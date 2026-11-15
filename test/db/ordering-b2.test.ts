// Session B2 (ordering): 1.4, 1.5, 1.6, 1.10, 1.14, 1.16, 1.18, on the real schema.
// Only the model (scripted) and Kapso's HTTP endpoint (a recorder) are replaced.
import { ar } from "@ak/agents/messages";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatOrderCard, orderButtonId, type Quote } from "@ak/agents/order-card";
import type { TestDb } from "./harness";
import { bucket, expectLedgerBalanced, flow, openFlowDb, pinned, read, recordKapso, use, type Ids, type Sent } from "./flow-kit";

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
    expect(body).toContain("التوصيل (بعقلين): $1.00");
    expect(body).toContain("*المجموع: $9.74*");                     // 7.24 + 1.00 + 1.50
    expect(body).toContain("الدفع: تحويل Whish");
    expect(body).toContain("بينّدفع سلف");                          // asked before the tap, not after
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order).toMatchObject({ payment_method: "whish", status: "awaiting_confirmation" });
    expect(Number(order.dues_usd)).toBe(1.5); expect(Number(order.total_usd)).toBeCloseTo(9.74);

    // The tap: awaiting payment, and the transfer amount includes the dues.
    await t.tap(orderButtonId("confirm", order.id));
    // CX1: the confirmation is one list (the card's choices under the words); the words are its body.
    expect(outbound.at(-1)!.body.interactive.body.text).toContain("$9.74");
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
    const body = (formatOrderCard({ orderId: "x", shortCode: "AK-1", quote, paymentMethod: "cod", changeForUsd: 20 })[0] as any).interactive.body.text as string;
    expect(body).not.toContain("مستحق"); expect(body).not.toContain("سلف"); expect(body).toContain(`${ar.card.changeFor}\n$20.00`);
    const owed = (formatOrderCard({ orderId: "x", shortCode: "AK-1", quote: { ...quote, dues_usd: 3, total_usd: 11.5 }, paymentMethod: "omt" })[0] as any).interactive.body.text as string;
    expect(owed).toContain("$3.00"); expect(owed).toContain("تحويل OMT"); expect(owed).toContain("سلف");
  });
});

describe("money guardrail (1.5)", () => {
  it("a reply that states a price is refused and logged; the reworded reply carries prices written by code from the database", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] }),
      [use("reply", { text: "اللبنة الكبيرة بـ $2.50 والصغيرة بـ $1" })],
      [use("reply", { text: "عنا حجمين لبنة، أيّا بتحب؟", price_of: [ids.LABNEH] })]]);
    await t.customer();
    await t.text("قديش حق اللبنة؟");
    expect(t.seen).toHaveLength(3);
    // the model is told why, so it can reword
    const told = JSON.stringify(t.seen[2]!.messages.at(-1));
    expect(told).toContain("refused:money_in_free_text"); expect(told).toContain("price_of");
    expect(outbound).toHaveLength(1);
    const body: string = outbound[0]!.body.text.body;
    expect(body).not.toContain("$2.50");
    const price = Number((await db.one(`select price_usd from offers where product_id = $1`, [ids.LABNEH])).price_usd);
    expect(body).toContain(`$${price.toFixed(2)}`);
    expect(await db.one(`select trace from agent_runs where agent = 'output_guard' order by created_at desc limit 1`))
      .toEqual({ trace: { code: "money_in_free_text", match: "$2.50" } });
  });

  it("a pin request with an amount is refused too, and a model that keeps writing prices ends with a fixed question, never silence", async () => {
    const bad = [use("reply", { text: "التوصيل 1$" })];
    const t = flow(db, [read({ intent: "question", lines: [] }), [use("ask_location_pin", { text: "التوصيل لعندك حقو 2 دولار، بعتلي موقعك" })], bad, bad, bad, bad, bad]);
    const c = await t.customer();
    await t.text("قديش التوصيل؟");
    expect(outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text)).toEqual([ar.support.stalled]);   // HO1: not a hand-off
    expect((await db.one(`select human_handoff from conversations where id = $1`, [c.conversation_id])).human_handoff).toBe(false);
  });
});

describe("payment screenshots (1.6)", () => {
  const RECEIPT = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), type: "image/jpeg" };
  const MEDIA_URL = "https://app.kapso.ai/m/receipt-1.jpg";   // A5 (G1-17): only Kapso's hosts are fetched; this was a made-up media.kapso.test
  const image = (url = MEDIA_URL) => ({ type: "image", image: { id: "meta-media-1" },
    kapso: { direction: "inbound", origin: "cloud_api", has_media: true, media_url: url, media_data: { url, content_type: "image/jpeg" } } });
  let opsLead: string;
  beforeAll(async () => {
    opsLead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
    await db.pg.query(`insert into party_identities(party_id, line, phone_e164) values ($1, 'ops', '+96171999000')`, [opsLead]);
    await db.rpc("touch_conversation", { p_line: "ops", p_wa_user_id: null, p_phone: "+96171999000", p_name: "Ops" });   // their 24-hour window is open
  });

  /** A customer whose Whish order was confirmed and now waits for the transfer. */
  async function awaitingTransfer(t: ReturnType<typeof flow>) {
    const c = await pinned(db, t, ids.BAAKLINE);
    const place = (await db.one(`select id from customer_places where party_id = $1`, [c.party_id])).id;
    const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: ids.LABNEH, qty: 1 }],
      p_village: ids.BAAKLINE, p_place: place, p_pickup: false, p_payment: "whish", p_change_for: null, p_notes: null });
    await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: c.party_id, p_wamid: `w-${o.short_code}` });
    expect((await db.one(`select status from orders where id = $1`, [o.order_id])).status).toBe("awaiting_payment");
    return { ...c, orderId: o.order_id as string, shortCode: o.short_code as string };
  }

  it("is stored privately from Kapso's URL, queued for ops with the model's pre-fill, and confirmed only by a person", async () => {
    outbound = recordKapso({ [MEDIA_URL]: RECEIPT });
    const t = flow(db, [[use("record_payment_proof", { provider: "whish", amount: 4, currency: "USD", reference: "WH-778812",
      datetime_iso: null, recipient_last4: "1234", looks_edited: false, confidence: 0.9 })]]);
    const c = await awaitingTransfer(t);
    await t.say(image());

    // The customer hears it arrived; ops hears there is one to check. No ordering model call, no money moved.
    expect(outbound.find((o) => o.url.includes("PN_CUSTOMER"))!.body.text.body).toContain(`وصلت صورة الدفع لطلب ${c.shortCode}`);
    const alert = outbound.find((o) => o.url.includes("PN_OPS"))!;
    expect(alert.body.to).toBe("+96171999000"); expect(alert.body.text.body).toContain(`#${c.shortCode}`);
    expect(t.seen).toHaveLength(1);
    expect(t.seen[0]!.tool_choice).toEqual({ type: "tool", name: "record_payment_proof" });
    const proof = await db.one(`select * from payment_proofs where order_id = $1`, [c.orderId]);
    expect(proof).toMatchObject({ status: "pending", party_id: c.party_id, reused_image: false, mime_type: "image/jpeg" });
    expect(proof.media_path).toMatch(new RegExp(`^payment_proofs/${c.party_id}/[0-9a-f]{64}\\.jpg$`));
    expect(bucket.get(`media/${proof.media_path}`)!.bytes).toEqual(RECEIPT.bytes);
    expect(proof.extracted).toMatchObject({ amount: 4, reference: "WH-778812" });          // a pre-fill for the person
    expect(await db.one(`select status, proof_media_path from payments where order_id = $1`, [c.orderId]))
      .toEqual({ status: "proof_submitted", proof_media_path: proof.media_path });
    expect((await db.one(`select status from orders where id = $1`, [c.orderId])).status).toBe("awaiting_payment");
    expect(await db.one(`select count(*)::int as n from ledger_entries where order_id = $1`, [c.orderId])).toEqual({ n: 0 });
    const open = await db.rpc("payment_proofs_open");
    expect(open.find((p: any) => p.proof_id === proof.id)).toMatchObject({ short_code: c.shortCode, reading: { reference: "WH-778812" } });
    expect(await db.one(`select status from ops_exceptions where kind = 'payment_proof' and ref = $1`, [proof.id])).toEqual({ status: "open" });

    // Only the ops lead can confirm, with the reference and amount they typed.
    await expect(db.rpc("review_payment_proof", { p_proof: proof.id, p_by: c.party_id, p_accept: true, p_external_ref: "WH-778812", p_amount_usd: 9 }))
      .rejects.toThrow(/NOT_AUTHORISED/);
    const total = Number((await db.one(`select total_usd from orders where id = $1`, [c.orderId])).total_usd);
    await expect(db.rpc("review_payment_proof", { p_proof: proof.id, p_by: opsLead, p_accept: true, p_external_ref: "WH-778812", p_amount_usd: total - 1 }))
      .rejects.toThrow(/UNDERPAID/);
    const r = await db.rpc("review_payment_proof", { p_proof: proof.id, p_by: opsLead, p_accept: true, p_external_ref: "WH-778812", p_amount_usd: total });
    expect(r).toMatchObject({ ok: true, status: "confirmed" });
    expect((await db.one(`select status from orders where id = $1`, [c.orderId])).status).toBe("confirmed");
    expect((await db.one(`select status from payment_proofs where id = $1`, [proof.id])).status).toBe("confirmed");
    expect(await db.one(`select status from ops_exceptions where kind = 'payment_proof' and ref = $1`, [proof.id])).toEqual({ status: "resolved" });
    await expectLedgerBalanced(db);
  });

  it("a retried turn stores and queues the same picture once", async () => {
    outbound = recordKapso({ [MEDIA_URL]: RECEIPT });
    const t = flow(db, []);
    await db.pg.exec(`update settings set value = '{"model_read": false}' where key = 'payment_proofs'`);
    const c = await awaitingTransfer(t);
    const pending = t.pending(image());
    const { processTurn } = await import("../../apps/gateway/src/turn");
    await processTurn({ ...t.deps, turnKey: "customer:proof-retry" }, pending, {});
    await processTurn({ ...t.deps, turnKey: "customer:proof-retry" }, pending, {});
    expect(await db.one(`select count(*)::int as n from payment_proofs where order_id = $1`, [c.orderId])).toEqual({ n: 1 });
    expect(outbound.filter((o) => o.url.includes("PN_CUSTOMER"))).toHaveLength(1);
    expect(outbound.filter((o) => o.url.includes("PN_OPS"))).toHaveLength(1);
    expect(t.seen).toHaveLength(0);                                    // model read switched off by the setting
    await db.pg.exec(`update settings set value = '{"model_read": true}' where key = 'payment_proofs'`);
  });

  it("the same picture for a second order is flagged for the reviewer, not refused", async () => {
    outbound = recordKapso({ [MEDIA_URL]: RECEIPT });
    const t = flow(db, []);
    await db.pg.exec(`update settings set value = '{"model_read": false}' where key = 'payment_proofs'`);
    const c = await awaitingTransfer(t);
    await t.say(image());
    expect(await db.one(`select reused_image from payment_proofs where order_id = $1`, [c.orderId])).toEqual({ reused_image: true });
    expect(outbound.find((o) => o.url.includes("PN_OPS"))!.body.text.body).toContain("نفس الصورة");
    expect(outbound.find((o) => o.url.includes("PN_CUSTOMER"))!.body.text.body).toContain("وصلت صورة الدفع");
    expect(await db.one(`select count(*)::int as n from risk_flags where rule = 'payment_proof_reused' and subject_id = $1`, [c.party_id])).toEqual({ n: 1 });
    await db.pg.exec(`update settings set value = '{"model_read": true}' where key = 'payment_proofs'`);
  });

  it("a raw Meta link is never fetched: the customer is asked to send it again", async () => {
    outbound = recordKapso();
    const t = flow(db, []);
    const c = await awaitingTransfer(t);
    await t.say(image("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"));
    expect(outbound.map((o) => o.body.text?.body)).toEqual([ar.payment.proofResend]);
    expect(await db.one(`select count(*)::int as n from payment_proofs where order_id = $1`, [c.orderId])).toEqual({ n: 0 });
  });

  it("G1-17: a host that is not Kapso's is never fetched either, whoever it belongs to", async () => {
    for (const url of ["https://cdn.example.com/receipt.jpg", "https://media.kapso.test/m/receipt-1.jpg", "https://evilkapso.ai/r.jpg", "http://app.kapso.ai/r.jpg"]) {
      outbound = recordKapso({ [url]: RECEIPT });
      const t = flow(db, []);
      const c = await awaitingTransfer(t);
      await t.say(image(url));
      expect(outbound.map((o) => o.body.text?.body), url).toEqual([ar.payment.proofResend]);
      expect(await db.one(`select count(*)::int as n from payment_proofs where order_id = $1`, [c.orderId]), url).toEqual({ n: 0 });
    }
  });

  it("with no order waiting for a transfer, a picture is just a picture and goes to the Concierge", async () => {
    outbound = recordKapso({ [MEDIA_URL]: RECEIPT });
    const t = flow(db, [read({ intent: "question", lines: [], promised_followup: "none" }), [use("reply", { text: "شو بتحب تطلب؟" })]]);
    await t.customer();
    await t.say(image());
    expect(t.seen[0]!.tool_choice).toEqual({ type: "tool", name: "extract_order" });
    expect(JSON.parse(t.seen[0]!.messages[0]!.content as string).texts).toEqual(["[image received]"]);
    expect([...bucket.keys()].filter((k) => k.includes(t.who.waUserId))).toEqual([]);
  });
});

describe("neutral and factual (1.10)", () => {
  it("praise and an unverified halal claim are refused with their reasons; the neutral rewording goes out", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] }),
      [use("reply", { text: "شاورما الضيعة أطيب شي عنا" })],
      [use("reply", { text: "إيه، الدجاج حلال" })],
      [use("reply", { text: "ما عندي معلومات موثّقة إذا الدجاج حلال. فيني اسأل المطعم؟" })]]);
    const c = await t.customer();
    await t.text("شو أطيب شاورما؟ والدجاج حلال؟");
    expect(outbound.map((o) => o.body.text.body)).toEqual(["ما عندي معلومات موثّقة إذا الدجاج حلال. فيني اسأل المطعم؟"]);
    const refused = await db.all(`select trace->>'code' as code from agent_runs where agent = 'output_guard' and conversation_id = $1 order by created_at`, [c.conversation_id]);
    expect(refused.map((r) => r.code)).toEqual(["quality_judgement", "unapproved_food_claim"]);
  });

  it("a fact approved under 1.11 lets the Concierge state it, with its status; the same words with no record stay refused", async () => {
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Facts') returning id`)).id;
    const fact = await db.rpc("propose_product_fact", { p_product: ids.LABNEH, p_attribute: "sesame", p_value: "free", p_status: "declared", p_source: "label", p_by: ops });
    await db.rpc("approve_product_fact", { p_fact: fact, p_by: ops });
    const claim = "اللبنة ما فيها سمسم، حسب الملصق (مصرّح من الشركة المصنّعة)";

    const without = flow(db, [read({ intent: "question", lines: [] }), [use("reply", { text: claim })], [use("reply", { text: "ما عندي معلومات موثّقة، فيني اسأل؟" })]]);
    await without.customer();
    await without.text("اللبنة فيها سمسم؟");
    expect(outbound.at(-1)!.body.text.body).toBe("ما عندي معلومات موثّقة، فيني اسأل؟");     // no food_facts call: still refused

    const t = flow(db, [read({ intent: "question", lines: [] }),
      [use("food_facts", { product_ids: [ids.LABNEH], restrictions: ["sesame", "milk"] })], [use("reply", { text: claim })]]);
    await t.customer();
    await t.text("اللبنة فيها سمسم؟ عندي حساسية");
    expect(outbound.at(-1)!.body.text.body).toBe(claim);
    const told = JSON.parse(JSON.parse(JSON.stringify(t.seen[2]!.messages.at(-1))).content[0].content);
    expect(told.products[0].facts).toMatchObject([{ attribute: "sesame", value: "free", status: "declared", source: "label" }]);
    expect(told.products[0].restrictions).toMatchObject({ meets: false, checks: [{ restriction: "milk", result: "unknown" }, { restriction: "sesame", result: "pass" }] });
  });
});

describe("customer control of memory (1.14)", () => {
  /** A delivered order, learned from, so there is something to remember. */
  async function deliveredOrder(c: { party_id: string; conversation_id: string }) {
    const place = (await db.one(`select id from customer_places where party_id = $1`, [c.party_id])).id;
    const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: ids.LABNEH, qty: 1, raw: "لبنة" }],
      p_village: ids.BAAKLINE, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.pg.query(`update orders set status = 'delivered', delivered_at = now() where id = $1`, [o.order_id]);
    return db.rpc("learn_from_order", { p_order: o.order_id });
  }

  it("'what do you know about me' lists what is held, with no model call; memories say whether they were observed or stated", async () => {
    const t = flow(db, []);
    const c = await pinned(db, t, ids.BAAKLINE);
    expect(await deliveredOrder(c)).toMatchObject({ learned: true, memory_on: true });
    await t.text("شو بتعرفو عني؟");
    expect(t.seen).toHaveLength(0);
    const body: string = outbound[0]!.body.text.body;
    expect(body).toContain("طلبات مكتملة: 1"); expect(body).toContain("Labneh"); expect(body).toContain("كاش عند التسليم");
    expect(body).toContain(t.who.phone!);
    expect(await db.all(`select distinct origin from customer_memory where party_id = $1`, [c.party_id])).toEqual([{ origin: "observed" }]);
  });

  it("'forget' asks once with a button; yes deletes the memories and the unused places, and the id leaves the alias evidence", async () => {
    const t = flow(db, []);
    const c = await pinned(db, t, ids.BAAKLINE);
    await deliveredOrder(c);
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.7, p_lng: 35.6, p_village: ids.BAAKLINE });   // a second place, no order on it
    await t.text("إنسى");
    expect(outbound[0]!.body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(["memory:forget:yes", "memory:forget:no"]);
    expect(await db.one(`select count(*)::int as n from customer_memory where party_id = $1`, [c.party_id])).toEqual({ n: 3 });   // nothing yet
    await t.tap("memory:forget:yes");
    expect(outbound.at(-1)!.body.text.body).toContain("محينا");
    expect(await db.one(`select count(*)::int as n from customer_memory where party_id = $1`, [c.party_id])).toEqual({ n: 0 });
    expect(await db.one(`select count(*)::int as n from customer_places where party_id = $1`, [c.party_id])).toEqual({ n: 1 });   // the one an order points to
    expect(await db.one(`select count(*)::int as n from alias_candidates where $1 = any(customers)`, [c.party_id])).toEqual({ n: 0 });
    const ctx = await db.rpc("customer_context", { p_party: c.party_id });
    expect(ctx.usuals).toEqual([]); expect(ctx.payment).toBeNull();
  });

  it("'stop remembering' stops learning and using memory; 'remember again' turns it back on", async () => {
    const t = flow(db, []);
    const c = await pinned(db, t, ids.BAAKLINE);
    await deliveredOrder(c);
    await t.text("وقّف التذكّر");
    expect(outbound[0]!.body.text.body).toContain("ما رح نتعلّم شي جديد");
    expect((await db.rpc("customer_context", { p_party: c.party_id })).usuals).toEqual([]);
    expect(await deliveredOrder(c)).toMatchObject({ learned: true, memory_on: false });
    expect(Number((await db.one(`select weight from customer_memory where party_id = $1 and kind = 'usual_item'`, [c.party_id])).weight)).toBe(1);
    await t.text("رجاع تذكّر");
    expect((await db.rpc("customer_context", { p_party: c.party_id })).usuals).toHaveLength(1);
  });

  it("a stated allergy goes on this order's notes at once; it is kept for the next order only after a yes", async () => {
    const reading = { ...ORDER_READING, lines: [ORDER_READING.lines[0]], restrictions: ["حساسية سمسم"] };
    const t = flow(db, [read(reading), read({ ...ORDER_READING, lines: [ORDER_READING.lines[0]] })]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("عندي حساسية سمسم. بدي علبتين لبنة ليبان ليه");
    const first = await db.one(`select customer_notes from orders where customer_id = $1`, [c.party_id]);
    expect(first.customer_notes).toContain("⚠️ قيود الزبون"); expect(first.customer_notes).toContain("حساسية سمسم");
    expect(outbound.map((o) => o.body.type)).toEqual(["interactive", "interactive"]);         // the card, then the question
    expect(outbound[1]!.body.interactive.body.text).toContain("بتحب نتذكّرها");
    expect(await db.rpc("customer_restrictions", { p_party: c.party_id })).toEqual([]);         // not kept without a yes
    await t.tap("memory:keep:yes");
    expect(await db.one(`select origin, value from customer_memory where party_id = $1 and kind = 'restriction'`, [c.party_id]))
      .toEqual({ origin: "stated", value: { text: "حساسية سمسم" } });

    // The next order: not said again, still on the notes, and not offered again.
    await t.text("بدي علبتين لبنة ليبان ليه");
    const next = await db.one(`select customer_notes from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    expect(next.customer_notes).toContain("حساسية سمسم");
    expect(outbound.at(-1)!.body.type).toBe("interactive"); expect(outbound.at(-1)!.body.interactive.body.text).not.toContain("نتذكّرها");
  });

  it("'just this once' keeps nothing, and the Concierge's reading of 'what do you know about me' gets the same answer", async () => {
    const t = flow(db, [read({ ...ORDER_READING, restrictions: ["no meat"] }), read({ intent: "memory_show", lines: [] })]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("no meat please, labneh and bread");
    await t.tap("memory:keep:no");
    expect(outbound.at(-1)!.body.text.body).toBe("تمام، بس لهالطلب.");
    expect(await db.rpc("customer_restrictions", { p_party: c.party_id })).toEqual([]);
    await t.text("can you tell me everything you have saved on me and my orders?");
    expect(outbound.at(-1)!.body.text.body).toContain("هيدا يلي منعرفو عنك");
    expect(t.seen).toHaveLength(2);
  });
});

describe("small-order fee and first-order cash cap (1.16)", () => {
  const setting = (key: string, value: unknown) => db.pg.query(`update settings set value = $2 where key = $1`, [key, JSON.stringify(value)]);
  afterEach(async () => { await setting("small_order_fee", { below_subtotal_usd: 0, fee_usd: 0 }); await setting("first_order", { max_cod_usd: 0 }); });
  const ONE_LABNEH = { ...ORDER_READING, lines: [ORDER_READING.lines[0]] };      // 2 x 3.00 = 6.00, under 10

  it("is off by default: no fee on the quote, no line on the card", async () => {
    const q = await db.rpc("quote_order", { p_lines: [{ product_id: ids.LABNEH, qty: 1 }], p_village: ids.BAAKLINE, p_pickup: false });
    expect(Number(q.small_order_fee_usd)).toBe(0);
    const t = flow(db, [read(ONE_LABNEH)]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي علبتين لبنة ليبان ليه");
    expect(cardBody(outbound[0]!)).not.toContain("رسم الطلبات الصغيرة");
  });

  it("a small basket pays the fee on its own line; cash posts it to the company's own account, and the rider is paid the delivery fee only", async () => {
    await setting("small_order_fee", { below_subtotal_usd: 10, fee_usd: 0.5 });
    const t = flow(db, [read(ONE_LABNEH)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي علبتين لبنة ليبان ليه");
    const body = cardBody(outbound[0]!);
    expect(body).toContain("$6.00"); expect(body).toContain("التوصيل (بعقلين): $1.00");
    expect(body).toContain("رسم الطلبات الصغيرة: $0.50"); expect(body).toContain("*المجموع: $7.50*");
    const o = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(Number(o.small_order_fee_usd)).toBe(0.5); expect(Number(o.delivery_fee_usd)).toBe(1); expect(Number(o.total_usd)).toBe(7.5);

    const rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'R') returning id`)).id;
    await db.rpc("post_cod_collection", { p_order: o.id, p_driver: rider, p_usd: 7.5, p_lbp: 0 });
    const by = async (code: string) => Number((await db.one(`select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id
                                                            where e.order_id = $1 and a.code = $2`, [o.id, code])).s);
    expect(await by("revenue_small_order")).toBe(-0.5);
    expect(await by("revenue_delivery")).toBe(-1);
    expect(await by("cash_over_short")).toBe(0);
    expect(Number(await db.rpc("settle_rider_earnings", { p_order: o.id, p_driver: rider }))).toBe(1);   // the fee is the rider's; the small-order fee is not
    expect(await by("revenue_small_order")).toBe(-0.5);
    expect(Number(await db.rpc("rider_earnings_usd", { p_driver: rider }))).toBe(1);
    await expectLedgerBalanced(db);
  });

  it("a basket at or above the threshold pays no fee; a confirmed transfer also posts the fee to its own account", async () => {
    await setting("small_order_fee", { below_subtotal_usd: 6, fee_usd: 0.5 });
    const big = await db.rpc("quote_order", { p_lines: [{ product_id: ids.LABNEH, qty: 2 }], p_village: ids.BAAKLINE, p_pickup: false });
    expect(Number(big.small_order_fee_usd)).toBe(0);
    const c = await pinned(db, flow(db, []), ids.BAAKLINE);
    const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: ids.LABNEH, qty: 1 }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: false, p_payment: "whish", p_change_for: null, p_notes: null });
    expect(Number(o.quote.small_order_fee_usd)).toBe(0.5); expect(Number(o.quote.total_usd)).toBe(6.5);      // 5.00 + 1.00 + 0.50
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops2') returning id`)).id;
    await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: c.party_id, p_wamid: "w-small" });
    await db.rpc("confirm_payment", { p_order: o.order_id, p_by: ops, p_external_ref: "WH-SMALL-1", p_amount_usd: 6.5 });
    expect(Number((await db.one(`select sum(e.usd_equiv) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id
                                  where e.order_id = $1 and a.code = 'revenue_small_order'`, [o.order_id])).s)).toBe(-0.5);
    await expectLedgerBalanced(db);
  });

  it("a first order above the cash cap goes out prepaid and says why; a customer with a delivered order may pay cash", async () => {
    await setting("first_order", { max_cod_usd: 5 });
    const t = flow(db, [read(ORDER_READING)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز");
    const body = cardBody(outbound[0]!);
    expect(body).toContain("الدفع: تحويل Whish"); expect(body).toContain("أول طلب كاش لحدّ:\n$5.00");
    expect((await db.one(`select payment_method from orders where customer_id = $1`, [c.party_id])).payment_method).toBe("whish");

    await db.pg.query(`update orders set status = 'delivered' where customer_id = $1`, [c.party_id]);
    const again = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: ids.LABNEH, qty: 2 }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    expect(again.created).toBe(true);
  });

  it("tripwire: the four functions that carry the fee still do (a later migration that redefines one must keep it; confirm_payment posts through confirm_payment_now since F1)", async () => {
    for (const fn of ["quote_order", "create_order_from_quote", "post_cod_collection", "confirm_payment_now"]) {   // F1 (0106): confirm_payment_now posts the money
      const def = (await db.one(`select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn])).d;
      expect(def, fn).toContain("small_order_fee");
    }
  });
});

describe("stay on the job (1.18)", () => {
  it("homework gets one fixed, friendly line and an offer to order, with no second model call and nothing answered", async () => {
    const t = flow(db, [read({ intent: "off_topic", lines: [] })]);
    await t.customer();
    await t.text("ساعدني بفرض الرياضيات: شو حل 2x + 5 = 11؟");
    expect(t.seen).toHaveLength(1);
    expect(outbound.map((o) => o.body.text.body)).toEqual([ar.fixed.offTopic]);
  });

  it("an order inside a chatty message is still an order", async () => {
    const t = flow(db, [read({ ...ORDER_READING, intent: "order" })]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("كيفك؟ شو أخبار الطقس عندكن؟ المهم بدي علبتين لبنة ليبان ليه وربطتين خبز");
    expect(outbound[0]!.body.type).toBe("interactive");
  });
});
