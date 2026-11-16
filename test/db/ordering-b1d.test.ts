// Session B1d (counts and edits): the wrong-product conversations of sim-test 43781701377 (CX1's run on main), read one by one in
// evals/cases/b1d_counts_edits.json, as flows through the real turn code, tools and gateway on the real schema with a scripted model.
// The reading is the model's (scripted); what code makes of it is under test. Invented customers.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { pickButtonId } from "@ak/agents/choice";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
const P: Record<string, string> = {};
const SKU: Record<string, string> = { vanillin: "AK-0225", bicarb: "AK-0226", germex: "AK-0262", pepperoni: "AK-0097", beefPepperoni: "AK-0098",
  diapers6: "AK-0286", diapers5: "AK-0288", loulou6: "AK-0285", sugar: "AK-0223", sugar5: "AK-0228", lentilsRed: "AK-0180", lentilsGreen: "AK-0186",
  tender: "AK-0033", legs: "AK-0029", tanmiaLegs: "AK-0034", cornFlour: "AK-0187", goldMedal: "AK-0188", pepsiDiet: "AK-0116", colgate: "AK-0275", mint: "AK-0023" };
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  for (const [k, sku] of Object.entries(SKU)) {
    const r = await db.all<{ id: string }>(`select id from products where sku = $1`, [sku]);
    if (r[0]) P[k] = r[0].id;
  }
}, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(async () => { vi.unstubAllGlobals(); await db.pg.query(`update stock_levels set on_hand = 500`); });

const line = (raw: string, query: string, qty = 1, extra: Record<string, unknown> = {}) =>
  ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9, ...extra });
const order = (lines: unknown[], intent = "order", village: string | null = "بعقلين") =>
  ({ intent, fulfilment: "delivery", lines, address: { village, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const isQuestion = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("pick:"));
const name = async (k: string) => (await db.one(`select name_en from products where id = $1`, [P[k]])).name_en as string;
async function lastOrderLines(party: string) {
  const o = await db.one(`select id from orders where customer_id = $1 order by created_at desc limit 1`, [party]);
  const rows = await db.all<{ product_id: string; qty: string }>(`select product_id, qty from order_items where order_id = $1`, [o.id]);
  return new Map(rows.map((r) => [Object.keys(P).find((k) => P[k] === r.product_id) ?? r.product_id, Number(r.qty)]));
}
/** The lines of the last basket the shop listed (the minimum line, the night line or the card), as "qty × name". */
const listed = () => ([...outbound].reverse().map(bodyOf).find((b) => /\d × /.test(b)) ?? "").split("\n").filter((l) => /\d × /.test(l)).join("\n");
const dump = () => outbound.map((s) => `${bodyOf(s)} [${buttonsOf(s).map((b) => b.title).join(" | ")}]`).join("\n---\n");

describe("counts against a pack's measure (sim-008, sim-135)", () => {
  it("«اتنين domo sugar vanillin خمس غرام»: the 5 g is the size, never a second line or a third vanillin (sim-008)", async () => {
    const t = flow(db, [read(order([line("اتنين domo sugar vanillin", "domo sugar vanillin", 2), line("خمس غرام", "خمس غرام", 5)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("مرحبا اتنين domo sugar vanillinخمس غرام");
    const asked = outbound.filter(isQuestion);
    expect(asked.length).toBeLessThanOrEqual(1);
    expect(asked.map(bodyOf).join("\n")).not.toContain("«خمس غرام»");
    if (asked.length) await t.tap(pickButtonId(P.vanillin!), "Domo Sugar Vanill 5G");
    expect(listed()).toContain(`2 × ${await name("vanillin")}`);
  });

  it("«مقاس ٦ (١٦-٣٠ كيلو) ٣٢ حبة» read as 16: the tap gives one pack (sim-135)", async () => {
    const t = flow(db, [read(order([line("بامبرز اوي اوي مقاس ٦ (١٦-٣٠ كيلو) ٣٢ حبة", "بامبرز اوي اوي مقاس 6", 16)]))]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("مرحبا، بدي بامبرز اوي اوي مقاس ٦ (١٦-٣٠ كيلو) ٣٢ حبة");
    if (outbound.some(isQuestion)) await t.tap(pickButtonId(P.diapers6!), "Oui Oui Diapers 30Kg");
    expect(isCard(outbound.at(-1)!)).toBe(true);
    expect((await lastOrderLines(c.party_id)).get("diapers6")).toBe(1);
  });
});

describe("a swap or a correction never doubles or drops a line (sim-107, sim-135)", () => {
  it("«3 Germex badal 2, w 1 Domo bicarbonate»: 3 Germex and the 1 Domo stays 1 (sim-107)", async () => {
    const t = flow(db, [
      read(order([line("2 Germex floor detergent 1L", "Germex floor detergent 1L", 2), line("1 Domo bicarbonate 85g", "Domo bicarbonate 85g", 1)])),
      read(order([line("3 Germex", "Germex floor detergent", 3, { change: "set" }), line("1 Domo bicarbonate", "Domo bicarbonate", 1, { change: "add" })], "change_order", null)),
    ]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("Marhaba, baddi 2 Germex floor detergent 1L w 1 Domo bicarbonate 85g");
    expect(listed()).toContain(`1 × ${await name("bicarb")}`);
    await t.text("baddi 3'ayyer: 3 Germex badal 2, w 1 Domo bicarbonate");
    const now = listed();
    expect(now).toContain(`3 × ${await name("germex")}`);
    expect(now).toContain(`1 × ${await name("bicarb")}`);
  });

  it("«وكمان بدي 3 من مقاس 5» never lands on the size 6 in the basket; «ناقص» never takes it off (sim-135)", async () => {
    const t = flow(db, [
      read(order([line("وحدة بامبرز اوي اوي مقاس 6", "Oui Oui Diapers Size 6", 1)])),
      read(order([line("3 من مقاس 5", "بامبرز اوي اوي مقاس 5", 3, { change: "remove" })], "change_order", null)),
    ]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي وحدة بامبرز اوي اوي مقاس 6");
    if (outbound.some(isQuestion)) await t.tap(pickButtonId(P.diapers6!), "Oui Oui Diapers 30Kg");
    expect(isCard(outbound.at(-1)!)).toBe(true);
    await t.text("الكارت ناقص، وكمان ناقص 3 بامبرز مقاس 5");
    if (isQuestion(outbound.at(-1)!)) await t.tap(pickButtonId(P.diapers5!), "Oui Oui Diapers 25Kg");
    const last = await lastOrderLines(c.party_id);
    expect(last.get("diapers6")).toBe(1);
    expect(last.get("diapers5")).toBe(3);
  });
});

describe("a product named in full is that product (sim-137)", () => {
  it("«Toulkarem Pepperoni», a button's title sent back as words, is never asked again", async () => {
    const t = flow(db, [read(order([line("Toulkarem Pepperoni", "Toulkarem Pepperoni", 2)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("Toulkarem Pepperoni");
    expect(outbound.some(isQuestion)).toBe(false);
    expect(listed()).toContain(`2 × `);
    expect(listed()).not.toContain(await name("beefPepperoni"));
  });
});

describe("the product the words fit, never another (sim-042, sim-082, sim-145)", () => {
  it("«Deroni 3adas ahmar masrou2 900g» fits two lentils: a question with them, never Deroni's sugar", async () => {
    const t = flow(db, [read(order([line("1 3elbet Deroni 3adas ahmar masrou2 900g", "Deroni 3adas ahmar masrou2 900g", 1, { brand_hint: "Deroni" })]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("Baddi 1 3elbet Deroni 3adas ahmar masrou2 900g, please");
    const all = outbound.map(bodyOf).join("\n");
    expect(all).not.toContain(await name("sugar"));
    const q = outbound.find(isQuestion);
    if (q) expect(buttonsOf(q).map((b) => b.id)).toContain(pickButtonId(P.lentilsRed!));
  });

  it("«2 Tanmia Chicken Tender Loose» out of stock: never offered or replaced by the chicken legs (sim-082)", async () => {
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1`, [P.tender]);
    const t = flow(db, [read(order([line("2 Tanmia Chicken Tender Loose", "Tanmia Chicken Tender Loose", 2), line("1 Chicken Legs", "Chicken Legs", 1)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("Hi, I want 2 Tanmia Chicken Tender Loose and 1 Chicken Legs please");
    for (const s of outbound.filter(isQuestion)) if (bodyOf(s).includes("Tender")) expect(buttonsOf(s).map((b) => b.id), dump()).not.toContain(pickButtonId(P.legs!));
    expect(outbound.map(bodyOf).join("\n")).not.toMatch(/[23] × Chicken Legs/);
  });

  it("«طحين درة دومو 200غ» out of stock: no other flour goes in the basket unasked (sim-145)", async () => {
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1`, [P.cornFlour]);
    const t = flow(db, [read(order([line("حبة طحين درة دومو 200غ", "طحين درة دومو 200غ", 1, { brand_hint: "دومو" }), line("تلات علب أكياس سندويش سيتي بلاست 100 حبة", "أكياس سندويش سيتي بلاست 100 حبة", 3)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("مرحبا، بدي حبة طحين درة دومو 200غ وتلات علب أكياس سندويش سيتي بلاست 100 حبة");
    expect(outbound.map(bodyOf).join("\n")).not.toContain(await name("goldMedal"));
  });
});

describe("a complaint or a question is not an edit, unless it says what to change (sim-023, sim-042, sim-093)", () => {
  it("«ma baddi zid shi, kif fiyye kammel hek? 2 tahina bas» with 2 in the basket stays 2 (sim-023)", async () => {
    const L = line("2 Al Arabiya Tahina 400g", "Al Arabiya Tahina 400g", 2);
    const t = flow(db, [read(order([L])), read(order([{ ...L, raw: "2 tahina", query: "tahina", change: "add" }], "add_to_order", null))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi tnayn al arabiya tahina 400 gram");
    const before = listed();
    expect(before).toMatch(/2 × .*Tahina/);
    await t.text("ma baddi zid shi, kif fiyye kammel hek? 2 tahina bas");
    expect(listed()).toMatch(/2 × .*Tahina/);
    expect(outbound.some(isCard)).toBe(false);
  });

  it("«Ma talabt sukkar! shil el sukkar» (a complaint) takes the sugar off by code (sim-042)", async () => {
    const t = flow(db, [
      read(order([line("1 Deroni Sugar 900G", "Deroni Sugar 900G", 1), line("2 ربطة نعنع", "نعنع", 2)])),
      read(order([line("el sukkar", "sukkar", 1, { change: "remove" })], "complaint", null)),
    ]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi Deroni sugar 900g w 2 rabtet na3na3");
    expect(listed(), dump()).toContain(await name("sugar"));
    await t.text("Ma talabt sukkar! Shil el sukkar men el basle please");
    expect(t.seen).toHaveLength(2);                                     // two readings: no loop said "removed" in words
    expect(listed(), dump()).not.toContain(await name("sugar"));
    expect(listed()).toContain("2 × ");
  });

  it("«Lek el sukkar lessa bel basle! Shilo.» read as cancel never empties the basket (sim-042)", async () => {
    const t = flow(db, [
      read(order([line("1 Deroni Sugar 900G", "Deroni Sugar 900G", 1), line("2 ربطة نعنع", "نعنع", 2)])),
      read({ ...order([], "cancel", null) }),
    ]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("baddi Deroni sugar 900g w 2 rabtet na3na3");
    await t.text("Lek el sukkar lessa bel basle! Shilo.");
    expect(outbound.map(bodyOf)).not.toContain(ar.basket.cleared);
  });

  it("«ما فيكن تجيبوها إلي هيك هيك؟» is a question, never asked as a product to choose (sim-093)", async () => {
    const t = flow(db, [read(order([line("ما فيكن تجيبوها إلي هيك هيك؟", "هيك", 1)]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("ما فيكن تجيبوها إلي هيك هيك؟");
    expect(outbound.some(isQuestion)).toBe(false);
  });
});

describe("the card an edit came from is not sent again (sim-032)", () => {
  it("Pepsi taken off after the card, then «ما فيي خلي الطلب هيك؟»: the basket without the Pepsi, never the old card", async () => {
    const t = flow(db, [
      read(order([line("3 بيبسي دايت 1.25 ليتر", "Pepsi Diet 1.25L", 3), line("2 معجون كولغيت تريبل أكشن 125 مل", "Colgate Triple Action 125Ml", 2),
                  line("2 ربطة نعنع", "نعنع", 2)])),
      read(order([line("البيبسي دايت", "Pepsi Diet 1.25L", 1, { change: "remove" })], "change_order", null)),
      read(order([], "status", null)),
    ]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي 3 بيبسي دايت 1.25 ليتر، و2 معجون كولغيت تريبل أكشن 125 مل، و2 ربطة نعنع");
    expect(isCard(outbound.at(-1)!)).toBe(true);
    await t.text("بدي شيل البيبسي دايت من الطلب لو سمحت");
    expect(listed()).not.toContain(await name("pepsiDiet"));
    const n = outbound.length;
    await t.text("ما بدي زيد شي، بس ما فيي خلي الطلب هيك؟");
    const after = outbound.slice(n);
    expect(after.some(isCard)).toBe(false);
    expect(after.map(bodyOf).join("\n")).not.toContain(await name("pepsiDiet"));
  });
});

describe("the house default's line quotes the customer's words by the message rules (run 43824481535: sim-069, sim-143, sim-045)", () => {
  it("«بدي كمان ٣ ربطات خبز»: «3 ...», Latin digits, never «٣ ...»", async () => {
    const was = (await db.all<{ id: string }>(`select id from products where house_default`)).map((r) => r.id);
    const pita = (await db.one(`select id from products where sku = 'AK-0082'`)).id;
    await db.pg.query(`update products set house_default = (id = $1) where house_default or id = $1`, [pita]);
    try {
      const t = flow(db, [read(order([line("كمان ٩ ربطات خبز", "خبز", 9)]))]);
      await t.customer();
      await t.text("بدي كمان ٩ ربطات خبز");
      const said = outbound.map(bodyOf).join("\n");
      expect(said).toContain("«كمان 9 ربطات خبز»");
      expect(said).not.toMatch(/«[^»]*[٠-٩][^»]*»/u);
    } finally { await db.pg.query(`update products set house_default = (id = any($1::uuid[]))`, [was]); }
  });
});
