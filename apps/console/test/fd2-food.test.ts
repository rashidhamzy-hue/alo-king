// FD2: the console's Food page over the real migrations (0249 to 0251) and the seeded test place. The call task with the place's phone and
// the order read out; each outcome recorded, and the customer told in their language through the gateway (what Kapso would receive); the
// rider's float, the counter payment with the receipt's photo, and the end-of-shift balance with the difference shown. Ops lead and admin
// only. Invented people and numbers only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]) as Uint8Array<ArrayBuffer>;

async function setUp() {
  const r = await rig();
  await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';`);
  await r.db.pg.exec(readFileSync(fileURLToPath(new URL("../../../scripts/staging/test-place.sql", import.meta.url)), "utf8"));
  const place = (await r.db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id as string;
  await r.db.pg.query(`update sources set hours = '{"open":"00:00","close":"00:00"}' where id = $1`, [place]);
  const lead = await r.staff("ops_lead", "Example lead");
  const b = r.browser(); await b.signIn(lead);
  return { r, b, lead, place };
}
let seq = 0;
async function confirmedFoodOrder(r: Rig, lang: "ar" | "en" = "en") {
  seq++;
  const baakline = (await r.db.one(`select id from villages where name_en = 'Baakline'`)).id;
  const party = (await r.db.one(`insert into parties(role, display_name) values ('customer', 'FD2 console customer') returning id`)).id;
  const phone = `+9617000050${seq}`;
  await r.db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', $2, $3)`, [party, `wa-fd2-console-${seq}`, phone]);
  const conv = (await r.db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id;
  // the customer's language, as the chat records it (customer_language, 0093: the last reading's language)
  await r.db.pg.query(`insert into agent_runs(agent, conversation_id, outcome, trace) values ('concierge', $1, 'ok', $2)`, [conv, JSON.stringify({ intent: { language: lang === "ar" ? "ar_lb" : lang } })]);
  await r.db.pg.query(`insert into consent_events(party_id, line, kind, action, source, wording) values ($1, 'customer', 'transactional', 'opt_in', 'test', 'fd2')`, [party]);
  const lead = (await r.db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await r.db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  const pin = await r.db.rpc("save_customer_pin", { p_party: party, p_lat: 33.67739, p_lng: 35.56355, p_village: baakline });
  const taouk = (await r.db.one(`select id from products where name_en = 'Taouk plate'`)).id;
  const garlic = (await r.db.one(`select o.id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = 'Garlic'`, [taouk])).id;
  const fries = (await r.db.one(`select id from products where name_en = 'French fries'`)).id;
  const o = await r.db.rpc("create_order_from_quote", { p_customer: party, p_conversation: conv, p_lines: [{ product_id: taouk, qty: 1, options: [garlic] }, { product_id: fries, qty: 1 }],
    p_village: baakline, p_place: pin.place_id, p_pickup: false });
  await r.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: party, p_wamid: `wamid.fd2.console.${seq}` });
  const call = (await r.db.one(`select id from place_calls where order_id = $1`, [o.order_id])).id as string;
  return { party, order: o.order_id as string, code: o.short_code as string, call };
}
const sentText = (r: Rig) => r.kapso.map((k) => k.body?.text?.body ?? k.body?.interactive?.body?.text ?? "").join("\n---\n");
const sentButtons = (r: Rig) => r.kapso.flatMap((k) => (k.body?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id as string));

describe("Food: calls", () => {
  it("lists the call with the place's phone and the order to read out; accepted tells the customer the estimate", async () => {
    const { r, b } = await setUp();
    const o = await confirmedFoodOrder(r);
    const page = (await b.get("/food")).text;
    expect(page).toContain("Call Alo King test kitchen");
    expect(page).toContain("tel:+96100000090");
    expect(page).toContain(o.code);
    expect(page).toMatch(/1 × Taouk plate <span class="muted">\(Garlic\)<\/span>/);
    const done = await b.post(`/food/${o.call}/accept`, { ready_in: 15 });
    expect(flashOf(done.text)).toBe("Recorded: the place took it. A rider is offered the job now. The customer was told.");
    expect((await r.db.one(`select status::text s from orders where id = $1`, [o.order])).s).toBe("preparing");
    expect(sentText(r)).toMatch(new RegExp(`✅ \\*Order ${o.code}\\*\\nAlo King test kitchen took the order and is preparing it.\\n⏱️ It arrives in about \\d+ minutes.`));
  });

  it("an item missing asks the customer with two buttons, in their language", async () => {
    const { r, b } = await setUp();
    const o = await confirmedFoodOrder(r, "ar");
    await b.get("/food");
    const item = (await r.db.one(`select i.id from order_items i join products p on p.id = i.product_id where i.order_id = $1 and p.name_en = 'French fries'`, [o.order])).id;
    const done = await b.post(`/food/${o.call}/missing`, { item });
    expect(flashOf(done.text)).toBe("Recorded. The customer is asked: go on without it, or cancel. The customer was told.");
    expect(sentText(r)).toContain(`⚠️ *طلبك ${o.code}*\nبطاطا مقلية مش متوفّر عند Alo King test kitchen.`);
    expect(sentButtons(r)).toEqual([`fcall:drop:${o.call}`, `fcall:cancel:${o.call}`]);
    expect((await b.get("/food")).text).toContain("Waiting for the customer");
  });

  it("a higher price waits for the customer's tap; the place closed cancels and tells", async () => {
    const { r, b } = await setUp();
    const o = await confirmedFoodOrder(r);
    await b.get("/food");
    const item = (await r.db.one(`select i.id from order_items i join products p on p.id = i.product_id where i.order_id = $1 and p.name_en = 'Taouk plate'`, [o.order])).id;
    expect(flashOf((await b.post(`/food/${o.call}/price`, { item, unit_usd: "9" })).text)).toBe("Recorded. The customer was told.");
    expect(sentText(r)).toContain("the price of Taouk plate changed");
    expect(sentButtons(r)).toEqual([`fcall:accept:${o.call}`, `fcall:cancel:${o.call}`]);
    const o2 = await confirmedFoodOrder(r);
    await b.get("/food");
    expect(flashOf((await b.post(`/food/${o2.call}/closed`, {})).text)).toBe("Recorded: the order is cancelled and the place is closed for today. The customer was told.");
    expect((await r.db.one(`select status::text s from orders where id = $1`, [o2.order])).s).toBe("cancelled");
    expect(sentText(r)).toContain(`❌ *Order ${o2.code} is cancelled*`);
  });

  it("is closed to pickers", async () => {
    const r = await rig();
    const picker = await r.staff("picker", "Example picker");
    const b = r.browser(); await b.signIn(picker);
    expect((await b.get("/food")).status).toBe(403);
  });
});

describe("Food: the riders' cash", () => {
  it("float given, the counter payment with the receipt's photo, the balance shows the difference in red", async () => {
    const { r, b } = await setUp();
    const o = await confirmedFoodOrder(r);
    await b.get("/food");
    await b.post(`/food/${o.call}/accept`, { ready_in: 10 });
    const rider = (await r.staff("driver", "Example rider")).partyId;
    await r.db.rpc("start_shift", { p_driver: rider });
    await b.get("/food?tab=riders");
    expect(flashOf((await b.post("/food/float", { rider, amount: "20", kind: "give" })).text)).toBe("Recorded. The rider now holds $20.00 of float.");
    const page = (await b.get("/food?tab=riders")).text;
    expect(page).toContain("data-menu-upload"); expect(page).toContain('<script src="/menus.js" defer></script>');
    const paid = await b.postFiles("/food/paid", { order: o.order, rider, amount: "10.50" }, { photo: { name: "r.jpg", type: "image/jpeg", bytes: JPEG } });
    expect(flashOf(paid.text)).toBe("Recorded. It differs from the food's price by $0.50: shown on the balance, never deducted.");
    const ev = await r.db.one(`select receipt_path from rider_float_events where order_id = $1 and kind = 'paid_place'`, [o.order]);
    expect(ev.receipt_path).toMatch(new RegExp(`^food-receipts/${o.order}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f]{64}\\.jpg$`));
    const bal = (await b.get("/food?tab=riders")).text;
    expect(bal).toContain("Example rider");
    expect(bal).toContain('ak-badge--danger');
    expect(bal).toContain("$0.50");
  });
});
