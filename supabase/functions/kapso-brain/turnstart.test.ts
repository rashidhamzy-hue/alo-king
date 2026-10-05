import { describe, expect, it } from "vitest";
import { beginTurn, touchCustomer, type SbLike } from "./turnstart.ts";

type Call = { kind: "rpc" | "from"; name: string; ops: any[]; at: number };
// A fake Supabase client: records every round trip and answers from a script. `tick` lets tests see which calls were issued in the same tick (parallel).
function fake(script: { rpc?: (name: string, args: any) => any; from?: (table: string, ops: any[]) => any } = {}) {
  const calls: Call[] = []; let tick = 0, inflight = 0, maxIn = 0;
  const builder = (table: string) => {
    const ops: any[] = []; const rec = { kind: "from" as const, name: table, ops, at: 0 };
    const b: any = new Proxy({}, { get: (_t, prop: string) => {
      if (prop === "then") { rec.at = tick; calls.push(rec); inflight++; maxIn = Math.max(maxIn, inflight); const r = script.from?.(table, ops) ?? { data: null, error: null }; return (res: any, rej: any) => Promise.resolve(r).then((v) => { inflight--; return res(v); }, rej); }
      return (...args: any[]) => { ops.push([prop, ...args]); return b; };
    } });
    return b;
  };
  const sb: SbLike = {
    from: (t: string) => builder(t),
    rpc: (name: string, args: any) => { const rec: Call = { kind: "rpc", name, ops: [args], at: tick }; calls.push(rec); return Promise.resolve(script.rpc?.(name, args) ?? { data: null, error: null }); },
  } as any;
  return { sb, calls, next: () => { tick++; }, maxInflight: () => maxIn };
}
const CUST = { language: "en", handoff_until: null, full_name: "Sami", village: "Baakleen", last_address: "near the church", last_lat: null, last_lng: null };
const base = { messageId: "wamid.A", phone: "96170000001", norm: "96170000001", contextId: undefined, touchCustomer: true, lang: "en" as const };

describe("beginTurn: one round trip", () => {
  it("a customer turn is ONE query (dedupe + handoff lookup + owner lookup + customer touch + quick-menu flag)", async () => {
    const f = fake({ rpc: () => ({ data: { dup: false, hrow: null, owner: null, customer: CUST, has_quick: false }, error: null }) });
    const r = await beginTurn(f.sb, base);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ kind: "rpc", name: "bot_begin_turn" });
    expect(f.calls[0].ops[0]).toEqual({ p_message_id: "wamid.A", p_phone: "96170000001", p_norm: "96170000001", p_context_id: null, p_touch: true, p_lang: "en" });
    expect(r).toMatchObject({ dup: false, handoffCustomer: null, owner: null, customer: CUST, hasQuick: false, queries: 1 });
  });
  it("maps hrow and owner", async () => {
    const f = fake({ rpc: () => ({ data: { dup: false, hrow: "961700", owner: { vendor_id: "v1", name_en: "King" }, customer: null, has_quick: true }, error: null }) });
    const r = await beginTurn(f.sb, { ...base, contextId: "wamid.ctx", touchCustomer: false, lang: null });
    expect(r.handoffCustomer).toBe("961700"); expect(r.owner).toEqual({ vendor_id: "v1", name_en: "King" }); expect(r.customer).toBeNull(); expect(r.hasQuick).toBe(true);
    expect(f.calls[0].ops[0]).toMatchObject({ p_context_id: "wamid.ctx", p_touch: false, p_lang: null });
  });
  it("a duplicate delivery stops right there", async () => {
    const f = fake({ rpc: () => ({ data: { dup: true }, error: null }) });
    const r = await beginTurn(f.sb, base);
    expect(r.dup).toBe(true); expect(r.customer).toBeNull(); expect(r.owner).toBeNull(); expect(f.calls).toHaveLength(1);
  });
  it("no message id: nothing to dedupe, the RPC is told so", async () => {
    const f = fake({ rpc: () => ({ data: { dup: false, hrow: null, owner: null, customer: CUST, has_quick: false }, error: null }) });
    await beginTurn(f.sb, { ...base, messageId: undefined });
    expect(f.calls[0].ops[0].p_message_id).toBeNull();
  });
});

describe("beginTurn: fallback while the RPC is not deployed (identical to the old behaviour)", () => {
  const missing = { data: null, error: { code: "PGRST202", message: "Could not find the function public.bot_begin_turn" } };
  it.each([["PGRST202"], ["42883"]])("error %s falls back to the legacy queries", async (code) => {
    const f = fake({ rpc: () => ({ data: null, error: { code, message: "x" } }), from: (t) => (t === "customers" ? { data: CUST, error: null } : { data: null, error: null }) });
    const r = await beginTurn(f.sb, { ...base, contextId: "wamid.ctx" });
    expect(r.dup).toBe(false); expect(r.hasQuick).toBe(true); // unknown: the conservative answer keeps the old "always clear" behaviour
    const tables = f.calls.filter((c) => c.kind === "from").map((c) => c.name);
    expect(tables[0]).toBe("processed_messages"); // the dedupe gate comes first
    expect(tables).toContain("handoff_log"); expect(tables).toContain("vendors"); expect(tables).toContain("customers");
  });
  it("the legacy dedupe still stops a duplicate before any other query", async () => {
    const f = fake({ rpc: () => missing, from: (t) => (t === "processed_messages" ? { data: null, error: { code: "23505", message: "duplicate" } } : { data: null, error: null }) });
    const r = await beginTurn(f.sb, base);
    expect(r.dup).toBe(true);
    expect(f.calls.filter((c) => c.kind === "from").map((c) => c.name)).toEqual(["processed_messages"]);
  });
  it("legacy: hrow and owner are looked up in the same tick (parallel), and the customer is only touched for a plain customer turn", async () => {
    const f = fake({ rpc: () => missing, from: (t) => (t === "vendors" ? { data: { vendor_id: "v1", name_en: "King" }, error: null } : { data: null, error: null }) });
    const r = await beginTurn(f.sb, { ...base, contextId: "wamid.ctx" });
    expect(r.owner).toEqual({ vendor_id: "v1", name_en: "King" });
    expect(f.calls.some((c) => c.name === "customers")).toBe(false); // an owner turn never touches the customers table
    expect(f.calls.filter((c) => c.name === "handoff_log" || c.name === "vendors")).toHaveLength(2); expect(f.maxInflight()).toBe(2); // issued together, not one after the other
  });
  it("legacy with touchCustomer=false never touches customers", async () => {
    const f = fake({ rpc: () => missing });
    await beginTurn(f.sb, { ...base, touchCustomer: false });
    expect(f.calls.some((c) => c.name === "customers")).toBe(false);
  });
  it("an unexpected RPC error also falls back instead of dropping the message", async () => {
    const f = fake({ rpc: () => ({ data: null, error: { code: "57014", message: "statement timeout" } }) });
    const r = await beginTurn(f.sb, base);
    expect(r.dup).toBe(false); expect(f.calls.some((c) => c.name === "processed_messages")).toBe(true);
  });
});

describe("touchCustomer (when the RPC did not run the touch: owner 'customer:' prefix, replays)", () => {
  it("one upsert that bumps last_inbound_at and returns the row; it never overwrites other columns", async () => {
    const f = fake({ from: () => ({ data: CUST, error: null }) });
    const row = await touchCustomer(f.sb, "96170000001", "en");
    expect(f.calls).toHaveLength(1); expect(f.calls[0].name).toBe("customers");
    const up = f.calls[0].ops.find((o) => o[0] === "upsert"); expect(Object.keys(up[1]).sort()).toEqual(["last_inbound_at", "phone_number"]); expect(up[2]).toMatchObject({ onConflict: "phone_number" });
    expect(row).toEqual(CUST);
  });
  it("the language is set only when the customer has none and one was detected (one more query, as before)", async () => {
    const f = fake({ from: () => ({ data: { ...CUST, language: null }, error: null }) });
    const row = await touchCustomer(f.sb, "96170000001", "ar");
    expect(f.calls).toHaveLength(2);
    const upd = f.calls[1].ops; expect(upd.find((o) => o[0] === "update")[1]).toMatchObject({ language: "ar" }); expect(upd.some((o) => o[0] === "is" && o[1] === "language" && o[2] === null)).toBe(true);
    expect(row?.language).toBe("ar");
  });
  it("no detected language: no language query", async () => {
    const f = fake({ from: () => ({ data: { ...CUST, language: null }, error: null }) });
    await touchCustomer(f.sb, "96170000001", null);
    expect(f.calls).toHaveLength(1);
  });
  it("a failed touch returns null instead of throwing (the old code ignored these errors too)", async () => {
    const f = fake({ from: () => ({ data: null, error: { message: "boom" } }) });
    expect(await touchCustomer(f.sb, "96170000001", "en")).toBeNull();
  });
});

describe("the old sequential start-of-turn queries are gone from index.ts", () => {
  const src = require("node:fs").readFileSync(require("node:path").resolve(process.cwd(), "supabase/functions/kapso-brain/index.ts"), "utf8");
  it("the dedupe, handoff lookup, owner lookup and customer touch go through beginTurn / touchCustomer", () => {
    expect(src).toContain("await beginTurn(sb,");
    expect(src).not.toMatch(/from\("processed_messages"\)\.insert/);
    expect(src).not.toMatch(/from\("handoff_log"\)\.select\("customer_phone"\)\.eq\("admin_message_id"/);
    expect(src).not.toMatch(/from\("customers"\)\.upsert\(\{ phone_number: phone \}, \{ onConflict: "phone_number", ignoreDuplicates: true \}\)/);
    expect(src).not.toMatch(/update\(\{ last_inbound_at: new Date\(\)\.toISOString\(\) \}\)\.eq\("phone_number", phone\)/);
  });
  it("only the customer-bound start touches customers once: a duplicate never reaches handleCustomer", () => {
    expect(src).toMatch(/if \(start\.dup\) \{ console\.log\("duplicate, skipping"/);
  });
});
