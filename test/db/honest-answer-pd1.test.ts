// PD1 (g): the honest answer when nothing fits (evals/cases/pd1_honest_answer.json): the two voice notes of 15 November, on today's
// seed, through the real turn code, tools and gateway with a scripted reading. Code answers; the model is called once (the reading).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso, type Sent } from "./flow-kit";
import { makeFactComplete } from "./fact-kit";
import cases from "../../evals/cases/pd1_honest_answer.json";
import { factsAsked, kindOf, audienceOf } from "@ak/agents/honest";

let db: TestDb;
beforeAll(async () => { ({ db } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const line = (l: { raw: string; query: string; qty: number; modifiers: string[] }) =>
  ({ unit: "each", brand_hint: null, source_hint: null, confidence: 0.9, ...l });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const order = (lines: unknown[], language: string, intent = "order") =>
  ({ intent, language, fulfilment: "unknown", lines, address: { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });

describe("PD1 (g): the two voice notes get the honest answer and a demand row", () => {
  it.each(cases.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const t = flow(db, [read(order(c.lines.map(line), c.language))]);
    const party = (await t.customer()).party_id;
    await t.text(c.said);
    expect(t.seen.length).toBe(1);                                       // the reading only: no ask loop, no model words
    expect(outbound.length).toBe(1);
    const sent = outbound[0]!;
    expect(sent.body.type).toBe("text");                                 // no buttons, so no catalogue button
    const body = bodyOf(sent);
    for (const x of c.expect.contains) expect(body).toContain(x);
    for (const x of c.expect.not_contains) expect(body.toLowerCase()).not.toContain(x.toLowerCase());
    expect(body.split("\n").filter((l) => l.startsWith("$")).length).toBeLessThanOrEqual(3);   // at most three items, each priced
    const d = await db.one(`select kind::text, detail from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party]);
    expect(d.kind).toBe(c.expect.kind);
    expect(d.detail.facts_asked).toEqual(c.expect.facts);
    expect(d.detail.audience).toBe(c.expect.audience);
    expect(d.detail.quantity).toBe(c.expect.quantity);
    expect(d.detail.language).toBe(c.language);
    expect(typeof d.detail.kind_asked).toBe("string");
  });

  it("an item whose own name holds the words is ordered as usual, not answered as a fact («ليبتون زيرو شوغر»)", async () => {
    const t = flow(db, [read(order([line({ raw: "ليبتون ايس تي ريد فروتس زيرو شوغر", query: "ليبتون ايس تي ريد فروتس زيرو شوغر", qty: 2, modifiers: [] })], "ar_lb"))]);
    const party = (await t.customer()).party_id;
    await t.text("بدي تنين ليبتون ايس تي ريد فروتس زيرو شوغر");
    expect(await db.all(`select 1 from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party])).toEqual([]);
  });

  // SR1 changed this case (docs/HANDOFF.md, SR1, "Changed expectations"): before SR1 an approved record for any product of the kind let the
  // usual path answer; now the record must show that the product fits. Kinder's panel says 52 g sugar, so it never passes "no sugar"; the
  // other snacks are unknown, so the honest answer runs and the request is logged.
  it("an approved record that shows the product does not fit lets nothing through: the honest answer runs (SR1)", async () => {
    const kinder = (await db.one(`select id from products where name_en = 'Kinder Chocolate Barrette Maxi 21G'`)).id;
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops PD1') returning id`)).id;
    await makeFactComplete(db, kinder, ops, { nutrition: { energy_kcal: 550, fat: 33, carbohydrates: 53, proteins: 9, sugars: 52 } });
    const t = flow(db, [read(order([line({ raw: "snacks with no sugar", query: "snacks", qty: 1, modifiers: [] })], "en"))]);
    const party = (await t.customer()).party_id;
    await t.text("snacks with no sugar");
    const body = outbound.map(bodyOf).join("\n");
    expect(body).toContain("I can't confirm the sugar for our snacks yet");
    expect(body).not.toContain("Kinder");
    expect(await db.all(`select 1 from demand_signals where party_id = $1 and origin = 'honest_answer'`, [party])).toHaveLength(1);
    await db.pg.query(`update product_facts set superseded_at = now() where product_id = $1`, [kinder]);
  });
});

describe("PD1 (g): reading the facts, the kind and the audience from the customer's words", () => {
  it.each([
    ["snacks with no sugar for 5 kids", ["sugar"], "kids"], ["protein bars with no sugar", ["sugar"], null],
    ["بدي سناكس بلا سكر لخمس ولاد", ["sugar"], "kids"], ["baddi snacks bala sekkar la 5 wled", ["sugar"], "kids"],
    ["des snacks sans sucre pour 5 enfants", ["sugar"], "kids"], ["high protein yoghurt", ["protein"], null],
    ["fragrance-free shampoo for kids", ["fragrance"], "kids"], ["gluten free bread", ["gluten"], null], ["2 khebez", [], null],
  ] as const)("%s", (said, facts, audience) => {
    expect(factsAsked(said)).toEqual(facts);
    expect(audienceOf(said)).toBe(audience);
  });
  it.each([
    ["snacks with no sugar", "snacks"], ["protein bars with no sugar", "protein bars"], ["سناكس بلا سكر لخمس ولاد", "سناكس"],
    ["snacks bala sekkar la 5 wled", "snacks"], ["des snacks sans sucre pour 5 enfants", "snacks"], ["fragrance-free shampoo for kids", "shampoo"],
  ] as const)("the kind in «%s» is «%s»", (words, kind) => { expect(kindOf(words)).toBe(kind); });
});
