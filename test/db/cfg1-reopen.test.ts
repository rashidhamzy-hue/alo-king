// CFG1 item 2: a customer who answers a lapsed card gets a new order from the same basket at today's prices and stock, linked to the
// old one (orders.reopened_from); the card says "reopened from AK-xxxx"; cancelled stays final. Through the real turn code, tools and
// gateway on the real schema, with a scripted model (rule 12: no live model call).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar, en } from "@ak/agents/messages";
import { orderButtonId } from "@ak/agents/order-card";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const LABNEH = { raw: "لبنة ليبان ليه 900 غ", query: "Liban Lait Labneh Baladieh 900G", qty: 1, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9 };
const order = (lines: unknown[]) => ({ intent: "order", fulfilment: "delivery", lines,
  address: { village: "بعقلين", landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));

/** A customer with a card on the table, which the timer then cancels (nobody tapped in time). */
async function lapsedCard() {
  const t = flow(db, [read(order([LABNEH]))]);
  const c = await pinned(db, t, ids.BAAKLINE);
  await t.text("بدي لبنة");
  const old = await db.one(`select id, short_code from orders where customer_id = $1`, [c.party_id]);
  await db.pg.query(`update orders set created_at = now() - interval '2 hours' where id = $1`, [old.id]);
  await db.rpc("run_timers");
  expect((await db.one(`select status from orders where id = $1`, [old.id])).status).toBe("cancelled");
  return { t, c, old };
}
const orders = (party: string) => db.all(`select id, short_code, status, reopened_from from orders where customer_id = $1 order by created_at, id`, [party]);

describe("reopen a lapsed order (CFG1)", () => {
  it("a tap on the lapsed card's Confirm opens a new order from the same basket, linked; the card says where from; the old one stays cancelled", async () => {
    const { t, c, old } = await lapsedCard();
    const unitBefore = Number((await db.one(`select unit_price_usd as p from order_items where order_id = $1`, [old.id])).p);
    // today's price, not the lapsed card's
    await db.pg.query(`update offers set price_usd = price_usd + 0.5 where product_id = $1`, [ids.LABNEH]);
    const before = outbound.length;
    await t.tap(orderButtonId("confirm", old.id));
    const all = await orders(c.party_id);
    expect(all).toHaveLength(2);
    const fresh = all[1]!;
    expect(fresh).toMatchObject({ status: "awaiting_confirmation", reopened_from: old.id });
    expect(all[0]).toMatchObject({ id: old.id, status: "cancelled", reopened_from: null });
    expect(Number((await db.one(`select unit_price_usd as p from order_items where order_id = $1`, [fresh.id])).p)).toBeCloseTo(unitBefore + 0.5, 2);
    expect((await db.one(`select qty from order_items where order_id = $1`, [fresh.id])).qty).toBe((await db.one(`select qty from order_items where order_id = $1`, [old.id])).qty);
    const card = outbound.slice(before).filter(isCard).at(-1)!;
    expect(bodyOf(card)).toContain(ar.card.reopenedFrom(old.short_code));
    expect(bodyOf(card)).toContain(fresh.short_code);
    expect(buttonsOf(card).map((b) => b.id)).toContain(orderButtonId("confirm", fresh.id));
  });

  it("the new card is an ordinary card: it needs its own confirm tap (the lapsed tap confirmed nothing)", async () => {
    const { t, c, old } = await lapsedCard();
    await t.tap(orderButtonId("confirm", old.id));
    const fresh = (await orders(c.party_id))[1]!;
    expect(fresh.status).toBe("awaiting_confirmation");
    expect((await db.one(`select count(*)::int as n from consent_events where party_id = $1 and action = 'opt_in'`, [c.party_id])).n).toBe(0);
    await t.tap(orderButtonId("confirm", fresh.id));
    expect((await db.one(`select status from orders where id = $1`, [fresh.id])).status).toBe("confirmed");
  });

  it("Edit on the lapsed card and the Reopen button open it the same way", async () => {
    for (const action of ["edit", "reopen"] as const) {
      const { t, c, old } = await lapsedCard();
      await t.tap(orderButtonId(action, old.id));
      expect((await orders(c.party_id)).map((o: any) => [o.status, o.reopened_from])).toEqual([["cancelled", null], ["awaiting_confirmation", old.id]]);
    }
  });

  it("is not opened twice: once reopened and confirmed, the lapsed card's tap makes no third order and says where the order is", async () => {
    const { t, c, old } = await lapsedCard();
    await t.tap(orderButtonId("confirm", old.id));
    const fresh = (await orders(c.party_id))[1]!;
    await t.tap(orderButtonId("confirm", fresh.id));
    const sentBefore = outbound.length;
    await t.tap(orderButtonId("confirm", old.id));
    expect(await orders(c.party_id)).toHaveLength(2);
    expect(outbound.length).toBe(sentBefore + 1);
    expect(bodyOf(outbound.at(-1)!)).toContain(fresh.short_code);
  });

  it("cancelled stays final: the customer's own cancel is never reopened, by a tap or by the button", async () => {
    const t = flow(db, [read(order([LABNEH]))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة");
    const o = await db.one(`select id, short_code from orders where customer_id = $1`, [c.party_id]);
    await t.tap(orderButtonId("cancel", o.id));
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("cancelled");
    for (const action of ["confirm", "edit", "reopen"] as const) await t.tap(orderButtonId(action, o.id));
    expect(await orders(c.party_id)).toHaveLength(1);
    expect((await orders(c.party_id))[0]!.status).toBe("cancelled");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.tap.cancelled(o.short_code));
  });

  it("a card a newer card replaced is final too, and so is another customer's order", async () => {
    const a = await lapsedCard();
    const b = flow(db, [read(order([LABNEH]))]);
    const other = await pinned(db, b, ids.BAAKLINE);
    await b.tap(orderButtonId("reopen", a.old.id));                          // somebody else's lapsed card
    expect(await orders(other.party_id)).toHaveLength(0);
    await db.pg.query(`update order_events set reason = 'superseded_by_new_card' where order_id = $1 and to_status = 'cancelled'`, [a.old.id]);
    await a.t.tap(orderButtonId("confirm", a.old.id));
    expect(await orders(a.c.party_id)).toHaveLength(1);
  });

  it("the lapsed notice carries the Reopen button inside the window, in the customer's language", async () => {
    const { c, old } = await lapsedCard();
    await db.pg.query(`update conversations set last_inbound_at = now() where id = $1`, [c.conversation_id]);
    const due = (await db.rpc("customer_notices_due")) as any[];
    const n = due.find((x) => x.kind === "order_cancelled" && x.order_id === old.id);
    expect(n).toMatchObject({ reopenable: true });
    expect(due.find((x) => x.kind === "order_cancelled" && x.order_id === old.id && x.reopenable === false)).toBeUndefined();
  });

  it("every language has the words", () => {
    for (const m of [ar, en]) { expect(m.card.reopenedFrom("AK-9")).toContain("AK-9"); expect(m.cx.reopenButton.length).toBeLessThanOrEqual(20); }
  });
});
