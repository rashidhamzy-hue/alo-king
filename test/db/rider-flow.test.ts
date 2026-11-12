import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
let hub: string, village: string, outer: string, ops: string;
const FX = 89500;

async function party(role: string, name: string) { return (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string; }

async function customer(n: number, v = village) {
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-${n}`, p_phone: `+9617000000${n}`, p_name: `Customer ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: v });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id as string;
  return { party: t.party_id as string, conv: t.conversation_id as string, place, village: v };
}

async function order(c: Awaited<ReturnType<typeof customer>>, qty = 2, payment = "cod") {
  const lines = await db.all(`select p.id as product_id, $1::int as qty, 'لبنة' as raw from products p where name_en = 'Leen Taanayel Labneh Premium'`, [qty * 8]);
  const o = await db.rpc("create_order_from_quote", { p_customer: c.party, p_conversation: c.conv, p_lines: lines, p_village: c.village,
    p_place: c.place, p_pickup: false, p_payment: payment, p_change_for: null, p_notes: null });
  expect(o.created, JSON.stringify(o)).toBe(true);
  const r = await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: c.party, p_wamid: "wamid." + o.short_code });
  expect(r.changed, JSON.stringify(r)).toBe(true);
  return { id: o.order_id as string, total: Number((await db.one(`select total_usd from orders where id = $1`, [o.order_id])).total_usd) };
}
const status = async (id: string) => (await db.one(`select status from orders where id = $1`, [id])).status as string;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`
    insert into fx_rates(lbp_per_usd) values (${FX});
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  outer = (await db.one(`select v.id from villages v join zones z on z.id = v.zone_id where z.name = 'outer' limit 1`)).id;
  hub = (await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [village])).id;
  ops = await party("ops_lead", "Ops");
}, 120_000);

describe("rider flow on the real schema", () => {
  let rami: string, ziad: string;

  it("offers the job to a rider on shift, and a lost Arrived tap does not block Delivered", async () => {
    rami = await party("driver", "Rami");
    const c = await customer(1);
    const o = await order(c);
    expect((await db.rpc("dispatch_order", { p_order: o.id })).status).toBe("no_rider");
    await db.rpc("start_shift", { p_driver: rami });
    const d = await db.rpc("dispatch_order", { p_order: o.id });
    expect(d).toMatchObject({ status: "offered", driver_id: rami });
    expect((await db.rpc("dispatch_order", { p_order: o.id })).status).toBe("already");

    const job = await db.rpc("rider_job", { p_delivery: d.delivery_id });
    expect(job.stops.map((s: any) => s.kind)).toEqual(["pickup", "dropoff"]);
    expect(Number(job.collect_usd)).toBeCloseTo(o.total, 2);

    expect((await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rami, p_accept: true })).status).toBe("accepted");
    expect((await db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rami })).pickups_left).toBe(0);
    expect(await status(o.id)).toBe("out_for_delivery");

    const del = await db.rpc("rider_delivered", { p_order: o.id, p_driver: rami });
    expect(del).toMatchObject({ ok: true, paid: false, needs_cash: true });
    expect(await status(o.id)).toBe("delivered");
    const inferred = await db.all(`select to_status from order_events where order_id = $1 and reason like 'inferred_from:%'`, [o.id]);
    expect(inferred.map((e: any) => e.to_status)).toContain("arrived");
    // delivered is a logistics fact: no money has been posted yet
    expect((await db.one(`select count(*)::int as n from payments where order_id = $1`, [o.id])).n).toBe(0);
    expect(Number(await db.rpc("driver_cash_usd", { p_driver: rami }))).toBe(0);
  });

  it("posts cash per currency, once, and only for the assigned rider", async () => {
    const o = await db.one(`select id, total_usd from orders where status = 'delivered' limit 1`);
    const total = Number(o.total_usd);
    const stranger = await party("driver", "Stranger");
    await expect(db.rpc("rider_collect", { p_order: o.id, p_driver: stranger, p_usd: total, p_lbp: 0 })).rejects.toThrow(/NOT_YOUR_ORDER/);
    await expect(db.rpc("rider_collect", { p_order: o.id, p_driver: rami, p_usd: -5, p_lbp: 0 })).rejects.toThrow(/NEGATIVE_AMOUNT/);
    await expect(db.rpc("rider_collect", { p_order: o.id, p_driver: rami, p_usd: 1, p_lbp: 0 })).rejects.toThrow(/AMOUNT_MISMATCH/);

    // customer pays $20 note + the rest in lira; rider gives change in lira
    const usd = 5, lbp = Math.round(((total - usd) * FX) / 1000) * 1000;
    const r = await db.rpc("rider_collect", { p_order: o.id, p_driver: rami, p_usd: usd, p_lbp: lbp });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    expect(Number(r.usd)).toBe(usd); expect(Number(r.lbp)).toBe(lbp);
    expect(await status(o.id)).toBe("closed");
    const again = await db.rpc("rider_collect", { p_order: o.id, p_driver: rami, p_usd: usd, p_lbp: lbp });
    expect(again.duplicate).toBe(true);
    // a tap that shows up after everything is finished is logged and harmless
    expect((await db.rpc("rider_arrived", { p_order: o.id, p_driver: rami })).status).toBe("closed");
    // the delivery fee is the rider's, not ours: revenue nets to zero and the rider's statement shows it
    const fee = Number((await db.one(`select delivery_fee_usd from orders where id = $1`, [o.id])).delivery_fee_usd);
    const st = await db.rpc("rider_statement", { p_driver: rami });
    expect(Number(st.earnings_usd)).toBe(fee);
    expect(Number(st.to_hand_over_usd)).toBeCloseTo(Number(st.cash_held_usd) - fee, 2);
    expect(Number((await db.one(`select coalesce(sum(e.usd_equiv),0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'revenue_delivery'`)).s)).toBe(0);
    const paid = await db.rpc("pay_rider_earnings", { p_driver: rami, p_by: ops });
    expect(Number(paid.kept_from_cash_usd)).toBe(fee);
    expect(Number((await db.rpc("rider_statement", { p_driver: rami })).earnings_usd)).toBe(0);
    expect(Number((await db.one(`select coalesce(sum(usd_equiv),0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
  });

  it("counts cash in hand plus COD already assigned against the cap, and a confirmed drop frees the rider", async () => {
    const held = Number(await db.rpc("driver_cash_usd", { p_driver: rami }));
    await db.pg.exec(`update settings set value = '{"soft_usd": ${held + 3}, "hard_usd": ${held + 5}}' where key = 'cash_cap'`);
    const o = await order(await customer(2), 3);
    expect(o.total).toBeGreaterThan(5);
    expect((await db.rpc("dispatch_order", { p_order: o.id })).status).toBe("no_rider");

    const native = await db.one(`select * from driver_cash_native($1)`, [rami]);
    const drop = await db.rpc("declare_cash_drop", { p_driver: rami, p_method: "hub", p_usd: native.usd, p_lbp: native.lbp, p_receipt_ref: null });
    await db.rpc("confirm_cash_drop", { p_drop: drop, p_by: ops });
    expect(Number(await db.rpc("driver_cash_usd", { p_driver: rami }))).toBe(0);
    await db.pg.exec(`update settings set value = '{"soft_usd": 150, "hard_usd": 200}' where key = 'cash_cap'`);
    expect((await db.rpc("dispatch_order", { p_order: o.id })).status).toBe("offered");
  });

  it("expires an unanswered offer and moves it to the next rider, never back to the one who ignored it", async () => {
    const d = await db.one(`select id from deliveries where status = 'offered'`);
    const oid = (await db.one(`select order_id from delivery_stops where delivery_id = $1 and kind = 'dropoff'`, [d.id])).order_id;
    await db.pg.exec(`update deliveries set offered_at = now() - interval '5 minutes' where id = '${d.id}'`);
    const t = await db.rpc("run_timers");
    expect(t.expired_offers.map((x: any) => x.delivery_id)).toContain(d.id);
    expect((await db.rpc("rider_respond", { p_delivery: d.id, p_driver: rami, p_accept: true })).ok).toBe(false);
    expect((await db.rpc("dispatch_order", { p_order: oid })).status).toBe("no_rider");
    ziad = await party("driver", "Ziad");
    await db.rpc("start_shift", { p_driver: ziad });
    const again = await db.rpc("dispatch_order", { p_order: oid });
    expect(again).toMatchObject({ status: "offered", driver_id: ziad });
    // picking up without tapping Accept counts as accepting
    await db.rpc("rider_picked_up", { p_delivery: again.delivery_id, p_driver: ziad });
    expect(await status(oid)).toBe("out_for_delivery");
  });

  it("refuses no-answer before the wait is up, then fails the order and carries the fee to the next one", async () => {
    const s = await db.one(`select s.id, s.order_id, o.customer_id, o.delivery_fee_usd from delivery_stops s join orders o on o.id = s.order_id join deliveries d on d.id = s.delivery_id
                             where o.status = 'out_for_delivery' and s.kind = 'dropoff' and d.status = 'in_progress'`);
    await db.rpc("rider_arrived", { p_order: s.order_id, p_driver: ziad });
    const early = await db.rpc("rider_no_answer", { p_order: s.order_id, p_driver: ziad });
    expect(early.ok).toBe(false); expect(early.wait_more_min).toBeGreaterThan(0);
    await db.pg.exec(`update delivery_stops set arrived_at = now() - interval '9 minutes' where id = '${s.id}'`);
    const failed = await db.rpc("rider_no_answer", { p_order: s.order_id, p_driver: ziad });
    expect(failed).toMatchObject({ ok: true, status: "failed_delivery", return_to_hub: true });
    expect(Number(failed.customer_owes_usd)).toBe(Number(s.delivery_fee_usd));
    expect(await db.rpc("customer_requires_prepay", { p_customer: s.customer_id })).toBe(true);
    expect(Number((await db.one(`select coalesce(sum(usd_equiv),0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
  });

  it("receives the goods back: shelf-stable items restocked, chilled items written off unless the picker clears them", async () => {
    const o = await db.one(`select id from orders where status = 'failed_delivery'`);
    const item = await db.one(`select i.product_id, i.qty, sl.on_hand from order_items i join stock_levels sl on sl.product_id = i.product_id where i.order_id = $1`, [o.id]);
    expect((await db.rpc("returns_pending")).map((x: any) => x.order_id)).toContain(o.id);
    await expect(db.rpc("receive_return", { p_order: o.id, p_by: ziad })).rejects.toThrow(/NOT_AUTHORISED/);
    // labneh is chilled: by default none of it goes back on the shelf; the picker clears 10 of the tubs as cold and sealed
    const r = await db.rpc("receive_return", { p_order: o.id, p_by: ops, p_restock: { [item.product_id]: 10 } });
    expect(r).toMatchObject({ ok: true, restocked_units: 10, wasted_units: Number(item.qty) - 10 });
    expect(Number((await db.one(`select on_hand from stock_levels where product_id = $1`, [item.product_id])).on_hand)).toBe(Number(item.on_hand) + 10);
    expect(await status(o.id)).toBe("closed");
    expect((await db.rpc("receive_return", { p_order: o.id, p_by: ops })).already).toBe(true);
    expect((await db.rpc("returns_pending")).length).toBe(0);
  });

  it("batches two hub orders for neighbouring doors into one job", async () => {
    const a = await order(await customer(3)); const b = await order(await customer(4));
    const d = await db.rpc("dispatch_order", { p_order: a.id });
    expect(d.status).toBe("offered");
    expect(d.orders).toEqual(expect.arrayContaining([a.id, b.id]));
    await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: d.driver_id, p_accept: false });
  });

  it("confirms a transfer only with a reference, only by ops, and never the same reference twice", async () => {
    const c = await customer(5);
    const o1 = await order(c, 1, "whish");
    expect(await status(o1.id)).toBe("awaiting_payment");
    await expect(db.rpc("confirm_payment", { p_order: o1.id, p_by: rami, p_external_ref: "WH-778812", p_amount_usd: o1.total })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("confirm_payment", { p_order: o1.id, p_by: ops, p_external_ref: "WH-778812", p_amount_usd: o1.total - 2 })).rejects.toThrow(/UNDERPAID/);
    expect((await db.rpc("confirm_payment", { p_order: o1.id, p_by: ops, p_external_ref: "WH-778812", p_amount_usd: o1.total })).status).toBe("confirmed");
    expect(await status(o1.id)).toBe("confirmed");
    const o2 = await order(await customer(6), 1, "whish");
    await expect(db.rpc("confirm_payment", { p_order: o2.id, p_by: ops, p_external_ref: "WH-778812", p_amount_usd: o2.total })).rejects.toThrow(/REFERENCE_ALREADY_USED/);
  });

  it("closes a shift: a few cents write themselves off, real money goes to review", async () => {
    const r = await db.rpc("close_shift", { p_driver: rami });
    expect(r, JSON.stringify(r)).toBeTruthy();
    expect((await db.one(`select ended_at from driver_shifts where driver_id = $1`, [rami])).ended_at).not.toBeNull();
  });
});

describe("reliability and learning", () => {
  it("a turn runs once; a retry is recognised; a finished turn is never re-run", async () => {
    expect(await db.rpc("begin_turn", { p_key: "t:wamid.A+wamid.B", p_line: "customer" })).toBe("run");
    expect(await db.rpc("begin_turn", { p_key: "t:wamid.A+wamid.B", p_line: "customer" })).toBe("retry");
    await db.rpc("finish_turn", { p_key: "t:wamid.A+wamid.B" });
    expect(await db.rpc("begin_turn", { p_key: "t:wamid.A+wamid.B", p_line: "customer" })).toBe("done");
  });

  it("an outbound message is sent once even if the turn is retried after a crash", async () => {
    const args = { p_key: "t:wamid.A:0", p_line: "customer", p_party: null, p_payload: { type: "text", text: "hi" } };
    expect(await db.rpc("outbox_claim", args)).toBe(true);
    expect(await db.rpc("outbox_claim", args)).toBe(false);         // another attempt holds it and may still be sending
    await db.pg.exec(`update wa_outbox set claimed_at = now() - interval '2 minutes' where dedupe_key = 't:wamid.A:0'`);
    expect(await db.rpc("outbox_claim", args)).toBe(true);          // the holder died: the lease is taken over
    await db.rpc("outbox_mark", { p_key: "t:wamid.A:0", p_wamid: null, p_error: "http_500" });
    expect(await db.rpc("outbox_claim", args)).toBe(true);          // a send that failed outright can be retried at once
    await db.rpc("outbox_mark", { p_key: "t:wamid.A:0", p_wamid: "wamid.out1" });
    expect(await db.rpc("outbox_claim", args)).toBe(false);
  });

  it("keeps a turn it gave up on in the exception queue until a person closes it", async () => {
    for (let i = 0; i < 4; i++) await db.rpc("begin_turn", { p_key: "t:wamid.Z", p_line: "customer" });
    expect(await db.rpc("begin_turn", { p_key: "t:wamid.Z", p_line: "customer" })).toBe("give_up");
    const due = await db.all(`select id, kind, ref from ops_exceptions_due()`);
    expect(due).toMatchObject([{ kind: "turn_failed", ref: "t:wamid.Z" }]);
    expect((await db.all(`select 1 from ops_exceptions_due()`)).length).toBe(0);       // alerted, quiet for ten minutes
    expect((await db.one(`select count(*)::int as n from ops_exceptions where status = 'open'`)).n).toBe(1);   // but still open
    await db.rpc("resolve_ops_exception", { p_id: due[0].id, p_by: ops });
    expect((await db.one(`select count(*)::int as n from ops_exceptions where status = 'open'`)).n).toBe(0);
  });

  it("refuses every marketing send while the switch is off, even to a customer who opted in", async () => {
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-mk", p_phone: "+96170000077", p_name: "Opted In" });
    await db.pg.exec(`insert into consent_events(party_id, line, kind, action, source) values ('${t.party_id}', 'customer', 'marketing', 'opt_in', 'marketing_button')`);
    expect(await db.rpc("can_send", { p_party: t.party_id, p_line: "customer", p_category: "marketing", p_is_template: true })).toBe("marketing_disabled");
    expect(await db.rpc("can_send", { p_party: t.party_id, p_line: "customer", p_category: "service", p_is_template: false })).toBe("ok");
    // The pilot lock: the switch cannot be turned on by a settings write, whatever shape the write takes.
    await expect(db.pg.exec(`update settings set value = '{"enabled": true}' where key = 'marketing'`)).rejects.toThrow(/MARKETING_LOCKED/);
    await expect(db.pg.exec(`update settings set value = '{"enabled": "true"}' where key = 'marketing'`)).rejects.toThrow(/MARKETING_LOCKED/);
    await expect(db.pg.exec(`insert into settings(key, value) values ('marketing', '{"enabled": true}') on conflict (key) do update set value = excluded.value`)).rejects.toThrow(/MARKETING_LOCKED/);
    // Deleting the row does not open the door either.
    await db.pg.exec(`delete from settings where key = 'marketing'`);
    expect(await db.rpc("can_send", { p_party: t.party_id, p_line: "customer", p_category: "marketing", p_is_template: true })).toBe("marketing_disabled");
    await db.pg.exec(`insert into settings(key, value) values ('marketing', '{"enabled": false}')`);
    // Replies and order updates still go out.
    expect(await db.rpc("can_send", { p_party: t.party_id, p_line: "customer", p_category: "service", p_is_template: false })).toBe("ok");
  });

  it("finds webhook events that were stored but never processed", async () => {
    await db.pg.exec(`insert into wa_inbound_events(idempotency_key, line, event, payload, received_at)
                      values ('k-lost', 'customer', 'whatsapp.message.received', '{}', now() - interval '2 minutes'),
                             ('k-fresh', 'customer', 'whatsapp.message.received', '{}', now())`);
    const stale = await db.all(`select idempotency_key from stale_inbound_events(45, 10)`);
    expect(stale.map((r: any) => r.idempotency_key)).toEqual(["k-lost"]);
    await db.rpc("mark_inbound_processed", { p_key: "k-lost" });
    expect((await db.all(`select 1 from stale_inbound_events(45, 10)`)).length).toBe(0);
  });

  it("sends the customer a fresh card when the price moved between the card and the tap", async () => {
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-90", p_phone: "+96170000090", p_name: "Nada" });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
    const prod = await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`);
    const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: prod.id, qty: 10 }],
      p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.pg.exec(`update offers set price_usd = price_usd + 0.5 where product_id = '${prod.id}'`);
    const r = await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: "w" });
    expect(r.status).toBe("stale_quote"); expect(r.issues[0].issue).toBe("price_changed");
    expect(await status(o.order_id)).toBe("draft");
    await db.pg.exec(`update offers set price_usd = price_usd - 0.5 where product_id = '${prod.id}'`);
  });

  it("learns a customer's usuals and their words from delivered orders, and promotes an alias after enough evidence", async () => {
    const closed = await db.one(`select id, customer_id from orders where status = 'closed' limit 1`);
    expect((await db.rpc("learn_from_order", { p_order: closed.id })).learned).toBe(true);
    expect((await db.rpc("learn_from_order", { p_order: closed.id })).already).toBe(true);
    const ctx = await db.rpc("customer_context", { p_party: closed.customer_id });
    expect(ctx.usuals.length).toBe(1); expect(ctx.orders).toBe(1);
    expect((await db.rpc("repeat_order_lines", { p_party: closed.customer_id })).length).toBe(1);

    const prod = (await db.one(`select product_id from order_items where order_id = $1`, [closed.id])).product_id;
    await db.pg.exec(`insert into alias_candidates(alias_folded, product_id, alias, hits, customers)
      values (fold_text('لبنة الضيعة'), '${prod}', 'لبنة الضيعة', 2, array[gen_random_uuid()])`);
    await db.pg.exec(`update order_items set raw_phrase = 'لبنة الضيعة' where order_id = '${closed.id}';
                      delete from order_events where order_id = '${closed.id}' and reason = 'learned'`);
    expect((await db.rpc("learn_from_order", { p_order: closed.id })).aliases_promoted).toBe(1);
    expect((await db.rpc("search_catalog", { p_query: "لبنة الضيعة" })).matches[0].product_id).toBe(prod);
  });

  it("applies an approved menu import: new dishes, new prices, and missing dishes switched off", async () => {
    const src = (await db.one(`insert into sources(kind, name, commission_pct, village_id) values ('merchant', 'Snack Abu Ali', 8, $1) returning id`, [village])).id;
    const imp = async (items: unknown[]) => (await db.one(
      `insert into merchant_menu_imports(source_id, source_url, extracted, status) values ($1, 'https://menu.example/abu-ali', $2, 'pending') returning id`,
      [src, { items }])).id;
    // an unsigned restaurant cannot be opened, by anyone, by any route
    await db.pg.exec(`update sources set is_open = true where id = '${src}'`);
    expect((await db.one(`select is_open from sources where id = $1`, [src])).is_open).toBe(false);
    await expect(db.rpc("approve_merchant", { p_source: src, p_by: ops, p_commission_pct: 8 })).rejects.toThrow(/NO_APPROVED_MENU/);
    const first = await db.rpc("apply_menu_import", { p_import: await imp([{ name_en: "Taouk Sandwich", name_ar: "طاووق", price: 4, currency: "USD" }, { name_en: null, name_ar: "برغر", price: 537000, currency: "LBP" }]), p_by: ops });
    expect(first).toMatchObject({ new: 2, updated: 0 });
    const second = await db.rpc("apply_menu_import", { p_import: await imp([{ name_en: "Taouk Sandwich", name_ar: "طاووق", price: 4.5, currency: "USD" }]), p_by: ops });
    expect(second).toMatchObject({ new: 0, updated: 1, switched_off: 1 });
    await expect(db.rpc("approve_merchant", { p_source: src, p_by: ops, p_commission_pct: 0 })).rejects.toThrow(/COMMISSION_REQUIRED/);
    expect(await db.rpc("approve_merchant", { p_source: src, p_by: ops, p_commission_pct: 8 })).toMatchObject({ ok: true, items: 1 });
    expect((await db.one(`select is_open from sources where id = $1`, [src])).is_open).toBe(true);
    expect((await db.rpc("search_catalog", { p_query: "طاووق", p_source_hint: "Snack Abu Ali" })).matches[0].price_usd).toBe(4.5);
  });
});

describe("outbox claim on the real schema", () => {
  it("lets exactly one of two concurrent claims through, and none once sent", async () => {
    const db = await openTestDb();
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-ob", p_phone: "+96170000055", p_name: "Outbox" });
    const args = { p_key: "k-conc", p_line: "customer", p_party: t.party_id, p_payload: { type: "text" } };
    const [a, b] = await Promise.all([db.rpc("outbox_claim", args), db.rpc("outbox_claim", args)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    await db.rpc("outbox_mark", { p_key: "k-conc", p_wamid: "w1", p_error: null });
    expect(await db.rpc("outbox_claim", args)).toBe(false);
  });
  it("holds the lease even when the outbox setting is missing, and releases a failed send for retry", async () => {
    const db = await openTestDb();
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-ob2", p_phone: "+96170000056", p_name: "Outbox" });
    await db.pg.exec(`delete from settings where key = 'outbox'`);
    const args = { p_key: "k-lease", p_line: "customer", p_party: t.party_id, p_payload: { type: "text" } };
    expect(await db.rpc("outbox_claim", args)).toBe(true);
    expect(await db.rpc("outbox_claim", args)).toBe(false);
    await db.rpc("outbox_mark", { p_key: "k-lease", p_wamid: null, p_error: "provider 500" });
    expect(await db.rpc("outbox_claim", args)).toBe(true);
  });
  it("forces marketing off even if an older database had it on", async () => {
    const db = await openTestDb();
    await db.pg.exec(`drop trigger settings_marketing_lock on settings; update settings set value = '{"enabled": true}' where key = 'marketing'`);
    const { readFileSync } = await import("node:fs");
    await db.pg.exec(readFileSync(new URL("../../supabase/migrations/0012_pilot_locks.sql", import.meta.url), "utf8"));
    expect((await db.one(`select value->>'enabled' as e from settings where key = 'marketing'`)).e).toBe("false");
  });
});
