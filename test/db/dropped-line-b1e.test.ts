// B1e: a kind and a fact with no product name, read with no line (evals/cases/b1e_dropped_line.json; QA1's case
// evals/cases/qa1_dropped_line.json). Through the real turn code, tools and gateway with the reading scripted as the live model gave it.
// The customer is a returning one (a closed order), as on staging. Code answers: PD1's honest answer and a demand row; never the
// returning-customer welcome, never a line about an order that does not exist. A fact alone and a restriction inside a real order keep
// what they did before.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import cases from "../../evals/cases/b1e_dropped_line.json";
import qa1 from "../../evals/cases/qa1_dropped_line.json";
import { wrongLanguage } from "../../evals/sim/checks";
import { messages } from "@ak/agents/messages";

let db: TestDb;
let ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const noAddress = { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null };
const line = (l: { raw: string; query: string; qty: number; modifiers: string[] }) =>
  ({ unit: "each", brand_hint: null, source_hint: null, confidence: 0.9, ...l });
const reading = (r: { intent: string; lines: { raw: string; query: string; qty: number; modifiers: string[] }[]; restrictions: string[] }, language: string) =>
  ({ intent: r.intent, language, fulfilment: "unknown", lines: r.lines.map(line), restrictions: r.restrictions, address: noAddress });

/** A returning customer: pinned in Baakline, one closed order delivered days ago (QA1 sent the note after AK-1058 closed). */
async function returning(t: ReturnType<typeof flow>) {
  const c = await pinned(db, t, ids.BAAKLINE);
  const o = (await db.one(`insert into orders(customer_id, short_code, status, village_id, delivered_at) values ($1, $3, 'closed', $2, now() - interval '2 days') returning id`,
    [c.party_id, ids.BAAKLINE, `AK-E${Math.floor(Math.random() * 1e6)}`])).id;
  const f = (await db.one(`insert into fulfilments(order_id, source_id) select $1, id from sources where kind = 'dark_store' limit 1 returning id`, [o])).id;
  await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd) values ($1, $2, $3, 'x', 2, 5)`, [o, f, ids.LABNEH]);
  return c;
}
const pathOf = async (conversationId: string) =>
  (await db.all(`select trace->>'path' as path from agent_runs where conversation_id = $1 and agent = 'concierge' order by created_at`, [conversationId])).at(-1)?.path ?? null;
const demand = (party: string) => db.all(`select kind::text, query, detail from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party]);
const expectedLang = (l: string) => (l === "ar_lb" ? "ar" : l) as "ar" | "arabizi" | "en" | "fr";

describe("B1e: a kind and a fact with no line get PD1's honest answer and a demand row", () => {
  it.each(cases.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const t = flow(db, [read(reading(c.reading, c.language))]);
    const cust = await returning(t);
    await t.text(c.said);
    expect(t.seen.length).toBe(1);                                       // the reading only: code answers
    expect(await pathOf(cust.conversation_id)).toBe(c.expect.path);
    const all = outbound.map(bodyOf).join("\n");
    for (const x of c.expect.contains) expect(all).toContain(x);
    for (const x of c.expect.not_contains) expect(all).not.toContain(x);
    for (const o of outbound) expect(wrongLanguage(expectedLang(c.language), bodyOf(o))).toBeNull();
    const rows = await demand(cust.party_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe(c.expect.kind);
    expect(rows[0].detail.kind_asked).toBe(c.expect.query);
    expect(rows[0].detail.facts_asked).toEqual(c.expect.facts);
  });

  it("QA1's case, as written (evals/cases/qa1_dropped_line.json)", async () => {
    const q = qa1.readings[0]!;
    const t = flow(db, [read({ ...q.reading, fulfilment: "unknown", address: noAddress })]);
    const cust = await returning(t);
    await t.text(q.text);
    const all = outbound.map(bodyOf).join("\n");
    for (const x of q.expect.reply.contains) expect(all).toContain(x);
    for (const x of q.expect.reply.not_contains) expect(all).not.toContain(x);
    const rows = await demand(cust.party_id);
    expect(rows.map((r) => [r.kind, r.detail.kind_asked])).toEqual([[q.expect.demand_row.kind, q.expect.demand_row.query]]);
  });
});

describe("B1e: a fact alone keeps its path; the restriction line is in the customer's language and names no order that does not exist", () => {
  const alone = cases.unchanged.filter((c) => c.expect.restriction_line);
  it.each(alone.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const t = flow(db, [read(reading(c.reading, c.language))]);
    const cust = await returning(t);
    await t.text(c.said);
    expect(await pathOf(cust.conversation_id)).not.toBe("honest_answer");
    expect(await demand(cust.party_id)).toHaveLength(c.expect.demand_rows!);
    const offer = outbound.find((o) => (o.body.interactive?.action?.buttons ?? []).some((b: any) => b.reply?.id === "memory:keep:yes"));
    expect(offer).toBeDefined();                                         // the offer to remember stays
    const text = bodyOf(offer!);
    for (const x of c.expect.restriction_line!.not_contains) expect(text).not.toContain(x);
    expect(wrongLanguage(c.expect.restriction_line!.language as "ar" | "en", text)).toBeNull();
    const R = messages(c.expect.restriction_line!.language as "ar" | "en").remember;
    expect(offer!.body.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual([R.yes, R.no]);
  });

  // A restriction inside a real order: the path is the one it had before B1e (the eval file's notes say why each is so).
  const real = cases.unchanged.filter((c) => "demand" in c.expect);
  it.each(real.map((c) => [c.id, c] as const))("%s: the path it had before B1e", async (_id, c) => {
    const e = c.expect as { path?: string; not_path?: string; demand: string[][]; contains?: string[]; not_contains?: string[] };
    const t = flow(db, [read(reading(c.reading, c.language))]);
    const cust = await returning(t);
    await t.text(c.said);
    const path = await pathOf(cust.conversation_id);
    if (e.path) expect(path).toBe(e.path);
    if (e.not_path) expect(path).not.toBe(e.not_path);
    expect((await demand(cust.party_id)).map((r) => [r.kind, r.detail.kind_asked])).toEqual(e.demand);
    const all = outbound.map(bodyOf).join("\n");
    for (const x of e.contains ?? []) expect(all).toContain(x);
    for (const x of e.not_contains ?? []) expect(all).not.toContain(x);   // B1f
    expect(all).not.toContain("Welcome to Alo King");
    for (const o of outbound) expect(wrongLanguage(expectedLang(c.language), bodyOf(o))).toBeNull();
    if (c.language === "en") expect(all).not.toContain("على طلبك");
  });
});
