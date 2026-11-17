// UX2a: the six staff pages on the design system (Today, Inbox, Orders, Pick, Dispatch, Stock), from the founder's design reference. Behaviour stays: every
// existing function, role and test of these pages still holds (their own test files). What is new, and proved here on the real migrations:
// Today's four tiles are links; the inbox shows the escalation steps from settings.support and "I'm on it" claims; the orders drawer says the handover-code state
// and the customer's missing-item choice and offers only what order_transitions allows ops; the command bar jumps to an order by its code; a reversible pick tap
// carries an Undo and nothing about money does; Dispatch shows the cash against settings.cash_cap and asks for the handover code; Stock needs a reason.
import { beforeAll, describe, expect, it } from "vitest";
import { flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); return { ...w, b }; };
const status = async (order: string) => (await r.db.one(`select status from orders where id = $1`, [order])).status as string;
const tile = (page: string, label: string) => new RegExp(`<li class="ak-kpi ak-kpi--link[^"]*"><a href="([^"]+)"><span class="label">(?:<svg[^>]*>(?:(?!</svg>)[\\s\\S])*</svg>)?${label}</span>`).exec(page)?.[1];

describe("Today: four tiles, each one link", () => {
  it("links orders waiting, late, cash held and cases open to where the work is; a state is said in words and an icon; a picker gets the two that are his", async () => {
    const o = await placeOrder(r.db, village);
    await r.db.pg.query(`update orders set confirmed_at = now() - interval '90 minutes' where id = $1`, [o.id]);
    const lead = await who("ops_lead", "Maya");
    const page = (await lead.b.get("/")).text;
    expect(tile(page, "Orders waiting")).toBe("/pick"); expect(tile(page, "Late")).toBe("#at-risk"); expect(tile(page, "Cash held")).toBe("/rider-jobs"); expect(tile(page, "Cases open")).toBe("/inbox");
    expect(page).toMatch(/class="ak-kpi ak-kpi--link ak-kpi--late"[\s\S]*?<span class="cmp state"><svg[\s\S]*?<\/svg>\d+ late<\/span>/);   // the state is an icon and words, the border only repeats it
    expect(page).toContain('id="at-risk"');
    expect(page).toContain("Waiting on customer"); expect(page).toContain("To pick");                                                       // the board has the reference's columns
    const picker = await who("picker", "Pia");
    const pp = (await picker.b.get("/")).text;
    expect(tile(pp, "Orders waiting")).toBe("/pick"); expect(tile(pp, "Late")).toBe("#at-risk"); expect(tile(pp, "Cash held")).toBeUndefined(); expect(tile(pp, "Cases open")).toBeUndefined();
    const ar = await who("admin", "Rasheed"); await ar.b.get("/lang?to=ar&next=/");
    const arp = (await ar.b.get("/")).text;
    expect(arp).toContain("طلبات بانتظارنا"); expect(arp).toContain("حالات مفتوحة");
  });
});

describe("Inbox: the escalation steps and I'm on it", () => {
  it("shows the steps at the minutes in settings.support, claims for this person from the list, and stops the steps once claimed", async () => {
    const a = await placeOrder(r.db, village), b2 = await placeOrder(r.db, village);
    await r.db.pg.query(`update conversations set last_inbound_at = now() where id = any($1::uuid[])`, [`{${a.conversation},${b2.conversation}}`]);
    const one = (await r.db.rpc("open_case", { p_conversation: a.conversation, p_kind: "complaint", p_topic: "late", p_order: a.id, p_source: "model" })).case_id;
    const two = (await r.db.rpc("open_case", { p_conversation: b2.conversation, p_kind: "person_requested", p_topic: null, p_order: null, p_source: "customer_words" })).case_id;
    await r.db.pg.query(`update handoffs set ladder_from = now() - interval '4 minutes' where id = $1`, [one]);
    const lead = await who("ops_lead", "Maya");
    const page = (await lead.b.get("/inbox")).text;
    for (const step of ["3 min", "5 min", "15 min"]) expect(page).toContain(`<bdi>${step}</bdi>`);
    expect(page).toContain("the ops lead is alerted"); expect(page).toContain("the founder is alerted"); expect(page).toContain("the case is marked late");
    expect(page).toMatch(/data-state="done"[^>]*>[\s\S]*?<bdi>3 min<\/bdi>[\s\S]*?<small>done<\/small>/);        // 4 minutes in: the first step has happened
    expect(page).toMatch(/data-state="next"[^>]*>[\s\S]*?<bdi>5 min<\/bdi>[\s\S]*?<small>next<\/small>/);
    expect((page.match(/I&#39;m on it/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // the numbers are the setting's, never the page's
    await r.db.pg.query(`update settings set value = value || '{"claim_alert_min": 4, "founder_alert_min": 9, "late_min": 30}'::jsonb where key = 'support'`);
    const moved = (await lead.b.get("/inbox")).text;
    expect(moved).toContain("<bdi>9 min</bdi>"); expect(moved).toContain("<bdi>30 min</bdi>"); expect(moved).not.toContain("<bdi>15 min</bdi>");
    await r.db.pg.query(`update settings set value = value || '{"claim_alert_min": 3, "founder_alert_min": 5, "late_min": 15}'::jsonb where key = 'support'`);
    // I'm on it from the list claims it for this person and comes back to the list
    const claimed = await lead.b.post(`/inbox/${two}/claim`, { back: "/inbox" });
    expect(flashOf(claimed.text)).toBe("Claimed. The bot steps back while you answer."); expect(lead.b.lastPath).toBe("/inbox");
    expect((await r.db.one(`select state, claimed_by from handoffs where id = $1`, [two])).claimed_by).toBe(lead.partyId);
    expect((await lead.b.get("/inbox")).text).toContain("the steps are stopped");
    // the case page shows the same steps and the same button
    const detail = (await lead.b.get(`/inbox/${one}`)).text;
    expect(detail).toContain("I&#39;m on it (the bot steps back)"); expect(detail).toContain("<bdi>5 min</bdi>");
    // a picker has no inbox; the reply still goes through the existing send path (inbox.test.ts holds it)
    const p = await who("picker", "Pia");
    expect((await p.b.post(`/inbox/${one}/claim`, {}, { follow: false })).status).toBe(403);
  });
});

describe("Orders: the drawer", () => {
  it("says the handover-code state (never the code), the customer's missing-item choice and who has it; offers only what order_transitions allows ops", async () => {
    const o = await placeOrder(r.db, village);
    await r.db.pg.query(`update orders set missing_pref = 'best_match' where id = $1`, [o.id]);
    const lead = await who("ops_lead", "Maya");
    let page = (await lead.b.get(`/orders/${o.id}`)).text;
    expect(page).toContain("no code needed"); expect(page).toContain("customer chose: the closest match");
    expect(page).toContain("Status history"); expect(page).toContain("What you can do");
    // a code on the order: needed, never printed; verified; locked
    await r.db.pg.query(`update orders set handover_code = '4827' where id = $1`, [o.id]);
    page = (await lead.b.get(`/orders/${o.id}`)).text;
    expect(page).toContain("code needed at the door"); expect(page).not.toContain("4827");
    await r.db.pg.query(`update orders set handover_attempts = 5 where id = $1`, [o.id]);
    expect((await lead.b.get(`/orders/${o.id}`)).text).toContain("locked after 5 wrong tries");
    await r.db.pg.query(`update orders set handover_attempts = 0, handover_verified_at = now() where id = $1`, [o.id]);
    expect((await lead.b.get(`/orders/${o.id}`)).text).toMatch(/code checked/);
    // a confirmed order: cancel is allowed, and nothing else is offered as a button; the other steps are not there
    expect(page).toContain(`action="/orders/${o.id}/cancel"`); expect(page).not.toContain("Decide it as a rider incident");
    // the table is the authority: with the ops cancel row gone, the button goes
    await r.db.pg.query(`update order_transitions set actors = array_remove(actors, 'ops') where from_status = 'confirmed' and to_status = 'cancelled'`);
    expect((await lead.b.get(`/orders/${o.id}`)).text).not.toContain(`action="/orders/${o.id}/cancel"`);
    await r.db.pg.query(`update order_transitions set actors = array_append(actors, 'ops') where from_status = 'confirmed' and to_status = 'cancelled'`);
    // the Arabic drawer
    await lead.b.get("/lang?to=ar&next=/orders");
    const ar = (await lead.b.get(`/orders/${o.id}`)).text;
    expect(ar).toContain("رمز التسليم"); expect(ar).toContain("اختار الزبون");
  });

  it("cancels before picking with a reason, once, tells the customer through the notice cron, moves no money; not after picking starts; not for a picker", async () => {
    const a = await placeOrder(r.db, village), b2 = await placeOrder(r.db, village);
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia");
    await lead.b.get(`/orders/${a.id}`);
    expect(flashOf((await lead.b.post(`/orders/${a.id}/cancel`, { reason: "" })).text)).toBe("Write why you cancel it.");
    expect(await status(a.id)).toBe("confirmed");
    const ledgerBefore = (await r.db.one(`select count(*)::int as n from ledger_entries`)).n;
    expect(flashOf((await lead.b.post(`/orders/${a.id}/cancel`, { reason: "customer phoned to cancel" })).text)).toBe("Cancelled. The customer is told.");
    expect(await status(a.id)).toBe("cancelled");
    expect((await r.db.one(`select count(*)::int as n from ledger_entries`)).n).toBe(ledgerBefore);                     // no money moved
    const ev = await r.db.one(`select actor, actor_id, reason from order_events where order_id = $1 and to_status = 'cancelled'`, [a.id]);
    expect(ev).toEqual({ actor: "ops", actor_id: lead.partyId, reason: "customer phoned to cancel" });
    expect((await r.db.rpc("customer_notices_due")).some((n: any) => n.kind === "order_cancelled" && n.order_id === a.id)).toBe(true);   // the system tells them
    expect((await lead.b.get(`/orders/${a.id}`)).text).not.toContain(`action="/orders/${a.id}/cancel"`);
    // once picking has started the database says no and the page says why
    expect((await picker.b.post(`/pick/${b2.id}/start`)).status).toBe(200);
    const page = (await lead.b.get(`/orders/${b2.id}`)).text;
    expect(page).not.toContain(`action="/orders/${b2.id}/cancel"`); expect(page).toContain("picking has started");
    expect(flashOf((await lead.b.post(`/orders/${b2.id}/cancel`, { reason: "too late" })).text)).toBe("This order can no longer be cancelled here.");
    expect(await status(b2.id)).toBe("preparing");
    expect((await picker.b.post(`/orders/${b2.id}/cancel`, { reason: "x" }, { follow: false })).status).toBe(403);
    expect((await r.actions()).filter((x: any) => x.action === "order_cancel" && x.phase === "intent").length).toBeGreaterThanOrEqual(2);
  });

  it("the command bar jumps to an order by its code: a lead to the order, a picker to its pick list; anything else is a search", async () => {
    const o = await placeOrder(r.db, village);
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia");
    expect((await lead.b.get("/")).text).toContain('<form method="get" action="/go">');
    const hop = async (b: typeof lead.b, q: string) => (await (b as any).go("GET", `/go?q=${encodeURIComponent(q)}`)).location as string;
    expect(await hop(lead.b, o.code)).toBe(`/orders/${o.code}`);
    expect(await hop(lead.b, o.code.toLowerCase().replace("-", " "))).toBe(`/orders/${o.code}`);
    expect(await hop(picker.b, o.code)).toBe(`/pick/${o.id}`);
    expect(await hop(lead.b, "AK-9999999")).toBe("/orders?q=AK-9999999");
    expect(await hop(lead.b, "labneh")).toBe("/orders?q=labneh");
    expect(await hop(picker.b, "labneh")).toBe("/catalog?q=labneh");
  });
});

describe("Pick: Undo only where the database can take it back", () => {
  it("a tapped line offers Undo, undo unmarks it and is logged; the walking order, the customer's choice and the progress are on the page; a rider's money action has no Undo", async () => {
    const o = await placeOrder(r.db, village);
    await r.db.pg.query(`update orders set missing_pref = 'remove' where id = $1`, [o.id]);
    const picker = await who("picker", "Pia");
    const started = await picker.b.post(`/pick/${o.id}/start`);
    expect(started.text).toContain("In walking order"); expect(started.text).toContain("take it off the order"); expect(started.text).toContain('<progress class="ak-progress"');
    expect(started.text).toContain('class="ak-runbar"');
    const item = /\/pick\/[0-9a-f-]+\/mark\/([0-9a-f-]+)"/.exec(started.text)![1]!;
    const marked = await picker.b.post(`/pick/${o.id}/mark/${item}`, { n: 1, picked: 1 });
    expect(flashOf(marked.text)).toBe("Picked.");
    expect(marked.text).toContain('<div class="flash-row" role="status">'); expect(marked.text).toContain(`action="/pick/${o.id}/mark/${item}"`); expect(marked.text).toContain('class="ak-toast-undo">Undo</button>');
    expect((await r.db.one(`select count(*)::int as n from pick_line_marks where item_id = $1`, [item])).n).toBe(1);
    const undone = await picker.b.post(`/pick/${o.id}/mark/${item}`, { n: 1, picked: 0 });                       // what the Undo form posts
    expect(flashOf(undone.text)).toMatch(/Put back/); expect(undone.text).toContain('value="1"');                   // and now offers to mark it again
    expect((await r.db.one(`select count(*)::int as n from pick_line_marks where item_id = $1`, [item])).n).toBe(0);
    expect((await r.actions()).filter((a: any) => a.phase === "intent" && ["pick_line_picked", "pick_line_unpicked"].includes(a.action)).map((a: any) => a.action).slice(-2)).toEqual(["pick_line_picked", "pick_line_unpicked"]);
    // the toast is never on a failure, and never on money or a message: giving an order to a rider, recording cash
    const lead = await who("ops_lead", "Maya");
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rider') returning id`)).id;
    await lead.b.get("/rider-jobs");
    const shift = await lead.b.post(`/rider-jobs/${rider}/start_shift`);
    expect(shift.text).not.toContain("ak-toast-undo"); expect(shift.text).not.toContain("flash-row");
  });
});

describe("Dispatch: packed orders, the riders against the cash cap, the code at the door", () => {
  it("lists a packed order, shows each rider's cash against the soft and hard cap in words, gives through offer_delivery (the database refuses past the cap), and asks for the code of a gift order", async () => {
    const lead = await who("ops_lead", "Maya"); const picker = await who("picker", "Pia");
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id as string;
    await lead.b.get("/rider-jobs"); await lead.b.post(`/rider-jobs/${rider}/start_shift`);
    const o = await placeOrder(r.db, village, "cod", 12);
    await picker.b.post(`/pick/${o.id}/start`);
    for (const m of (await r.db.all(`select id from order_items where order_id = $1`, [o.id]))) await r.db.rpc("pick_mark_line", { p_item: m.id, p_by: picker.partyId, p_picked: true });
    await r.db.rpc("finish_pick_packed", { p_order: o.id, p_by: picker.partyId, p_packing: { checked: [] } });
    expect(await status(o.id)).toBe("ready");
    const page = (await lead.b.get("/rider-jobs")).text;
    expect(page).toContain("Packed, waiting for a rider (1)"); expect(page).toContain(o.code); expect(page).toMatch(/Riders on shift \(\d\)/);
    expect(page).toContain("Soft cap $100.00 warns. Hard cap $150.00 blocks new cash orders until a drop.");          // from settings.cash_cap
    expect(page).toContain("Cash drop"); expect(page).toContain("Pickup shelf");
    // the caps are the setting's: move them and the page follows; the database refuses a job past the hard cap
    await r.db.pg.query(`update settings set value = '{"soft_usd": 1, "hard_usd": 2}'::jsonb where key = 'cash_cap'`);
    expect((await lead.b.get("/rider-jobs")).text).toContain("Hard cap $2.00 blocks");
    const refused = await lead.b.post("/rider-jobs/assign", { order: o.id, driver: rider });
    expect(flashOf(refused.text)).toMatch(/too much cash/);
    expect((await r.db.one(`select count(*)::int as n from deliveries where driver_id = $1`, [rider])).n).toBe(0);
    await r.db.pg.query(`update settings set value = '{"soft_usd": 100, "hard_usd": 150}'::jsonb where key = 'cash_cap'`);
    expect(flashOf((await lead.b.post("/rider-jobs/assign", { order: o.id, driver: rider })).text)).toMatch(/Given to the rider/);
    // a gift or prepaid order is handed over only against its code: the form asks for it, a wrong one counts, the right one hands over
    await r.db.pg.query(`update orders set handover_code = '4827' where id = $1`, [o.id]);
    const delivery = (await r.db.one(`select id from deliveries where driver_id = $1`, [rider])).id;
    await lead.b.post(`/rider-jobs/${rider}/picked_up`, { delivery });
    await lead.b.post(`/rider-jobs/${rider}/arrived`, { order: o.id });
    const asking = (await lead.b.get("/rider-jobs")).text;
    expect(asking).toContain("The customer&#39;s 4-digit code");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/delivered`, { order: o.id })).text)).toMatch(/4-digit code/);
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/delivered`, { order: o.id, code: "0000" })).text)).toMatch(/not the code. 4 tries left/);
    expect(await status(o.id)).toBe("arrived");
    expect(flashOf((await lead.b.post(`/rider-jobs/${rider}/delivered`, { order: o.id, code: "4827" })).text)).toMatch(/Delivered/);
    expect(await status(o.id)).toBe("delivered");                                                                  // delivered is not paid
    // Arabic
    await lead.b.get("/lang?to=ar&next=/rider-jobs");
    expect((await lead.b.get("/rider-jobs")).text).toContain("جاهز بانتظار مندوب");
  }, 120_000);
});

describe("Stock: counts and adjustments, the reason required", () => {
  it("lists what is out, running low and to use soon; a count that differs needs a note; an adjustment needs a reason; a picker's limit and the reserved stock are the database's", async () => {
    const prod = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id as string;
    const src = r.source;
    const picker = await who("picker", "Pia"); const lead = await who("ops_lead", "Maya");
    await r.db.pg.query(`update stock_levels set on_hand = 3, reserved = 0, reorder_point = 10 where source_id = $1 and product_id = $2`, [src, prod]);
    let page = (await picker.b.get("/stock")).text;
    expect(page).toContain("Running low (1)"); expect(page).toContain("Leen Taanayel Labneh Premium"); expect(page).toContain("Out (");
    expect(page).toContain("More stock pages"); expect(page).toContain('href="/pick"');
    await r.db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where source_id = $1 and product_id = $2`, [src, prod]);
    page = (await picker.b.get("/stock")).text;
    expect(page).toMatch(/Out \(\d+\)<\/h2><ul class="ak-rows"><li><div class="head"><strong><bdi>[^<]*<\/bdi>/);
    await r.db.pg.query(`update stock_levels set on_hand = 8, reserved = 0, reorder_point = 0 where source_id = $1 and product_id = $2`, [src, prod]);
    // a count that matches needs no note; one that differs needs the person's words
    expect(flashOf((await picker.b.post(`/stock/${prod}/count`, { counted: 8, view: "needs", q: "" })).text)).toBe("Count saved: it matches the books.");
    expect(flashOf((await picker.b.post(`/stock/${prod}/count`, { counted: 5, note: "" })).text)).toMatch(/write why the count differs/);
    expect(Number((await r.db.one(`select on_hand from stock_levels where source_id = $1 and product_id = $2`, [src, prod])).on_hand)).toBe(8);
    expect(flashOf((await picker.b.post(`/stock/${prod}/count`, { counted: 5, note: "two were damaged in the box" })).text)).toMatch(/the books had 8, a difference of -3/);
    // an adjustment without a reason is not sent; Other needs a note; a good one is named
    expect(flashOf((await picker.b.post(`/stock/${prod}/adjust`, { delta: -1, reason: "" })).text)).toMatch(/Choose the reason first/);
    expect(flashOf((await picker.b.post(`/stock/${prod}/adjust`, { delta: -1, reason: "other", note: "" })).text)).toMatch(/Write a note/);
    expect(flashOf((await picker.b.post(`/stock/${prod}/adjust`, { delta: -1, reason: "damaged", note: "dropped" })).text)).toBe("Saved. On hand now 4.");
    const m = await r.db.one(`select adjust_reason, note, actor_id from stock_movements where product_id = $1 order by created_at desc limit 1`, [prod]);
    expect(m).toEqual({ adjust_reason: "damaged", note: "dropped", actor_id: picker.partyId });
    // the database's own rules, said in words: the picker's limit, and never below what is reserved
    await r.db.pg.query(`update stock_levels set on_hand = 100, reserved = 90 where source_id = $1 and product_id = $2`, [src, prod]);
    expect(flashOf((await picker.b.post(`/stock/${prod}/adjust`, { delta: 50, reason: "found" })).text)).toMatch(/Above the picker limit/);
    expect(flashOf((await lead.b.post(`/stock/${prod}/adjust`, { delta: -20, reason: "damaged", note: "flood" })).text)).toMatch(/less on the shelf than is reserved/);
    // it logs who did it; in Arabic; and a movement offers no Undo (it is a record, never edited)
    expect((await r.actions()).filter((a: any) => a.action === "stock_adjust" && a.phase === "intent").every((a: any) => !!a.party_id)).toBe(true);
    const ok = await picker.b.post(`/stock/${prod}/adjust`, { delta: 2, reason: "found" });
    expect(ok.text).not.toContain("ak-toast-undo");
    await picker.b.get("/lang?to=ar&next=/stock");
    expect((await picker.b.get("/stock")).text).toContain("صفحات مخزون أخرى");
  });
});
