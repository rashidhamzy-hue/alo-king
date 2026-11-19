// AST1: an invented day at Alo King for the console assistant's tests and its eval (evals/assistant/questions.json).
// Every figure the 20 founder questions expect comes from this seed. The day is Wednesday 18 November 2026; "now" is 15:00 in Beirut
// (13:00 UTC). All names, numbers and phones are invented (the personal-data guard checks them). Rows are written straight into the test
// database with triggers off (session_replication_role = replica): this is a fixture of what the tables hold, not a path the code takes.
import type { TestDb } from "../../test/db/harness";
import type { GithubRead, SentryRead } from "../../apps/console/src/assistant/tools";

export const NOW = new Date("2026-11-18T13:00:00Z");     // 15:00 Beirut
export const DAY = "2026-11-18";

const Z = (hm: string, day = DAY) => `${day}T${hm}:00Z`;   // a UTC time on the day (Beirut is UTC+2 in November)

export async function seedWorld(db: TestDb): Promise<{ ids: Record<string, string> }> {
  const q = (sql: string, p: unknown[] = []) => db.pg.query(sql, p);
  const one = async (sql: string, p: unknown[] = []) => (await db.pg.query<{ id: string }>(sql, p)).rows[0]!.id;
  await db.pg.exec("set session_replication_role = replica");
  try {
    const ids: Record<string, string> = {};
    // geography: one zone of 30 minutes, two villages (data, invented)
    const zone = await one(`insert into zones(name, delivery_fee_usd, base_eta_minutes, is_active) values ('AST zone', 2, 30, true) returning id`);
    const vA = await one(`insert into villages(zone_id, name_en, name_ar, is_served) values ($1, 'Kfar Test', 'كفر تست', true) returning id`, [zone]);
    const vB = await one(`insert into villages(zone_id, name_en, name_ar, is_served) values ($1, 'Ain Sample', 'عين سامبل', true) returning id`, [zone]);
    const hub = (await db.one<{ id: string }>(`select id from sources where kind = 'dark_store' order by id limit 1`)).id;

    // people
    const cust = async (name: string, phone: string, probe = false) => one(`insert into parties(role, display_name, contact_phone, is_probe) values ('customer', $1, $2, $3) returning id`, [name, phone, probe]);
    const c1 = await cust("Test Customer One", "+96170000711"), c2 = await cust("Test Customer Two", "+96170000712"), c3 = await cust("Test Customer Three", "+96170000713");
    const probe = await cust("Probe", "+96170000719", true);
    const rami = await one(`insert into parties(role, display_name) values ('driver', 'Rami Test') returning id`);
    const nadia = await one(`insert into parties(role, display_name) values ('driver', 'Nadia Test') returning id`);
    const staff = await one(`insert into parties(role, display_name) values ('ops_lead', 'Lead Test') returning id`);
    ids.rami = rami; ids.nadia = nadia; ids.staff = staff;
    const conv = async (p: string) => one(`insert into conversations(line, party_id) values ('customer', $1) returning id`, [p]);
    const cv1 = await conv(c1), cv2 = await conv(c2), cv3 = await conv(c3);

    // food places
    const grill = await one(`insert into sources(kind, name, village_id, buys_for_customer, visibility, prep_minutes, approved_at, closed_on, tier, listing_id) values ('merchant', 'Test Grill', $1, true, 'testers', 20, now(), $2, 'assisted', 'ast-test-grill') returning id`, [vA, DAY]);
    const cedar = await one(`insert into sources(kind, name, village_id, buys_for_customer, visibility, prep_minutes, approved_at, tier, listing_id) values ('merchant', 'Cedar Shawarma', $1, true, 'testers', 15, now(), 'assisted', 'ast-test-cedar') returning id`, [vB]);
    for (const name of ["Mixed grill plate", "Kafta sandwich"])
      await q(`insert into menu_dish_proposals(source_id, name_en, status, price_status, flags) values ($1, $2, 'waiting', 'to_confirm', '{}')`, [cedar, name]);

    // orders of the day (subtotal, fee 2): times are UTC
    type O = { code: string; c: string; cv: string; v: string; status: string; sub: number; at: string; conf?: string; ready?: string; out?: string; done?: string; cancel?: string; probe?: boolean };
    const orders: O[] = [
      { code: "AK-2001", c: c1, cv: cv1, v: vA, status: "closed", sub: 12.5, at: "06:58", conf: "07:00", ready: "07:08", out: "07:10", done: "07:25" },
      { code: "AK-2002", c: c2, cv: cv2, v: vA, status: "closed", sub: 20, at: "07:58", conf: "08:00", ready: "08:35", out: "08:38", done: "08:52" },
      { code: "AK-2003", c: c3, cv: cv3, v: vB, status: "delivered", sub: 8, at: "08:58", conf: "09:00", ready: "09:05", out: "09:40", done: "09:50" },
      { code: "AK-2004", c: c1, cv: cv1, v: vA, status: "closed", sub: 15, at: "09:58", conf: "10:00", ready: "10:40", out: "10:42", done: "10:55" },
      { code: "AK-2005", c: c2, cv: cv2, v: vB, status: "closed", sub: 9.5, at: "10:58", conf: "11:00", ready: "11:15", out: "11:17", done: "11:35" },
      { code: "AK-2006", c: c3, cv: cv3, v: vB, status: "out_for_delivery", sub: 30, at: "11:58", conf: "12:00", ready: "12:10", out: "12:15" },
      { code: "AK-2007", c: c1, cv: cv1, v: vA, status: "cancelled", sub: 7, at: "12:05", cancel: "customer_cancelled" },
      { code: "AK-2008", c: c2, cv: cv2, v: vA, status: "awaiting_confirmation", sub: 6, at: "12:50" },
      { code: "AK-2009", c: c3, cv: cv3, v: vA, status: "cancelled", sub: 11, at: "11:58", conf: "12:00", cancel: "place_closed" },
      { code: "PRB-77", c: probe, cv: cv1, v: vA, status: "closed", sub: 5, at: "05:58", conf: "06:00", ready: "06:05", out: "06:06", done: "06:20", probe: true },
    ];
    for (const o of orders) {
      const id = await one(`insert into orders(short_code, customer_id, conversation_id, status, village_id, subtotal_usd, delivery_fee_usd, payment_method, created_at, confirmed_at, delivered_at, cancel_reason)
        values ($1, $2, $3, $4, $5, $6, 2, 'cod', $7, $8, $9, $10) returning id`, [o.code, o.c, o.cv, o.status, o.v, o.sub, Z(o.at), o.conf ? Z(o.conf) : null, o.done ? Z(o.done) : null, o.cancel ?? null]);
      ids[o.code] = id;
      const ev = (to: string, at?: string) => at ? q(`insert into order_events(order_id, to_status, actor, created_at) values ($1, $2, 'system', $3)`, [id, to, Z(at)]) : null;
      await ev("confirmed", o.conf); await ev("ready", o.ready); await ev("out_for_delivery", o.out); await ev("delivered", o.done);
      if (o.status === "closed") await q(`insert into payments(order_id, method, status, amount_usd, received_usd, confirmed_at) values ($1, 'cod', 'confirmed', $2, $2, $3)`, [id, o.sub + 2, Z(o.done!)]);
    }
    // the call ahead: Test Grill answered AK-2004 after 22 minutes (ready in 15), refused AK-2009 (closed); Cedar answered AK-2005 after 4 (ready in 10)
    const call = (order: string, src: string, status: string, at: string, accepted: string | null, readyIn: number | null) =>
      one(`insert into place_calls(order_id, source_id, status, created_at, accepted_at, ready_in_min) values ($1, $2, $3, $4, $5, $6) returning id`, [ids[order], src, status, Z(at), accepted ? Z(accepted) : null, readyIn]);
    await call("AK-2004", grill, "accepted", "10:00", "10:22", 15);
    await call("AK-2005", cedar, "accepted", "11:00", "11:04", 10);
    const closedCall = await call("AK-2009", grill, "closed", "12:00", null, null);
    await q(`insert into place_call_log(call_id, action, at) values ($1, 'closed', $2)`, [closedCall, Z("12:09")]);

    // riders: Rami since 09:00 Beirut, holds 120 USD (soft cap 100, hard 150); Nadia since 13:00 Beirut, holds nothing
    const shiftR = await one(`insert into driver_shifts(driver_id, started_at) values ($1, $2) returning id`, [rami, Z("07:00")]);
    const shiftN = await one(`insert into driver_shifts(driver_id, started_at) values ($1, $2) returning id`, [nadia, Z("11:00")]);
    const deliver = async (driver: string, shift: string, code: string) => {
      const d = await one(`insert into deliveries(driver_id, shift_id, status, completed_at) values ($1, $2, 'completed', (select delivered_at from orders where id = $3)) returning id`, [driver, shift, ids[code]]);
      await q(`insert into delivery_stops(delivery_id, seq, kind, order_id, completed_at) values ($1, 1, 'dropoff', $2, (select delivered_at from orders where id = $2))`, [d, ids[code]]);
    };
    for (const code of ["AK-2001", "AK-2002", "AK-2003"]) await deliver(rami, shiftR, code);
    for (const code of ["AK-2004", "AK-2005"]) await deliver(nadia, shiftN, code);
    const dl = await one(`insert into deliveries(driver_id, shift_id, status) values ($1, $2, 'in_progress') returning id`, [rami, shiftR]);
    await q(`insert into delivery_stops(delivery_id, seq, kind, order_id) values ($1, 1, 'dropoff', $2)`, [dl, ids["AK-2006"]]);
    const acct = await one(`insert into ledger_accounts(code, kind, party_id) values ($1, 'driver_cash', $2) on conflict (code) do update set party_id = excluded.party_id returning id`, [`driver_cash:${rami}`, rami]);
    const other = await one(`insert into ledger_accounts(code, kind) values ('ast_test_offset', 'hub_cash') on conflict (code) do update set kind = excluded.kind returning id`);
    const txn = crypto.randomUUID();
    await q(`insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, created_at) values ($1, $2, 120, 'USD', 120, $4), ($1, $3, -120, 'USD', -120, $4)`, [txn, acct, other, Z("10:00")]);

    // stock: every item 50 on the shelf, then Tomato (AK-0002) none, Lemon (AK-0005) all reserved, Potato (AK-0001) 3 of a reorder point 5
    await q(`update stock_levels set on_hand = 50, reserved = 0, reorder_point = 5 where source_id = $1`, [hub]);
    await q(`update stock_levels sl set on_hand = x.h, reserved = x.r from (values ('AK-0002', 0, 0), ('AK-0005', 2, 2), ('AK-0001', 3, 0)) x(sku, h, r), products p
              where p.sku = x.sku and sl.product_id = p.id and sl.source_id = $1`, [hub]);
    const pid = async (sku: string) => (await db.one<{ id: string }>(`select id from products where sku = $1`, [sku])).id;
    await q(`insert into stock_lots(source_id, product_id, lot, expiry_date, qty_received, qty_left) values ($1, $2, 'L-77', '2026-11-19', 6, 6), ($1, $3, 'L-12', '2026-11-17', 4, 2)`, [hub, await pid("AK-0010"), await pid("AK-0011")]);
    const sup = await one(`insert into suppliers(name) values ('Test Supplier') returning id`);
    const po = await one(`insert into purchase_orders(number, supplier_id, source_id, expected_date, created_by, status) values ('PO-0901', $1, $2, '2026-11-17', $3, 'received') returning id`, [sup, hub, staff]);
    const pl = await one(`insert into purchase_order_lines(po_id, product_id, qty, position) values ($1, $2, 24, 1) returning id`, [po, await pid("AK-0020")]);
    await q(`insert into receiving_lines(po_id, po_line_id, product_id, ordered, counted, damaged, received, short, received_by, received_at) values ($1, $2, $3, 24, 20, 1, 19, 4, $4, $5)`, [po, pl, await pid("AK-0020"), staff, Z("08:00", "2026-11-17")]);
    // the fridge log: started on the 16th; the 17th's evening reading missed; today's morning reading 7.2 °C (out of 0 to 5)
    for (const [day, slot, c, at] of [["2026-11-16", "morning", 3.5, "07:00"], ["2026-11-16", "evening", 3.8, "15:00"], ["2026-11-17", "morning", 4.0, "07:10"], [DAY, "morning", 7.2, "07:05"]] as const)
      await q(`insert into temperature_readings(source_id, zone, reading_c, in_range, photo_path, slot_day, slot, taken_by, taken_at) values ($1, 'chilled', $2, $3, 'temperature/test.jpg', $4, $5, $6, $7)`,
        [hub, c, c >= 0 && c <= 5, day, slot, staff, Z(at, day)]);

    // what customers asked for: "protein bars" 3 times by 2 people found nothing; "oat milk" once; Zaatar w Zeit (not on Alo King) twice
    const ask = (kind: string, party: string, query: string, at: string, n: number) =>
      q(`insert into demand_signals(kind, origin, party_id, query, subject, dedupe_key, created_at) values ($1, 'chat', $2, $3, $3, $4, $5)`, [kind, party, query, `${kind}:${query}:${n}`, Z(at)]);
    await ask("unknown_product", c1, "protein bars", "08:10", 1); await ask("unknown_product", c1, "protein bars", "08:11", 2); await ask("unknown_product", c2, "protein bars", "09:30", 3);
    await ask("unknown_product", c3, "oat milk", "10:30", 4);
    await ask("unsigned_restaurant", c2, "zaatar w zeit", "11:30", 5); await ask("unsigned_restaurant", c3, "zaatar w zeit", "12:30", 6);

    // hand-offs, a complaint, feedback
    await q(`insert into handoffs(conversation_id, reason, kind, state, status, created_at, first_staff_reply_at, late, order_id) values ($1, 'asked_for_person', 'person_requested', 'resolved', 'resolved', $2, $3, false, null)`, [cv1, Z("08:20"), Z("08:24")]);
    await q(`insert into handoffs(conversation_id, reason, kind, state, status, created_at, late, order_id) values ($1, 'late_order', 'complaint', 'open', 'open', $2, true, $3)`, [cv2, Z("12:30"), ids["AK-2002"]]);
    await q(`insert into complaint_cases(order_id, kind, priority, detail, opened_by, opened_at, status) values ($1, 'late', 2, 'invented detail', $2, $3, 'open')`, [ids["AK-2002"], staff, Z("09:10")]);
    for (const [code, party, v] of [["AK-2001", c1, "fine"], ["AK-2004", c1, "fine"], ["AK-2002", c2, "problem"]] as const)
      await q(`insert into order_feedback(order_id, party_id, asked_at, verdict, answered_at) values ($1, $2, $3, $4, $3)`, [ids[code], party, Z("12:00"), v]);

    // approvals: one refund over the limit waits for a second person
    await q(`insert into pending_approvals(kind, ref, payload, summary, requested_by, status) values ('refund', $1, '{}', 'refund 15 USD', $2, 'pending')`, [ids["AK-2002"], staff]);

    // model spend this month, and yesterday's digest
    await q(`insert into model_costs(workflow, run_id, model, step, day, calls, usd, cap_usd) values ('menu-read', 'r1', 'claude-haiku-5-5', '', '2026-11-18', 3, 0.0086, 2),
              ('sim-test', 'r2', 'claude-sonnet-5-5', 'judge', '2026-11-12', 40, 0.4, 2), ('assistant', '2026-11-17', 'claude-sonnet-5-5', 'answer', '2026-11-17', 6, 0.12, 0.5)`);
    await q(`insert into assistant_digests(day, facts, text_en, text_ar, model) values ('2026-11-17', $1, $2, $3, 'claude-haiku-5-5')`, [
      JSON.stringify({ day: "2026-11-17", orders: { orders: 11, late_total: 3, delivered: 10 }, fix_candidates: [{ what: "late orders", count: 3, page: "/orders" }] }),
      "Went well: 10 of 11 orders delivered.\nWent wrong: 3 orders were late.\nTop 3 to fix:\n1. Late orders: 3 [Orders](/orders)",
      "سار جيداً: سُلّم 10 من 11 طلباً.\nما لم يسر جيداً: تأخر 3 طلبات.\nأهم 3 للإصلاح:\n1. الطلبات المتأخرة: 3 [الطلبات](/orders)"]);
    return { ids };
  } finally {
    await db.pg.exec("set session_replication_role = origin");
  }
}

/** Sentry and GitHub as they answer in the scenario (invented). */
export const fakeSentry = async (): Promise<SentryRead> => ({ count: 3, link: "https://alo-king.sentry.io/issues/?statsPeriod=24h", issues: [{ title: "TypeError: cannot read the pick list", events: 3, last_seen: "2026-11-18T12:40" }] });
export const fakeGithub = async (): Promise<GithubRead> => ({ link: "https://github.com/example/actions", failed: [{ workflow: "deploy-staging", branch: "main", started: "2026-11-18T09:12", url: "https://github.com/example/actions/runs/1" }] });
