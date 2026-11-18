// FD2: a food order on WhatsApp end to end, through the real turn code, food path, tools and gateway (evals/cases/fd2_food.json). The reading
// is scripted as the live model gives it; every question after it is code's (no second model call). The place is the seeded test place.
//   1. A required choice is asked as a list or buttons, and answered before the card; an optional one is offered once ("no, thanks" first).
//   2. The card names the place («🍗 من: …») and the options; its price is the database's.
//   3. A customer who is not a tester gets "not on Alo King yet". A dish not on the menu is named, and the menu is shown.
//   4. One shop per order: a grocery card and a food card wait side by side as two orders.
//   5. The confirm tap makes the call task; staff record the place accepted; the customer is told by the console (tested in apps/console).
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import cases from "../../evals/cases/fd2_food.json";

let db: TestDb; let ids: Ids; let place: string; let lead: string;
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  place = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00" } } });
}, 180_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const rowsOf = (s: Sent): { id: string; title: string }[] => [
  ...(s.body.interactive?.action?.buttons ?? []).map((b: any) => ({ id: b.reply.id, title: b.reply.title })),
  ...(s.body.interactive?.action?.sections ?? []).flatMap((x: any) => x.rows.map((r: any) => ({ id: r.id, title: r.title }))),
];
const last = () => outbound.at(-1)!;
const noAddress = { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null };
const reading = (lines: { raw: string; query: string; qty: number; source_hint?: string | null }[]) => ({ intent: "order", fulfilment: "unknown", restrictions: [],
  address: noAddress, lines: lines.map((l) => ({ unit: "each", brand_hint: null, confidence: 0.9, modifiers: [], source_hint: null, ...l })) });
const caseOf = (id: string) => cases.cases.find((c) => c.id === id)!;
async function customer(t: ReturnType<typeof flow>, tester: boolean) {
  const c = await pinned(db, t, ids.BAAKLINE);
  if (tester) await db.rpc("set_tester", { p_by: lead, p_phone: t.who.phone, p_on: true });
  return c;
}
const tapRow = async (t: ReturnType<typeof flow>, title: RegExp) => {
  const row = rowsOf(last()).find((r) => title.test(r.title));
  expect(row, `a row like ${title} in ${JSON.stringify(rowsOf(last()))}`).toBeDefined();
  await t.tap(row!.id, row!.title);
};

describe("FD2: a food order on WhatsApp", () => {
  it("required choices by code, an optional one offered once, then the card with the place; the tap makes the call task", async () => {
    const c = caseOf("fd2-required-choice");
    const t = flow(db, [read(reading(c.lines))]);
    const cust = await customer(t, true);
    await t.text(c.said);
    expect(t.seen.length).toBe(1);                                                   // the reading only: code asks the rest
    expect(bodyOf(last())).toContain(c.expect.group!);
    expect(rowsOf(last()).map((r) => r.title)).toEqual(expect.arrayContaining(c.expect.rows!.map((x) => expect.stringContaining(x))));
    await tapRow(t, /كبير/);
    expect(bodyOf(last())).toContain("الخبز");                                      // the next required group
    await tapRow(t, /صاج/);
    expect(bodyOf(last())).toContain("إضافات");                                      // the optional group, offered once
    expect(rowsOf(last())[0]!.title).toBe("لا، شكراً");
    await tapRow(t, /لا، شكراً/);
    const card = bodyOf(last());
    expect(card).toContain("🍗 من: Alo King test kitchen");
    expect(card).toContain("2 × سندويش شاورما دجاج (كبير، صاج) · $13.00");          // (4 + 2 + 0.50) × 2, the database's prices
    expect(t.seen.length).toBe(1);
    const order = await db.one(`select id, status::text s from orders where customer_id = $1 order by created_at desc limit 1`, [cust.party_id]);
    expect(order.s).toBe("awaiting_confirmation");
    const confirm = rowsOf(last()).find((r) => r.id.startsWith("order:confirm:"))!;
    await t.tap(confirm.id, confirm.title);
    expect((await db.one(`select status::text s from orders where id = $1`, [order.id])).s).toBe("confirmed");
    expect((await db.one(`select status from place_calls where order_id = $1`, [order.id])).status).toBe("to_call");
  });

  it("options said in the words are taken; the optional group is the only question", async () => {
    const c = caseOf("fd2-options-in-the-words");
    const t = flow(db, [read({ ...reading(c.lines), language: "en" })]);
    await customer(t, true);
    await t.text(c.said);
    expect(bodyOf(last()).toLowerCase()).toContain(c.expect.group!.toLowerCase());
    await tapRow(t, /Extra garlic/);
    const card = bodyOf(last());
    expect(card).toMatch(/2 × Chicken shawarma sandwich \(Large, Saj, Extra garlic\) · \$14\.00/);
  });

  it("a typed answer chooses the option («كبير»)", async () => {
    const c = caseOf("fd2-required-choice");
    const t = flow(db, [read(reading(c.lines)), read(reading([{ raw: "كبير", query: "كبير", qty: 1 }]))]);
    await customer(t, true);
    await t.text(c.said);
    await t.text("كبير");
    expect(bodyOf(last())).toContain("الخبز");
    expect(t.seen.length).toBe(2);
  });

  it("a customer who is not a tester is told the place is not on Alo King yet", async () => {
    const c = caseOf("fd2-non-tester");
    const t = flow(db, [read(reading(c.lines))]);
    const cust = await customer(t, false);
    await t.text(c.said);
    const all = outbound.map(bodyOf).join("\n");
    for (const x of c.expect.contains!) expect(all).toContain(x);
    for (const x of c.expect.not_contains!) expect(all).not.toContain(x);
    expect((await db.one(`select count(*)::int n from orders where customer_id = $1`, [cust.party_id])).n).toBe(0);
  });

  it("a dish not on the menu is named, and the menu follows as a list", async () => {
    const c = caseOf("fd2-not-on-menu");
    const t = flow(db, [read(reading(c.lines))]);
    await customer(t, true);
    await t.text(c.said);
    expect(bodyOf(last())).toContain(c.expect.contains![0]!);
    expect(rowsOf(last()).map((r) => r.title)).toEqual(expect.arrayContaining(["سندويش فلافل", "صحن طاووق"]));
    await tapRow(t, /طاووق/);
    expect(bodyOf(last())).toContain("الصلصة");                                      // its required choice, then the card
    await tapRow(t, /حار/);
    expect(bodyOf(last())).toContain("🍗 من: Alo King test kitchen");
    expect(bodyOf(last())).toContain("1 × صحن طاووق (حار) · $8.00");
  });

  it("one shop per order: a grocery card and a food card wait as two orders", async () => {
    const t = flow(db, [read(reading([{ raw: "٢ لبنة", query: "لبنة ليبان ليه", qty: 2 }])),
                        read(reading([{ raw: "٢ فلافل", query: "سندويش فلافل", qty: 2, source_hint: "مطبخ التجربة" }]))]);
    const cust = await customer(t, true);
    await t.text("بدي ٢ لبنة");
    await t.text("وبدي ٢ فلافل من مطبخ التجربة");
    const orders = await db.all(`select o.status::text s, (select count(distinct f.source_id)::int from fulfilments f where f.order_id = o.id) shops
                                   from orders o where o.customer_id = $1 order by o.created_at`, [cust.party_id]);
    expect(orders).toEqual([{ s: "awaiting_confirmation", shops: 1 }, { s: "awaiting_confirmation", shops: 1 }]);
    expect(bodyOf(last())).toContain("🍗 من: Alo King test kitchen");
  });
});
