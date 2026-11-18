// CFG1 (settings and small rules from the design review, 17 November 2026), migrations 0222 and 0223. Each rule has its test here,
// written before the migration:
//   1. one reminder for an unconfirmed order card, at settings.timers.confirm_reminder_min (20), once, a utility message inside the
//      24-hour window only; STOP and can_send() hold
//   2. reopen a lapsed order: a new order from the same basket at today's prices and stock, linked (orders.reopened_from); cancelled
//      stays final
//   3. every pickup order needs the handover code; pickup stays off in settings
//   4. settings.approvals refund_usd 10, price_change_pct 10; a change to the LBP rate needs a second person
//   5. settings.cash_cap soft 100, hard 150
//   6. the inbox escalation timers are a setting (settings.support: lead 3, founder 5, late 15), read by case_timers_due
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { send as gatewaySend } from "@ak/wa/gateway";
import { sendNotice } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { collect, deliverToDoor, openHub, placeOrder, total, type Hub } from "./hub-kit";
import { supabaseOver } from "./supabase-shim";

let h: Hub; let COFFEE: string; let n = 0;
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541" };
let sent: any[];
beforeEach(() => { sent = []; vi.stubGlobal("fetch", vi.fn(async (_u: string, i: RequestInit) => { sent.push(JSON.parse(String(i.body))); return new Response(JSON.stringify({ messages: [{ id: `wamid.c${Math.random()}` }] }), { status: 200, headers: { "content-type": "application/json" } }); })); });
afterEach(() => vi.unstubAllGlobals());
const deps = (): TurnDeps => { const { client } = supabaseOver(h.db); return { db: client, model: {} as never, modelName: "x", send: (r) => gatewaySend(client, env, r) } as TurnDeps; };

beforeAll(async () => { h = await openHub(); COFFEE = await h.product("Najjar Cafe Classic Normal 180G"); }, 120_000);

/** A customer with a card waiting for the tap: the order is awaiting_confirmation and its card went out `minsAgo` minutes ago. */
async function card(opts: { minsAgo?: number; windowOpen?: boolean; pickup?: boolean; payment?: "cod" | "whish"; qty?: number } = {}) {
  const { db } = h;
  const k = ++n;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-cfg1-${k}`, p_phone: `+9617100${String(k).padStart(4, "0")}`, p_name: `Cfg ${k}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source) values ($1, 'customer', 'transactional', 'opt_in', 'first_order_button')`, [t.party_id]);
  await db.pg.query(`update conversations set last_inbound_at = $2 where id = $1`,
    [t.conversation_id, opts.windowOpen === false ? new Date(Date.now() - 30 * 3600_000).toISOString() : new Date().toISOString()]);
  const place = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: COFFEE, qty: opts.qty ?? 2 }],
    p_village: h.village, p_place: place, p_pickup: !!opts.pickup, p_payment: opts.payment ?? "cod", p_change_for: null, p_notes: null });
  if (!o.created) throw new Error("not created: " + JSON.stringify(o.quote.issues));
  const mins = opts.minsAgo ?? 0;
  if (mins) await db.pg.query(`update order_events set created_at = now() - make_interval(mins => $2) where order_id = $1`, [o.order_id, mins]);
  return { party: t.party_id as string, conversation: t.conversation_id as string, orderId: o.order_id as string, code: o.short_code as string };
}
const due = async () => (await h.db.rpc("customer_notices_due")) as any[];
const reminderFor = async (orderId: string) => (await due()).find((x) => x.kind === "confirm_reminder" && x.order_id === orderId);
const tick = async () => { for (const x of await due()) await sendNotice(deps(), x); };

describe("1. one reminder for an unconfirmed order card", () => {
  it("is a setting: settings.timers.confirm_reminder_min is 20", async () => {
    expect(Number((await h.db.one(`select setting('timers')->>'confirm_reminder_min' as m`)).m)).toBe(20);
  });

  it("is due at 20 minutes, not before; about the customer's own order, in their language", async () => {
    const early = await card({ minsAgo: 19 });
    const late = await card({ minsAgo: 21 });
    expect(await reminderFor(early.orderId)).toBeUndefined();
    expect(await reminderFor(late.orderId)).toMatchObject({ kind: "confirm_reminder", customer_id: late.party, short_code: late.code,
      key: `notice:confirm_reminder:${late.orderId}`, params: [late.code], template: null });
  });

  it("follows the setting", async () => {
    const c = await card({ minsAgo: 21 });
    await h.db.pg.exec(`update settings set value = value || '{"confirm_reminder_min": 30}' where key = 'timers'`);
    expect(await reminderFor(c.orderId)).toBeUndefined();
    await h.db.pg.exec(`update settings set value = value || '{"confirm_reminder_min": 20}' where key = 'timers'`);
    expect(await reminderFor(c.orderId)).toBeDefined();
  });

  it("is not due once the customer has confirmed, edited back to a draft, or cancelled", async () => {
    const a = await card({ minsAgo: 25 }); const b = await card({ minsAgo: 25 }); const c = await card({ minsAgo: 25 });
    await h.db.rpc("handle_order_button", { p_order: a.orderId, p_action: "confirm", p_party: a.party, p_wamid: "wamid.cfg1.a" }).catch(() =>
      h.db.rpc("confirm_order_checked", { p_order: a.orderId, p_party: a.party, p_wamid: "wamid.cfg1.a" }));
    await h.db.rpc("handle_order_button", { p_order: b.orderId, p_action: "edit", p_party: b.party });
    await h.db.rpc("handle_order_button", { p_order: c.orderId, p_action: "cancel", p_party: c.party });
    for (const x of [a, b, c]) expect(await reminderFor(x.orderId)).toBeUndefined();
  });

  it("is sent once, as one free message inside the 24-hour window, in the same chat; never a second one", async () => {
    const c = await card({ minsAgo: 21 });
    await tick(); await tick(); await tick();
    const mine = sent.filter((m) => m.type === "text" && String(m.text?.body).includes(c.code));
    expect(mine).toHaveLength(1);
    expect(mine[0].text.body).toBe(ar.notice.confirmReminder(c.code));
    expect((await h.db.one(`select outcome from customer_notices where key = $1`, [`notice:confirm_reminder:${c.orderId}`])).outcome).toBe("sent:text");
    expect(await reminderFor(c.orderId)).toBeUndefined();
    // the order's own count of code-started messages includes it (CX1's budget of four)
    expect((await h.db.rpc("order_message_count", { p_order: c.orderId })).sent).toBe(1);
  });

  it("outside the 24-hour window nothing is sent (no template exists for it) and the skip is recorded, once", async () => {
    const c = await card({ minsAgo: 21, windowOpen: false });
    await tick(); await tick();
    expect(sent.filter((m) => String(m.text?.body ?? "").includes(c.code))).toHaveLength(0);
    expect(sent.filter((m) => m.type === "template" && JSON.stringify(m).includes(c.code))).toHaveLength(0);
    expect((await h.db.one(`select outcome from customer_notices where key = $1`, [`notice:confirm_reminder:${c.orderId}`])).outcome).toBe("refused:window_closed_use_template");
    expect(await h.db.one(`select trace->>'event' as e from agent_runs where trace->>'reason' = 'template_not_utility' and order_id = $1`, [c.orderId])).toEqual({ e: "confirm_reminder" });
  });

  it("STOP holds: a customer who said STOP gets nothing, and it is not retried", async () => {
    const c = await card({ minsAgo: 21 });
    await h.db.pg.query(`insert into consent_events(party_id, line, kind, action, source) values ($1, 'customer', 'transactional', 'opt_out', 'stop_word')`, [c.party]);
    await tick(); await tick();
    expect(sent.filter((m) => String(m.text?.body ?? "").includes(c.code))).toHaveLength(0);
    expect((await h.db.one(`select outcome from customer_notices where key = $1`, [`notice:confirm_reminder:${c.orderId}`])).outcome).toMatch(/^refused:/);
  });

  it("every language has its line", async () => {
    const { messages } = await import("@ak/agents/messages");
    for (const lang of ["ar", "en", "fr"] as const) expect(messages(lang).notice.confirmReminder("AK-9")).toContain("AK-9");
  });
});

describe("2. the lapsed-order notice", () => {
  it("carries the Reopen button inside the window (the tap itself is tested in cfg1-reopen.test.ts); a customer's own cancel gets no notice", async () => {
    const lapsed = await card({ minsAgo: 90 });
    await h.db.pg.query(`update orders set created_at = now() - interval '2 hours' where id = $1`, [lapsed.orderId]);
    await h.db.rpc("run_timers");
    const own = await card();
    await h.db.rpc("handle_order_button", { p_order: own.orderId, p_action: "cancel", p_party: own.party });
    await tick();
    const mine = sent.filter((m) => m.type === "interactive" && JSON.stringify(m).includes(lapsed.code));
    expect(mine).toHaveLength(1);
    expect(mine[0].interactive.body.text).toBe(ar.notice.orderCancelled(lapsed.code, "ما تأكّد الطلب بالوقت المحدد", true));
    expect(mine[0].interactive.action.buttons[0].reply).toEqual({ id: `order:reopen:${lapsed.orderId}`, title: ar.cx.reopenButton });
    expect(sent.filter((m) => JSON.stringify(m).includes(own.code))).toHaveLength(0);
  });
});

describe("2b. the Reopen button with the cancel template approved (QA1)", () => {
  // QA1, staging 17 Nov 20:18: AK-1059 lapsed and its notice went as ak_order_cancelled_v1 (approved by Meta, utility), which has no
  // button, so the Reopen button reached nobody once the template was approved. Inside the window the free message with the button
  // goes; outside it, only the template can go, and it does.
  it("inside the window: the free message with Reopen, not the template; outside it: the approved template", async () => {
    await h.db.rpc("set_template_meta", { p_name: "ak_order_cancelled_v1", p_status: "APPROVED", p_category: "UTILITY" });
    try {
      const inside = await card({ minsAgo: 90 }), outside = await card({ minsAgo: 90, windowOpen: false });
      await h.db.pg.query(`update orders set created_at = now() - interval '2 hours' where id = any($1::uuid[])`, [`{${inside.orderId},${outside.orderId}}`]);
      await h.db.rpc("run_timers");
      await tick();
      const about = (code: string) => sent.filter((m) => JSON.stringify(m).includes(code));
      expect(about(inside.code)).toHaveLength(1);
      expect(about(inside.code)[0].type).toBe("interactive");
      expect(about(inside.code)[0].interactive.action.buttons[0].reply).toEqual({ id: `order:reopen:${inside.orderId}`, title: ar.cx.reopenButton });
      expect(about(outside.code)).toHaveLength(1);
      expect(about(outside.code)[0]).toMatchObject({ type: "template", template: { name: "ak_order_cancelled_v1" } });
    } finally {
      await h.db.rpc("set_template_meta", { p_name: "ak_order_cancelled_v1", p_status: "PENDING", p_category: "UTILITY" });
    }
  });
});

describe("3. every pickup order needs the handover code", () => {
  it("a cash pickup order gets a code when it is confirmed; a cash delivery order still gets none", async () => {
    const p = await card({ pickup: true });
    const d = await card({ pickup: false });
    for (const x of [p, d]) await h.db.rpc("confirm_order_checked", { p_order: x.orderId, p_party: x.party, p_wamid: `wamid.cfg1.pk${x.code}` });
    expect((await h.db.one(`select handover_code from orders where id = $1`, [p.orderId])).handover_code).toMatch(/^\d{4}$/);
    expect((await h.db.one(`select handover_code from orders where id = $1`, [d.orderId])).handover_code).toBeNull();
  });

  it("the hub hands a cash pickup over only with the right code", async () => {
    const p = await card({ pickup: true });
    await h.db.rpc("confirm_order_checked", { p_order: p.orderId, p_party: p.party, p_wamid: `wamid.cfg1.h${p.code}` });
    const code = (await h.db.one(`select handover_code from orders where id = $1`, [p.orderId])).handover_code as string;
    await h.db.rpc("start_pick", { p_order: p.orderId, p_by: h.picker });
    await h.db.rpc("finish_pick", { p_order: p.orderId, p_by: h.picker });
    const total = Number((await h.db.one(`select total_usd from orders where id = $1`, [p.orderId])).total_usd);
    const wrong = await h.db.rpc("hub_handover", { p_order: p.orderId, p_by: h.picker, p_code: code === "0000" ? "1111" : "0000", p_usd: total });
    expect(wrong).toMatchObject({ ok: false, result: "wrong" });
    const none = await h.db.rpc("hub_handover", { p_order: p.orderId, p_by: h.picker, p_usd: total });
    expect(none).toMatchObject({ ok: false });
    const ok = await h.db.rpc("hub_handover", { p_order: p.orderId, p_by: h.picker, p_code: code, p_usd: total });
    expect(ok).toMatchObject({ ok: true, status: "closed" });
  });

  it("pickup stays off in settings", async () => {
    expect((await h.db.one(`select setting('pickup')->>'enabled' as e`)).e).toBe("false");
  });
});

describe("5. the cash cap", () => {
  it("settings.cash_cap is soft 100, hard 150", async () => {
    const fresh = await h.db.one(`select value from settings where key = 'cash_cap'`);
    expect(fresh.value).toEqual({ soft_usd: 100, hard_usd: 150 });
  });
});

describe("4. approvals", () => {
  it("settings.approvals: refund_usd 10, price_change_pct 10, and a rate change needs a second person", async () => {
    const v = (await h.db.one(`select value from settings where key = 'approvals'`)).value;
    expect(v).toMatchObject({ refund_usd: 10, price_change_pct: 10, fx_rate_second_person: true });
  });

  it("a change to the LBP rate waits for a second person: nothing changes, the asker cannot approve, another ops lead can", async () => {
    const before = Number(await h.db.rpc("current_fx"));
    const second = (await h.db.one(`insert into parties(role, display_name) values ('ops_lead', 'Second') returning id`)).id;
    const r = await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 90500, p_by: h.ops });
    expect(r).toMatchObject({ status: "awaiting_approval", lbp_per_usd: 90500, current: before });
    expect(Number(await h.db.rpc("current_fx"))).toBe(before);
    // asking again for the same rate is the same request
    expect(await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 90500, p_by: h.ops })).toMatchObject({ duplicate: true, approval_id: r.approval_id });
    await expect(h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: h.ops, p_approve: true })).rejects.toThrow(/SAME_PERSON/);
    await expect(h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: h.picker, p_approve: true })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(Number(await h.db.rpc("current_fx"))).toBe(before);
    expect(await h.db.rpc("decide_approval", { p_id: r.approval_id, p_by: second, p_approve: true })).toMatchObject({ status: "approved", result: { status: "set" } });
    expect(Number(await h.db.rpc("current_fx"))).toBe(90500);
    expect((await h.db.one(`select set_by from fx_rates order by effective_from desc, id desc limit 1`)).set_by).toBe(h.ops);
    expect((await h.db.one(`select reason from config_changes where kind = 'fx' order by created_at desc, id limit 1`)).reason).toBe("approved by Second");
    // the approval is the check the 3% hold stood for: a big move that a second person approved is not held again
    const big = await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 99000, p_by: h.ops });
    expect(await h.db.rpc("decide_approval", { p_id: big.approval_id, p_by: second, p_approve: true })).toMatchObject({ result: { status: "set" } });
    expect(Number(await h.db.rpc("current_fx"))).toBe(99000);
    expect(await h.db.rpc("fx_quoting_paused")).toBe(false);
    // rejected: nothing changes; a newer request replaces an older pending one
    const no = await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 91000, p_by: h.ops });
    await h.db.rpc("decide_approval", { p_id: no.approval_id, p_by: second, p_approve: false, p_note: "typo" });
    expect(Number(await h.db.rpc("current_fx"))).toBe(99000);
    const a1 = await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 91000, p_by: h.ops });
    const a2 = await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 92000, p_by: h.ops });
    expect((await h.db.one(`select status from pending_approvals where id = $1`, [a1.approval_id])).status).toBe("rejected");
    expect((await h.db.one(`select status from pending_approvals where id = $1`, [a2.approval_id])).status).toBe("pending");
    await h.db.pg.query(`update pending_approvals set status = 'rejected' where status = 'pending'`);
  });

  it("with the setting off, a rate is set at once as before (0045), and the first rate ever is not a change", async () => {
    await h.db.pg.exec(`update settings set value = value || '{"fx_rate_second_person": false}' where key = 'approvals'`);
    expect(await h.db.rpc("set_fx_rate", { p_lbp_per_usd: 90000, p_by: h.ops })).toMatchObject({ status: "set" });   // within the 3% of the morning rate
    await h.db.pg.exec(`update settings set value = value || '{"fx_rate_second_person": true}' where key = 'approvals'`);
    const empty = await openHub();
    await empty.db.pg.exec(`delete from fx_rates`);
    expect(await empty.db.rpc("set_fx_rate", { p_lbp_per_usd: 89500, p_by: empty.ops })).toMatchObject({ status: "set" });
  });

  it("a refund above 10 USD waits for a second person; one of 10 or less does not", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 5 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
    await deliverToDoor(h, o.orderId);
    await collect(h, o.orderId);
    expect(await total(h, o.orderId)).toBeGreaterThan(12);
    const small = await h.db.rpc("refund_order", { p_order: o.orderId, p_by: h.ops, p_amount_usd: 5, p_charged_to: "goodwill", p_reason: "late", p_key: "cfg1-small" });
    const large = await h.db.rpc("refund_order", { p_order: o.orderId, p_by: h.ops, p_amount_usd: 12, p_charged_to: "goodwill", p_reason: "late", p_key: "cfg1-large" });
    expect(small).not.toMatchObject({ status: "awaiting_approval" });
    expect(small).toMatchObject({ ok: true });
    expect(large).toMatchObject({ status: "awaiting_approval" });
  });
});

describe("6. the inbox escalation timers are a setting", () => {
  it("settings.support holds lead 3, founder 5, late 15", async () => {
    const v = (await h.db.one(`select value from settings where key = 'support'`)).value;
    expect(v).toMatchObject({ claim_alert_min: 3, founder_alert_min: 5, late_min: 15 });
  });

  it("case_timers_due follows them: the lead step, the founder step and late each move with the setting", async () => {
    const c = await card();
    const hid = (await h.db.rpc("open_case", { p_conversation: c.conversation, p_kind: "person_requested", p_topic: "cfg1", p_order: null, p_source: "code" })).case_id as string;
    const step = async () => { await h.db.rpc("case_timers_due"); return h.db.one(`select alert_step, late from handoffs where id = $1`, [hid]); };
    const age = (mins: number) => h.db.pg.query(`update handoffs set ladder_from = now() - make_interval(secs => $2) where id = $1`, [hid, Math.round(mins * 60)]);
    await h.db.pg.exec(`update settings set value = value || '{"claim_alert_min": 4, "founder_alert_min": 8, "late_min": 20}' where key = 'support'`);
    await age(3.5); expect(await step()).toMatchObject({ alert_step: 0, late: false });         // 3.5 < 4: the lead step is not due yet
    await age(4.5); expect(await step()).toMatchObject({ alert_step: 1, late: false });         // lead
    await age(6); expect(await step()).toMatchObject({ alert_step: 1, late: false });           // 6 < 8: founder not yet
    await age(8.5); expect(await step()).toMatchObject({ alert_step: 2, late: false });         // founder
    await age(21); expect(await step()).toMatchObject({ alert_step: 2, late: true });           // late
    await h.db.pg.exec(`update settings set value = value || '{"claim_alert_min": 3, "founder_alert_min": 5, "late_min": 15}' where key = 'support'`);
  });
});
