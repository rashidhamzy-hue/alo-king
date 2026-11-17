// SELL1 (0226), the chat: with sell_requires_label on, a packaged item with no label reading yet is said "coming soon" by CODE (messages
// basket.comingSoon, in the customer's language), before any pin request or card; no card is made while the basket holds it. With the
// setting off the same message gets what it always got. Through the real turn code, tools and gateway on the real schema, a scripted model.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { productName } from "@ak/agents/messages";
import type { TestDb } from "./harness";
import { makeFactComplete } from "./fact-kit";
import { flow, openFlowDb, read, recordKapso, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids; let ops: string;
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops SELL1') returning id`)).id;
}, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());
const gate = (on: boolean) => db.pg.query(`update settings set value = $1::jsonb where key = 'sell_requires_label'`, [JSON.stringify({ enabled: on })]);

const line = (raw: string, query: string, qty = 1) => ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9 });
const LABNEH = line("لبنة ليبان ليه 900 غ", "Liban Lait Labneh Baladieh 900G");
const address = (a: Record<string, string | null> = {}) => ({ village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null, ...a });
const order = (lines: unknown[], a: Record<string, string | null> = {}, intent = "order") => ({ intent, fulfilment: "delivery", lines, address: address(a) });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const isPinRequest = (s: Sent) => s.body.interactive?.type === "location_request_message";

describe("the chat says coming soon, by code", () => {
  it("on: a packaged item with no label reading is coming soon: the fixed line, no pin request, no card, no order", async () => {
    await gate(true);
    const p = await db.one(`select name_en, name_ar from products where name_en = 'Liban Lait Labneh Baladieh 900G'`);
    const t = flow(db, [read(order([LABNEH], { village: "بعقلين" }))]);
    const c = await t.customer();
    await t.text("بدي لبنة ليبان ليه 900 غ عبعقلين");
    const said = outbound.map(bodyOf).join("\n");
    expect(said).toContain(ar.basket.comingSoon([productName({ name: p.name_en, name_ar: p.name_ar }, "ar")]));
    expect(outbound.some(isCard)).toBe(false);
    expect(outbound.some(isPinRequest)).toBe(false);
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    // it says no reason about the product, no date, and nothing of health or praise
    expect(said).not.toMatch(/\d{1,2}[/.-]\d{1,2}|غداً|بكرا|tomorrow/i);
  }, 30_000);

  it("off: the same message gets what it always got (the pin request, then the card): nothing about coming soon", async () => {
    await gate(false);
    const t = flow(db, [read(order([LABNEH], { village: "بعقلين" }))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه 900 غ عبعقلين");
    expect(outbound.map(bodyOf).join("\n")).not.toContain("جايي قريباً");
    expect(outbound.some((s) => isPinRequest(s) || isCard(s))).toBe(true);
  }, 30_000);

  it("on, and the item has its label read and approved by a person: sold as before", async () => {
    await gate(true);
    const id = (await db.one(`select id from products where name_en = 'Liban Lait Labneh Baladieh 900G'`)).id;
    await makeFactComplete(db, id, ops);
    const t = flow(db, [read(order([LABNEH], { village: "بعقلين" }))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه 900 غ عبعقلين");
    expect(outbound.map(bodyOf).join("\n")).not.toContain("جايي قريباً");
    expect(outbound.some((s) => isPinRequest(s) || isCard(s))).toBe(true);
    await gate(false);
  }, 30_000);
});
