// UX2b, migration 0231: the console's Settings page writes settings only through change_setting(). Written before the migration.
//   * admin only; a key and field must be on the editable list (data: editable_settings), with its type and bounds
//   * every change is logged with who, when, before, after and why (config_changes, kind 'setting')
//   * the rules the review calls two-person (the approval limits, the cash caps, selling-requires-a-label switched on, the second-person
//     rule switched off) wait in pending_approvals and are made by decide_approval; the asker cannot approve; a newer request replaces an older
//   * the marketing lock and anything not on the list can never be written from here
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let admin: string; let admin2: string; let lead: string; let picker: string;
const change = (key: string, field: string, value: unknown, by: string, reason = "because the founder asked") =>
  db.rpc("change_setting", { p_key: key, p_field: field, p_value: JSON.stringify(value), p_by: by, p_reason: reason });
const setting = async (key: string) => (await db.one(`select setting($1) as v`, [key])).v;
const fails = async (p: Promise<unknown>, code: RegExp) => { await expect(p).rejects.toThrow(code); };

beforeAll(async () => {
  db = await openTestDb();
  const party = async (role: string, name: string) => (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string;
  admin = await party("admin", "Rashid"); admin2 = await party("admin", "Second admin"); lead = await party("ops_lead", "Hussein"); picker = await party("picker", "Rana");
}, 120_000);

describe("who may change a setting", () => {
  it("an admin may; an ops lead and a picker may not", async () => {
    expect(await change("timers", "awaiting_payment_min", 40, admin)).toMatchObject({ ok: true, status: "set" });
    await fails(change("timers", "awaiting_payment_min", 41, lead), /NOT_AUTHORISED/);
    await fails(change("timers", "awaiting_payment_min", 41, picker), /NOT_AUTHORISED/);
    expect((await setting("timers")).awaiting_payment_min).toBe(40);
  });
});

describe("what may be changed", () => {
  it("only what is on the editable list, with its type and bounds", async () => {
    await fails(change("marketing", "enabled", true, admin), /NOT_EDITABLE/);                 // the lock is never a settings edit
    await fails(change("sim_monthly_cap_usd", "default_usd", 1, admin), /NOT_EDITABLE/);
    await fails(change("timers", "no_such_timer", 5, admin), /NOT_EDITABLE/);
    await fails(change("timers", "draft_min", 0, admin), /VALUE_INVALID/);                    // below its minimum
    await fails(change("timers", "draft_min", 99999, admin), /VALUE_INVALID/);
    await fails(change("timers", "draft_min", 12.5, admin), /VALUE_INVALID/);                 // an int
    await fails(change("hours", "open", "8am", admin), /VALUE_INVALID/);
    await fails(change("pickup", "enabled", "yes", admin), /VALUE_INVALID/);
    await fails(change("search", "embeddings", "maybe", admin), /VALUE_INVALID/);
    await fails(change("min_order_usd", "", -1, admin), /VALUE_INVALID/);
  });

  it("changes a nested field and a whole value, and keeps the rest of the row", async () => {
    await change("hours", "open", "07:30", admin);
    expect(await setting("hours")).toMatchObject({ open: "07:30", close: "21:00", tz: "Asia/Beirut" });
    await change("min_order_usd", "", 6.5, admin);
    expect(Number(await setting("min_order_usd"))).toBe(6.5);
    await change("pickup", "place_en", "  Hub counter, Baakline  ", admin);
    await change("pickup", "place_ar", "طاولة المستودع، بعقلين", admin);
    expect(await setting("pickup")).toMatchObject({ enabled: false, place_en: "Hub counter, Baakline", place_ar: "طاولة المستودع، بعقلين" });
    await change("pickup", "place_en", "", admin);
    expect((await setting("pickup")).place_en).toBeNull();
    for (const f of ["claim_alert_min", "founder_alert_min", "late_min"]) await change("support", f, 4, admin);
    expect(await setting("support")).toMatchObject({ claim_alert_min: 4, founder_alert_min: 4, late_min: 4 });
  });

  it("the cash caps keep the soft mark at or below the hard one", async () => {
    await db.pg.query(`update settings set value = '{"soft_usd": 100, "hard_usd": 150}' where key = 'cash_cap'`);
    await fails(change("cash_cap", "soft_usd", 200, admin), /CAP_ORDER/);
    await fails(change("cash_cap", "hard_usd", 50, admin), /CAP_ORDER/);
  });
});

describe("every change is logged with who, when and why", () => {
  it("writes before, after, reason and the person; a reason is required; a no-op is not logged", async () => {
    await fails(change("timers", "draft_min", 70, admin, "  "), /REASON_REQUIRED/);
    await fails(change("timers", "draft_min", 70, admin, "ab"), /REASON_REQUIRED/);
    const before = Number((await db.one(`select count(*) as n from config_changes where kind = 'setting'`)).n);
    await change("timers", "draft_min", 70, admin, "longer drafts for the pilot");
    const row = await db.one(`select * from config_changes where kind = 'setting' order by created_at desc, id desc limit 1`);
    expect(row).toMatchObject({ reason: "longer drafts for the pilot", changed_by: admin });
    expect(row.before).toMatchObject({ key: "timers", field: "draft_min", value: 60 });
    expect(row.after).toMatchObject({ key: "timers", field: "draft_min", value: 70 });
    expect(row.created_at).toBeTruthy();
    expect(Number((await db.one(`select count(*) as n from config_changes where kind = 'setting'`)).n)).toBe(before + 1);
    expect(await change("timers", "draft_min", 70, admin, "same again")).toMatchObject({ ok: true, status: "unchanged" });
    expect(Number((await db.one(`select count(*) as n from config_changes where kind = 'setting'`)).n)).toBe(before + 1);
  });

  it("settings_log() names the person and the time, newest first; console_settings() lists what the page edits", async () => {
    const log = await db.rpc("settings_log", { p_limit: 5 });
    expect(log[0]).toMatchObject({ key: "timers", field: "draft_min", by_name: "Rashid", reason: "longer drafts for the pilot" });
    expect(log[0].at).toBeTruthy();
    const list = await db.rpc("console_settings");
    const row = list.find((x: any) => x.key === "timers" && x.field === "draft_min");
    expect(row).toMatchObject({ kind: "int", min: 1, max: 1440, two_person: false, value: 70, changed_by_name: "Rashid" });
    expect(list.map((x: any) => `${x.key}.${x.field}`)).toEqual(expect.arrayContaining(["hours.open", "hours.close", "min_order_usd.", "cash_cap.soft_usd", "cash_cap.hard_usd",
      "pickup.place_en", "support.late_min", "approvals.refund_usd", "sell_requires_label.enabled", "search.embeddings", "small_order_fee.fee_usd"]));
    expect(list.some((x: any) => x.key === "marketing")).toBe(false);
  });
});

describe("the rules that are two-person", () => {
  it("a change to an approval limit waits in pending_approvals and changes nothing", async () => {
    const r = await change("approvals", "refund_usd", 25, admin, "the first month is quiet");
    expect(r).toMatchObject({ ok: true, status: "awaiting_approval" });
    expect((await setting("approvals")).refund_usd).toBe(10);
    const a = await db.one(`select * from pending_approvals where id = $1`, [r.approval_id]);
    expect(a).toMatchObject({ kind: "setting", status: "pending", requested_by: admin });
    expect(a.payload).toMatchObject({ key: "approvals", field: "refund_usd", value: 25 });
    expect(String(a.summary)).toContain("refund_usd");
    expect(await change("approvals", "refund_usd", 25, admin, "again")).toMatchObject({ status: "awaiting_approval", duplicate: true, approval_id: r.approval_id });
  });

  it("the person who asked cannot approve; a second person does, and it is logged with both", async () => {
    const a = await db.one(`select id from pending_approvals where kind = 'setting' and status = 'pending'`);
    await fails(db.rpc("decide_approval", { p_id: a.id, p_by: admin, p_approve: true }), /SAME_PERSON/);
    expect((await setting("approvals")).refund_usd).toBe(10);
    const ok = await db.rpc("decide_approval", { p_id: a.id, p_by: lead, p_approve: true });
    expect(ok).toMatchObject({ ok: true, status: "approved" });
    expect((await setting("approvals")).refund_usd).toBe(25);
    expect((await setting("approvals")).price_change_pct).toBe(10);                                // the rest of the row stands
    const row = await db.one(`select * from config_changes where kind = 'setting' order by created_at desc, id desc limit 1`);
    expect(row).toMatchObject({ changed_by: admin });
    expect(row.after).toMatchObject({ key: "approvals", field: "refund_usd", value: 25, approved_by: lead });
    expect(String(row.reason)).toContain("Hussein");
  });

  it("a rejected request changes nothing, and a newer request replaces an older one", async () => {
    const one = await change("cash_cap", "hard_usd", 175, admin, "more room for the weekend");
    const two = await change("cash_cap", "hard_usd", 180, admin, "a little more");
    expect((await db.one(`select status from pending_approvals where id = $1`, [one.approval_id])).status).toBe("rejected");
    expect((await db.one(`select status from pending_approvals where id = $1`, [two.approval_id])).status).toBe("pending");
    expect((await setting("cash_cap")).hard_usd).toBe(150);
    await db.rpc("decide_approval", { p_id: two.approval_id, p_by: admin2, p_approve: false, p_note: "not yet" });
    expect((await setting("cash_cap")).hard_usd).toBe(150);
    expect((await db.one(`select status from pending_approvals where id = $1`, [two.approval_id])).status).toBe("rejected");
  });

  it("a request that would break the caps is refused when it is asked and again when it is approved", async () => {
    await fails(change("cash_cap", "hard_usd", 90, admin), /CAP_ORDER/);
    const a = await change("cash_cap", "soft_usd", 120, admin, "soft mark up");
    await db.pg.query(`update settings set value = '{"soft_usd": 100, "hard_usd": 110}' where key = 'cash_cap'`);   // the hard cap moved meanwhile
    await db.pg.query(`update pending_approvals set payload = jsonb_set(payload, '{value}', '130') where id = $1`, [a.approval_id]);
    await fails(db.rpc("decide_approval", { p_id: a.approval_id, p_by: admin2, p_approve: true }), /CAP_ORDER/);
    await db.pg.query(`update settings set value = '{"soft_usd": 100, "hard_usd": 150}' where key = 'cash_cap'`);
    await db.pg.query(`update pending_approvals set status = 'rejected' where status = 'pending'`);
  });

  it("selling-requires-a-label is two-person to switch on, immediate to switch off; the second-person rule is two-person to switch off", async () => {
    expect((await setting("sell_requires_label")).enabled).toBe(false);
    const on = await change("sell_requires_label", "enabled", true, admin, "label day is done");
    expect(on).toMatchObject({ status: "awaiting_approval" });
    expect((await setting("sell_requires_label")).enabled).toBe(false);
    await db.rpc("decide_approval", { p_id: on.approval_id, p_by: lead, p_approve: true });
    expect((await setting("sell_requires_label")).enabled).toBe(true);
    expect(await change("sell_requires_label", "enabled", false, admin, "back to selling everything")).toMatchObject({ status: "set" });
    expect((await setting("sell_requires_label")).enabled).toBe(false);
    expect(await change("approvals", "fx_rate_second_person", true, admin, "already on")).toMatchObject({ status: "unchanged" });
    const off = await change("approvals", "fx_rate_second_person", false, admin, "only one admin today");
    expect(off).toMatchObject({ status: "awaiting_approval" });
    expect((await setting("approvals")).fx_rate_second_person).toBe(true);
    await db.rpc("decide_approval", { p_id: off.approval_id, p_by: lead, p_approve: false });
  });
});

describe("the embeddings switch", () => {
  it("turns on only when the model's vectors are in the database", async () => {
    await fails(change("search", "embeddings", "on", admin, "try meaning search"), /EMBEDDINGS_NOT_READY/);
    expect((await setting("search")).embeddings).toBe("off");
    const p = (await db.one(`select id from products limit 1`)).id;
    await db.pg.query(`insert into product_embeddings(product_id, model, digest, dims, embedding) values ($1, $2, 'x', 3, '[1,2,3]')`, [p, (await setting("search")).model]);
    expect(await change("search", "embeddings", "on", admin, "vectors are built")).toMatchObject({ status: "set" });
    expect((await setting("search")).embeddings).toBe("on");
    expect(await change("search", "embeddings", "off", admin, "back to words")).toMatchObject({ status: "set" });
  });
});

describe("the rest of the system is untouched", () => {
  it("the marketing lock still holds under every path", async () => {
    await expect(db.pg.query(`update settings set value = '{"enabled": true}' where key = 'marketing'`)).rejects.toThrow(/MARKETING_LOCKED/);
  });
});
