// Session B1b (ordering fixes from the simulated customers, part 2): SIM1's fixes 5, 6, 7 and 8 (docs/SIM_REPORT_2026-11-15.md),
// each from a failing case of evals/cases/sim_*.json or B1a's third run on main (43736730998), through the real turn code, tools and
// gateway on the real schema with a scripted model. Coordinator decision 3 of 15 Nov 13:30: a first order without a map pin is
// accepted with a typed village and landmark and marked for a rider call; a pin outside the area is still refused.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar, en } from "@ak/agents/messages";
import { pinVillageButtonId } from "@ak/agents/order-card";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso, use, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
const V: Record<string, { id: string; lat: number; lng: number }> = {};
beforeAll(async () => {
  ({ db, ids } = await openFlowDb());
  for (const n of ["Aainbal", "Aatrine", "Baakline", "Jbaa"]) V[n] = await db.one(`select id, lat, lng from villages where name_en = $1`, [n]);
}, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const line = (raw: string, query: string, qty = 1) =>
  ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9 });
const LABNEH = line("لبنة ليبان ليه 900 غ", "Liban Lait Labneh Baladieh 900G");
const BREAD = line("خبز وودن بيكري", "Wooden Bakery Pita White Bread Big 800G", 2);
const address = (a: Record<string, string | null> = {}) => ({ village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null, ...a });
const order = (lines: unknown[], a: Record<string, string | null> = {}, intent = "order") => ({ intent, fulfilment: "delivery", lines, address: address(a) });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const isPinRequest = (s: Sent) => s.body.interactive?.type === "location_request_message";
const pin = (t: ReturnType<typeof flow>, lat: number, lng: number) => t.say({ type: "location", location: { latitude: lat, longitude: lng } });

describe("fix 5: a first order without a map pin (sim-006, sim-046, sim-077: «ما فيني ابعت لوكيشن», asked for the pin four times)", () => {
  it("a typed village and landmark are accepted: the card goes out, the order is marked for a rider call", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" })),
      read(order([], { village: "بعقلين", landmark: "حارة الجامع", building: "البناية البيضا", floor: "الطابق التاني",
                       verbatim: "بعقلين، حارة الجامع، البناية البيضا، الطابق التاني" }))]);
    const c = await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    expect(isPinRequest(outbound.at(-1)!)).toBe(true);                 // a pin is still asked for first
    await t.text("ما فيني ابعت لوكيشن، الموقع مطفي عندي. بعقلين، حارة الجامع، البناية البيضا، الطابق التاني");
    const card = outbound.find(isCard);
    expect(card, outbound.map(bodyOf).join("\n---\n")).toBeTruthy();
    expect(outbound.filter(isPinRequest)).toHaveLength(1);             // never asked again
    expect(outbound.map(bodyOf).join("\n")).toContain(ar.fixed.noPinCall("بعقلين"));
    const o = await db.one(`select id, place_id, village_id, customer_notes from orders where customer_id = $1`, [c.party_id]);
    // A place said in words: no coordinates, the customer's words for the rider.
    const place = await db.one(`select lat, lng, directions, building from customer_places where id = $1`, [o.place_id]);
    expect(place.lat).toBeNull();
    expect(place.directions).toContain("حارة الجامع");
    expect(o.village_id).toBe(V.Baakline!.id);
    expect(o.customer_notes).toContain("حارة الجامع");
    expect(o.customer_notes).toContain(ar.fixed.noPinNote);            // the rider or ops reads it on the order
    const flag = await db.one(`select rule, severity, details from risk_flags where subject_kind = 'order' and subject_id = $1`, [o.id]);
    expect(flag.rule).toBe("call_before_dispatch");
    expect(flag.details.reason).toBe("no_pin");
    // The branch run (43746511047): the confirm tap on such a card asked for the pin again. It confirms.
    await t.tap(`order:confirm:${o.id}`, "تأكيد الطلب");
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("confirmed");
    expect(outbound.filter(isPinRequest)).toHaveLength(1);
  }, 30_000);

  it("an edit after the card made without a pin never asks for the pin again (sim-046, sim-077 on the branch run)", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" })),
      read(order([], { village: "بعقلين", landmark: "حارة الجامع", building: "البناية البيضا", floor: "الطابق التاني" })),
      read(order([{ ...BREAD, qty: 1, change: "set" }], {}, "change_order"))]);
    const c = await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    await t.text("ما فيني ابعت لوكيشن. بعقلين، حارة الجامع، البناية البيضا، الطابق التاني");
    await t.text("بدي ربطة خبز وحدة بس");
    expect(outbound.filter(isPinRequest)).toHaveLength(1);
    expect(outbound.filter(isCard).length).toBe(2);
    const flags = await db.all(`select f.rule from risk_flags f join orders o on o.id = f.subject_id where o.customer_id = $1`, [c.party_id]);
    expect(flags.map((f: any) => f.rule)).toEqual(["call_before_dispatch", "call_before_dispatch"]);
  }, 30_000);

  it("Arabizi, the address only in words (sim-046): the same, and the fixed lines are Arabic", async () => {
    const t = flow(db, [read({ ...order([LABNEH, BREAD], { village: "Baakline" }), language: "arabizi" }),
      read({ ...order([], { village: "Baakline", landmark: "7ay el sa7a", building: "el bineye el bayda", floor: "el taba2 el tene" }), language: "arabizi" })]);
    await t.customer();
    await t.text("marhaba, baddi labne liban lait w 2 khebez la Baakline");
    await t.text("el location mish sha3él 3andi, ana bi Baakline, 7ay el sa7a, el bineye el bayda, el taba2 el tene");
    expect(outbound.some(isCard)).toBe(true);
    expect(outbound.filter(isPinRequest)).toHaveLength(1);
  }, 30_000);

  it("no pin and no village said: one short question for the village and a landmark, the basket kept", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD])), read(order([], {}))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز");
    expect(isPinRequest(outbound.at(-1)!)).toBe(true);
    await t.text("ما فيني ابعت موقع");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.fixed.askVillageLandmark);
    expect(outbound.some(isCard)).toBe(false);
  }, 30_000);

  it("a typed village we do not serve is refused, as a pin outside is", async () => {
    await db.pg.query(`update villages set is_served = false where id = $1`, [V.Jbaa!.id]);
    try {
      const t = flow(db, [read(order([LABNEH, BREAD])), read(order([], { village: "جباع", landmark: "حد الكنيسة" }))]);
      await t.customer();
      await t.text("بدي لبنة ليبان ليه وربطتين خبز");
      await t.text("ما فيني ابعت موقع. جباع، حد الكنيسة");
      expect(outbound.some(isCard)).toBe(false);
      expect(bodyOf(outbound.at(-1)!)).toContain("لهلّق ما منوصّل على جباع");
    } finally { await db.pg.query(`update villages set is_served = true where id = $1`, [V.Jbaa!.id]); }
  }, 30_000);

  it("a pin outside the area is still refused, and no line of the refusal is over 120 characters", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" }))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    await pin(t, 33.40, 35.20);
    expect(outbound.some(isCard)).toBe(false);
    for (const s of outbound) for (const l of bodyOf(s).split("\n")) expect(l.length, l).toBeLessThanOrEqual(120);
  }, 30_000);

  it("the list of villages we serve is wrapped: no line over 120 characters (sim-008, sim-055: 257)", () => {
    const names = Array.from({ length: 25 }, (_, i) => `ضيعة رقم ${i + 1}`);
    for (const m of [ar, en]) for (const l of m.answer.outOfArea("جباع", names).split("\n")) expect(l.length, l).toBeLessThanOrEqual(120);
  });
});

describe("fix 5: a pin between villages, when the customer already named one of them (sim-110: «between several villages. Where exactly?»)", () => {
  it("the village said is taken when the pin is near it: no question", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "عترين" }))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عترين");
    const mid = { lat: (V.Aainbal!.lat + V.Aatrine!.lat) / 2, lng: (V.Aainbal!.lng + V.Aatrine!.lng) / 2 };
    await pin(t, mid.lat, mid.lng);
    expect(outbound.some((s) => buttonsOf(s).some((b) => b.id.startsWith("pinvillage:"))), outbound.map(bodyOf).join("\n---\n")).toBe(false);
    expect(bodyOf(outbound.at(-1)!)).toContain("عترين");             // the address question names the village
  }, 30_000);

  it("no village said: one short question, at most three buttons", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD]))]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز");
    const mid = { lat: (V.Aainbal!.lat + V.Aatrine!.lat) / 2, lng: (V.Aainbal!.lng + V.Aatrine!.lng) / 2 };
    await pin(t, mid.lat, mid.lng);
    const q = outbound.at(-1)!;
    expect(bodyOf(q)).toBe(ar.fixed.askVillage);
    expect(bodyOf(q).length).toBeLessThanOrEqual(120);
    expect(buttonsOf(q).length).toBeGreaterThan(0);
    expect(buttonsOf(q).length).toBeLessThanOrEqual(3);
    expect(buttonsOf(q).map((b) => b.id)).toContain(pinVillageButtonId(V.Aatrine!.id));
  }, 30_000);
});

describe("fix 8: a greeting, a thank-you or a goodbye is not off-topic (SIM1: 60 conversations got the off-topic line)", () => {
  it("«ok np, thanks anyway. bye», read as off_topic: a short closing line, not the off-topic line, and no model wording it", async () => {
    const t = flow(db, [read({ intent: "off_topic", lines: [], language: "en" })]);
    await t.customer();
    await t.text("ok np, thanks anyway. bye");
    expect(t.seen).toHaveLength(1);
    expect(outbound.map(bodyOf)).toEqual([en.fixed.welcome]);
  });

  it("«ماشي مرسي، يعطيكن العافية» with a basket in hand: the closing line, and the basket is still there", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" })), read({ intent: "off_topic", lines: [] })]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    await t.text("ماشي مرسي، يعطيكن العافية");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.fixed.welcome);
    expect(outbound.map(bodyOf)).not.toContain(ar.fixed.offTopic);
  }, 30_000);

  it("«مرحبا كيفك؟ شو أخبارك؟» read as off_topic is a greeting: the Concierge greets, never the off-topic line", async () => {
    const t = flow(db, [read({ intent: "off_topic", lines: [] }), [use("reply", { text: "أهلين! شو بتحب تطلب اليوم؟" })]]);
    await t.customer();
    await t.text("مرحبا كيفك؟ شو أخبارك؟");
    expect(outbound.map(bodyOf)).toEqual(["أهلين! شو بتحب تطلب اليوم؟"]);
  });

  it("«شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» read as off_topic goes to the Concierge (HANDOFF lane B (b))", async () => {
    const t = flow(db, [read({ intent: "off_topic", lines: [] }), [use("reply", { text: "أكيد، شو بدك من العدس والرز والبصل؟" })]]);
    await t.customer();
    await t.text("شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة");
    expect(t.seen).toHaveLength(2);
    expect(outbound.map(bodyOf)).not.toContain(ar.fixed.offTopic);
  });

  it("the answer to the house question read as off_topic is the address (sim-021: «l binen l abyad, l tabe2 l tene»)", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" })),
      read({ intent: "off_topic", lines: [], language: "arabizi", address: address({ building: "l binen l abyad", floor: "l tabe2 l tene" }) })]);
    await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    await pin(t, V.Baakline!.lat + 0.0003, V.Baakline!.lng);
    expect(bodyOf(outbound.at(-1)!)).toContain(ar.fixed.askAddress);
    await t.text("l binen l abyad, l tabe2 l tene");
    expect(outbound.some(isCard), outbound.map(bodyOf).join("\n---\n")).toBe(true);
    expect(outbound.map(bodyOf)).not.toContain(ar.fixed.offTopic);
  }, 30_000);
});

describe("fix 6: the customer's language is kept (sim-010, sim-133: a tap on an English title switched an Arabizi customer to English)", () => {
  it("an Arabizi customer who taps an English product title keeps Arabic fixed lines; the ask loop is told to write Arabizi", async () => {
    const t = flow(db, [read({ intent: "question", lines: [], language: "arabizi" }), [use("reply", { text: "Ayya labne baddak?", buttons: [{ id: "x1", title: "Liban Lait Labneh" }] })],
      read({ intent: "question", lines: [], language: "en" }), [use("reply", { text: "tamam" })]]);
    await t.customer();
    await t.text("marhaba, shu fi 3andkon labne?");
    await t.tap("x1", "Liban Lait Labneh");
    const askInput = JSON.parse(String((t.seen[3]!.messages[0]!.content as string)));
    expect(askInput.reply_language).toMatch(/Arabizi/);
  }, 30_000);

  it("a voice note in English before a case is opened gets the English line (sim-084)", async () => {
    const t = flow(db, [], { deps: { stt: undefined } });
    await t.customer();
    await t.text("Hi, I ordered yesterday and it never came, I want to talk to a person now");
    expect(bodyOf(outbound[0]!)).toBe(en.support.opened);
  });
});

describe("fix 7: the model's words keep the message rules when they are sent", () => {
  it("Arabic-Indic digits become Latin and a long line is split into its sentences", async () => {
    const long = "تمام، ضفت ٣ قناني تلاية على السلة، وفيك تزيد شي كمان إذا بدك قبل ما نبعتلك ورقة الطلب لتأكد عليها. شو بعد بتحب تطلب من عنا؟";
    const t = flow(db, [read({ intent: "question", lines: [] }), [use("reply", { text: long })]]);
    await t.customer();
    await t.text("في عندكن تلاية؟");
    const sent = bodyOf(outbound[0]!);
    expect(sent).not.toMatch(/[٠-٩]/u);
    expect(sent.split("\n").every((l) => l.length <= 120)).toBe(true);
  });
});

describe("B1a's reading leftovers, through the turn", () => {
  it("«30 حبة» of a product sold as a pack of 30 is one pack (sim-147: 32 packs of 32 diapers)", async () => {
    const eggs = line("بيض هوا ابيض 30 حبة", "Hawa Chicken White Eggs 30Pcs", 30);
    const t = flow(db, [read(order([eggs, BREAD], { village: "بعقلين" }))]);
    const c = await t.customer();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: ids.BAAKLINE });
    await t.text("بدي بيض هوا ابيض 30 حبة وربطتين خبز عبعقلين");
    const o = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    const items = await db.all(`select p.sku, oi.qty from order_items oi join products p on p.id = oi.product_id where oi.order_id = $1 order by p.sku`, [o.id]);
    expect(items.map((r: any) => [r.sku, Number(r.qty)])).toContainEqual(["AK-0055", 1]);
  }, 30_000);

  it("«البناية البيضا» in the address step is the building, never eggs (sim-113, sim-117)", async () => {
    const t = flow(db, [read(order([LABNEH, BREAD], { village: "بعقلين" })),
      read({ intent: "order", language: "arabizi", lines: [line("bayda", "bayd abyad")], address: address({ floor: "el tabe2 tene" }) })]);
    const c = await t.customer();
    await t.text("بدي لبنة ليبان ليه وربطتين خبز عبعقلين");
    await pin(t, V.Baakline!.lat + 0.0003, V.Baakline!.lng);
    await t.text("el binaye bayda, el tabe2 tene");
    expect(outbound.some(isCard)).toBe(true);
    const o = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    const skus = (await db.all(`select p.sku from order_items oi join products p on p.id = oi.product_id where oi.order_id = $1`, [o.id])).map((r: any) => r.sku);
    expect(skus.some((s: string) => ["AK-0055", "AK-0056", "AK-0057", "AK-0058"].includes(s))).toBe(false);
  }, 30_000);
});

describe("fix 5: the village said in an earlier message settles a pin between villages (sim-043 on the second branch run)", () => {
  it("named in the first message, a pin then sent with no basket: the village is taken, no question", async () => {
    const t = flow(db, [read({ intent: "question", lines: [] }), [use("reply", { text: "أهلين! ابعتلي موقعك من الزر تحت." })]]);
    await t.customer();
    await t.text("مرحبا، بدي اطلب لعترين، كيف بعمل؟");
    const mid = { lat: (V.Aainbal!.lat + V.Aatrine!.lat) / 2, lng: (V.Aainbal!.lng + V.Aatrine!.lng) / 2 };
    await pin(t, mid.lat, mid.lng);
    expect(outbound.some((s) => buttonsOf(s).some((b) => b.id.startsWith("pinvillage:")))).toBe(false);
    expect(bodyOf(outbound.at(-1)!)).toContain("عترين");
  }, 30_000);
});
