// Test rig for the console: the real migrations in PGlite, the real gateway send (Kapso's HTTP replaced),
// Supabase Auth and Storage replaced by small fakes. Pages are driven through handle() as a browser would.
import { vi } from "vitest";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "../../../test/db/harness";
import { supabaseOver } from "../../../test/db/supabase-shim";
import { handle, type Deps, type Section } from "../src/app";
import { DbError, checkIdent, type Db, type Query } from "../src/db";
import type { AuthUser, StaffAuth } from "../src/auth";
import type { Media } from "../src/media";
import { registry } from "../src/pages";
import type { Role } from "../src/roles";

/** The console's Db over the test database: the same two verbs, in SQL. */
export function pgDb(db: TestDb): Db {
  const wrap = (e: unknown) => new DbError((e as Error).message, (e as { code?: string }).code);
  return {
    async rpc(fn, args = {}) {
      try {
        // A set-returning function comes back as a list of rows, as PostgREST returns it.
        const f = await db.one<{ proretset: boolean }>("select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1", [checkIdent(fn)]);
        if (f?.proretset) {
          const keys = Object.keys(args);
          const call = keys.map((k, i) => `${checkIdent(k)} => $${i + 1}`).join(", ");
          return await db.all(`select * from ${fn}(${call})`, keys.map((k) => args[k])) as any;
        }
        return await db.rpc(fn, args);
      } catch (e) { throw wrap(e); }
    },
    async rows(table, q: Query = {}) {
      const params: unknown[] = [];
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const conds = Object.entries(q.where ?? {}).map(([col, c]) => {
        checkIdent(col);
        if (c === null) return `${col} is null`;
        if (typeof c === "object") {
          if ("in" in c) return c.in.length ? `${col}::text = any(${p(c.in.map(String))}::text[])` : "false";
          if ("not" in c) return `${col} is distinct from ${p(c.not)}`;
          if ("gte" in c) return `${col} >= ${p(c.gte)}`;
          if ("lte" in c) return `${col} <= ${p(c.lte)}`;
          if ("lt" in c) return `${col} < ${p(c.lt)}`;
          if ("isNull" in c) return `${col} is ${c.isNull ? "" : "not "}null`;
        }
        return `${col} = ${p(c)}`;
      });
      const cols = (q.select ?? "*").split(",").map((s) => s.trim()).map((s) => (s === "*" ? s : checkIdent(s))).join(", ");
      const order = q.order?.length ? " order by " + q.order.map((o) => `${checkIdent(o.col)}${o.desc ? " desc" : ""}`).join(", ") : "";
      const sql = `select ${cols} from ${checkIdent(table)}${conds.length ? " where " + conds.join(" and ") : ""}${order}${q.limit ? ` limit ${Math.floor(q.limit)}` : ""}`;
      try { return await db.all(sql, params); } catch (e) { throw wrap(e); }
    },
    async hasFunction(fn) { return !!(await db.one("select 1 as x from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn])); },
  };
}

export class FakeAuth implements StaffAuth {
  users = new Map<string, { password: string; user: AuthUser }>();
  tokens = new Map<string, AuthUser>();
  passwordsSet: { userId: string; password: string }[] = [];
  down = false;
  add(email: string, password: string, partyId: string | null) {
    const user = { id: crypto.randomUUID(), email, partyId };
    this.users.set(email, { password, user });
    return user;
  }
  async signIn(email: string, password: string) {
    if (this.down) { const { AuthUnavailable } = await import("../src/auth"); throw new AuthUnavailable("auth_503"); }
    const u = this.users.get(email);
    return u && u.password === password ? u.user : null;
  }
  async userFromToken(t: string) { return this.tokens.get(t) ?? null; }
  async setPassword(userId: string, password: string) {
    this.passwordsSet.push({ userId, password });
    for (const u of this.users.values()) if (u.user.id === userId) u.password = password;
  }
}

export class FakeMedia implements Media {
  objects = new Map<string, string>();
  failPut = false;
  async sign(path: string, seconds: number) { return `https://media.test/${path}?token=t&expires=${seconds}`; }
  async put(path: string, body: string | ArrayBuffer) {
    if (this.failPut) throw new Error("storage_503");
    if (this.objects.has(path)) throw new Error("storage_409");
    this.objects.set(path, typeof body === "string" ? body : `[${body.byteLength} bytes]`);
  }
  audit(): Record<string, any>[] {
    return [...this.objects.entries()].filter(([k]) => k.startsWith("console_audit/")).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => JSON.parse(v));
  }
}

export const KAPSO_ENV = { KAPSO_BASE_URL: "https://api.kapso.test/meta/whatsapp/v24.0", KAPSO_API_KEY: "test-key", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };

export interface Rig {
  db: TestDb; deps: Deps; auth: FakeAuth; media: FakeMedia;
  /** Every request Kapso would have received. */
  kapso: { url: string; body: any }[];
  staff(role: Role | "driver" | "customer", name?: string): Promise<{ partyId: string; email: string; password: string }>;
  browser(sections?: Section[]): Browser;
  source: string;
}

/** `without`: SQL functions to drop, to prove a page says plainly when the database it talks to lacks one (staging can lag). */
export async function rig(opts: { without?: string[] } = {}): Promise<Rig> {
  const db = await openTestDb();
  for (const fn of opts.without ?? []) await db.pg.exec(`drop function ${checkIdent(fn)}`);
  const auth = new FakeAuth();
  const media = new FakeMedia();
  const kapso: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    kapso.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: `wamid.T${kapso.length}` }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  }));
  const supa = supabaseOver(db).client;
  const deps: Deps = {
    db: pgDb(db), auth, media,
    send: (req) => gatewaySend(supa, KAPSO_ENV, req),
    secret: "test-secret-test-secret-test-secret-1234", environment: "test", supabaseUrl: "https://project.supabase.test",
    now: () => new Date(),           // the database's now() moves on during a test; a clock frozen at rig() made "late" drift
  };
  const source = (await db.one<{ id: string }>("select id from sources where kind = 'dark_store' limit 1"))?.id ?? "";
  let n = 0;
  return {
    db, deps, auth, media, kapso, source,
    async staff(role, name) {
      n++;
      const party = await db.one<{ id: string }>("insert into parties(role, display_name) values ($1, $2) returning id", [role, name ?? `${role} ${n}`]);
      const email = `${role}${n}@staff.test`;
      const password = `correct horse ${n}`;
      auth.add(email, password, party.id);
      return { partyId: party.id, email, password };
    },
    browser: (sections) => new Browser(deps, sections),
  };
}

export class Browser {
  cookies = new Map<string, string>();
  csrf = "";
  last = "";
  lastPath = "/";
  constructor(readonly deps: Deps, readonly sections: Section[] = registry) {}
  private async go(method: string, path: string, body?: URLSearchParams | FormData, headers: Record<string, string> = {}) {
    const h = new Headers(headers);
    if (this.cookies.size) h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (body instanceof URLSearchParams) h.set("content-type", "application/x-www-form-urlencoded");
    const res = await handle(new Request(`https://console.test${path}`, { method, headers: h, body }), this.deps, this.sections);
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(";");
      const [k, v] = [pair!.slice(0, pair!.indexOf("=")), pair!.slice(pair!.indexOf("=") + 1)];
      if (attrs.some((a) => a.trim() === "Max-Age=0")) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await res.text();
    if (method === "GET") { this.last = text; this.lastPath = path; const m = /name="_csrf" value="([^"]+)"/.exec(text); if (m) this.csrf = m[1]!; }
    return { status: res.status, location: res.headers.get("location"), text, headers: res.headers };
  }
  get(path: string) { return this.go("GET", path); }
  /** Posts a form with the page's CSRF token, then follows the redirect (as a browser does) and returns that page. */
  async post(path: string, fields: Record<string, string | number> = {}, opts: { csrf?: string; follow?: boolean; headers?: Record<string, string> } = {}) {
    const body = new URLSearchParams({ _csrf: opts.csrf ?? this.csrf, _key: crypto.randomUUID(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) });
    const r = await this.go("POST", path, body, { referer: "https://console.test" + this.lastPath, ...opts.headers });
    if (r.status === 303 && opts.follow !== false && r.location) return this.get(r.location);
    return r;
  }
  /** A form with files (multipart), as a browser sends a photo. */
  async postFiles(path: string, fields: Record<string, string | number>, files: Record<string, { name: string; type: string; bytes: Uint8Array<ArrayBuffer> }>) {
    const fd = new FormData();
    fd.set("_csrf", this.csrf); fd.set("_key", crypto.randomUUID());
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const [k, f] of Object.entries(files)) fd.set(k, new File([f.bytes], f.name, { type: f.type }));
    const r = await this.go("POST", path, fd, { referer: "https://console.test" + this.lastPath });
    if (r.status === 303 && r.location) return this.get(r.location);
    return r;
  }
  async signIn(who: { email: string; password: string }) {
    await this.get("/sign-in");
    const r = await this.post("/sign-in", { email: who.email, password: who.password });
    return r;
  }
}

/** The message shown after an action (the flash), or "" if none. */
export const flashOf = (page: string) => /<p class="flash (?:ok|err)">([^<]*)<\/p>/.exec(page)?.[1]?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") ?? "";

// ---------- a small shop, as in test/db/rider-settlement.test.ts ----------
export const FX = 89500;
export async function openShop(db: TestDb) {
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (${FX});
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  const village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id as string;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [village]);
  return village;
}
let orderSeq = 0;
export async function placeOrder(db: TestDb, village: string, payment: "cod" | "whish" | "omt" = "cod", qty = 12) {
  const n = ++orderSeq;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-c${n}`, p_phone: `+9617020000${n}`, p_name: `Customer ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const prod = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: prod, qty }],
    p_village: village, p_place: place, p_pickup: false, p_payment: payment, p_change_for: null, p_notes: null });
  await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-c${n}` });
  const row = await db.one(`select short_code, total_usd, delivery_fee_usd from orders where id = $1`, [o.order_id]);
  return { id: o.order_id as string, code: row.short_code as string, total: Number(row.total_usd), fee: Number(row.delivery_fee_usd),
           customer: t.party_id as string, conversation: t.conversation_id as string, product: prod as string };
}
export async function deliver(db: TestDb, orderId: string, rider: string) {
  const d = await db.rpc("dispatch_order", { p_order: orderId });
  await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
  await db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });
  return { delivery: d.delivery_id as string, result: await db.rpc("rider_delivered", { p_order: orderId, p_driver: rider }) };
}
/** Cash reaches the hub drawer as in life: the rider drops what they hold at the hub and the ops lead confirms it. */
export async function dropAtHub(db: TestDb, rider: string, by: string) {
  const n = await db.one(`select * from driver_cash_native($1)`, [rider]);
  const drop = await db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: Number(n.usd), p_lbp: Number(n.lbp) });
  await db.rpc("confirm_cash_drop", { p_drop: drop, p_by: by });
  return Number(n.usd);
}
export async function drawerUsd(db: TestDb) {
  return Number((await db.one(`select usd from account_native('hub_cash')`)).usd);
}
export async function ledgerSum(db: TestDb) {
  return Number((await db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s);
}
