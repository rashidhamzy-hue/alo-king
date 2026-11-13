// Session B2 (ordering): 1.4, 1.5, 1.6, 1.10, 1.14, 1.16, 1.18, on the real schema.
// Only the model (scripted) and Kapso's HTTP endpoint (a recorder) are replaced.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatOrderCard, orderButtonId, type Quote } from "@ak/agents/order-card";
import type { TestDb } from "./harness";
import { expectLedgerBalanced, flow, openFlowDb, pinned, read, recordKapso, use, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const ORDER_READING = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }, { raw: "ربطتين خبز", query: "خبز", qty: 2, unit: "bundle", confidence: 0.9 }],
  address: { village: "بعقلين" } };
const cardBody = (s: Sent) => s.body.interactive.body.text as string;

/** What a delivery nobody answered leaves behind (rider_no_answer, 0006): a balanced entry the customer owes. */
async function owe(partyId: string, usd: number) {
  await db.pg.query(`do $$ declare t uuid := gen_random_uuid(); begin
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (t, ensure_account('customer_receivable:${partyId}', 'customer_receivable'::account_kind, '${partyId}'::uuid), ${usd}, 'USD', ${usd}, 'Owed after failed delivery'),
      (t, ensure_account('revenue_delivery', 'revenue_delivery'), -${usd}, 'USD', -${usd}, 'Failed delivery fee');
  end $$`);
}

describe("the card shows what is owed and asks for prepayment (1.4)", () => {
  it("a customer who owes from a failed delivery gets a prepaid card with the amount on its own line, and the total adds up", async () => {
    const t = flow(db, [read(ORDER_READING)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await owe(c.party_id, 1.5);
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين");
    expect(outbound).toHaveLength(1);
    const body = cardBody(outbound[0]!);
    expect(body).toContain("مستحق من طلب سابق ما قدرنا نسلّمو: $1.50");
    expect(body).toContain("المجموع الفرعي: $7.24"); expect(body).toContain("التوصيل (بعقلين): $1.00");
    expect(body).toContain("الإجمالي: $9.74");                      // 7.24 + 1.00 + 1.50
    expect(body).toContain("الدفع: تحويل Whish");
    expect(body).toContain("بينّدفع سلف");                          // asked before the tap, not after
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order).toMatchObject({ payment_method: "whish", status: "awaiting_confirmation" });
    expect(Number(order.dues_usd)).toBe(1.5); expect(Number(order.total_usd)).toBeCloseTo(9.74);

    // The tap: awaiting payment, and the transfer amount includes the dues.
    await t.tap(orderButtonId("confirm", order.id));
    expect(outbound.at(-1)!.body.text.body).toContain("$9.74");
    expect((await db.one(`select status from orders where id = $1`, [order.id])).status).toBe("awaiting_payment");
    await expectLedgerBalanced(db);
  });

  it("when the Concierge proposes cash for someone who owes, the database refuses it and the card goes out prepaid instead", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] }), [
      use("resolve_place", { village: "بعقلين" }), use("quote_order", { lines: [{ product_id: ids.LABNEH, qty: 1 }] }),
    ], [use("send_confirmation", { payment_method: "cod" })]]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await owe(c.party_id, 2);
    await t.text("بدي لبنة");
    expect(t.seen).toHaveLength(3);
    expect(outbound).toHaveLength(1);
    const body = cardBody(outbound[0]!);
    expect(body).toContain("مستحق من طلب سابق ما قدرنا نسلّمو: $2.00"); expect(body).toContain("بينّدفع سلف");
    expect((await db.one(`select payment_method from orders where customer_id = $1`, [c.party_id])).payment_method).toBe("whish");
  });

  it("no dues, no extra line and no prepayment request", () => {
    const quote: Quote = { ok: true, issues: [], subtotal_usd: 7.5, delivery_fee_usd: 1, total_usd: 8.5, fx_rate_lbp: 89500, total_lbp: 761000,
      eta_minutes: 20, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null, lines: [] };
    const body = (formatOrderCard({ orderId: "x", shortCode: "AK-1", quote, paymentMethod: "cod", changeForUsd: 20 }) as any).interactive.body.text as string;
    expect(body).not.toContain("مستحق"); expect(body).not.toContain("سلف"); expect(body).toContain("فراطة لـ $20.00");
    const owed = (formatOrderCard({ orderId: "x", shortCode: "AK-1", quote: { ...quote, dues_usd: 3, total_usd: 11.5 }, paymentMethod: "omt" }) as any).interactive.body.text as string;
    expect(owed).toContain("$3.00"); expect(owed).toContain("تحويل OMT"); expect(owed).toContain("سلف");
  });
});
