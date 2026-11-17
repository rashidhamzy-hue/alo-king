// Session WEB2 (the website's day-one ordering), on the real migrations (0228 to 0230). Every website call runs as the database role web_channel,
// as the Worker does; the party always comes from the session token. What this proves:
//   * the page never confirms (C1 as decided for WEB2): placing an order makes a card that waits for the WhatsApp tap, and asks the gateway to send it;
//   * the payment ways of the chat (cash in dollars with the "which note" rule, cash in lira at today's rate with the change amount, Whish or OMT);
//   * the missing-item choice per order, with a per-item override the picker's decision follows;
//   * the order page behind a signed, expiring link: a wrong or expired link shows nothing, and no address or phone is in it;
//   * history (WhatsApp and web orders together) with "order again" (re-priced, missing items named), the account (places, memory, sign out
//     everywhere), the map pin (the pin decides the village and fee), the delivery windows and the service facts, all from the database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSupabase, type TestDb } from "./harness";
import { collect, deliverToDoor, openHub, type Hub } from "./hub-kit";
import { channelCommerce, webCommerce, webOrdering, WEB_CHANNEL_FUNCTIONS, type RpcSource } from "@ak/commerce/index";

let h: Hub; let db: TestDb;
let svc: ReturnType<typeof channelCommerce>;
let web: ReturnType<typeof webCommerce>;
let ord: ReturnType<typeof webOrdering>;
const BASKET = [{ sku: "AK-0103", qty: 2 }, { sku: "AK-0080", qty: 1 }, { sku: "AK-0133", qty: 3 }];
let n = 0;

function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}
async function customer() {
  const k = ++n;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-web2-${k}`, p_phone: `+9617620${String(k).padStart(4, "0")}`, p_name: `W2 ${k}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const place = (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [t.party_id])).id;
  return { party: t.party_id as string, conversation: t.conversation_id as string, place: place as string };
}
async function visitor(lines = BASKET, linked = true) {
  const c = await customer();
  const s = await web.startSession("test phone");
  for (const l of lines) await web.setLine(s.token, l.sku, l.qty);
  if (linked) {
    const code = await web.linkCode(s.token);
    if (!code.ok) throw new Error("no code");
    expect(await svc.claimLinkCode(c.party, code.code, `wamid-w2-${n}`)).toMatchObject({ ok: true, status: "linked" });
  }
  return { ...c, token: s.token };
}
const place = (v: { token: string; place: string }, o: Partial<Parameters<typeof ord.placeOrder>[1]> = {}) =>
  ord.placeOrder(v.token, { requestKey: `req-w2-${++n}`, place: v.place, payment: "cod", lang: "en", ...o });
const order = async (id: string) => db.one(`select * from orders where id = $1`, [id]);

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false, riders: 2 }); db = h.db;
  svc = channelCommerce(asSupabase(db));
  web = webCommerce(asWebChannel(db));
  ord = webOrdering(asWebChannel(db));
}, 120_000);
afterAll(async () => { await db?.pg.close(); });

describe("the page never confirms: the card goes to WhatsApp and the tap there confirms (C1, invariant 4)", () => {
  it("confirm on the page is off; the website's confirm answers 'confirm on WhatsApp' and changes nothing", async () => {
    expect((await db.one(`select value from settings where key = 'web'`)).value).toMatchObject({ confirm_on_page: false, order_link_days: 7, order_link_after_end_hours: 48 });
    const v = await visitor();
    const r = await place(v);
    expect(r).toMatchObject({ created: true, status: "awaiting_confirmation" });
    expect(await web.confirm(v.token, r.order_id!, "req-w2-page-confirm")).toMatchObject({ status: "confirm_on_whatsapp", changed: false });
    expect((await order(r.order_id!)).status).toBe("awaiting_confirmation");
    // the gateway is asked to send the card, once; the tap there confirms like any chat order
    const due = await db.rpc<any[]>("web_cards_due", { p_limit: 50 });
    expect(due.filter((d) => d.order_id === r.order_id)).toEqual([expect.objectContaining({ customer_id: v.party, conversation_id: v.conversation, short_code: r.short_code, lang: "en" })]);
    expect(await svc.confirmTap(r.order_id!, v.party, "wamid-w2-tap")).toMatchObject({ status: "confirmed", changed: true });
    expect((await order(r.order_id!)).channel).toBe("web");
    // once the order no longer waits, it is no longer due
    expect((await db.rpc<any[]>("web_cards_due", { p_limit: 50 })).some((d) => d.order_id === r.order_id)).toBe(false);
  });

  it("a placed order sent twice is one order and one card request; a card sent is not sent again", async () => {
    const v = await visitor();
    const key = `req-w2-twice-${n}`;
    const a = await ord.placeOrder(v.token, { requestKey: key, place: v.place, payment: "cod", lang: "ar" });
    const b = await ord.placeOrder(v.token, { requestKey: key, place: v.place, payment: "cod", lang: "ar" });
    expect(b).toMatchObject({ created: true, reused: true, order_id: a.order_id });
    expect(Number((await db.one(`select count(*) n from web_card_requests where order_id = $1`, [a.order_id])).n)).toBe(1);
    await db.rpc("web_card_done", { p_order: a.order_id, p_outcome: "sent" });
    expect((await db.rpc<any[]>("web_cards_due", { p_limit: 50 })).some((d) => d.order_id === a.order_id)).toBe(false);
    expect((await db.one(`select outcome, done_at is not null as done from web_card_requests where order_id = $1`, [a.order_id]))).toEqual({ outcome: "sent", done: true });
  });

  it("an anonymous visitor cannot place an order (no anonymous cash order)", async () => {
    const v = await visitor(BASKET, false);
    expect(await place(v)).toMatchObject({ created: false, error: "not_linked" });
  });

  it("'Card AK-xxxx' on WhatsApp finds the sender's own waiting card, never another person's", async () => {
    const v = await visitor();
    const r = await place(v);
    expect(await db.rpc("web_card_again", { p_party: v.party, p_code: r.short_code })).toMatchObject({ ok: true, order_id: r.order_id, short_code: r.short_code });
    const other = await customer();
    expect(await db.rpc("web_card_again", { p_party: other.party, p_code: r.short_code })).toMatchObject({ ok: false, status: "unknown" });
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-again-${n}`);
    expect(await db.rpc("web_card_again", { p_party: v.party, p_code: r.short_code })).toMatchObject({ ok: false, status: "not_waiting", order_status: "confirmed" });
  });
});

describe("payment: the chat's ways and rules", () => {
  it("cash in dollars with a note from the chat's list that is more than the total; a note too small or not on the list is refused before any order", async () => {
    const v = await visitor();
    const small = await place(v, { cash: "usd", note: 10 });
    expect(small).toMatchObject({ created: false, error: "note_too_small" });
    expect(await place(v, { cash: "usd", note: 37 })).toMatchObject({ created: false, error: "unknown_note" });
    expect(Number((await db.one(`select count(*) n from orders where customer_id = $1`, [v.party])).n)).toBe(0);
    const ok = await place(v, { cash: "usd", note: 100 });
    expect(ok.created).toBe(true);
    const o = await order(ok.order_id!);
    expect({ pm: o.payment_method, cur: o.cash_currency, note: Number(o.change_for_usd) }).toEqual({ pm: "cod", cur: "usd", note: 100 });
    expect(ok.card.change_for_usd).toBe(100);
  });

  it("cash in lira at today's rate: the change amount is a round amount above the lira total, and the rider and picker read it on the order", async () => {
    const v = await visitor();
    const facts = await ord.serviceFacts();
    const fx = Number(facts.fx_rate_lbp);
    expect(fx).toBe(89500);
    const q = await web.checkoutQuote(v.token, { place: v.place });
    const lbp = Number(q.quote!.total_lbp);
    expect(await place(v, { cash: "lbp", note: lbp - 100000 })).toMatchObject({ created: false, error: "note_too_small" });
    expect(await place(v, { cash: "lbp", note: lbp + 1234 })).toMatchObject({ created: false, error: "unknown_note" });
    const up = Math.ceil((lbp + 1) / 500000) * 500000;
    const r = await place(v, { cash: "lbp", note: up });
    expect(r.created).toBe(true);
    const o = await order(r.order_id!);
    expect({ cur: o.cash_currency, lbp: Number(o.change_for_lbp), usd: o.change_for_usd }).toEqual({ cur: "lbp", lbp: up, usd: null });
    expect(o.customer_notes).toContain(up.toLocaleString("en-US"));
    expect(r.card).toMatchObject({ cash_currency: "lbp", change_for_lbp: up });
    // the rider's cash is counted in lira at the order's rate, as for any lira payment (rider_collect)
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-lbp-${n}`);
    await deliverToDoor(h, r.order_id!, h.riders[1]);
    const total = Number((await order(r.order_id!)).total_usd);
    const fxo = Number((await order(r.order_id!)).fx_rate_lbp);
    await db.rpc("rider_collect", { p_order: r.order_id, p_driver: h.riders[1], p_usd: 0, p_lbp: up, p_change_usd: 0, p_change_lbp: up - Math.round(total * fxo) });
    expect((await order(r.order_id!)).status).toBe("closed");
  });

  it("Whish or OMT: a transfer a person confirms; the confirm tap leaves it waiting for payment", async () => {
    const v = await visitor();
    const r = await place(v, { payment: "omt" });
    expect(r.created).toBe(true);
    expect((await order(r.order_id!)).payment_method).toBe("omt");
    expect(await svc.confirmTap(r.order_id!, v.party, `wamid-w2-omt-${n}`)).toMatchObject({ status: "awaiting_payment" });
  });

  it("a first cash order over the first-order cap is refused as in the chat, with the cap", async () => {
    await db.pg.exec(`update settings set value = '{"max_cod_usd": 5}' where key = 'first_order'`);
    try {
      const v = await visitor();
      const r = await place(v);
      expect(r.created).toBe(false);
      expect(r.issues?.some((i: any) => i.code === "first_order_cod_cap" && Number(i.max_cod_usd) === 5)).toBe(true);
      expect((await place(v, { payment: "whish" })).created).toBe(true);
    } finally { await db.pg.exec(`update settings set value = '{"max_cod_usd": 0}' where key = 'first_order'`); }
  });
});

describe("the missing-item choice: per order, with a per-item override", () => {
  it("is stored on the order and its items, carried on the card, and the picker's decision follows the item's own choice", async () => {
    const v = await visitor();
    const r = await place(v, { missing: "ask", items: { "AK-0080": "remove" } });
    expect(r.created).toBe(true);
    expect((await order(r.order_id!)).missing_pref).toBe("ask");
    const items = await db.all<any>(`select p.sku, i.missing_pref, i.id from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by p.sku`, [r.order_id]);
    expect(Object.fromEntries(items.map((i) => [i.sku, i.missing_pref]))).toEqual({ "AK-0080": "remove", "AK-0103": null, "AK-0133": null });
    expect(r.card.missing_pref).toBe("ask");
    expect(r.card.missing_items).toEqual([expect.objectContaining({ pref: "remove", name: expect.any(String) })]);
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-miss-${n}`);
    const pk = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
    await db.rpc("start_pick", { p_order: r.order_id, p_by: pk });
    const removed = await db.rpc("pick_item_missing", { p_item: items.find((i) => i.sku === "AK-0080").id, p_by: pk });
    expect(removed).toMatchObject({ decision: "removed", preference: "remove" });
    const other = await db.rpc("pick_item_missing", { p_item: items.find((i) => i.sku === "AK-0103").id, p_by: pk });
    expect(other.decision).toBe("removed");
    expect(other.preference).toBeUndefined();
  });

  it("refuses a choice that is not one of the three, and an item that is not in the basket", async () => {
    const v = await visitor();
    await expect(place(v, { missing: "maybe" as any })).rejects.toThrow(/UNKNOWN_VALUE/);
    await expect(place(v, { items: { "AK-0080": "later" } as any })).rejects.toThrow(/UNKNOWN_VALUE/);
    const r = await place(v, { items: { "AK-0001": "remove" } });
    expect(r.created).toBe(true);
    expect(Number((await db.one(`select count(*) n from order_items where order_id = $1 and missing_pref is not null`, [r.order_id])).n)).toBe(0);
  });
});

describe("the order page: a signed, expiring link; no address, no phone", () => {
  it("shows the status steps, the time, the lines and the totals with the right link, and nothing with a wrong one", async () => {
    const v = await visitor();
    const r = await place(v);
    const link = r.link as string;
    expect(link).toMatch(/^\d{10}\.[0-9a-f]{32}$/);
    const p = await ord.orderPage(r.short_code!, link);
    expect(p).toMatchObject({ ok: true, short_code: r.short_code, status: "awaiting_confirmation", channel: "web", pickup: false });
    expect(p.totals.total_usd).toBe(Number((await order(r.order_id!)).total_usd));
    expect(p.lines).toHaveLength(3);
    expect(p.eta_minutes).toBeGreaterThan(0);
    const json = JSON.stringify(p);
    for (const word of ["+9617", "building", "floor", "directions", "lat", "lng", "phone", "customer_id", v.party]) expect(json, word).not.toContain(word);
    for (const bad of [link.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "", "1.abc", link.split(".")[0] + "." + "0".repeat(32)]) {
      expect(await ord.orderPage(r.short_code!, bad), bad).toEqual({ ok: false });
    }
    // a link for one order never opens another
    const other = await place(await visitor());
    expect(await ord.orderPage(other.short_code!, link)).toEqual({ ok: false });
    // an expired link shows nothing
    const old = await db.rpc<string>("order_link", { p_order: r.order_id, p_expires: new Date(Date.now() - 1000).toISOString() });
    expect(await ord.orderPage(r.short_code!, old)).toEqual({ ok: false });
  });

  it("steps follow the order; the handover code shows while it is needed; what changed at the shelf is listed", async () => {
    const v = await visitor();
    const r = await place(v, { payment: "whish" });
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-steps-${n}`);
    const total = Number((await order(r.order_id!)).total_usd);
    await db.rpc("confirm_payment", { p_order: r.order_id, p_by: h.ops, p_external_ref: `WH-${r.short_code}`, p_amount_usd: total });
    let p = await ord.orderPage(r.short_code!, r.link!);
    expect(p.status).toBe("confirmed");
    expect(p.handover_code).toMatch(/^\d{4}$/);
    expect(p.events.map((e: any) => e.status)).toEqual(expect.arrayContaining(["awaiting_confirmation", "awaiting_payment", "confirmed"]));
    // a line taken off at the shelf shows under "what changed"
    const item = (await db.one(`select i.id from order_items i join products p on p.id = i.product_id where i.order_id = $1 and p.sku = 'AK-0080'`, [r.order_id])).id;
    await db.rpc("start_pick", { p_order: r.order_id, p_by: h.picker });
    await db.rpc("pick_item_missing", { p_item: item, p_by: h.picker });
    p = await ord.orderPage(r.short_code!, r.link!);
    expect(p.removed.map((x: any) => x.sku)).toEqual(["AK-0080"]);
    expect(p.lines.map((x: any) => x.sku)).not.toContain("AK-0080");
  });

  it("48 hours after the order ended the page shows nothing, even with a fresh link", async () => {
    const v = await visitor();
    const r = await place(v);
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-end-${n}`);
    await deliverToDoor(h, r.order_id!);
    await collect(h, r.order_id!);
    const fresh = await db.rpc<string>("order_link", { p_order: r.order_id });
    expect((await ord.orderPage(r.short_code!, fresh)).ok).toBe(true);
    await db.pg.query(`update orders set delivered_at = now() - interval '49 hours' where id = $1`, [r.order_id]);
    await db.pg.query(`update order_events set created_at = now() - interval '49 hours' where order_id = $1`, [r.order_id]);
    expect(await ord.orderPage(r.short_code!, fresh)).toEqual({ ok: false });
  });
});

describe("history, order again, the account", () => {
  it("lists the person's WhatsApp and web orders together, each with a working link, and nobody else's", async () => {
    const v = await visitor();
    const chat = await svc.createOrderForTurn({ turnKey: `turn-w2-${n}`, customer: v.party, conversation: v.conversation,
      lines: await Promise.all(BASKET.map(async (l) => ({ product_id: (await db.one(`select id from products where sku = $1`, [l.sku])).id, qty: l.qty }))),
      village: h.village, place: v.place });
    expect(chat.created).toBe(true);
    await svc.confirmTap(chat.order_id!, v.party, `wamid-w2-hist-${n}`);
    const w = await place(v);
    const list = await ord.orders(v.token);
    expect(list.ok).toBe(true);
    expect(list.orders.map((o: any) => [o.short_code, o.channel])).toEqual([[w.short_code, "web"], [chat.short_code, "whatsapp"]]);
    for (const o of list.orders) expect((await ord.orderPage(o.short_code, o.link)).ok).toBe(true);
    const stranger = await visitor();
    expect((await ord.orders(stranger.token)).orders.map((o: any) => o.short_code)).not.toContain(w.short_code);
    expect(await ord.orders((await web.startSession(null)).token)).toEqual({ ok: false, error: "not_linked" });
  });

  it("order again: today's prices into the basket; an item that cannot be sold now is named first and left out", async () => {
    const v = await visitor();
    const r = await place(v);
    await svc.confirmTap(r.order_id!, v.party, `wamid-w2-again2-${n}`);
    const held = await db.one(`select on_hand, reserved from stock_levels where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]);
    await db.pg.query(`update stock_levels set reserved = on_hand where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]);
    await db.pg.exec(`update offers set price_usd = price_usd + 1 where product_id = (select id from products where sku = 'AK-0103')`);
    try {
      const again = await ord.orderAgain(v.token, r.order_id!);
      expect(again.ok).toBe(true);
      expect(again.missing.map((m: any) => m.sku)).toEqual(["AK-0080"]);
      const cart = await web.viewCart(v.token);
      expect(cart.lines!.map((l) => l.sku).sort()).toEqual(["AK-0103", "AK-0133"]);
      const priced = cart.quote!.lines.find((l) => l.sku === "AK-0103")!;
      const now = Number((await db.one(`select price_usd from offers where product_id = (select id from products where sku = 'AK-0103') order by price_usd limit 1`)).price_usd);
      expect(Number(priced.unit_price_usd)).toBe(now);
      expect(await ord.orderAgain((await visitor()).token, r.order_id!)).toMatchObject({ ok: false, error: "not_found" });
    } finally {
      await db.pg.query(`update stock_levels set reserved = $2 where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub, held.reserved]);
      await db.pg.exec(`update offers set price_usd = price_usd - 1 where product_id = (select id from products where sku = 'AK-0103')`);
    }
  });

  it("the account: saved places, what we remember, forget (forgets in the chat too), stop, and sign out everywhere", async () => {
    const v = await visitor();
    await db.rpc("set_place_details", { p_party: v.party, p_place: v.place, p_building: "Blue gate", p_floor: "2" });
    await db.rpc("save_stated_restriction", { p_party: v.party, p_text: "no peanuts" });
    await db.pg.query(`insert into customer_memory(party_id, kind, key, value, origin) values ($1, 'note', 'x', '{"text": "ring twice"}', 'stated')`, [v.party]);
    const a = await ord.account(v.token);
    expect(a.ok).toBe(true);
    expect(a.places).toEqual([expect.objectContaining({ place_id: v.place, building: "Blue gate", floor: "2", has_pin: true, village: "Baakline" })]);
    expect(a.memory).toMatchObject({ remember: true, restrictions: ["no peanuts"], notes: ["ring twice"] });
    expect(JSON.stringify(a)).not.toMatch(/\+9617|contact_phone|lat|lng/);
    expect(await ord.memoryPref(v.token, false)).toMatchObject({ ok: true, remember: false });
    expect((await db.rpc("customer_memory_view", { p_party: v.party })).remember).toBe(false);
    expect(await ord.forget(v.token)).toMatchObject({ ok: true });
    expect((await db.rpc("customer_memory_view", { p_party: v.party })).notes).toEqual([]);
    // a second device of the same person, then sign out everywhere from the first: both are gone
    const s2 = await web.startSession("second");
    const c2 = await web.linkCode(s2.token);
    if (!c2.ok) throw new Error("no code");
    await svc.claimLinkCode(v.party, c2.code, `wamid-w2-dev2-${n}`);
    expect(await ord.signOutEverywhere(v.token)).toMatchObject({ ok: true, ended: 2 });
    expect((await web.sessionState(v.token)).valid).toBe(false);
    expect((await web.sessionState(s2.token)).valid).toBe(false);
  });
});

describe("the place: the pin decides the village and the fee", () => {
  it("a pin in a served village gives its fee in the quote; house and floor are saved; a pin outside is refused politely", async () => {
    const v = await visitor();
    const village = await db.one(`select v.id, v.name_en, v.lat, v.lng, z.delivery_fee_usd from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active and v.lat is not null and v.name_en <> 'Baakline'
         and locate_pin(v.lat, v.lng)->>'status' = 'located' order by z.delivery_fee_usd desc, v.name_en limit 1`);
    const pin = await ord.savePin(v.token, Number(village.lat), Number(village.lng));
    expect(pin).toMatchObject({ ok: true, status: "located", village: village.name_en, served: true, fee_usd: Number(village.delivery_fee_usd) });
    expect(await ord.placeDetails(v.token, pin.place_id, { building: "Stone house", floor: "1" })).toMatchObject({ ok: true });
    const q = await web.checkoutQuote(v.token, { place: pin.place_id });
    expect(Number(q.quote!.delivery_fee_usd)).toBe(Number(village.delivery_fee_usd));
    const far = await ord.savePin(v.token, 34.4, 35.9);
    expect(far).toMatchObject({ ok: true, status: "outside" });
    expect(far.served).not.toBe(true);
    const anon = await web.startSession(null);
    expect(await ord.savePin(anon.token, 33.68, 35.56)).toEqual({ ok: false, error: "not_linked" });
  });

  it("windows come from the database for the village", async () => {
    const v = await visitor();
    const w = await ord.windows(v.token, h.village, false);
    expect(Array.isArray(w)).toBe(true);
    const direct = await db.rpc<any[]>("open_delivery_windows", { p_village: h.village, p_fresh: false });
    expect(w.map((x: any) => x.slot_id)).toEqual(direct.map((x) => x.slot_id));
  });
});

describe("the numbers a page shows come from settings", () => {
  it("hours, minimum, fees, rate, payment ways and timers follow the settings", async () => {
    await db.pg.exec(`update settings set value = '7.5' where key = 'min_order_usd'`);
    const f = await ord.serviceFacts();
    expect(f).toMatchObject({ min_order_usd: 7.5, fx_rate_lbp: 89500, payments: ["cod_usd", "cod_lbp", "whish", "omt"], confirm_reminder_min: 20, confirm_lapse_min: 60 });
    expect(f.notes_usd).toEqual([10, 20, 50, 100]);
    expect(f.served.length).toBeGreaterThan(0);
    expect(f.hours).toMatchObject({ open: "00:00" });
    await db.pg.exec(`update settings set value = '5' where key = 'min_order_usd'`);
    expect((await ord.serviceFacts()).min_order_usd).toBe(5);
  });

  it("the basket count is the cart's own, and an unknown session counts nothing", async () => {
    const v = await visitor(BASKET, false);
    expect(await ord.cartCount(v.token)).toBe(6);
    expect(await ord.cartCount("x".repeat(64))).toBe(0);
  });
});

describe("web_channel: exactly the client's list", () => {
  it("may execute every website function and nothing else", async () => {
    const can = await db.all<any>(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('web_channel', p.oid, 'execute') order by 1`);
    expect(can.map((r) => r.proname).sort()).toEqual([...WEB_CHANNEL_FUNCTIONS].sort());
    for (const fn of ["web_cards_due", "web_card_done", "web_card_again", "order_link", "order_link_ok", "web_sign"]) expect(can.map((r) => r.proname)).not.toContain(fn);
  });
});
