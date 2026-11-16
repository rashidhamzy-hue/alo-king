// Session B1c (wrong products, part 3): the wrong-product conversations of sim-test 43756167947 (B1b's second run on main), read one
// by one in evals/cases/b1c_wrong_products.json, as flows through the real turn code, tools and gateway on the real schema with a
// scripted model. Prices are the catalog seeds': Lipton 0.69, Kinder Maxi 0.35, Oui Oui wet wipes 1.55, Tanmia mortadelle 0.74,
// Dolsi 0.89, Master 0.57, Deroni red lentils 0.99, Colgate Herbal 1.42. The minimum is the seeded 5 USD.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { editsFromPlan } from "@ak/agents/basket";
import { pickButtonId, pickTitles, questionsFor } from "@ak/agents/choice";
import { packSizeCount } from "@ak/agents/reading";
import { offersChoices } from "@ak/agents/pipeline";
import { repeatButtonId } from "@ak/agents/answers";
import { KEPT_BUTTON } from "@ak/agents/order-card";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
const P: Record<string, string> = {};
const SKU: Record<string, string> = { dove: "AK-0276", diapers6: "AK-0286", lipton: "AK-0123", kinder: "AK-0148", ouioui: "AK-0284", wellplus: "AK-0269", tanmia: "AK-0096", almouna: "AK-0093",
  dolsi: "AK-0160", master: "AK-0161", lentilsRed: "AK-0180", colgateHerbal: "AK-0280", colgateTriple: "AK-0275", pita: "AK-0082" };
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  for (const [k, sku] of Object.entries(SKU)) P[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
}, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(async () => { vi.unstubAllGlobals(); await db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [OPEN]); });
const OPEN = `{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}`;
const CLOSED = `{"open":"08:00","close":"08:00","tz":"Asia/Beirut"}`;

const line = (raw: string, query: string, qty = 1, extra: Record<string, unknown> = {}) =>
  ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9, ...extra });
const order = (lines: unknown[], intent = "order", village: string | null = "بعقلين") =>
  ({ intent, fulfilment: "delivery", lines, address: { village, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const name = async (k: string) => (await db.one(`select name_en from products where id = $1`, [P[k]])).name_en as string;
async function lastOrderLines(party: string) {
  const o = await db.one(`select id from orders where customer_id = $1 order by created_at desc limit 1`, [party]);
  const rows = await db.all<{ product_id: string; qty: string }>(`select product_id, qty from order_items where order_id = $1`, [o.id]);
  return new Map(rows.map((r) => [Object.keys(P).find((k) => P[k] === r.product_id) ?? r.product_id, Number(r.qty)]));
}

describe("fix 1: a generic word or a brand alone is one question by code, never a product chosen (sim-029, sim-048, sim-016)", () => {
  it("«بدي ٢ كيس عدس»: three buttons from the products that fit, nothing added before the tap, and the tap keeps the 2", async () => {
    const t = flow(db, [read(order([line("٢ كيس عدس", "عدس", 2)]))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ٢ كيس عدس");
    expect(t.seen).toHaveLength(1);                                    // the reading only: no ask loop chose a lentil
    const q = outbound.at(-1)!;
    const picks = buttonsOf(q);
    expect(picks.length).toBeGreaterThan(1);
    expect(picks.length).toBeLessThanOrEqual(3);
    expect(picks.every((b) => b.id.startsWith("pick:"))).toBe(true);
    expect(bodyOf(q)).toContain("«2 كيس عدس»: أي واحد بدك؟");          // the customer's words, Latin digits (message rule 7)
    expect(bodyOf(q)).toContain("$0.99");                              // the prices come from the plan
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    await t.tap(pickButtonId(P.lentilsRed!), "Deroni Red");
    expect(t.seen).toHaveLength(1);                                    // the tap is code's: no model
    const after = bodyOf(outbound.at(-1)!);
    expect(after).toContain(`2 × ${await name("lentilsRed")}`);         // the minimum line shows the basket, with the count said
    expect(after).toContain("طلبك هلّق: $1.98");
  });

  it("a brand alone («بدي Gorosti») with one product is that product, shown in the basket line (sim-016)", async () => {
    const t = flow(db, [read(order([line("Gorosti", "Gorosti turkey breast")]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("مرحبا، كيفك؟ بدي Gorosti لو سمحت");
    expect(bodyOf(outbound.at(-1)!)).toContain("1 × صدر حبش");
  });

  it("the other lines of the message stay in the basket while one is asked, and the count said with the asked one is kept (sim-088, sim-130, B1a's sim-105)", async () => {
    const t = flow(db, [read(order([line("تلات معاجين كولجيت", "كولجيت", 3), line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml")]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي تلات معاجين كولجيت وليبتون ايس تي ريد فروتس زيرو شوغر ٣٢٠ مل");
    const q = outbound.at(-1)!;
    expect(buttonsOf(q).map((b) => b.id)).toContain(pickButtonId(P.colgateHerbal!));
    await t.tap(pickButtonId(P.colgateHerbal!), "Colgate Herbal");
    const body = bodyOf(outbound.at(-1)!);                              // 3 × 1.42 + 0.69 = 4.95: the minimum, with both lines
    expect(body).toContain(`3 × ${await name("colgateHerbal")}`);
    expect(body).toContain(`1 × ${await name("lipton")}`);
    expect(body).toContain("طلبك هلّق: $4.95");
  });

  it("button titles stay apart within 20 characters", () => {
    const t = pickTitles([{ product_id: "a", name: "Wooden Bakery Pita White Medium 400G", name_ar: null },
                          { product_id: "b", name: "Wooden Bakery Pita White Bread Big 800G", name_ar: null }], "en");
    expect(t.every((x) => x.length <= 20)).toBe(true);
    expect(new Set(t).size).toBe(2);
  });
});

describe("the house default is used and said (fix 1)", () => {
  it("«بدي ٩ ربطات خبز» with Wooden Bakery Pita Medium as the house default: nine of it; the pin request says which, the card names it", async () => {
    const was = (await db.all<{ id: string }>(`select id from products where house_default`)).map((r) => r.id);
    await db.pg.query(`update products set house_default = (id = $1) where house_default or id = $1`, [P.pita]);
    try {
      const t = flow(db, [read(order([line("٩ ربطات خبز", "خبز", 9)]))]);
      await t.customer();                                                // no pin yet: the pin request says which bread (9 × 0.62 = 5.58)
      await t.text("بدي ٩ ربطات خبز");
      expect(bodyOf(outbound.at(-1)!)).toContain(ar.basket.houseDefault("٩ ربطات خبز", await name("pita")));
      expect(bodyOf(outbound.at(-1)!).endsWith(ar.fixed.askPin)).toBe(true);
      // with a pin, the card names it with its count
      const t2 = flow(db, [read(order([line("٩ ربطات خبز", "خبز", 9)]))]);
      await pinned(db, t2, ids.BAAKLINE);
      await t2.text("بدي ٩ ربطات خبز");
      expect(bodyOf(outbound.filter(isCard).at(-1)!)).toContain(`9 × ${await name("pita")}`);
    } finally { await db.pg.query(`update products set house_default = (id = any($1::uuid[]))`, [was]); }
  });
});

describe("the basket is shown, and a count said again is not added again (sim-010, sim-078, sim-117, sim-067, sim-133)", () => {
  it("the minimum line lists the basket line by line", async () => {
    const t = flow(db, [read(order([line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 3)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ٣ ليبتون ايس تي ريد فروتس");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.basket.minimum(5, 2.07, 2.93, [`3 × ${await name("lipton")}`]));
  });

  it("«baddi ba3ten el 3 Lipton» (the count already in the basket, said again) stays 3", async () => {
    const L = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 3);
    const t = flow(db, [read(order([L])), read(order([L], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi 3 Lipton ice tea red fruits");
    await t.text("w baddi ba3ten el 3 Lipton");
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك هلّق: $2.07");
    expect(bodyOf(outbound.at(-1)!)).toContain(`3 × ${await name("lipton")}`);
  });

  it("but «zid 3 Lipton kamen» adds", async () => {
    const L = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 3);
    const t = flow(db, [read(order([L])), read(order([{ ...L, raw: "zid 3 ليبتون ايس تي ريد فروتس kamen", change: "add" }], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi 3 Lipton ice tea red fruits");
    await t.text("zid 3 Lipton kamen");
    expect(bodyOf(outbound.at(-1)!)).toContain(`6 × ${await name("lipton")}`);
  });
});

describe("fix 2: a basket kept overnight keeps its counts exactly (sim-028, sim-067; B1a's sim-104, sim-105)", () => {
  it("«they seem not added, add them» at night changes nothing, and «ابعت طلبي» in the morning sends the same counts", async () => {
    await db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [CLOSED]);
    const MORT = line("تلاتة تنمية مورتديلا بقر مع زيتون", "Tanmia Mortadelle Beef Aux Olives", 3);
    const KIND = line("Kinder Chocolate Barrette Maxi 21G", "Kinder Chocolate Barrette Maxi 21G", 2);
    const LIP = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 5);    // 2.22 + 0.70 + 3.45 = 6.37
    const t = flow(db, [read(order([MORT, KIND, LIP])), read(order([{ ...MORT, change: "add" }], "add_to_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await db.pg.query(`update customer_places set building = 'البناية البيضا', floor = '2' where party_id = $1`, [c.party_id]);
    await t.text("بدي تلاتة تنمية مورتديلا بقر مع زيتون وتنين كيندر ماكسي");
    const kept = bodyOf(outbound.find((s) => buttonsOf(s).some((b) => b.id === KEPT_BUTTON))!);
    expect(kept).toContain(`3 × ${await name("tanmia")}`);              // the kept basket is shown
    const before = outbound.length;
    await t.text("عفوا، أنا طلبت كمان تلاتة مورتديلا تنمية، شكلهن ما انضافوا. ممكن تضيفهن؟");
    expect(bodyOf(outbound[before]!)).toContain(`3 × ${await name("tanmia")}`);   // still 3, shown again
    await db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [OPEN]);
    await t.tap(KEPT_BUTTON, "ابعت طلبي");
    expect(outbound.some(isCard), JSON.stringify(outbound.map(bodyOf))).toBe(true);
    const lines = await lastOrderLines(c.party_id);
    expect(lines.get("tanmia")).toBe(3);
    expect(lines.get("kinder")).toBe(2);
    expect(lines.get("lipton")).toBe(5);
  });
});

describe("an edit lands on the basket's own product (sim-021, sim-025, sim-052, sim-143)", () => {
  it("«1 Kinder w 1 wet wipes bas» with Oui Oui in the basket: Oui Oui, never a second brand of wipes", async () => {
    const t = flow(db, [read(order([line("Kinder Chocolate Barrette Maxi 21G", "Kinder Chocolate Barrette Maxi 21G", 3),
                                    line("Oui Oui Wet Wipes Aqua Pure 80 sheets", "Oui Oui Wet Wipes Aqua Pure 80 sheets"),
                                    line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 4)])),
                        read(order([line("1 Kinder", "Kinder Chocolate Barrette Maxi 21G", 1, { change: "set" }), line("1 wet wipes", "wet wipes", 1, { change: "set" })],
                                   "change_order", null))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi 3 Kinder Barrette Maxi w Oui Oui wet wipes aqua pure w 4 Lipton");
    await t.text("3 Kinder? ana talabt 1 Kinder w 1 wet wipes bas");
    const body = bodyOf(outbound.at(-1)!);
    expect(body).not.toContain(await name("wellplus"));
    expect(body).toContain(`1 × ${await name("kinder")}`);
    expect(body).toContain(`1 × ${await name("ouioui")}`);
    void c;
  });

  it("«mortadelle 1 mech 2» with Tanmia mortadelle in the basket: Tanmia 1, no Al Mouna", async () => {
    const t = flow(db, [read(order([line("Tanmia mortadelle beef bel zeitoun", "Tanmia Mortadelle Beef Aux Olives", 2),
                                    line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 7)])),
                        read(order([line("mortadelle 1 mech 2", "mortadelle", 1, { change: "set" })], "change_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi 2 Tanmia mortadelle beef bel zeitoun w 7 Lipton");      // 1.48 + 4.83, then 0.74 + 4.83: a card both times
    await t.text("mortadelle 1 mech 2");
    const card = outbound.filter(isCard).at(-1)!;
    expect(bodyOf(card)).not.toContain(await name("almouna"));
    expect(bodyOf(card)).toContain(`1 × ${await name("tanmia")}`);
  });

  it("«كمان ٢ كيس شيبس ماستر» with Dolsi in the basket: never the Dolsi; which Master is asked, and the tap adds two of it", async () => {
    const t = flow(db, [read(order([line("Dolsi Chips Crunchy Peanuts Puffs 80G", "Dolsi Chips Crunchy Peanuts Puffs 80G", 2)])),
                        read(order([line("٢ كيس شيبس ماستر", "شيبس ماستر", 2, { change: "add" })], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ٢ دولسي شيبس");
    await t.text("عطيني كمان ٢ كيس شيبس ماستر");
    const q = outbound.at(-1)!;
    expect(buttonsOf(q).map((b) => b.id)).toContain(pickButtonId(P.master!));
    expect(buttonsOf(q).map((b) => b.id)).not.toContain(pickButtonId(P.dolsi!));
    await t.tap(pickButtonId(P.master!), "Master 65G");
    const body = bodyOf(outbound.at(-1)!);
    expect(body).toContain(`2 × ${await name("dolsi")}`);
    expect(body).toContain(`2 × ${await name("master")}`);
  });

  it("editsFromPlan: a generic word fits one basket product among those it fits (`tied`)", () => {
    const { edits, unresolved } = editsFromPlan(
      { intent: "change_order", lines: [{ raw: "1 wet wipes", query: "wet wipes", qty: 1, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9, change: "set" } as any] },
      { lines: [{ idx: 0, status: "ambiguous", qty: 1, chosen: null, candidates: [{ product_id: "W" }, { product_id: "G" }], tied: [{ product_id: "W" }, { product_id: "G" }, { product_id: "O" }] }],
        quote_lines: [] },
      [{ product_id: "O", qty: 2 }, { product_id: "K", qty: 3 }]);
    expect(unresolved).toEqual([]);
    expect(edits).toEqual([{ op: "set", product_id: "O", qty: 1 }]);
  });
});

describe("fix 3: «where is my order?» with no open order offers the last one (sim-073)", () => {
  it("a customer with a closed order hears «no open order» with the last order as one tap, and the tap is its card", async () => {
    const t = flow(db, [read({ intent: "status", lines: [] })]);
    const c = await pinned(db, t, ids.BAAKLINE);
    const old = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id,
      p_lines: [{ product_id: P.lipton, qty: 8 }], p_village: ids.BAAKLINE, p_place: null, p_pickup: true, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.pg.query(`update orders set status = 'closed', delivered_at = now() - interval '5 days' where id = $1`, [old.order_id]);
    await t.text("آخر طلبية كانت من خمس ايام، مش مسجلة عندكن؟");
    const offer = outbound.at(-1)!;
    expect(bodyOf(offer)).toContain("ما عندك طلب مفتوح هلّق.");
    expect(buttonsOf(offer).map((b) => b.id)).toEqual([repeatButtonId(old.order_id)]);
    await t.tap(repeatButtonId(old.order_id), ar.answer.repeatButton);
    expect(bodyOf(outbound.at(-1)!)).toContain(`8 × ${await name("lipton")}`);
  });
});

describe("pack sizes (sim-003)", () => {
  it.each([
    ["three large blue trash bags vimax thirty pieces", 30, "Vimax Trash Bags Large Blue 30 Pieces", 3],
    ["one pack of nestle pure life water the small bottles twelve pieces", 12, "Nestle Pure Life Water 0.6L X12", 1],
    ["حفاضات وي وي مقاس 6، 32 حبة", 32, "Oui Oui Diapers Size 6 16-30Kg 32 Pieces", 1],     // B1b's sim-147, still one pack
  ])("%s", (raw, qty, product, packs) => {
    expect(packSizeCount({ raw: raw as string, qty: qty as number }, [product as string])).toBe(packs);
  });
  it("a count that is not the pack's size is left alone", () => {
    expect(packSizeCount({ raw: "3 trash bags", qty: 3 }, ["Vimax Trash Bags Large Blue 30 Pieces"])).toBeNull();
  });
});

describe("what the B1c run on main showed (sim-test 43771268952)", () => {
  it("«add 2 more Dove cream bars, same one»: the Dove soap in the basket, never a question about cream (sim-083)", async () => {
    const DOVE = line("Dove Original Beauty Cream Bar 90G", "Dove Original Beauty Cream Bar 90G", 2);
    const t = flow(db, [read(order([DOVE])), read(order([line("add 2 more Dove cream bars, same one", "Dove cream bar", 2, { change: "add" })], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("Hi, I want 2 Dove cream bar soap please, the original one 90g");
    await t.text("ok can you add 2 more Dove cream bars, same one");
    const body = bodyOf(outbound.at(-1)!);
    expect(buttonsOf(outbound.at(-1)!).some((b) => b.id.startsWith("pick:"))).toBe(false);
    expect(body).toContain(`4 × ${await name("dove")}`);
  });

  it("a question the customer moves past is dropped, never asked again (sim-083)", async () => {
    const LIP = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 2);
    const t = flow(db, [read(order([line("عدس", "عدس")])), read(order([LIP], "order", null)), read(order([{ ...LIP, qty: 3, change: "set" }], "change_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي عدس");
    expect(buttonsOf(outbound.at(-1)!).some((b) => b.id.startsWith("pick:"))).toBe(true);
    await t.text("لا ما بدي عدس، بدي ٢ ليبتون");
    await t.text("خليهن ٣ ليبتون");
    const last = outbound.at(-1)!;
    expect(bodyOf(last), JSON.stringify(outbound.map(bodyOf))).not.toContain("أي واحد بدك");
    expect(bodyOf(last)).toContain(`3 × ${await name("lipton")}`);
  });

  it("the tap keeps «٣٢ حبة» of a 32-piece pack as one pack (sim-147)", async () => {
    const t = flow(db, [read(order([line("حفاضات ٣٢ حبة", "حفاضات", 32)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي حفاضات ٣٢ حبة");
    const q = outbound.at(-1)!;
    expect(buttonsOf(q).map((b) => b.id)).toContain(pickButtonId(P.diapers6!));
    await t.tap(pickButtonId(P.diapers6!), "Oui Oui 32");
    expect(bodyOf(outbound.at(-1)!)).toContain(`1 × ${await name("diapers6")}`);
  });

  it("«مثلا ربطة خبز أو علبة تونة», «chocolate aw chips» are choices: nothing is added by code (sim-043, sim-040)", async () => {
    const two = (a: string, b: string) => ({ lines: [line(a, a), line(b, b)] }) as any;
    expect(offersChoices("بدي شي بسيط يكمّل الطلب، مثلا ربطة خبز أو علبة تونة.", two("ربطة خبز", "علبة تونة"))).toBe(true);
    expect(offersChoices("baddi kamen chocolate aw chips", two("chocolate", "chips"))).toBe(true);
    expect(offersChoices("بدي ربطة خبز وعلبة تونة", two("ربطة خبز", "علبة تونة"))).toBe(false);
    const LIP = line("ليبتون ايس تي ريد فروتس زيرو شوغر 320 مل", "Lipton Ice Tea Red Fruits Zero Sugar 320Ml", 2);
    const t = flow(db, [read(order([LIP])), read(order([line("ربطة خبز", "خبز"), line("علبة تونة", "تونة")], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي ٢ ليبتون ايس تي");
    await t.text("بدي شي بسيط يكمّل الطلب، مثلا ربطة خبز أو علبة تونة.");
    expect(t.seen.length).toBeGreaterThan(2);                         // the loop got the turn (the scripted model has nothing more)
    expect(outbound.some((o) => bodyOf(o).includes("2 × ") && bodyOf(o).includes("Pita"))).toBe(false);
  });
});

describe("fix 3: same as last time with a past basket under today's minimum (sim-073 in sim-test 43771268952)", () => {
  async function pastOrder(c: { party_id: string; conversation_id: string }) {
    // a basket under today's $5 minimum, delivered days ago: written as rows (create_order_from_quote refuses it today)
    const o = (await db.one(`insert into orders(customer_id, short_code, status, village_id, delivered_at) values ($1, $3, 'closed', $2, now() - interval '5 days') returning id`,
      [c.party_id, ids.BAAKLINE, `AK-H${Math.floor(Math.random() * 1e6)}`])).id;
    const f = (await db.one(`insert into fulfilments(order_id, source_id) select $1, id from sources where kind = 'dark_store' limit 1 returning id`, [o])).id;
    await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd) values ($1, $2, $3, 'x', 2, 0.69)`, [o, f, P.lipton]);
    return o as string;
  }
  it("the words: the minimum line with the old basket in it, kept; never the loop's «I prepared it»", async () => {
    const t = flow(db, [read({ intent: "order", repeat_last: true, lines: [], address: {} })]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await pastOrder(c);
    await t.text("بدي نفس الطلبية يلي المرة الماضية لو سمحت");
    expect(t.seen).toHaveLength(1);
    const body = bodyOf(outbound.at(-1)!);
    expect(body).toContain(`2 × ${await name("lipton")}`);
    expect(body).toContain("الحد الأدنى للطلب: $5.00");
  });
  it("the button: the same, never silence", async () => {
    const t = flow(db, []);
    const c = await pinned(db, t, ids.BAAKLINE);
    const o = await pastOrder(c);
    await t.tap(repeatButtonId(o), ar.answer.repeatButton);
    expect(outbound.length).toBeGreaterThan(0);
    expect(bodyOf(outbound.at(-1)!)).toContain(`2 × ${await name("lipton")}`);
  });
});

describe("the question quotes the customer's words by the message rules (sim-test 43776071899: sim-105, sim-029, sim-126)", () => {
  it("Latin digits, no amount, short", () => {
    const cand = [{ product_id: "a", name: "Deroni Sugar 900G", name_ar: null, price_usd: 0.69, in_stock: true }];
    const q = (raw: string) => questionsFor([{ idx: 0, status: "ambiguous", candidates: cand }], { lines: [{ raw, query: "x", qty: 1 } as any] })[0]!.raw;
    expect(q("بدي كمان ٣ كيلو سكر")).toBe("بدي كمان 3 كيلو سكر");
    expect(q('baddi "ليمون للعصير" $0.44 yalli kenet 3endak 2abel')).not.toContain("$");
    expect(q("بدي قهوة نجار بالهيل ١٨٠ غرام، اتنين وكمان شي تاني طويل كتير كتير").length).toBeLessThanOrEqual(40);
  });
});
