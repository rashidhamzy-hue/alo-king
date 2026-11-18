import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// SIM1: the throwaway database a batch of simulated conversations runs on. PGlite (Postgres in the process, the database every
// test/db test uses) with every migration on main, then staging's catalogue and settings loaded over it (staging.ts), or the
// repository seeds when no copy is given (local runs and tests). Nothing here is ever sent anywhere.
//
// What the run changes in its own copy, all printed and listed in the report:
//   the clock    settings.hours.tz is moved to a fixed-offset zone so the database's "now" reads 02:xx (night batch), the
//                opening hour plus one (the morning after) or 11:xx (day: hours of opening left, whenever the job runs);
//   stock        on_hand = 0 for the out-of-stock scenarios' products (scenarios.ts oosPool);
//   gaps         an exchange rate, stock and a hub village only if the copy has none (each says so).
import { openTestDb, type TestDb } from "../../test/db/harness";
import { COPY_TABLES, scrubSettings, type Copy } from "./staging";

export interface VillageInfo { id: string; name_en: string; name_ar: string | null; served: boolean; lat: number | null; lng: number | null }
export interface World {
  label: string;
  db: TestDb;
  source: "staging" | "repo-seeds";
  adjustments: string[];
  hub: string;
  sku: Map<string, string>;
  villages: Map<string, VillageInfo>;
  hours: { open: string; close: string; tz: string };
  setClock(target: "day" | "night" | "morning"): Promise<string>;
}

const jsonTypes = new Set(["json", "jsonb"]);
const arrLiteral = (a: unknown[]) => `{${a.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;

/** The one staff party the copy's "who decided" columns point at (created in the throwaway database; no real party is ever copied). */
export const STAND_IN_STAFF = "00000000-0000-4000-8000-0000000000c1";
/** The rule party (0124): created by the migrations, so it exists in every throwaway database; 0207's check names it as the approver of a published_sources fact. */
const AUTO_PARTY = "00000000-0000-4000-8000-0000000000a1";
/** A column that records who proposed, approved, reviewed or decided: kept, pointing at the stand-in, so what a person approved stays approved. */
const isDecider = (col: string) => /_by$/.test(col);

async function loadCopy(db: TestDb, copy: Copy, log: (s: string) => void): Promise<string[]> {
  const notes: string[] = [];
  await db.pg.query(`insert into parties(id, role, display_name, notes) values ($1, 'ops_lead', 'Stand-in staff (simulation copy)', 'Stands in for every person who approved or proposed something in the copy.') on conflict (id) do nothing`, [STAND_IN_STAFF]);
  const copied = new Set(COPY_TABLES.map((t) => t.table).filter((t) => copy[t]));
  const keepTargets = new Set([...copied, "food_attributes"]);
  await db.pg.exec("set session_replication_role = replica");
  try {
    for (const spec of [...COPY_TABLES].reverse()) if (copied.has(spec.table)) await db.pg.exec(`delete from ${spec.table}`);
    for (const spec of COPY_TABLES) {
      let rows = copy[spec.table];
      if (!rows) continue;
      if (spec.table === "settings") { const s = scrubSettings(rows); rows = s.rows; if (s.replaced) notes.push(`settings: ${s.replaced} phone-like value(s) replaced by +99900000000`); }
      const cols = await db.all<{ column_name: string; data_type: string; is_generated: string; identity_generation: string | null; is_nullable: string }>(
        `select column_name, data_type, is_generated, identity_generation, is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1`, [spec.table]);
      const fks = await db.all<{ col: string; target: string }>(`select a.attname as col, c.confrelid::regclass::text as target from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.conrelid = $1::regclass`, [spec.table]);
      // A column pointing at a person (or anything not copied) is emptied: no party reaches the copy.
      const blank = new Set(fks.filter((f) => !keepTargets.has(f.target.replace(/^public\./, ""))).map((f) => f.col));
      // ... except the columns that say who decided, when they point at a party: those point at the stand-in staff party (a stored decision
      // keeps its decider, or 0021's check refuses an approved fact with no approver).
      const standIn = new Set(fks.filter((f) => blank.has(f.col) && isDecider(f.col) && f.target.replace(/^public\./, "") === "parties").map((f) => f.col));
      const usable = cols.filter((c) => c.is_generated === "NEVER");
      const always = usable.some((c) => c.identity_generation === "ALWAYS");
      const names = usable.map((c) => c.column_name).filter((c) => rows!.some((r) => c in r));
      let skipped = 0;
      const enc = (c: (typeof usable)[number], v: unknown): unknown => {
        if (standIn.has(c.column_name)) return v === null || v === undefined ? null : v === AUTO_PARTY ? AUTO_PARTY : STAND_IN_STAFF;
        if (blank.has(c.column_name) || v === null || v === undefined) return null;
        if (jsonTypes.has(c.data_type)) return JSON.stringify(v);
        if (c.data_type === "ARRAY" && Array.isArray(v)) return arrLiteral(v);
        if (typeof v === "object") return JSON.stringify(v);
        return v;
      };
      const meta = names.map((n) => usable.find((c) => c.column_name === n)!);
      const ok = rows.filter((r) => { const bad = meta.some((c) => blank.has(c.column_name) && !standIn.has(c.column_name) && c.is_nullable === "NO" && r[c.column_name] !== null); if (bad) skipped++; return !bad; });
      for (let i = 0; i < ok.length; i += 200) {
        const chunk = ok.slice(i, i + 200);
        const params: unknown[] = [];
        const values = chunk.map((r) => "(" + meta.map((c) => { params.push(enc(c, r[c.column_name])); return `$${params.length}`; }).join(",") + ")").join(",");
        await db.pg.query(`insert into ${spec.table} (${names.map((n) => `"${n}"`).join(",")}) ${always ? "overriding system value " : ""}values ${values} on conflict do nothing`, params);
      }
      if (blank.size) notes.push(`${spec.table}: ${[...blank].filter((c) => !standIn.has(c)).join(", ") || "no column"} emptied${standIn.size ? `; ${[...standIn].join(", ")} point at the stand-in staff party` : ""}${skipped ? `, ${skipped} row(s) left out` : ""}`);
      log(`[world] ${spec.table}: ${ok.length} rows loaded`);
    }
  } finally { await db.pg.exec("set session_replication_role = origin"); }
  return notes;
}

/** The fixed-offset zone whose local hour is `hour` now (Etc/GMT-3 is UTC+3). */
export function zoneForHour(hour: number, now = new Date()): string {
  let off = ((hour - now.getUTCHours()) % 24 + 24) % 24;
  if (off > 14) off -= 24;
  return off === 0 ? "Etc/GMT" : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export async function openWorld(opts: { label: string; copy: Copy | null; oosSkus: string[]; log?: (s: string) => void }): Promise<World> {
  const log = opts.log ?? (() => {});
  const db = await openTestDb({ seeds: !opts.copy, welcome: true });
  const adjustments: string[] = [];
  if (opts.copy) adjustments.push(...(await loadCopy(db, opts.copy, log)));
  // Gaps the copy may have; each is said.
  if (!(await db.one(`select 1 as x from fx_rates limit 1`))) { await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`); adjustments.push("no exchange rate in the copy: 89,500 LBP per USD inserted"); }
  if (Number((await db.one(`select coalesce(sum(on_hand), 0) as s from stock_levels`)).s) === 0) {
    await db.pg.exec(`update stock_levels set on_hand = 5000`); adjustments.push("no stock in the copy: 5,000 of every product (as scripts/staging/prepare-staging.sql does)");
  }
  let hub = (await db.one(`select id, village_id from sources where kind = 'dark_store' order by id limit 1`)) as { id: string; village_id: string | null } | undefined;
  if (!hub) throw new Error("the copy has no dark store (sources.kind = 'dark_store')");
  if (!hub.village_id) {
    await db.pg.query(`update sources set village_id = (select id from villages where name_en = 'Baakline') where id = $1`, [hub.id]);
    adjustments.push("the hub had no village: Baakline set"); hub = { ...hub };
  }
  // FD2: the seeded test place (invented; testers only), for the food scenarios. The same file staging and the tests use.
  try { await db.pg.exec(readFileSync(fileURLToPath(new URL("../../scripts/staging/test-place.sql", import.meta.url)), "utf8")); adjustments.push("the seeded test place (scripts/staging/test-place.sql)"); }
  catch (e) { adjustments.push(`the test place could not be seeded: ${String(e).slice(0, 120)}`); }
  const sku = new Map((await db.all<{ sku: string; id: string }>(`select sku, id from products`)).map((r) => [r.sku, r.id]));
  if (opts.oosSkus.length) {
    const ids = opts.oosSkus.map((s) => sku.get(s)).filter((x): x is string => !!x);
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = any($1::uuid[])`, [`{${ids.join(",")}}`]);
    adjustments.push(`out-of-stock scenarios: on_hand = 0 for ${ids.length} product(s) (${opts.oosSkus.filter((s) => !sku.has(s)).length} SKU(s) not in the copy)`);
  }
  const villages = new Map((await db.all<any>(`select v.id, v.name_en, v.name_ar, coalesce(v.is_served, false) as served, c.lat, c.lng
      from villages v left join village_coords c on c.name_en = v.name_en`)).map((v) => [v.name_en as string,
      { id: v.id, name_en: v.name_en, name_ar: v.name_ar, served: !!v.served, lat: v.lat === null ? null : Number(v.lat), lng: v.lng === null ? null : Number(v.lng) }]));
  const h = (await db.one(`select value from settings where key = 'hours'`))?.value ?? { open: "08:00", close: "23:00", tz: "Asia/Beirut" };
  const hours = { open: String(h.open ?? "08:00"), close: String(h.close ?? "23:00"), tz: String(h.tz ?? "Asia/Beirut") };
  const world: World = {
    label: opts.label, db, source: opts.copy ? "staging" : "repo-seeds", adjustments, hub: hub.id, sku, villages, hours,
    async setClock(target) {
      const openH = Math.floor(toMin(hours.open) / 60);
      let tz = hours.tz;
      if (target === "night") tz = zoneForHour(2);
      else if (target === "morning") tz = zoneForHour(openH + 1);
      // Day: always a fixed-offset zone where it is late morning, so a run of several hours never crosses closing time.
      else tz = zoneForHour(Math.max(11, Math.min(openH + 3, 20)));
      await db.pg.query(`update settings set value = jsonb_set(value, '{tz}', to_jsonb($1::text)) where key = 'hours'`, [tz]);
      const local = (await db.one(`select to_char(now() at time zone $1, 'HH24:MI') as t`, [tz])).t as string;
      const note = `${opts.label}: clock "${target}" -> settings.hours.tz = ${tz} (database local time ${local}; hours ${hours.open}-${hours.close})`;
      adjustments.push(note); log(`[world] ${note}`);
      return local;
    },
  };
  return world;
}
