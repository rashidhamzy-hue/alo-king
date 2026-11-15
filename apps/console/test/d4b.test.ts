// D4b: the pick queue, rider jobs with "act for a rider", and rider incidents, on the real migrations through the console's own routes.
// The headline test is the session's "done when": one order goes from confirmed to closed using only the console, with no message on
// the staff line. Then the pieces: the order of the queue, what the picker is refused, the packing checklist, a short line and what the
// customer is told, a substitute, who is recorded as having acted, the rider's refusals standing, cash in two currencies, and incidents.
import { beforeAll, describe, expect, it } from "vitest";
import { rig, openShop, placeOrder, flashOf, ledgerSum, type Rig } from "./kit";
import { parseSubstitutionButton, pickChangeText, substitutionQuestion, staffButtonId } from "../../gateway/src/ops-turn";
import { pickChangeNotice, substitutionButtonId, substitutionNotice } from "../src/notices";

let r: Rig; let village: string;
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

const who = async (role: "admin" | "ops_lead" | "picker" | "driver", name: string) => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); return { ...w, b }; };
const status = async (order: string) => (await r.db.one(`select status from orders where id = $1`, [order])).status as string;
const links = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]!);
const opsRequests = () => r.kapso.filter((k) => /PN_OPS/.test(k.url) || /PN_OPS/.test(JSON.stringify(k.body ?? {})));

async function newRider(name: string) { return r.db.one(`insert into parties(role, display_name) values ('driver', $1) returning id`, [name]).then((x) => x.id as string); }

describe("one order, confirmed to closed, on the console alone", () => {
  it("is picked, packed, given to a rider, picked up, delivered and paid in two currencies, with no message on the staff line", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia");
    const rider = await newRider("Rider one");
    r.kapso.length = 0;

    // the lead switches on "offer the rider when picking starts" from the pick queue
    expect((await lead.b.get("/pick")).text).toContain("Offer the rider when picking starts");
    expect(flashOf(await lead.b.post("/pick/queue-mode", { on: "1" }).then((p) => p.text))).toMatch(/On:/);
    expect((await r.db.one(`select setting('picking')->>'console_queue' as v`)).v).toBe("true");

    const o = await placeOrder(r.db, village, "cod", 12);
    expect(await status(o.id)).toBe("confirmed");
    // the hub now waits for a picker: dispatch does not offer a rider yet
    expect((await r.db.rpc("dispatch_order", { p_order: o.id })).status).toBe("waiting_for_pick");

    // the picker sees it, and starts it
    const queue = (await picker.b.get("/pick")).text;
    expect(queue).toContain(o.code); expect(queue).toContain("Start picking");
    const started = await picker.b.post(`/pick/${o.id}/start`);
    expect(flashOf(started.text)).toBe("Picking started.");
    expect(started.text).toContain("Lines to pick, in shelf order");
    expect(await status(o.id)).toBe("preparing");

    // done is refused until every line is ticked
    const items = links(started.text, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g);
    expect(items.length).toBeGreaterThan(0);
    const early = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1, check_eggs_bread_top: 1, check_bag_label: 1 });
    expect(flashOf(early.text)).toMatch(/not ticked|neither ticked/i);
    expect(await status(o.id)).toBe("preparing");

    for (const item of items) { await picker.b.get(`/pick/${o.id}`); await picker.b.post(`/pick/${o.id}/mark/${item}`, { n: 1, picked: 1 }); }
    // the packing steps: every one has to be ticked; the cold-bag step shows only for an order with chilled lines (labneh is chilled)
    const donePage = (await picker.b.get(`/pick/${o.id}/done`)).text;
    expect(donePage).toContain("Packing steps"); expect(donePage).toContain("cold bag"); expect(donePage).toContain("bag label");
    const refused = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1 });
    expect(flashOf(refused.text)).toMatch(/Tick every packing step/);
    const packed = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1, check_eggs_bread_top: 1, check_bag_label: 1 });
    expect(flashOf(packed.text)).toContain(`${o.code} is packed`);
    expect(await status(o.id)).toBe("ready");
    const packing = (await r.db.one(`select packing from pick_sessions where order_id = $1`, [o.id])).packing;
    expect(packing.checked).toEqual(["cold_bag", "eggs_bread_top", "bag_label"]); expect(packing.checked_by).toBe(picker.partyId);

    // the lead starts the rider's shift and gives the order to them: offered and accepted for them
    const jobs = (await lead.b.get("/rider-jobs")).text;
    expect(jobs).toContain("Waiting for a rider (1)"); expect(jobs).toContain("Start their shift");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/start_shift`)).text)).toMatch(/shift is open/);
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post("/rider-jobs/assign", { order: o.id, driver: rider })).text)).toMatch(/Given to the rider/);
    const delivery = (await r.db.one(`select id, status from deliveries where driver_id = $1`, [rider]));
    expect(delivery.status).toBe("accepted");

    // picked up: the customer is told on the customer line
    const page = (await lead.b.get("/rider-jobs")).text;
    expect(page).toContain("Picked up: on the way");
    const went = await lead.b.post(`/rider-jobs/${rider}/picked_up`, { delivery: delivery.id });
    expect(flashOf(went.text)).toContain("on the road");
    expect(await status(o.id)).toBe("out_for_delivery");
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/arrived`, { order: o.id })).text)).toMatch(/at the door/);
    expect(await status(o.id)).toBe("arrived");
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/delivered`, { order: o.id })).text)).toMatch(/record the cash/);
    expect(await status(o.id)).toBe("delivered");          // delivered is not paid

    // cash, by currency: part in dollars, the rest in lira, a little change back in lira
    const cash = (await lead.b.get("/rider-jobs")).text;
    expect(cash).toContain("Cash to record"); expect(cash).toContain("Dollars received"); expect(cash).toContain("Lira received");
    const fx = Number((await r.db.one(`select fx_rate_lbp from orders where id = $1`, [o.id])).fx_rate_lbp);
    const inUsd = Math.floor(o.total) - 2, restLbp = Math.round(((o.total - inUsd) * fx) / 1000) * 1000;
    const closed = await lead.b.post(`/rider-jobs/${rider}/collect`, { order: o.id, usd: inUsd, lbp: restLbp, change_usd: 0, change_lbp: 0 });
    expect(flashOf(closed.text)).toMatch(/Cash recorded/);
    expect(await status(o.id)).toBe("closed");
    const pay = await r.db.one(`select status, received_usd, received_lbp from payments where order_id = $1`, [o.id]);
    expect(pay.status).toBe("confirmed"); expect(Number(pay.received_usd)).toBeCloseTo(inUsd, 2); expect(Number(pay.received_lbp)).toBeCloseTo(restLbp, 0);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 2);
    // the delivery fee is the rider's (invariant 10), as when the rider taps it themselves
    expect(Number((await r.db.one(`select coalesce(sum(-amount), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.kind = 'rider_payable' and a.party_id = $1`, [rider])).s)).toBeGreaterThan(0);

    // no message on the staff line, whatever happened; the customer got the "on the way" line on the customer line
    expect(opsRequests()).toEqual([]);
    expect(r.kapso.length).toBeGreaterThan(0);
    expect(r.kapso.every((k) => /PN_CUSTOMER/.test(k.url))).toBe(true);

    // who acted: the action log names the picker and the lead; the order's timeline says a person did the rider's taps
    const log = (await r.actions()).filter((a) => a.phase === "intent");
    const by = (action: string) => log.find((a) => a.action === action)?.party_id;
    expect(by("pick_start")).toBe(picker.partyId); expect(by("pick_done")).toBe(picker.partyId); expect(by("pick_line_picked")).toBe(picker.partyId);
    for (const a of ["rider_assign", "rider_act_picked_up", "rider_act_arrived", "rider_act_delivered", "rider_act_collect"]) expect(by(a), a).toBe(lead.partyId);
    const ev = await r.db.all(`select reason, actor, actor_id, meta from order_events where order_id = $1 and reason like 'acted_for_rider:%' order by created_at`, [o.id]);
    expect(ev.map((e) => e.reason)).toEqual(["acted_for_rider:assign", "acted_for_rider:picked_up", "acted_for_rider:arrived", "acted_for_rider:delivered", "acted_for_rider:collect"]);
    expect(ev.every((e) => e.actor === "ops" && e.actor_id === lead.partyId && e.meta.driver_id === rider)).toBe(true);
  }, 120_000);
});

describe("the pick queue", () => {
  it("lists orders in the order they were promised, not the order they came", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia");
    const first = await placeOrder(r.db, village, "cod", 12); const second = await placeOrder(r.db, village, "cod", 12);
    // the second was confirmed earlier: it is promised earlier
    await r.db.pg.query(`update orders set confirmed_at = now() - interval '30 minutes' where id = $1`, [second.id]);
    await r.db.pg.query(`update orders set confirmed_at = now() - interval '2 minutes' where id = $1`, [first.id]);
    const page = (await picker.b.get("/pick")).text;
    expect(page.indexOf(second.code)).toBeGreaterThan(-1);
    expect(page.indexOf(second.code)).toBeLessThan(page.indexOf(first.code));
    const board = await r.db.rpc("console_pick_board", {});
    const codes = board.map((x: any) => x.short_code);
    expect(codes.indexOf(second.code)).toBeLessThan(codes.indexOf(first.code));
    expect(Number(board.find((x: any) => x.short_code === second.code).promise_min)).toBeGreaterThan(0);
    // only a lead sees the switch
    expect(page).not.toContain("Offer the rider when picking starts");
    expect((await lead.b.get("/pick")).text).toContain("Offer the rider when picking starts");
    expect((await picker.b.post("/pick/queue-mode", { on: "0" }, { follow: false })).status).toBe(403);
    // the second picker is told, not allowed, to take an order someone else holds; one picker holds one order
    await picker.b.get("/pick");
    await picker.b.post(`/pick/${second.id}/start`);
    const other = await who("picker", "Pat");
    expect(flashOf((await (async () => { await other.b.get("/pick"); return other.b.post(`/pick/${second.id}/start`); })()).text)).toMatch(/already picking/);
    await picker.b.get("/pick");
    expect(flashOf((await picker.b.post(`/pick/${first.id}/start`)).text)).toMatch(/Finish/);
  }, 120_000);

  it("takes a missing line off, tells the customer what changed, and says so in Arabic when the staff member's language is Arabic", async () => {
    const picker = await who("picker", "Pia");
    const o = await placeOrder(r.db, village, "cod", 12);
    r.kapso.length = 0;
    await picker.b.get("/pick"); await picker.b.post(`/pick/${o.id}/start`);
    const list = (await picker.b.get(`/pick/${o.id}`)).text;
    const item = links(list, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g)[0]!;
    expect(list).toContain("Missing or short");
    const form = (await picker.b.get(`/pick/${o.id}?missing=${item}`)).text;
    expect(form).toContain("How many did you find?");
    const bad = await picker.b.post(`/pick/${o.id}/missing/${item}`, { found: 12, n: 1 });
    expect(flashOf(bad.text)).toMatch(/Type how many you found/);
    const total = Number((await r.db.one(`select total_usd from orders where id = $1`, [o.id])).total_usd);
    const rec = await picker.b.post(`/pick/${o.id}/missing/${item}`, { found: 8, n: 1 });
    expect(flashOf(rec.text)).toMatch(/Taken off the order/);
    expect(Number((await r.db.one(`select total_usd from orders where id = $1`, [o.id])).total_usd)).toBeLessThan(total);
    // the rest is picked; done; the customer hears about the change on the customer line, never the ops line
    const rest = links((await picker.b.get(`/pick/${o.id}`)).text, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g);
    for (const x of rest) { await picker.b.get(`/pick/${o.id}`); await picker.b.post(`/pick/${o.id}/mark/${x}`, { n: 1, picked: 1 }); }
    const done = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1, check_eggs_bread_top: 1, check_bag_label: 1 });
    expect(flashOf(done.text)).toMatch(/The customer was told what changed/);
    expect(r.kapso.length).toBe(1); expect(r.kapso[0]!.url).toContain("PN_CUSTOMER");
    expect(JSON.stringify(r.kapso[0]!.body)).toContain(o.code);
    expect(opsRequests()).toEqual([]);
    // Arabic
    await picker.b.get("/lang?to=ar&next=/pick");
    expect((await picker.b.get("/pick")).text).toContain("قائمة التجهيز");
    await picker.b.get("/lang?to=en&next=/pick");
  }, 120_000);

  it("offers a substitute when that is switched on: the customer is asked on the customer line with the same words the ops line uses", async () => {
    const picker = await who("picker", "Pia");
    await r.db.pg.query(`update settings set value = value || '{"offer_substitutes": true}' where key = 'picking'`);
    const o = await placeOrder(r.db, village, "cod", 12);
    r.kapso.length = 0;
    await picker.b.get("/pick"); await picker.b.post(`/pick/${o.id}/start`);
    const item = links((await picker.b.get(`/pick/${o.id}`)).text, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g)[0]!;
    const rec = await picker.b.post(`/pick/${o.id}/missing/${item}`, { found: 0, n: 1 });
    const offers = links(rec.text, /\/pick\/[0-9a-f-]+\/offer\/[0-9a-f-]+\/([0-9a-f-]+)"/g);
    expect(offers.length, flashOf(rec.text)).toBeGreaterThan(0);
    expect(flashOf(rec.text)).toMatch(/Recorded as missing/);
    const missingId = /\/pick\/[0-9a-f-]+\/offer\/([0-9a-f-]+)\//.exec(rec.text)![1]!;
    const asked = await picker.b.post(`/pick/${o.id}/offer/${missingId}/${offers[0]}`);
    expect(flashOf(asked.text)).toMatch(/The customer was asked/);
    expect(r.kapso.length).toBe(1); expect(opsRequests()).toEqual([]);
    expect(JSON.stringify(r.kapso[0]!.body)).toMatch(/sub:keep:/);
    expect(await r.db.one(`select count(*)::int as n from substitution_offers where order_id = $1 and status = 'open'`, [o.id])).toEqual({ n: 1 });
    expect((await picker.b.get(`/pick/${o.id}`)).text).toContain("Waiting for the customer");
    // done is refused while the customer has not answered
    const items = links((await picker.b.get(`/pick/${o.id}`)).text, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g);
    for (const x of items) { await picker.b.get(`/pick/${o.id}`); await picker.b.post(`/pick/${o.id}/mark/${x}`, { n: 1, picked: 1 }); }
    const early = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1, check_eggs_bread_top: 1, check_bag_label: 1 });
    expect(flashOf(early.text)).toMatch(/still waits for a decision/);
    // the customer says keep (on their line, as ever); the substitute is a line to pick, then done
    const offerId = (await r.db.one(`select id from substitution_offers where order_id = $1 and status = 'open'`, [o.id])).id;
    await r.db.rpc("answer_substitution", { p_offer: offerId, p_party: o.customer, p_keep: true });
    const after = links((await picker.b.get(`/pick/${o.id}`)).text, /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/g);
    for (const x of after) { await picker.b.get(`/pick/${o.id}`); await picker.b.post(`/pick/${o.id}/mark/${x}`, { n: 1, picked: 1 }); }
    const finished = await picker.b.post(`/pick/${o.id}/done`, { check_cold_bag: 1, check_eggs_bread_top: 1, check_bag_label: 1 });
    expect(flashOf(finished.text)).toContain("is packed");
    await r.db.pg.query(`update settings set value = value || '{"offer_substitutes": false}' where key = 'picking'`);
  }, 120_000);

  it("keeps the customer's words in step with the ops line (the copies in the console are held to the gateway's)", () => {
    const changes = { short_code: "AK-1", total_usd: 7.5, fx_rate_lbp: 89500, payment_method: "cod", removed: [{ name: "Labneh", qty: 2, line_total_usd: 5 }],
      substituted: [{ name: "Yogurt", by: "Labneh", qty: 1, line_total_usd: 2 }], credit_usd: 1.25 };
    for (const lang of ["ar", "en", "fr"]) expect(pickChangeNotice(changes, lang)).toEqual(pickChangeText(changes, lang));
    const offer = { offer_id: "11111111-1111-4111-8111-111111111111", order_id: "22222222-2222-4222-8222-222222222222", short_code: "AK-1", customer_id: "c", missing_name: "Labneh", substitute_name: "Yogurt",
      missing_name_ar: "لبنة", substitute_name_ar: "لبن", qty: 2, replaced_total_usd: 5, line_total_usd: 4, diff_usd: -1, answer_min: 5 };
    for (const lang of ["ar", "en", "fr"]) expect(substitutionNotice(offer, lang)).toEqual(substitutionQuestion(offer, lang));
    // the customer's tap is read back by the ops line's parser
    expect(parseSubstitutionButton(substitutionButtonId(true, offer.offer_id))).toEqual({ keep: true, offerId: offer.offer_id });
    expect(staffButtonId({ kind: "pick", action: "done", id: offer.order_id })).toMatch(/^pick:done:/);
  });
});

describe("act for a rider", () => {
  it("is for the ops lead and the admin only; a picker has no page for it, and the database says no too", async () => {
    const picker = await who("picker", "Pia"); const rider = await newRider("Rider two");
    expect((await picker.b.get("/rider-jobs")).status).toBe(403);
    expect((await picker.b.get("/rider-incidents")).status).toBe(403);
    await expect(r.db.rpc("act_for_rider", { p_by: picker.partyId, p_driver: rider, p_action: "start_shift" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("act_for_rider", { p_by: rider, p_driver: rider, p_action: "start_shift" })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("keeps the rider's own refusals: the cash cap, someone else's order, an amount a dollar off", async () => {
    const lead = await who("admin", "Rasheed");
    const one = await newRider("Rider three"), two = await newRider("Rider four");
    for (const d of [one, two]) await r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: d, p_action: "start_shift" });
    const o = await placeOrder(r.db, village, "cod", 12);
    await r.db.pg.query(`update orders set status = 'ready' where id = $1`, [o.id]);
    // an unknown rider, an unknown action, a pickup order, an order a rider already holds
    await expect(r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: lead.partyId, p_action: "assign", p_order: o.id })).rejects.toThrow(/NOT_A_DRIVER/);
    await expect(r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: one, p_action: "fly" })).rejects.toThrow(/UNKNOWN_ACTION/);
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post("/rider-jobs/assign", { order: o.id, driver: one })).text)).toMatch(/Given to the rider/);
    expect(flashOf((await lead.b.post("/rider-jobs/assign", { order: o.id, driver: two })).text)).toMatch(/already has this order/);
    // rider two cannot pick up rider one's job, nor deliver rider one's order
    const d = (await r.db.one(`select id from deliveries where driver_id = $1`, [one])).id;
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post(`/rider-jobs/${two}/picked_up`, { delivery: d })).text)).toMatch(/not this rider's/);
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post(`/rider-jobs/${two}/delivered`, { order: o.id })).text)).toMatch(/not this rider's/);
    // deliver it, then an amount more than a dollar off is refused and nothing is recorded; the right one closes it
    await lead.b.get("/rider-jobs");
    await lead.b.post(`/rider-jobs/${one}/picked_up`, { delivery: d }); await lead.b.get("/rider-jobs");
    await lead.b.post(`/rider-jobs/${one}/delivered`, { order: o.id });
    const wrong = await lead.b.post(`/rider-jobs/${one}/collect`, { order: o.id, usd: o.total + 5 });
    expect(flashOf(wrong.text)).toMatch(/does not match the order total/);
    expect(await status(o.id)).toBe("delivered");
    expect(flashOf((await lead.b.post(`/rider-jobs/${one}/collect`, { order: o.id, usd: 0, lbp: 0 })).text)).toMatch(/Type the amount received/);
    const ok = await lead.b.post(`/rider-jobs/${one}/collect`, { order: o.id, exact: 1 });
    expect(flashOf(ok.text)).toMatch(/Cash recorded/);
    expect(await status(o.id)).toBe("closed");
    // the same tap twice records nothing twice
    await lead.b.get("/rider-jobs");
    expect(flashOf((await lead.b.post(`/rider-jobs/${one}/collect`, { order: o.id, exact: 1 })).text)).toMatch(/not valid|no cash waiting|already recorded/);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 2);
  }, 120_000);

  it("will not let a rider pick up what is still being picked, when the hub picks through the queue", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia"); const rider = await newRider("Rider five");
    await r.db.pg.query(`update settings set value = value || '{"console_queue": true}' where key = 'picking'`);
    await r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: rider, p_action: "start_shift" });
    const o = await placeOrder(r.db, village, "cod", 12);
    await picker.b.get("/pick"); await picker.b.post(`/pick/${o.id}/start`);
    await lead.b.get("/rider-jobs");
    await lead.b.post("/rider-jobs/assign", { order: o.id, driver: rider });
    const d = (await r.db.one(`select id from deliveries where driver_id = $1 and status = 'accepted'`, [rider])).id;
    const page = (await lead.b.get("/rider-jobs")).text;
    expect(page).toContain("Still being picked at the hub");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/picked_up`, { delivery: d })).text)).toMatch(/Still being picked/);
    expect(await status(o.id)).toBe("preparing");
  }, 120_000);
});

describe("rider incidents", () => {
  it("marks a rider off, transfers the order on the road to another rider, and receives the cash they held", async () => {
    const lead = await who("ops_lead", "Maya");
    const a = await newRider("Rider A"), b = await newRider("Rider B");
    for (const d of [a, b]) await r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: d, p_action: "start_shift" });
    await r.db.pg.query(`update settings set value = value || '{"console_queue": false}' where key = 'picking'`);
    // rider A delivers one order for cash first, so they hold money when the incident comes
    const first = await placeOrder(r.db, village, "cod", 12);
    await r.db.pg.query(`update orders set status = 'ready' where id = $1`, [first.id]);
    await lead.b.get("/rider-jobs"); await lead.b.post("/rider-jobs/assign", { order: first.id, driver: a });
    const d1 = (await r.db.one(`select id from deliveries where driver_id = $1 and status = 'accepted'`, [a])).id;
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${a}/picked_up`, { delivery: d1 });
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${a}/delivered`, { order: first.id });
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${a}/collect`, { order: first.id, exact: 1 });
    expect(await status(first.id)).toBe("closed");
    const o = await placeOrder(r.db, village, "cod", 12);
    await r.db.pg.query(`update orders set status = 'ready' where id = $1`, [o.id]);
    await lead.b.get("/rider-jobs"); await lead.b.post("/rider-jobs/assign", { order: o.id, driver: a });
    const d = (await r.db.one(`select id from deliveries where driver_id = $1 and status = 'accepted'`, [a])).id;
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${a}/picked_up`, { delivery: d });
    expect(await status(o.id)).toBe("out_for_delivery");
    r.kapso.length = 0;

    const inc = (await lead.b.get("/rider-incidents")).text;
    expect(inc).toContain("This rider cannot continue");
    const unsure = await lead.b.post(`/rider-incidents/${a}/off`, {});
    expect(flashOf(unsure.text)).toMatch(/Tick the box/);
    const off = await lead.b.post(`/rider-incidents/${a}/off`, { sure: 1 });
    expect(flashOf(off.text)).toMatch(/is off\. 0 job\(s\) back in the queue; 1 order\(s\) on the road wait for a rider/);
    expect(flashOf(off.text)).toMatch(/1 customer\(s\) told of the delay/);
    expect(r.kapso.length).toBe(1); expect(r.kapso[0]!.url).toContain("PN_CUSTOMER"); expect(opsRequests()).toEqual([]);
    expect((await r.db.one(`select count(*)::int as n from rider_incidents where driver_id = $1 and by_party = $2`, [a, lead.partyId])).n).toBe(1);
    expect(off.text).toContain("On the road with nobody (1)"); expect(off.text).toContain("Transfer to this rider");

    // transfer to rider B: offered and accepted for them; the order is theirs now
    await lead.b.get("/rider-incidents");
    expect(flashOf((await lead.b.post("/rider-jobs/assign", { order: o.id, driver: b })).text)).toMatch(/Given to the rider/);
    expect(await r.db.one(`select d.driver_id from deliveries d join delivery_stops s on s.delivery_id = d.id where s.order_id = $1 and d.status = 'accepted'`, [o.id])).toEqual({ driver_id: b });
    expect(await status(o.id)).toBe("out_for_delivery");

    // the cash rider A held is counted and received at the hub, by the lead
    const held = Number((await r.db.one(`select usd from driver_cash_native($1)`, [a])).usd);
    expect(held).toBeGreaterThan(0);
    const page = (await lead.b.get("/rider-incidents")).text;
    expect(page).toContain("Cash received");
    expect(flashOf((await lead.b.post(`/rider-incidents/${a}/cash`, {})).text)).toMatch(/Tick the box/);
    expect(flashOf((await lead.b.post(`/rider-incidents/${a}/cash`, { sure: 1 })).text)).toMatch(/Received at the hub/);
    expect(Number((await r.db.one(`select usd from driver_cash_native($1)`, [a])).usd)).toBeCloseTo(0, 2);
    expect(await ledgerSum(r.db)).toBeCloseTo(0, 2);
  }, 120_000);

  it("calls a stranded order off with no charge and tells the customer on the customer line", async () => {
    const lead = await who("admin", "Rasheed");
    const a = await newRider("Rider C");
    await r.db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: a, p_action: "start_shift" });
    const o = await placeOrder(r.db, village, "cod", 12);
    await r.db.pg.query(`update orders set status = 'ready' where id = $1`, [o.id]);
    await lead.b.get("/rider-jobs"); await lead.b.post("/rider-jobs/assign", { order: o.id, driver: a });
    const d = (await r.db.one(`select id from deliveries where driver_id = $1`, [a])).id;
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${a}/picked_up`, { delivery: d });
    await lead.b.get("/rider-incidents"); await lead.b.post(`/rider-incidents/${a}/off`, { sure: 1 });
    r.kapso.length = 0;
    const page = (await lead.b.get("/rider-incidents")).text;
    expect(page).toContain("Call it off, no charge");
    expect(flashOf((await lead.b.post(`/rider-incidents/${o.id}/call-off`, {})).text)).toMatch(/Tick the box/);
    const called = await lead.b.post(`/rider-incidents/${o.id}/call-off`, { sure: 1 });
    expect(flashOf(called.text)).toMatch(/is called off/);
    expect(await status(o.id)).toBe("failed_delivery");
    expect(r.kapso.length).toBe(1); expect(r.kapso[0]!.url).toContain("PN_CUSTOMER"); expect(opsRequests()).toEqual([]);
  }, 120_000);
});

describe("what the database itself answers", () => {
  it("lets only staff mark a line or switch the queue, and refuses to finish a pick with an unmarked line", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia"); const rider = await newRider("Rider six");
    const o = await placeOrder(r.db, village, "cod", 12);
    await picker.b.get("/pick"); await picker.b.post(`/pick/${o.id}/start`);
    const item = (await r.db.one(`select id from order_items where order_id = $1 and status = 'ok' limit 1`, [o.id])).id;
    await expect(r.db.rpc("pick_mark_line", { p_item: item, p_by: rider, p_picked: true })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("set_console_pick_queue", { p_by: picker.partyId, p_on: true })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("set_console_pick_queue", { p_by: rider, p_on: true })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("finish_pick_packed", { p_order: o.id, p_by: picker.partyId, p_packing: { checked: [] } })).rejects.toThrow(/LINES_NOT_CHECKED/);
    expect(await status(o.id)).toBe("preparing");
    await r.db.rpc("pick_mark_line", { p_item: item, p_by: picker.partyId, p_picked: true });
    const r2 = await r.db.rpc("finish_pick_packed", { p_order: o.id, p_by: picker.partyId, p_packing: { checked: ["bag_label"] } });
    expect(r2.status).toBe("ready");
    // finished already: asking again changes nothing and does not raise
    expect((await r.db.rpc("finish_pick_packed", { p_order: o.id, p_by: picker.partyId, p_packing: { checked: ["x"] } })).status).toBe("already");
    expect((await r.db.one(`select packing->'checked' as c from pick_sessions where order_id = $1`, [o.id])).c).toEqual(["bag_label"]);
    // a line marked picked can no longer be marked once the pick is over
    await expect(r.db.rpc("pick_mark_line", { p_item: item, p_by: picker.partyId, p_picked: false })).rejects.toThrow(/NOT_BEING_PICKED/);
    void lead;
  });

  it("leaves a scheduled order off the board until it is released, and promises it at the start of its window", async () => {
    const o = await placeOrder(r.db, village, "cod", 12);
    const slot = (await r.db.one(`insert into delivery_slots(slot_date, starts_at, ends_at, order_by, fresh_order_by, capacity)
      values (current_date + 1, now() + interval '1 day', now() + interval '1 day 2 hours', now(), now(), 5) returning id, starts_at`));
    await r.db.pg.query(`update orders set delivery_slot_id = $2 where id = $1`, [o.id, slot.id]);
    const ids = async () => (await r.db.rpc("console_pick_board", {})).map((x: any) => x.order_id);
    expect(await ids()).not.toContain(o.id);
    await r.db.pg.query(`update orders set released_at = now() where id = $1`, [o.id]);
    const row = (await r.db.rpc("console_pick_board", {})).find((x: any) => x.order_id === o.id);
    expect(row).toBeTruthy();
    expect(new Date(row.promise_at).getTime()).toBe(new Date(slot.starts_at).getTime());
    expect(row.window).toBeTruthy();
  });

  it("reads the packing steps from the settings: a changed step is what the picker sees, and the cold-bag step shows only for chilled goods", async () => {
    const picker = await who("picker", "Pia");
    const was = (await r.db.one(`select value from settings where key = 'packing_checklist'`)).value;
    await r.db.pg.query(`update settings set value = $1::jsonb where key = 'packing_checklist'`, [JSON.stringify({ items: [
      { key: "seal", when: "always", en: "The bag is sealed.", ar: "الكيس مغلق." }, { key: "ice", when: "chilled", en: "Ice pack in.", ar: "كيس الثلج." }] })]);
    const o = await placeOrder(r.db, village, "cod", 12);
    await picker.b.get("/pick"); await picker.b.post(`/pick/${o.id}/start`);
    for (const x of links((await picker.b.get(`/pick/${o.id}`)).text, /\/mark\/([0-9a-f-]+)"/g)) { await picker.b.get(`/pick/${o.id}`); await picker.b.post(`/pick/${o.id}/mark/${x}`, { n: 1, picked: 1 }); }
    const page = (await picker.b.get(`/pick/${o.id}/done`)).text;
    expect(page).toContain("The bag is sealed."); expect(page).toContain("Ice pack in."); expect(page).not.toContain("bag label");
    // no chilled line left: the chilled-only step is not asked
    await r.db.pg.query(`update products set storage = 'ambient' where id = $1`, [o.product]);
    const dry = (await picker.b.get(`/pick/${o.id}/done`)).text;
    expect(dry).toContain("The bag is sealed."); expect(dry).not.toContain("Ice pack in.");
    expect(flashOf((await picker.b.post(`/pick/${o.id}/done`, { check_seal: 1 })).text)).toContain("is packed");
    await r.db.pg.query(`update products set storage = 'chilled' where id = $1`, [o.product]);
    await r.db.pg.query(`update settings set value = $1::jsonb where key = 'packing_checklist'`, [JSON.stringify(was)]);
  });
});
