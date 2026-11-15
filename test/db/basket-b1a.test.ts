// Session B1a (basket integrity): SIM1's fixes 1, 3, 4, 9 and 10 and its two no-reply turns, each from a failing case of
// evals/cases/sim_*.json (docs/SIM_REPORT_2026-11-15.md), through the real turn code, tools and gateway on the real schema with a
// scripted model. The minimum is the seeded 5 USD; Lipton 0.69, Pepsi 2.25 L 1.65, bread 1.01, labneh 900 g 5.00.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar, en } from "@ak/agents/messages";
import { BASKET_CLEAR, applyEdits, editsFromPlan, minimumGap } from "@ak/agents/basket";
import { checkModelText } from "@ak/agents/output-guard";
import { orderButtonId, windowButtonId } from "@ak/agents/order-card";
import { MENU_BROWSE } from "@ak/agents/support";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, use, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
const P: Record<string, string> = {};
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  for (const [k, sku] of [["lipton", "AK-0123"], ["pepsi", "AK-0115"]] as const) P[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
}, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const line = (raw: string, query: string, qty = 1, extra: Record<string, unknown> = {}) =>
  ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9, ...extra });
const LIPTON = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml");
const LABNEH = line("لبنة ليبان ليه 900 غ", "Liban Lait Labneh Baladieh 900G");
const BREAD = (qty = 1) => line("خبز وودن بيكري", "Wooden Bakery Pita White Bread Big 800G", qty);
const PEPSI = (qty = 1) => line("Pepsi Carbonated Drink 2.25L", "Pepsi Carbonated Drink 2.25L", qty);
const order = (lines: unknown[], intent = "order", village: string | null = "بعقلين") =>
  ({ intent, fulfilment: "delivery", lines, address: { village, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const tapId = (t: ReturnType<typeof flow>, id: string) => t.tap(id);
const NO_OPEN = [ar.answer.noOpenOrder, en.answer.noOpenOrder];

describe("fix 1: the minimum is said by code, with the minimum, the basket and the gap (sim-208, sim-024, sim-009)", () => {
  it("one Lipton: the minimum line with the amounts, Browse and Cancel, and no model wording it", async () => {
    const t = flow(db, [read(order([LIPTON])), read({ intent: "question", lines: [] })]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("مرحبا، بدي ليبتون ايس تي ريد فروتس زيرو شوغر ٣٢٠مل، وحدة");
    expect(t.seen).toHaveLength(1);                                    // the reading only: no ask loop to word the minimum
    expect(outbound).toHaveLength(1);
    const msg = outbound[0]!;
    expect(bodyOf(msg)).toBe(ar.basket.minimum(5, 0.69, 4.31));
    expect(bodyOf(msg)).toContain("الحد الأدنى للطلب: $5.00");
    expect(bodyOf(msg)).toContain("طلبك هلّق: $0.69");
    expect(bodyOf(msg)).toContain("ناقصك: $4.31");
    // No button raises a quantity for the customer: the B1a run on main counted "+7 Lipton" as a product the customer never chose.
    expect(buttonsOf(msg).map((x) => x.id)).toEqual([MENU_BROWSE, BASKET_CLEAR]);

    // "What is the minimum exactly?": the same numbers, by code, again with no ask loop (SIM1: asked up to five times, never told).
    await t.text("شو الحد الأدنى بالضبط؟");
    expect(t.seen).toHaveLength(2);
    expect(outbound).toHaveLength(2);
    expect(bodyOf(outbound[1]!)).toContain("ناقصك: $4.31");
  });

  it("an item said next is added to the basket under the minimum, never a new basket", async () => {
    const t = flow(db, [read(order([LIPTON])), read(order([BREAD(4)], "add_to_order", null)), read(order([BREAD(1)], "add_to_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ليبتون");
    await t.text("زيد اربع ربطات خبز");
    expect(outbound.some(isCard)).toBe(false);                        // 0.69 + 4 × 1.01 = 4.73: still under, so the minimum again
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك هلّق: $4.73");
    expect(bodyOf(outbound.at(-1)!)).toContain("ناقصك: $0.27");
    await t.text("وربطة كمان");
    const card = outbound.find(isCard)!;
    expect(card).toBeTruthy();
    const o = await db.one(`select subtotal_usd from orders where customer_id = $1`, [c.party_id]);
    expect(Number(o.subtotal_usd)).toBeCloseTo(5.74);
  }, 30_000);

  it("Cancel under the minimum lets the basket go; «where is my order» then has nothing open", async () => {
    const t = flow(db, [read(order([LIPTON]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ليبتون");
    await tapId(t, BASKET_CLEAR);
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.basket.cleared);
    await t.text("وين طلبي؟");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.answer.noOpenOrder);
  });

  it("«what is the minimum?» with no basket: the amount from settings, by code", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] })]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("شو الحد الأدنى للطلب عندكن؟");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.basket.minimumIs(5));
    expect(t.seen).toHaveLength(1);
  });

  it("the model's own words about the minimum are refused (the guard), so the loop cannot word it", () => {
    for (const t of ["طلبك لسا تحت الحد الأدنى للتوصيل، ضيف شي تاني؟", "Le fromage seul n'atteint pas le minimum de commande.", "Your order is below the minimum."])
      expect(checkModelText(t)?.code).toBe("minimum_by_code");
  });
});

describe("fix 3: the basket is kept while it is built (sim-009, sim-024: «you have no open order» mid-order)", () => {
  it("«where is my order?» while the basket waits on the pin: the basket so far and the pin request, never «no open order»", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD(1)]))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطة خبز عبعقلين");
    expect(outbound.at(-1)!.body.interactive?.type).toBe("location_request_message");
    await t.text("وين طلبي؟");                                         // the status shortcut, no model
    const reply = outbound.at(-1)!;
    expect(NO_OPEN).not.toContain(bodyOf(reply));
    expect(bodyOf(reply)).toContain("بسلّتك");
    expect(bodyOf(reply)).toContain("1 × ");
    expect(reply.body.interactive?.type).toBe("location_request_message");
    expect(t.seen).toHaveLength(1);
  });

  it("items said early stay on the card: a line that needed a question does not drop the ones already matched", async () => {
    const t = flow(db, [
      read(order([LABNEH, line("زكزوكة فريز", "zzqx frobnicate")])),
      [use("reply", { text: "شو قصدك بالزكزوكة؟" })],
      read(order([BREAD(2)])),
    ]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة وزكزوكة فريز");
    expect(outbound).toHaveLength(1);
    await t.text("لا خلص، بس ربطتين خبز");
    const card = outbound.find(isCard)!;
    expect(card).toBeTruthy();
    const items = await db.all(`select i.qty, p.id from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id
                                 where o.customer_id = $1 order by p.id`, [c.party_id]);
    expect(items.map((i: any) => i.id).sort()).toEqual([ids.LABNEH, ids.BREAD].sort());
  });

  it("a greeting mid-basket does not offer «same as last time» over it", async () => {
    const t = flow(db, [read(order([LIPTON])), read({ intent: "greeting", lines: [] }), [use("reply", { text: "أهلين! شو بتحب تزيد؟" })]]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ليبتون");
    await t.text("مرحبا");
    expect(buttonsOf(outbound.at(-1)!).some((b) => b.id.startsWith("repeat:"))).toBe(false);
  });
});

describe("fix 4: the basket changes only by what the customer picked (sim-215, sim-122, sim-020)", () => {
  it("«add 2 more» adds two: 2 bread become 4 on a new card that says what changed; the old card is withdrawn", async () => {
    const t = flow(db, [read(order([BREAD(2), LABNEH])),
                        read(order([line("زيد ربطتين خبز", "خبز", 2, { change: "add" })], "add_to_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ربطتين خبز ولبنة");
    const first = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    expect(first?.id).toBeTruthy();
    await t.text("زيد ربطتين خبز كمان");
    const orders = await db.all(`select id, status from orders where customer_id = $1 order by created_at`, [c.party_id]);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ id: first.id, status: "cancelled" });
    const bread = await db.one(`select qty from order_items where order_id = $1 and product_id = $2`, [orders[1].id, ids.BREAD]);
    expect(Number(bread.qty)).toBe(4);
    const all = outbound.map(bodyOf).join("\n");
    expect(all).toContain("✅ عدّلنا طلبك:");
    expect(all).toContain("2 → 4");
    expect((await db.one(`select count(*)::int as n from order_items where order_id = $1`, [orders[1].id])).n).toBe(2);   // the labneh stays
  });

  it("«no bread» takes the bread off and nothing else", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD(2)])),
                        read(order([line("بلا خبز", "خبز", 1, { change: "remove" })], "change_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة وربطتين خبز");
    await t.text("شيل الخبز");
    const last = await db.one(`select id from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    const items = await db.all(`select product_id from order_items where order_id = $1`, [last.id]);
    expect(items.map((i: any) => i.product_id)).toEqual([ids.LABNEH]);
    expect(outbound.map(bodyOf).join("\n")).toContain("− ");
  });

  it("the Concierge's quote_order sets lines and keeps the rest: a substitute replaces the line that ran out, nothing else is lost", async () => {
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [P.pepsi]);
    const small = (await db.one(`select id from products where sku = 'AK-0117'`)).id;
    const t = flow(db, [read(order([PEPSI(2), LABNEH])), [use("reply", { text: "البيبسي الكبيرة خلصت. بدك الصغيرة بدالها؟" })],
                        read({ intent: "question", lines: [] }), [use("quote_order", { lines: [{ product_id: small, qty: 2 }] })], [use("send_confirmation", {})]]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي 2 Pepsi Carbonated Drink 2.25L ولبنة");
    await t.text("إيه");
    await db.pg.query(`update stock_levels set on_hand = reserved + 500 where product_id = $1`, [P.pepsi]);
    const o = await db.one(`select id from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    const items = await db.all(`select product_id, qty from order_items where order_id = $1 order by product_id`, [o.id]);
    expect(items.map((i: any) => i.product_id).sort()).toEqual([ids.LABNEH, small].sort());
  });

  it("the edits, unit by unit: add adds, set re-counts, remove takes off, a substitute replaces its line", () => {
    const L = [{ product_id: "a", qty: 2 }, { product_id: "b", qty: 1 }];
    expect(applyEdits(L, [{ op: "add", product_id: "a", qty: 2 }]).lines).toEqual([{ product_id: "a", qty: 4 }, { product_id: "b", qty: 1 }]);
    expect(applyEdits(L, [{ op: "set", product_id: "a", qty: 3 }]).changes).toEqual([{ kind: "qty", product_id: "a", from: 2, to: 3 }]);
    expect(applyEdits(L, [{ op: "remove", product_id: "b" }]).lines).toEqual([{ product_id: "a", qty: 2 }]);
    expect(applyEdits(L, [{ op: "add", product_id: "c", qty: 1, replaces: "b" }]).lines.map((l) => l.product_id)).toEqual(["a", "c"]);
    // A restated item keeps its count (set), an "add" reading adds: the planner's line for "a" said again with qty 2.
    const plan = { lines: [{ idx: 0, status: "matched", qty: 2, chosen: { product_id: "a" }, candidates: null }], quote_lines: [{ product_id: "a", qty: 2 }] };
    const said = { lines: [{ raw: "a", query: "a", qty: 2 }] } as any;
    expect(applyEdits(L, editsFromPlan({ ...said, intent: "order" }, plan, L).edits).lines[0]!.qty).toBe(2);
    expect(applyEdits(L, editsFromPlan({ ...said, intent: "add_to_order" }, plan, L).edits).lines[0]!.qty).toBe(4);
  });

  it("«a third one» makes three in all (sim-051: «زيدلي ربطة خبز تالتة كمان» gave 5 pita); «another» still adds one", () => {
    const L = [{ product_id: "a", qty: 2 }];
    const plan = (q: number) => ({ lines: [{ idx: 0, status: "matched", qty: q, chosen: { product_id: "a" }, candidates: null }], quote_lines: [{ product_id: "a", qty: q }] });
    const said = (raw: string, qty: number) => ({ intent: "add_to_order", lines: [{ raw, query: "خبز", qty, change: "add" }] }) as any;
    expect(applyEdits(L, editsFromPlan(said("زيدلي ربطة خبز تالتة كمان", 3), plan(3), L).edits).lines[0]!.qty).toBe(3);
    expect(applyEdits(L, editsFromPlan(said("zidli rabta talte", 3), plan(3), L).edits).lines[0]!.qty).toBe(3);
    expect(applyEdits(L, editsFromPlan(said("زيدلي ربطة تانية", 1), plan(1), L).edits).lines[0]!.qty).toBe(3);
    expect(applyEdits(L, editsFromPlan(said("زيدلي ٣ ربطات كمان", 3), plan(3), L).edits).lines[0]!.qty).toBe(5);
  });

  it("the gap is the minimum less the basket, to the cent", () => {
    expect(minimumGap({ issues: [{ code: "below_minimum", minimum_usd: 5, subtotal_usd: 3.2 }] })).toEqual({ min: 5, now: 3.2, gap: 1.8 });
  });
});

describe("what the B1a run on main showed (sim-test 43722643280)", () => {
  it("the basket waits on the house and floor: «البناية البيضا» is the address, never eggs on the card", async () => {
    const eggsAddress = { intent: "order", fulfilment: "delivery", lines: [line("البيضا", "بيض")],
      address: { village: null, landmark: null, building: "البناية البيضا", floor: "الطابق التاني", recipient_name: null, verbatim: "البناية البيضا، الطابق التاني" } };
    const t = flow(db, [read(order([LABNEH])), read(eggsAddress)]);
    const c = await t.customer();
    await t.text("بدي لبنة عبعقلين");
    await t.say({ type: "location", location: { latitude: 33.68, longitude: 35.56 } });
    expect(bodyOf(outbound.at(-1)!)).toContain(ar.fixed.askAddress.split("\n")[0]!);
    await t.text("البناية البيضا، الطابق التاني");
    const card = outbound.find(isCard)!;
    expect(card).toBeTruthy();
    const items = await db.all(`select i.product_id from order_items i join orders o on o.id = i.order_id where o.customer_id = $1`, [c.party_id]);
    expect(items.map((i: any) => i.product_id)).toEqual([ids.LABNEH]);
  });

  it("an order with a food question: the loop answers the question first, the minimum is not said over it", async () => {
    const asked = { ...order([LIPTON]), restrictions: ["gluten"] };
    const t = flow(db, [read(asked), [use("reply", { text: "ما عنا معلومات موثّقة عن الغلوتين بهالمنتج، شوف الملصق." })]]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ليبتون بس فيه غلوتين؟");
    expect(t.seen).toHaveLength(2);
    expect(bodyOf(outbound[0]!)).not.toContain("الحد الأدنى");
  });

  it("«when will someone answer?» with a request open and no order: the request's reminder, never «no open order»", async () => {
    const t = flow(db, []);
    const c = await t.customer();
    await db.rpc("open_case", { p_conversation: c.conversation_id, p_kind: "person_requested", p_topic: "test", p_order: null, p_source: "test" });
    await t.text("وين طلبي؟");
    expect(NO_OPEN).not.toContain(bodyOf(outbound.at(-1)!));
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.support.reminder);
  });
});

describe("what the second B1a run on main showed (sim-test 43730014902)", () => {
  it("«where is my order?» while a card waits on the tap: the card again, never «no open order» (sim-079, sim-146)", async () => {
    const t = flow(db, [read(order([LABNEH])), read({ intent: "status", lines: [] })]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة");
    expect(outbound.filter(isCard)).toHaveLength(1);
    await t.text("وين طلبي؟");
    expect(NO_OPEN).not.toContain(bodyOf(outbound.at(-1)!));
    expect(outbound.filter(isCard)).toHaveLength(2);
  });

  it("«edit» on the card keeps its basket: «where is my order?» brings it back as a card, and a change said next edits it (sim-079)", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD(2)])),                                  // «وين طلبي؟» is read by code (quick intent)
                        read(order([line("خلّي الخبز تلاتة", "خبز", 3, { change: "set" })], "change_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة وربطتين خبز");
    const first = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    await t.tap(orderButtonId("edit", first.id));
    expect((await db.one(`select status from orders where id = $1`, [first.id])).status).toBe("draft");
    await t.text("وين طلبي؟");
    expect(NO_OPEN).not.toContain(bodyOf(outbound.at(-1)!));
    expect(outbound.filter(isCard)).toHaveLength(2);
    await t.tap(orderButtonId("edit", (await db.one(`select id from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id])).id));
    await t.text("خلّي الخبز تلاتة");
    const o = await db.one(`select id from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    const items = await db.all(`select product_id, qty from order_items where order_id = $1`, [o.id]);
    expect(Object.fromEntries(items.map((i: any) => [i.product_id, Number(i.qty)]))).toEqual({ [ids.LABNEH]: 1, [ids.BREAD]: 3 });
    expect(outbound.map(bodyOf).join("\n")).toContain("2 → 3");
  });

  it("the model says it changed the order without a tool: refused; it must change it through quote_order (sim-079, sim-146)", () => {
    for (const said of ["تمام، عدّلنا معجون البندورة لـ يمامة 660 غرام.", "تمام، خلّينا الحفاضات أربعة. ثواني وبحدّث الطلب.",
                        "I've updated your order to 2 Dove.", "J'ai modifié votre commande.", "tamam, 3addalt el talab"]) {
      expect(checkModelText(said)?.code, said).toBe("change_claim");
      expect(checkModelText(said, { basketChanged: true })).toBeNull();
    }
    expect(checkModelText("تمام، سجلت: البناية البيضا، الطابق تنين.")).toBeNull();
  });

  it("quote_order on a card waiting for the tap edits that card's basket: the rest of the card stays (sim-079)", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD(2)])), read({ intent: "question", lines: [] }),
                        [use("quote_order", { lines: [{ product_id: ids.BREAD, qty: 3 }] })], [use("send_confirmation", {})]]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة وربطتين خبز");
    expect(outbound.filter(isCard)).toHaveLength(1);
    await t.text("خلّي الخبز تلاتة");
    const o = await db.one(`select id from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    const items = await db.all(`select product_id, qty from order_items where order_id = $1`, [o.id]);
    expect(Object.fromEntries(items.map((i: any) => [i.product_id, Number(i.qty)]))).toEqual({ [ids.LABNEH]: 1, [ids.BREAD]: 3 });
  });
});

describe("fix 9: a cancel the database refuses gets a fixed answer and a case, never a turn error (sim-112, sim-215)", () => {
  it("Cancel on an order being prepared: the fixed line, a case for a person (its exception alerts ops), no technical error", async () => {
    const t = flow(db, [read(order([LABNEH]))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي لبنة");
    const o = await db.one(`select id, short_code from orders where customer_id = $1`, [c.party_id]);
    await t.tap(orderButtonId("confirm", o.id));
    await db.pg.query(`select transition_order($1, 'preparing', 'system', null, 'test')`, [o.id]);
    await t.tap(orderButtonId("cancel", o.id));
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.basket.cancelRefused(o.short_code));
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("preparing");
    const cs = await db.all(`select kind, topic from handoffs where conversation_id = $1`, [c.conversation_id]);
    expect(cs.some((x: any) => x.kind === "order_problem" && String(x.topic).startsWith("cancel_refused"))).toBe(true);
    expect((await db.one(`select count(*)::int as n from ops_exceptions where kind = 'technical' and detail->>'conversation_id' = $1`, [c.conversation_id])).n).toBe(0);
  });
});

describe("fix 10: catalogue claims only from tool results (sim-215: «the catalogue is not ready»)", () => {
  it("show_catalog with no WhatsApp catalog: one fixed line by code asking for the items in words", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] }), [use("show_catalog", {})]]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("شو عندكن؟ وريني الكتالوج");
    expect(outbound).toHaveLength(1);
    expect(bodyOf(outbound[0]!)).toBe(ar.support.browseInWords);
  });

  it("«the only one» and «the catalogue is not ready» are refused unless a search ran this turn", () => {
    expect(checkModelText("La confiture fraise est en rupture et c'est la seule disponible.")?.code).toBe("catalogue_claim");
    expect(checkModelText("الكتالوج مش جاهز هلق للأسف.")?.code).toBe("catalogue_claim");
    expect(checkModelText("The only strawberry jam we have is out of stock.")?.code).toBe("catalogue_claim");
    expect(checkModelText("The only strawberry jam we have is out of stock.", { catalogueSearched: true })).toBeNull();
    expect(checkModelText("بدك شي تاني؟")).toBeNull();
  });
});

describe("the two no-reply turns: a window tapped for a basket kept overnight (sim-009, sim-014)", () => {
  it("the basket fell under the minimum overnight: the tap gets the minimum line, never silence", async () => {
    const plan = (await db.one(`insert into delivery_window_plans(name, starts, ends, capacity, order_by_min, fresh_order_by_min)
                                values ('B1a', '10:00', '12:00', 5, 120, 180) returning id`)).id;
    await db.rpc("generate_delivery_slots", {});
    const slot = (await db.one(`select id from delivery_slots where plan_id = $1 and slot_date = (now() at time zone 'Asia/Beirut')::date + 1`, [plan])).id;
    await db.pg.query(`update settings set value = '{"open":"08:00","close":"08:00","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
    try {
      const t = flow(db, [read(order([LABNEH]))]);
      await pinned(db, t, ids.BAAKLINE);
      await t.text("بدي لبنة");
      expect(bodyOf(outbound[0]!)).toBe(ar.fixed.closedKept("08:00"));
      await db.pg.query(`update offers set price_usd = 4.50 where product_id = $1`, [ids.LABNEH]);
      const n = outbound.length;
      await t.say({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: windowButtonId(slot, null), title: "x" } } });
      expect(outbound.length).toBeGreaterThan(n);
      expect(bodyOf(outbound.at(-1)!)).toContain("ناقصك: $0.50");
    } finally {
      await db.pg.query(`update offers set price_usd = 5.00 where product_id = $1`, [ids.LABNEH]);
      await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
      await db.pg.query(`update delivery_window_plans set active = false where id = $1`, [plan]);
    }
  });
});
