// SIM1: a read-only copy of staging's catalogue and settings, for the throwaway database the simulation runs on.
// Read with HTTP GET through PostgREST (the repository secrets product-data.yml already uses: SUPABASE_SERVICE_KEY over the
// staging URL). Nothing here can write: the reader issues GET only, and the fetch guard (guard.ts) refuses any other method to
// staging and closes staging altogether once the copy is done. No parties, chats, orders or media are read: the tables are
// listed here, and every column that points at a person is emptied before the row is loaded.
export interface CopySpec { table: string; filter?: string }
/** The catalogue and the settings, in load order (a table before the tables that point at it). */
export const COPY_TABLES: CopySpec[] = [
  { table: "zones" }, { table: "villages" }, { table: "village_coords" }, { table: "travel_times" },
  { table: "sources" },
  { table: "products" }, { table: "product_aliases" }, { table: "offers" }, { table: "stock_levels" },
  // FD2: a place's dishes carry their option groups (sizes, bread, sauce); without them a dish would be ordered with no choice asked.
  { table: "dish_option_groups" }, { table: "dish_options" },
  { table: "language_pack" }, { table: "catalog_negation" }, { table: "catalog_filler" },
  { table: "catalog_categories" }, { table: "catalog_subgroups" }, { table: "catalog_placements" },
  { table: "delivery_window_plans" }, { table: "delivery_calendar" }, { table: "delivery_slots" },
  { table: "settings" }, { table: "fx_rates" },
  // Food facts a person approved (the only ones the Concierge may state); proposals stay on staging.
  { table: "product_facts", filter: "approved_at=not.is.null&superseded_at=is.null" },
];
/** Tables that must never be read, whatever a later edit adds above: people, conversations, orders, money, media. */
export const NEVER_COPY = ["parties", "party_identities", "conversations", "wa_messages", "wa_outbox", "orders", "order_items", "payments",
  "ledger_entries", "customer_places", "customer_memory", "handoffs", "payment_proofs", "consent_events", "agent_runs", "turns", "web_sessions"];

export type Copy = Record<string, Record<string, unknown>[]>;
const PAGE = 1000;

/** Reads every table of COPY_TABLES with GET. `fetchImpl` is the guarded fetch in the run and a fake in the tests. */
export async function readStaging(base: string, key: string, fetchImpl: typeof fetch = fetch, log: (s: string) => void = () => {}): Promise<Copy> {
  const out: Copy = {};
  for (const spec of COPY_TABLES) {
    if (NEVER_COPY.includes(spec.table)) throw new Error(`refusing to copy ${spec.table}`);
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const q = `select=*&limit=${PAGE}&offset=${offset}${spec.filter ? `&${spec.filter}` : ""}`;
      const res = await fetchImpl(`${base.replace(/\/+$/, "")}/rest/v1/${spec.table}?${q}`, {
        method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
      if (res.status === 404) { log(`[copy] ${spec.table}: not on staging, skipped`); break; }
      if (!res.ok) throw new Error(`STAGING_READ ${spec.table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const page = (await res.json()) as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    out[spec.table] = rows;
    log(`[copy] ${spec.table}: ${rows.length} rows`);
  }
  return out;
}

const PHONE = /^\+?[\d\s-]{7,18}$/;
/** Replaces anything in the settings that looks like a phone number (a transfer number, a staff line) with an invented one. */
export function scrubSettings(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; replaced: number } {
  let replaced = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const digits = v.replace(/[\s-]/g, "");
      if (PHONE.test(v) && /^\+?\d{7,15}$/.test(digits) && digits.replace(/^\+/, "").length >= 7) { replaced++; return "+99900000000"; }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  // TEST1: the simulated customers are real customers of the copy, never the friends' test: test mode stays off there (the copy is not
  // a database marked as staging, so 0271's lock would refuse it on anyway).
  const off = (r: Record<string, unknown>) => (r.key === "test_mode" ? { ...r, value: { ...(r.value as object), enabled: false } } : r);
  return { rows: rows.map((r) => off({ ...r, value: walk(r.value) })), replaced };
}
