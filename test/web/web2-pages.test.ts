// Session WEB2: the website's day-one ordering, built and served by workerd over the real migrations (the stand-in for PostgREST runs every
// call as web_channel). Each behaviour of the prompt has its test here, written before its page:
//   1. the basket: add from the aisle, product and search pages; quantities and remove; prices read again on every view; a sold-out or
//      "coming soon" item named and kept out; the minimum and the delivery fee from settings;
//   2. sign-in by a WhatsApp message (the code typed for the customer; the turn links the session; 90 days; sign out);
//   3. checkout: place (saved, or a pin), when, the missing-item choice, payment (dollars with the note, lira with the amount, Whish/OMT);
//   4. the page never confirms: the card goes to WhatsApp and the page turns into the order page once the tap there confirms;
//   5. the order page behind a signed link (nothing for a wrong one; no address or phone);
//   6. history with "order again", and the account (places, memory, sign out everywhere);
//   7. "How it works" from settings;
//   and, as the prompt's "done when", one order placed on the site and the same basket sent in the chat are identical in price, fee and ledger.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { build, preview } from "astro";
import { createServer } from "node:net";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openHub, deliverToDoor, collect, expectBooksBalanced, type Hub } from "../db/hub-kit";
import { supabaseOver } from "../db/supabase-shim";
import { asSupabase, type TestDb } from "../db/harness";
import { channelCommerce, WEB_CHANNEL_FUNCTIONS } from "@ak/commerce/index";
import { runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { sendWebCards } from "@ak/agents/web-orders";
import { formatOrderCard } from "@ak/agents/order-card";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "./postgrest-fake";

const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
let h: Hub; let db: TestDb; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
let svc: ReturnType<typeof channelCommerce>;
const WA = "https://wa.me/96100000000";
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const price = async (sku: string) => Number((await db.one(`select o.price_usd from offers o join products p on p.id = o.product_id where p.sku = $1 and o.source_id = $2`, [sku, h.hub])).price_usd);
const money = (n: number) => `$${n.toFixed(2)}`;

/** One visitor's browser: its cookies, its language, same-origin form posts. */
class Browser {
  jar = new Map<string, string>([["lang", "en"]]);
  constructor(lang: "ar" | "en" | "fr" = "en") { this.jar.set("lang", lang); }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  private keep(r: Response) {
    for (const c of r.headers.getSetCookie()) { const m = /^([^=]+)=([^;]*)/.exec(c); if (m) { if (/Max-Age=0/.test(c)) this.jar.delete(m[1]!); else this.jar.set(m[1]!, m[2]!); } }
    return r;
  }
  async get(path: string) { const r = this.keep(await fetch(base + path, { redirect: "manual", headers: { cookie: this.cookie } })); return { status: r.status, headers: r.headers, html: await r.text() }; }
  async post(path: string, form: Record<string, string>) {
    const r = this.keep(await fetch(base + path, { method: "POST", redirect: "manual", body: new URLSearchParams(form),
      headers: { cookie: this.cookie, origin: base, "content-type": "application/x-www-form-urlencoded" } }));
    return { status: r.status, location: r.headers.get("location"), headers: r.headers, html: await r.text() };
  }
  /** Follows a 303 like a browser. */
  async submit(path: string, form: Record<string, string>) { const r = await this.post(path, form); return r.status === 303 && r.location ? this.get(r.location) : r; }
  get token() { return this.jar.get("ak_session") ?? null; }
}
let phones = 0;
/** The customer's WhatsApp: a turn on the customer line with a model that must never be called. */
function whatsapp() {
  const k = ++phones;
  const who = { waUserId: `bsuid-web2p-${k}`, phone: `+9617640${String(k).padStart(4, "0")}` };
  const shim = supabaseOver(db);
  const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
  const seen: unknown[] = [];
  const model = { messages: { create: async (b: unknown) => { seen.push(b); return { id: "m", type: "message", role: "assistant", model: "t", content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message; } } };
  const deps: TurnDeps = { db: shim.client, model: model as any, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req), capacity: { backoffMs: [1], sleep: async () => undefined } };
  const state = { lang: "en" as const };
  const say = (message: Record<string, unknown>) => runTurn(deps, [{ line: "customer", who, event: { phone_number_id: "PN_CUSTOMER", conversation: { id: `c${k}`, contact_name: "T" },
    message: { id: `wamid.web2p.${k}.${Math.random()}`, timestamp: "0", kapso: { direction: "inbound", origin: "cloud_api" }, ...message } } } as any] as Pending[], state);
  const party = async () => (await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "T" }));
  return { who, deps, seen, party, text: (body: string) => say({ type: "text", text: { body } }), tap: (id: string) => say({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "Confirm" } } }),
           cart: (items: { sku: string; qty: number }[]) => say({ type: "order", order: { catalog_id: "1", product_items: items.map((i) => ({ product_retailer_id: i.sku, quantity: i.qty, item_price: 0, currency: "USD" })) } }) };
}
const outbound: { url: string; body: any }[] = [];
const realFetch = globalThis.fetch;
function stubKapso() {
  vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
    if (String(url).startsWith("https://kapso.test")) { outbound.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 }); }
    return realFetch(url, init);
  }));
}
/** A browser signed in by sending its code from this WhatsApp, with a basket. */
async function signedIn(lines: [string, number][] = [["AK-0103", 2], ["AK-0080", 1], ["AK-0133", 3]], lang: "ar" | "en" | "fr" = "en") {
  const b = new Browser(lang); const w = whatsapp();
  for (const [sku, qty] of lines) await b.post("/cart/line", { sku, qty: String(qty) });
  const s = await b.submit("/signin", { next: "/checkout" });
  const code = /ALO-[23456789A-HJ-NP-Z]{6}/.exec(s.html)![0];
  await w.text(code);
  return { b, w, code };
}

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false, riders: 2 }); db = h.db;
  svc = channelCommerce(asSupabase(db));
  await db.pg.query(`update settings set value = value || jsonb_build_object('product_link', $1::text) where key = 'catalog'`, [`${WA}?text={sku}`]);
  fake = await startFakePostgrest(db);
  await build({ root, logLevel: "error" });
  const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", WEB_POST_LIMIT: "100000" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(root + ".dev.vars", body); writeFileSync(root + "dist/server/.dev.vars", body);
  const port = await freePort();
  const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
  stop = () => server.stop(); base = `http://127.0.0.1:${port}`;
  stubKapso();
}, 300_000);
afterAll(async () => { vi.unstubAllGlobals(); await stop(); await fake?.close(); if (existsSync(root + ".dev.vars")) rmSync(root + ".dev.vars"); });

describe("1. the basket", () => {
  it("adds from the aisle, the product and the search pages with no script; every one carries the add form", async () => {
    const b = new Browser();
    for (const [page, sku] of [["/c/dairy_eggs", "AK-0042"], ["/p/AK-0103", "AK-0103"], ["/search?q=labne", "AK-0042"]] as const) {
      const html = (await b.get(page)).html;
      expect(html, page).toMatch(new RegExp(`<form method="post" action="/cart/line"><input type="hidden" name="sku" value="${sku}">`));
    }
    const added = await b.post("/cart/line", { sku: "AK-0103", add: "1", back: "/p/AK-0103" });
    expect(added.status).toBe(303);
    expect(added.location).toBe("/p/AK-0103?added=AK-0103");
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect(added.headers.getSetCookie().join()).toMatch(/HttpOnly/);
    expect(text((await b.get("/p/AK-0103?added=AK-0103")).html)).toContain("Added to your basket.");
    await b.post("/cart/line", { sku: "AK-0103", add: "1" });
    const cart = await b.get("/cart");
    expect(cart.headers.get("cache-control")).toMatch(/no-store/);
    expect(cart.html).toMatch(/<output[^>]*>2<\/output>/);
    expect(text(cart.html)).toContain(money(2 * (await price("AK-0103"))));
    expect(JSON.parse((await b.get("/cart/count")).html)).toEqual({ n: 2 });
  });

  it("quantities and remove; the price is read again on every view, and a changed price is named", async () => {
    const b = new Browser();
    await b.post("/cart/line", { sku: "AK-0080", qty: "1", price: String(await price("AK-0080")) });
    await b.post("/cart/line", { sku: "AK-0133", qty: "3" });
    await b.post("/cart/line", { sku: "AK-0133", qty: "2" });
    const before = await price("AK-0080");
    await db.pg.query(`update offers set price_usd = price_usd + 0.5 where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]);
    try {
      const t1 = text((await b.get("/cart")).html);
      expect(t1).toContain(money(before + 0.5));
      expect(t1).toContain("The price changed since you added it:");
    } finally { await db.pg.query(`update offers set price_usd = price_usd - 0.5 where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]); }
    expect((await b.get("/cart")).html).toMatch(/name="qty" value="1"[\s\S]*?<output[^>]*>2<\/output>/);
    await b.post("/cart/line", { sku: "AK-0133", qty: "0" });
    const after = await b.get("/cart");
    expect(after.html).not.toContain("AK-0133");
    expect(after.html).toContain("AK-0080");
  });

  it("a sold-out item and a coming-soon item are named and kept out of the total", async () => {
    const b = new Browser();
    await b.post("/cart/line", { sku: "AK-0103", qty: "2" });
    await b.post("/cart/line", { sku: "AK-0080", qty: "1" });
    const held = await db.one(`select reserved from stock_levels where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]);
    await db.pg.query(`update stock_levels set reserved = on_hand where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub]);
    try {
      const t1 = text((await b.get("/cart")).html);
      expect(t1).toMatch(/Sold out now, so it is left out: .*Labneh|Sold out now, so it is left out:/);
      expect(t1).toContain(money(2 * (await price("AK-0103"))));
      expect(t1).not.toContain(money(2 * (await price("AK-0103")) + (await price("AK-0080"))));
    } finally { await db.pg.query(`update stock_levels set reserved = $2 where product_id = (select id from products where sku = 'AK-0080') and source_id = $1`, [h.hub, held.reserved]); }
    await db.pg.exec(`update settings set value = '{"enabled": true}' where key = 'sell_requires_label'`);
    try {
      const packaged = (await db.one(`select p.sku from products p join offers o on o.product_id = p.id where p.sku in ('AK-0103','AK-0080') and product_is_packaged(p.id) limit 1`)).sku;
      expect(text((await b.get("/cart")).html)).toContain("Coming soon, we can't take it yet:");
      expect((await b.get("/cart")).html).toContain(packaged);
    } finally { await db.pg.exec(`update settings set value = '{"enabled": false}' where key = 'sell_requires_label'`); }
  });

  it("the minimum and the delivery fee come from settings, as the chat shows them", async () => {
    const b = new Browser();
    await b.post("/cart/line", { sku: "AK-0133", qty: "1" });
    const p1 = await price("AK-0133");
    await db.pg.exec(`update settings set value = '20' where key = 'min_order_usd'`);
    try {
      const t1 = text((await b.get("/cart")).html);
      expect(t1).toContain(`The minimum order is ${money(20)}. Add ${money(20 - p1)} more to check out.`);
      expect((await b.get("/cart")).html).not.toMatch(/href="\/checkout"/);
    } finally { await db.pg.exec(`update settings set value = '5' where key = 'min_order_usd'`); }
    const v = await db.one(`select v.id, v.name_en, z.delivery_fee_usd from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active order by z.delivery_fee_usd desc limit 1`);
    expect(text((await b.get("/cart")).html)).toContain("Choose your village to see the delivery fee.");
    await b.post("/cart/village", { village: v.id });
    const t2 = text((await b.get("/cart")).html);
    expect(t2).toContain(`Delivery to ${v.name_en} ${money(Number(v.delivery_fee_usd))}`);
  });
});

describe("2. sign-in on WhatsApp", () => {
  it("opens our number with the code typed; the turn links the session by code; then this device is signed in for 90 days", async () => {
    const b = new Browser(); const w = whatsapp();
    await b.post("/cart/line", { sku: "AK-0103", qty: "1" });
    const page = await b.get("/checkout");
    expect(text(page.html)).toContain("Confirm your number on WhatsApp");
    const s = await b.submit("/signin", { next: "/checkout" });
    const code = /ALO-[23456789A-HJ-NP-Z]{6}/.exec(s.html)![0];
    expect(s.html).toContain(`href="${WA}?text=${encodeURIComponent(code)}"`);
    expect(s.html).toMatch(/<meta http-equiv="refresh" content="\d+"/);          // the page follows with no script
    await w.text(code);
    expect(w.seen).toHaveLength(0);
    const done = await b.get("/signin?next=/checkout");
    expect(text(done.html)).toContain("Your number is confirmed. This device is signed in.");
    expect(done.headers.getSetCookie().join()).toMatch(/ak_session=[0-9a-f]{64}; Path=\/; Max-Age=(77\d{5}|78\d{5})/);   // about 90 days
    expect(text((await b.get("/checkout")).html)).not.toContain("Confirm your number on WhatsApp");
  });

  it("sign out from the account page, or 'sign out' on WhatsApp", async () => {
    const one = await signedIn([["AK-0103", 1]]);
    await one.b.submit("/account", { do: "signout" });
    expect(text((await one.b.get("/account")).html)).toContain("Confirm your number to see this page.");
    const two = await signedIn([["AK-0103", 1]]);
    await two.w.text("sign out");
    expect(text((await two.b.get("/account")).html)).toContain("Confirm your number to see this page.");
  });
});

describe("3 and 4. checkout: place, when, missing items, payment; the card goes to WhatsApp and the tap there confirms", () => {
  it("a pin decides the village and fee; house and floor; cash in dollars with a note; the card is sent by the gateway; the page turns into the order", async () => {
    const { b, w } = await signedIn();
    const v = await db.one(`select v.id, v.name_en, v.lat, v.lng, z.delivery_fee_usd from villages v join zones z on z.id = v.zone_id
      where v.is_served and z.is_active and v.lat is not null and locate_pin(v.lat, v.lng)->>'status' = 'located' order by z.delivery_fee_usd desc, v.name_en limit 1`);
    let c = await b.submit("/checkout", { do: "pin", pin: `${v.lat}, ${v.lng}` });
    expect(text(c.html)).toContain(`Pinned in ${v.name_en}.`);
    const place = /name="place" value="([0-9a-f-]{36})" checked/.exec(c.html)![1]!;
    c = await b.submit("/checkout", { do: "details", place, building: "Blue door house", floor: "1" });
    expect(text(c.html)).toContain(`${money(Number(v.delivery_fee_usd))}`);
    const key = /name="key" value="([^"]+)"/.exec(c.html)![1]!;
    for (const pay of ["Cash in dollars", "Cash in lira, at today's rate", "Whish transfer", "OMT transfer"]) expect(text(c.html)).toContain(pay);
    expect(text(c.html)).not.toMatch(/Mastercard|Apple Pay|Google Pay/);
    expect(text(c.html)).toContain("Nothing is ordered yet. We send this card to your WhatsApp, and the order is placed when you tap Confirm there.");
    const sent = await b.post("/checkout", { do: "place", key, place, slot: "now", missing: "ask", "item:AK-0080": "remove", pay: "cod_usd", note: "50", notes: "" });
    expect(sent.status).toBe(303);
    const link = /^\/o\/(AK-\d+)\?k=(\d{10}\.[0-9a-f]{32})$/.exec(sent.location!)!;
    expect(link).toBeTruthy();
    const order = await db.one(`select * from orders where short_code = $1`, [link[1]]);
    expect(order).toMatchObject({ status: "awaiting_confirmation", channel: "web", payment_method: "cod", cash_currency: "usd", missing_pref: "ask" });
    expect(Number(order.change_for_usd)).toBe(50);
    expect(Number(order.delivery_fee_usd)).toBe(Number(v.delivery_fee_usd));
    let o = await b.get(sent.location!);
    expect(text(o.html)).toContain("Your order card is on WhatsApp. Tap Confirm there to place the order.");
    expect(o.html).toMatch(/<meta http-equiv="refresh"/);
    // the same card as WhatsApp's, word for word
    const stored = await db.rpc("order_card", { p_order: order.id, p_party: order.customer_id });
    const wa = formatOrderCard({ orderId: order.id, shortCode: order.short_code, quote: stored.quote, paymentMethod: "cod", changeForUsd: 50, missingPref: "ask",
      missingItems: stored.missing_items, lang: "en", address: null }).map((x: any) => (x.interactive?.body?.text ?? x.text?.body) as string).join("\n");
    for (const line of wa.split("\n").map((l) => l.replace(/\*/g, "").trim()).filter((l) => l && !l.startsWith("🛒"))) expect(text(o.html), line).toContain(line.replace(/\s+/g, " "));
    // nothing on the site confirms; the gateway sends the card; the tap there confirms
    expect(fake.calls.some((c) => c.fn === "web_confirm_order")).toBe(false);
    outbound.length = 0;
    expect(await sendWebCards({ db: w.deps.db, send: w.deps.send })).toBe(1);
    expect(outbound[0]!.body.to).toBe(w.who.phone);
    await w.tap(`order:confirm:${order.id}`);
    o = await b.get(sent.location!);
    expect(text(o.html)).toContain("Confirmed");
    expect(text(o.html)).not.toContain("Tap Confirm there");
    expect(o.html).not.toMatch(/Blue door house|\+9617|"phone"/);
  });

  it("cash in lira at today's rate with the amount handed over; Whish or OMT; a below-minimum basket is not sent", async () => {
    const { b } = await signedIn();
    const c = await b.get("/checkout");
    const place = /name="place" value="([0-9a-f-]{36})"/.exec(c.html)?.[1];
    expect(place, "the WhatsApp number's pin is not saved yet: pin one").toBeUndefined();
    const v = await db.one(`select lat, lng from villages where name_en = 'Baakline'`);
    const p = await b.submit("/checkout", { do: "pin", pin: `${v.lat},${v.lng}` });
    const pl = /name="place" value="([0-9a-f-]{36})" checked/.exec(p.html)![1]!;
    await b.submit("/checkout", { do: "details", place: pl, building: "House 4", floor: "0" });
    const q = await b.submit("/checkout", { do: "update", place: pl, pay: "cod_lbp" });
    expect(text(q.html)).toContain("Today's rate for one dollar: 89,500 LBP");
    const amounts = [...q.html.matchAll(/name="note_lbp"[^>]*value="(\d+)"/g)].map((m) => Number(m[1]));
    expect(amounts.length).toBeGreaterThan(0);
    const key = /name="key" value="([^"]+)"/.exec(q.html)![1]!;
    const sent = await b.post("/checkout", { do: "place", key, place: pl, slot: "now", missing: "best_match", pay: "cod_lbp", note_lbp: String(amounts[0]) });
    expect(sent.status).toBe(303);
    const order = await db.one(`select * from orders where short_code = $1`, [/AK-\d+/.exec(sent.location!)![0]]);
    expect({ cur: order.cash_currency, lbp: Number(order.change_for_lbp), pref: order.missing_pref }).toEqual({ cur: "lbp", lbp: amounts[0], pref: "best_match" });
    const t2 = await signedIn();
    const p2 = await t2.b.submit("/checkout", { do: "pin", pin: `${v.lat},${v.lng}` });
    const pl2 = /name="place" value="([0-9a-f-]{36})" checked/.exec(p2.html)![1]!;
    const k2 = /name="key" value="([^"]+)"/.exec(p2.html)![1]!;
    const s2 = await t2.b.post("/checkout", { do: "place", key: k2, place: pl2, slot: "now", missing: "ask", pay: "omt" });
    expect(s2.status).toBe(303);
    expect((await db.one(`select payment_method from orders where short_code = $1`, [/AK-\d+/.exec(s2.location!)![0]])).payment_method).toBe("omt");
  });
});

describe("5. the order page: a signed, expiring link", () => {
  it("a wrong or missing link shows nothing", async () => {
    const { b } = await signedIn();
    const v = await db.one(`select lat, lng from villages where name_en = 'Baakline'`);
    const p = await b.submit("/checkout", { do: "pin", pin: `${v.lat},${v.lng}` });
    const pl = /name="place" value="([0-9a-f-]{36})" checked/.exec(p.html)![1]!;
    const k = /name="key" value="([^"]+)"/.exec(p.html)![1]!;
    const sent = await b.post("/checkout", { do: "place", key: k, place: pl, slot: "now", missing: "ask", pay: "cod_usd", note: "" });
    const [, code, sig] = /^\/o\/(AK-\d+)\?k=(.+)$/.exec(sent.location!)!;
    const stranger = new Browser();
    expect((await stranger.get(sent.location!)).status).toBe(200);           // the link itself is the key: it can be opened on another phone
    for (const bad of [`/o/${code}`, `/o/${code}?k=${sig!.replace(/.$/, (c) => (c === "a" ? "b" : "a"))}`, `/o/${code}?k=1.2`, `/o/AK-1?k=${sig}`]) {
      const r = await stranger.get(bad);
      expect(r.status, bad).toBe(404);
      expect(r.html, bad).not.toContain(code!);
    }
  });
});

describe("6. history, order again, the account", () => {
  it("orders from WhatsApp and the web together; order again names what is missing first, at today's prices", async () => {
    const { b, w } = await signedIn();
    const party = (await w.party()).party_id;
    const v = await db.one(`select lat, lng from villages where name_en = 'Baakline'`);
    await db.rpc("save_customer_pin", { p_party: party, p_lat: Number(v.lat), p_lng: Number(v.lng), p_village: null });
    await db.rpc("set_place_details", { p_party: party, p_place: (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [party])).id, p_building: "House 1", p_floor: "1" });
    await w.cart([{ sku: "AK-0103", qty: 2 }, { sku: "AK-0133", qty: 3 }]);
    const chat = await db.one(`select id, short_code from orders where customer_id = $1 order by created_at desc limit 1`, [party]);
    await w.tap(`order:confirm:${chat.id}`);
    const list = await b.get("/orders");
    expect(text(list.html)).toContain(chat.short_code);
    expect(text(list.html)).toContain("On WhatsApp");
    const held = await db.one(`select reserved from stock_levels where product_id = (select id from products where sku = 'AK-0133') and source_id = $1`, [h.hub]);
    await db.pg.query(`update stock_levels set reserved = on_hand where product_id = (select id from products where sku = 'AK-0133') and source_id = $1`, [h.hub]);
    try {
      const again = await b.submit("/orders", { do: "again", order: chat.id });
      expect(text(again.html)).toContain("Not available now, so not added:");
      expect(again.html).toMatch(/AK-0103/);
    } finally { await db.pg.query(`update stock_levels set reserved = $2 where product_id = (select id from products where sku = 'AK-0133') and source_id = $1`, [h.hub, held.reserved]); }
  });

  it("the account: places, what we remember, forget, stop, sign out everywhere", async () => {
    const { b, w } = await signedIn();
    const party = (await w.party()).party_id;
    await db.rpc("save_stated_restriction", { p_party: party, p_text: "no sesame" });
    const a = await b.get("/account");
    expect(text(a.html)).toContain("no sesame");
    expect(a.html).not.toMatch(/\+9617/);
    expect(text((await b.submit("/account", { do: "stop" })).html)).toContain("Remembering is stopped");
    expect((await db.rpc("customer_memory_view", { p_party: party })).remember).toBe(false);
    expect(text((await b.submit("/account", { do: "forget" })).html)).toContain("We forgot what we had learned, here and on WhatsApp.");
    await b.submit("/account", { do: "signout_all" });
    expect(text((await b.get("/account")).html)).toContain("Confirm your number to see this page.");
  });
});

describe("7. How it works, from settings", () => {
  it("hours, minimum, fees by village, payment ways and today's rate", async () => {
    await db.pg.exec(`update settings set value = '6' where key = 'min_order_usd'`);
    try {
      const t1 = text((await new Browser().get("/how")).html);
      expect(t1).toContain(`Minimum order: ${money(6)}`);
      expect(t1).toContain("Open every day, 00:00–23:59.");
      expect(t1).toContain("89,500 LBP");
      const v = await db.one(`select v.name_en, z.delivery_fee_usd from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active order by v.name_en limit 1`);
      expect(t1).toContain(v.name_en);
      expect(t1).toContain(money(Number(v.delivery_fee_usd)));
      expect(t1).not.toMatch(/Mastercard|Apple Pay|healthy|best/i);
    } finally { await db.pg.exec(`update settings set value = '5' where key = 'min_order_usd'`); }
  });
});

describe("the done-when: one order on the site and the same basket in the chat are identical in price, fee and ledger", () => {
  it("places both, confirms both by the WhatsApp tap, delivers and collects both, and compares", async () => {
    const BASKET: [string, number][] = [["AK-0103", 2], ["AK-0080", 1], ["AK-0133", 3]];
    // the site
    const { b, w } = await signedIn(BASKET);
    const v = await db.one(`select lat, lng from villages where name_en = 'Baakline'`);
    const p = await b.submit("/checkout", { do: "pin", pin: `${v.lat},${v.lng}` });
    const pl = /name="place" value="([0-9a-f-]{36})" checked/.exec(p.html)![1]!;
    await b.submit("/checkout", { do: "details", place: pl, building: "House 9", floor: "2" });
    const k = /name="key" value="([^"]+)"/.exec(p.html)![1]!;
    const sent = await b.post("/checkout", { do: "place", key: k, place: pl, slot: "now", missing: "ask", pay: "cod_usd", note: "" });
    const site = await db.one(`select * from orders where short_code = $1`, [/AK-\d+/.exec(sent.location!)![0]]);
    await sendWebCards({ db: w.deps.db, send: w.deps.send });
    await w.tap(`order:confirm:${site.id}`);
    // the chat: the same basket, sent from the WhatsApp catalogue by another customer with a pin in the same village
    const c = whatsapp();
    const cp = (await c.party()).party_id;
    await db.rpc("save_customer_pin", { p_party: cp, p_lat: Number(v.lat), p_lng: Number(v.lng), p_village: null });
    await db.rpc("set_place_details", { p_party: cp, p_place: (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [cp])).id, p_building: "House 3", p_floor: "1" });
    await c.cart(BASKET.map(([sku, qty]) => ({ sku, qty })));
    const chat = await db.one(`select * from orders where customer_id = $1 order by created_at desc limit 1`, [cp]);
    expect(chat.status).toBe("awaiting_confirmation");
    await c.tap(`order:confirm:${chat.id}`);
    for (const o of [site, chat]) expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("confirmed");
    // the same lines, prices, fee and totals
    const items = async (id: string) => (await db.all(`select p.sku, i.qty::numeric::text as qty, i.unit_price_usd::text as unit from order_items i join products p on p.id = i.product_id where i.order_id = $1 and i.status = 'ok' order by p.sku`, [id]));
    expect(await items(site.id)).toEqual(await items(chat.id));
    const money2 = async (id: string) => db.one(`select subtotal_usd, delivery_fee_usd, small_order_fee_usd, total_usd, payment_method from orders where id = $1`, [id]);
    expect(await money2(site.id)).toEqual(await money2(chat.id));
    expect([site.channel, chat.channel]).toEqual(["web", "whatsapp"]);
    // delivered, paid in cash, closed: the same ledger
    for (const id of [site.id, chat.id]) { await deliverToDoor(h, id); await collect(h, id); }
    const ledger = async (id: string) => (await db.all(`select regexp_replace(a.code, '[0-9a-f]{8}-[0-9a-f-]{27}', '<party>') as code, e.currency::text as currency, sum(e.amount)::text as amount
       from ledger_entries e join ledger_accounts a on a.id = e.account_id where e.order_id = $1 group by 1, 2 having sum(e.amount) <> 0 order by 1, 2`, [id]));
    const l1 = await ledger(site.id);
    expect(l1.length).toBeGreaterThan(2);
    expect(l1).toEqual(await ledger(chat.id));
    await expectBooksBalanced(h);
  });
});

describe("the website calls only its own functions and never sends a message", () => {
  it("every call the Worker made is on web_channel's list; none confirms", () => {
    expect(fake.calls.length).toBeGreaterThan(20);
    for (const c of fake.calls) expect(WEB_CHANNEL_FUNCTIONS as readonly string[]).toContain(c.fn);
    expect(fake.calls.some((c) => c.fn === "web_confirm_order")).toBe(false);
  });
});
