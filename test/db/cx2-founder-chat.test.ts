// CX2: the founder's staging chat of 18 November (evals/cases/cx2_founder_chat.json). Through the real turn code, planner, tools and gateway,
// the reading scripted as the live model gave it. Nothing the customer asked for is dropped in silence (it is on the card, or a reply names
// it), and a «which one?» never offers a different kind of product than the words said.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, use, type Ids, type Sent } from "./flow-kit";
import chat from "../../evals/cases/cx2_founder_chat.json";

let db: TestDb;
let ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(async () => { vi.unstubAllGlobals(); await hours(OPEN); });

const OPEN = `{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}`;
const CLOSED = `{"open":"08:00","close":"08:00","tz":"Asia/Beirut"}`;
const hours = (h: string) => db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [h]);
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const titles = (s: Sent): string[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply?.title ?? "");
const noAddress = { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null };
const reading = (lines: { raw: string; query: string; qty: number }[]) => ({ intent: "order", fulfilment: "unknown", restrictions: [], address: noAddress,
  lines: lines.map((l) => ({ unit: "each", brand_hint: null, source_hint: null, confidence: 0.9, modifiers: [], ...l })) });
const pathOf = async (conversationId: string) =>
  (await db.all(`select trace->>'path' as path from agent_runs where conversation_id = $1 and agent = 'concierge' order by created_at`, [conversationId])).at(-1)?.path ?? null;

describe("CX2: the founder's chat, every line said", () => {
  it.each(chat.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    await hours(c.hours === "closed" ? CLOSED : OPEN);
    const reply = (c as { model_reply?: string }).model_reply;
    const t = flow(db, [read(reading(c.lines)), ...(reply ? [[use("reply", { text: reply })]] : [])]);
    const cust = await pinned(db, t, ids.BAAKLINE);
    await t.text(c.said);
    expect(t.seen.length).toBe(reply ? 2 : 1);                              // the reading only, unless the loop asks: code answers
    const path = await pathOf(cust.conversation_id);
    if (c.expect.path === "card") expect(path).toMatch(/card/); else expect(path).toBe(c.expect.path);
    const all = outbound.map((o) => [bodyOf(o), ...titles(o), JSON.stringify(o.body.interactive?.action?.sections ?? [])].join("\n")).join("\n");
    for (const x of c.expect.contains) expect(all).toContain(x);
    for (const x of c.expect.not_contains) expect(all).not.toContain(x);
  });

  it("0257: a plan line with JSON null for its candidates (or a word that is not a list) never stops the planner (language gate 44303688282)", async () => {
    expect((await db.one(`select catalog_other_kind('["mate"]'::jsonb, 'null'::jsonb) as r`)).r).toBe(true);
    expect((await db.one(`select catalog_other_kind('"mate"'::jsonb, '[]'::jsonb) as r`)).r).toBe(false);
    expect((await db.one(`select catalog_other_kind(null, null) as r`)).r).toBe(false);
  });

  it(`${chat.loop.id}: the model's reply did not name the line; code does`, async () => {
    // «لبنة» alone with no house default is the loop's question (B1c); the model asks about the labneh and nothing else.
    await db.pg.query(`update products set house_default = false where sku = $1`, [chat.loop.no_house_default]);
    const t = flow(db, [read(reading(chat.loop.lines)), [use("reply", { text: chat.loop.model_reply })]]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text(chat.loop.said);
    await db.pg.query(`update products set house_default = true where sku = $1`, [chat.loop.no_house_default]);
    expect(t.seen.length).toBe(2);
    const all = outbound.map(bodyOf).join("\n");
    expect(all).toContain(chat.loop.model_reply);
    for (const x of chat.loop.expect.contains) expect(all).toContain(x);
  });
});
