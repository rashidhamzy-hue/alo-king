// Session B4: the founder's first live order on staging, 13 Nov 2026 18:43-18:58 UTC, replayed turn by turn from wa_messages and
// agent_runs (docs/HANDOFF.md, "0.13 first real attempt"). The model's readings below are the ones the live model (Haiku 5.5)
// produced that evening, verbatim. What went wrong, each a test here before its fix:
//   1. The basket was lost: the reading left the village out («عبعقلين» went to needs_clarification), the plan asked, the model
//      sent a pin request of its own, and nothing kept the three lines. After the address the bot asked him to send the order again.
//   2. The pin was in Khraibeh; the bot said «وصلنا موقعك في بعقلين»: the village came from the text, not the pin.
//   3. «بحي راجح» in his voice note is a neighbourhood; the reading made it a village and the bot asked which area.
//   4. No card ever came.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso, type Sent } from "./flow-kit";
import { ar } from "@ak/agents/messages";

let db: TestDb;
let outbound: Sent[];
const ids: Record<string, string> = {};
beforeAll(async () => {
  ({ db } = await openFlowDb());
  for (const [k, sku] of [["water", "AK-0103"], ["bread", "AK-0080"], ["coffee", "AK-0133"]] as const)
    ids[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
  for (const v of ["Baakline", "Khraibeh", "Ain Qani", "Moukhtara"]) ids[v] = (await db.one(`select id from villages where name_en = $1`, [v])).id;
}, 60_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db?.pg.close(); });

const MESSAGE = "بدي كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار، عبعقلين";
// Turn 1, 18:43:14: the live reading. Lines right, village missing, «عبعقلين» left as something to clarify.
const READING_1 = {
  intent: "order", fulfilment: "delivery", transcript_quality: "good", needs_clarification: ["عبعقلين"],
  lines: [
    { qty: 1, raw: "كرتونة مي تنورين", unit: "each", query: "مي تنورين", modifiers: [], brand_hint: "تنورين", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "ربطة خبز الفورنو", unit: "bundle", query: "خبز الفورنو", modifiers: [], brand_hint: "الفورنو", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "قهوة نجار", unit: "each", query: "قهوة نجار", modifiers: [], brand_hint: "نجار", confidence: 0.9, source_hint: null },
  ],
  address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null },
};
// 18:55:39: his pin. In Khraibeh (0.34 km from its centre), 7.5 km from Baakline.
const PIN = { latitude: 33.645404815674, longitude: 35.643405914307 };
// 18:56:43: his voice note, Kapso's transcript, and the live reading of it: «راجح» taken for a village.
const TRANSCRIPT = "بحي راجح، آآ، بيت شادي أبو اسماعيل، الطابق الثاني، بوجه، آآآ، سنقوشي ومحطة راجح";
const READING_3 = {
  intent: "order", lines: [], language: "mixed", fulfilment: "delivery", transcript_quality: "partial", needs_clarification: [],
  address: { floor: "الطابق الثاني", village: "راجح", building: "بيت شادي أبو اسماعيل", landmark: "سنقوشي ومحطة راجح",
             verbatim: TRANSCRIPT, recipient_name: "شادي أبو اسماعيل" },
};
const voice = (text: string) => ({ type: "audio", audio: { id: "a1", voice: true },
  kapso: { direction: "inbound", origin: "cloud_api", transcript: { text }, media_data: { url: "https://k/a", byte_size: 9000 } } });
const bodyOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";

describe("the founder's order of 13 Nov, replayed (B4)", () => {
  it("message, pin, voice address: the basket survives, the pin decides the village, «حي راجح» is a neighbourhood, the card comes", async () => {
    outbound = recordKapso();
    const t = flow(db, [read(READING_1), read(READING_3)]);

    // 1. The order. Its reading is all the model does: the pin request is code's, and the basket waits for the pin.
    await t.text(MESSAGE);
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.type).toBe("location_request_message");
    expect(bodyOf(outbound[0]!)).toBe(ar.fixed.askPin);

    // 2. The pin, alone. The pin decides: Khraibeh, said so. With no house or floor yet, one question for them; no model call.
    await t.say({ type: "location", location: PIN });
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(2);
    const afterPin = bodyOf(outbound[1]!);
    expect(afterPin).toContain("الخريبة");
    expect(afterPin).not.toContain("بعقلين وصلنا");
    const c = await t.customer();
    const place = await db.one(`select * from customer_places where party_id = $1`, [c.party_id]);
    expect(place.village_id).toBe(ids.Khraibeh);

    // 3. The voice note with the address. «حي راجح» is not a village: no question about the area. The card goes out.
    await t.say(voice(TRANSCRIPT));
    expect(t.seen).toHaveLength(2);                                   // the reading only; no tool loop
    expect(outbound).toHaveLength(3);
    const card = outbound[2]!;
    expect(card.body.type).toBe("interactive");
    const text = bodyOf(card);
    expect(text).toContain("طلبك AK-");
    expect(text).toContain("الخريبة");                                // priced for where the pin is
    for (const sent of outbound.map(bodyOf)) {
      expect(sent).not.toMatch(/مرة تانية|لأي منطقة/);               // never "send the order again", never "which area"
    }
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order).toMatchObject({ status: "awaiting_confirmation", village_id: ids.Khraibeh, place_id: place.id });
    expect(order.customer_notes).toContain("راجح");                           // the neighbourhood travels to the rider, in his words
    const items = await db.all(`select product_id from order_items where order_id = $1 order by product_id`, [order.id]);
    expect(items.map((i: any) => i.product_id).sort()).toEqual([ids.water, ids.bread, ids.coffee].sort());
    const kept = await db.one(`select building, floor, directions, village_id from customer_places where id = $1`, [place.id]);
    expect(kept).toMatchObject({ building: "بيت شادي أبو اسماعيل", village_id: ids.Khraibeh });
    expect(kept.directions).toContain("حي راجح");

    // 4. The tap confirms it.
    await t.tap(`order:confirm:${order.id}`, "تأكيد الطلب");
    expect((await db.one(`select status from orders where id = $1`, [order.id])).status).toBe("confirmed");
  }, 60_000);

  it("pin and address in one go: the card comes at once", async () => {
    outbound = recordKapso();
    const t = flow(db, [read(READING_1), read({ ...READING_3, address: { ...READING_3.address, village: null } })]);
    await t.text(MESSAGE);
    await t.conv.fetch(t.inbound({ type: "location", location: PIN }));
    await t.conv.fetch(t.inbound(voice(TRANSCRIPT)));
    await t.conv.alarm();
    expect(outbound).toHaveLength(3);                                   // pin request; «the pin is in Khraibeh, not Baakline»; the card
    expect(bodyOf(outbound[1]!)).toContain("الخريبة");
    expect(bodyOf(outbound[2]!)).toContain("طلبك AK-");
  }, 60_000);

  it("staging probe, 13 Nov 21:46 UTC: a reading whose only address is the village («عبعقلين» in verbatim) still asks for house and floor", async () => {
    outbound = recordKapso();
    const t = flow(db, [read({ ...READING_1, needs_clarification: [], address: { ...READING_1.address, village: "بعقلين", verbatim: "عبعقلين" } }),
                        read({ ...READING_3, address: { ...READING_3.address, village: null } })]);
    await t.text(MESSAGE);
    await t.say({ type: "location", location: { latitude: 33.67739, longitude: 35.56355 } });
    expect(outbound).toHaveLength(2);
    expect(bodyOf(outbound[1]!)).toContain("كرمال السائق");                 // a village is not an address: the rider needs the house
    await t.say(voice(TRANSCRIPT));
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");
  }, 60_000);

  it("staging probe, 13 Nov 22:14 UTC: the last order's directions never describe a new place", async () => {
    outbound = recordKapso();
    const first = { ...READING_1, needs_clarification: [], address: { ...READING_1.address, village: "بعقلين", building: "بيت أبو اسماعيل" } };
    const second = { ...READING_1, needs_clarification: [], address: { ...READING_1.address, village: "بعقلين", verbatim: "عبعقلين" } };
    const t = flow(db, [read(first), read(second), read({ ...READING_3, address: { ...READING_3.address, village: null } })]);
    await t.text(MESSAGE + " بيت أبو اسماعيل");
    await t.say({ type: "location", location: { latitude: 33.67739, longitude: 35.56355 } });
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");                 // the first order had its house: card at once
    const c = await t.customer();
    await db.pg.query(`update customer_places set village_id = null, lat = null, lng = null, building = null, floor = null, directions = null where party_id = $1`, [c.party_id]);
    await t.text(MESSAGE);                                                    // a new order, no saved place (the probe's fresh_place)
    await t.say({ type: "location", location: { latitude: 33.67739, longitude: 35.56355 } });
    expect(bodyOf(outbound.at(-1)!)).toContain("كرمال السائق");             // asked again: the old house is not this place's
    await t.say(voice(TRANSCRIPT));
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");
  }, 60_000);

  it("the pin decides even when the text named another village, and the card says where it is going", async () => {
    outbound = recordKapso();
    const t = flow(db, [read({ ...READING_1, address: { ...READING_1.address, village: "بعقلين", building: "بيت أبو اسماعيل" }, needs_clarification: [] })]);
    await t.text(MESSAGE + " بيت أبو اسماعيل");
    expect(bodyOf(outbound[0]!)).toBe(ar.fixed.askPin);
    await t.say({ type: "location", location: PIN });
    const c = await t.customer();
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order.village_id).toBe(ids.Khraibeh);
    const all = outbound.map(bodyOf).join("\n");
    expect(all).toContain("الخريبة");
    expect(all).toContain("بعقلين");                                  // what he wrote is named, and the pin wins
  }, 60_000);

  it("a pin no village clearly owns: the bot asks with buttons, and the tap decides", async () => {
    outbound = recordKapso();
    const t = flow(db, [read({ ...READING_1, address: { ...READING_1.address, building: "بيت أبو اسماعيل" } })]);
    await t.text(MESSAGE + " بيت أبو اسماعيل");
    // Half-way between Ain Qani and Moukhtara (about 0.35 km each): neither is clearly nearer.
    await t.say({ type: "location", location: { latitude: 33.65421, longitude: 35.61372 } });
    expect(t.seen).toHaveLength(1);
    const q = outbound[1]!;
    expect(q.body.interactive.type).toBe("button");
    const choices = q.body.interactive.action.buttons.map((b: any) => b.reply.id);
    expect(choices).toContain(`pinvillage:${ids["Ain Qani"]}`);
    expect(choices).toContain(`pinvillage:${ids.Moukhtara}`);
    const c = await t.customer();
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [c.party_id])).toEqual({ n: 0 });
    await t.tap(`pinvillage:${ids.Moukhtara}`, "المختارة");
    expect(t.seen).toHaveLength(1);
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    expect(order.village_id).toBe(ids.Moukhtara);
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");
  }, 60_000);

  it("a tap for a village far from the pin is refused by the database", async () => {
    const c = await flow(db, []).customer();
    const pin = await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: PIN.latitude, p_lng: PIN.longitude });
    expect(pin).toMatchObject({ status: "located", village_id: ids.Khraibeh });
    expect(await db.rpc("set_pin_village", { p_party: c.party_id, p_place: pin.place_id, p_village: ids.Baakline }))
      .toMatchObject({ ok: false, reason: "too_far_from_pin" });
    const other = await flow(db, []).customer();
    expect(await db.rpc("set_pin_village", { p_party: other.party_id, p_place: pin.place_id, p_village: ids.Khraibeh }))
      .toMatchObject({ ok: false, reason: "not_your_place" });
  }, 60_000);

  it("village_in_text finds «عبعقلين» and 3a b3aklin, and never a neighbourhood «حي راجح»", async () => {
    expect((await db.rpc("village_in_text", { p_text: MESSAGE }))?.village_id).toBe(ids.Baakline);
    expect((await db.rpc("village_in_text", { p_text: "bade labne 3a b3aklin" }))?.village_id).toBe(ids.Baakline);
    expect((await db.rpc("village_in_text", { p_text: "عالخريبة" }))?.village_id).toBe(ids.Khraibeh);
    expect(await db.rpc("village_in_text", { p_text: TRANSCRIPT })).toBeNull();
    expect(await db.rpc("village_in_text", { p_text: "بدي خبز" })).toBeNull();
    expect(await db.rpc("village_in_text", { p_text: "من بعقلين للخريبة" })).toBeNull();     // two villages: the pin decides
  }, 60_000);
});
