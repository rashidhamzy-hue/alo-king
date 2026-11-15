// OPS1 items 3 and 4 on the real schema (0141, 0142): staff added and blocked through one SQL function that logs every change;
// a sign-in throttle that keeps hashed keys only; the dead-letter and hand-off kinds high priority; and the template-health view.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let admin: string; let lead: string;
const staff = async (name: string, role: string) => (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string;

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  admin = await staff("Rasheed", "admin");
  lead = await staff("Hussein", "ops_lead");
}, 60_000);

describe("staff and roles: one function, logged", () => {
  it("only an admin adds staff; the new party gets the role and the change is logged with before and after", async () => {
    await expect(db.rpc("set_staff", { p_by: lead, p_party: null, p_name: "Nour", p_role: "picker" })).rejects.toThrow(/NOT_AUTHORISED/);
    const r = await db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "  Nour  ", p_role: "picker" });
    expect(r).toMatchObject({ changed: true, action: "add" });
    expect(await db.one(`select role, display_name, is_blocked, is_probe from parties where id = $1`, [r.party_id])).toEqual({ role: "picker", display_name: "Nour", is_blocked: false, is_probe: false });
    const log = await db.one(`select action, by_party, party_id, before, after from staff_changes where party_id = $1`, [r.party_id]);
    expect(log).toMatchObject({ action: "add", by_party: admin, after: { role: "picker", name: "Nour", blocked: false } });
  });

  it("changes a role, blocks and unblocks, and logs each; a change that changes nothing is not logged", async () => {
    const p = (await db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "Samer", p_role: "picker" })).party_id;
    expect(await db.rpc("set_staff", { p_by: admin, p_party: p, p_name: "Samer", p_role: "ops_lead" })).toMatchObject({ changed: true, action: "role" });
    expect(await db.rpc("set_staff", { p_by: admin, p_party: p, p_name: "Samer", p_role: "ops_lead", p_blocked: true })).toMatchObject({ changed: true, action: "block" });
    expect((await db.one(`select is_blocked from parties where id = $1`, [p])).is_blocked).toBe(true);
    expect(await db.rpc("set_staff", { p_by: admin, p_party: p, p_name: "Samer", p_role: "ops_lead", p_blocked: true })).toMatchObject({ changed: false });
    expect(await db.rpc("set_staff", { p_by: admin, p_party: p, p_name: "Samer", p_role: "ops_lead", p_blocked: false })).toMatchObject({ changed: true, action: "unblock" });
    expect((await db.all(`select action from staff_changes where party_id = $1 order by id`, [p])).map((x) => x.action)).toEqual(["add", "role", "block", "unblock"]);
  });

  it("a blocked staff member's push subscriptions go with the access (the 0158 trigger)", async () => {
    const p = (await db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "Dina", p_role: "ops_lead" })).party_id;
    await db.rpc("save_push_subscription", { p_party: p, p_endpoint: "https://fcm.googleapis.com/x/ops1", p_p256dh: "B".repeat(87), p_auth: "A".repeat(22) });
    await db.rpc("set_staff", { p_by: admin, p_party: p, p_name: "Dina", p_role: "ops_lead", p_blocked: true });
    expect((await db.one(`select count(*)::int n from push_subscriptions where party_id = $1`, [p])).n).toBe(0);
  });

  it("refuses what would lock the console: blocking or demoting yourself (so an admin is never the last one by their own hand), a bad role, an empty name", async () => {
    await expect(db.rpc("set_staff", { p_by: admin, p_party: admin, p_name: "Rasheed", p_role: "admin", p_blocked: true })).rejects.toThrow(/CANNOT_CHANGE_SELF/);
    await expect(db.rpc("set_staff", { p_by: admin, p_party: admin, p_name: "Rasheed", p_role: "ops_lead" })).rejects.toThrow(/CANNOT_CHANGE_SELF/);
    const second = (await db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "Second admin", p_role: "admin" })).party_id;
    await db.rpc("set_staff", { p_by: second, p_party: admin, p_name: "Rasheed", p_role: "ops_lead" });      // another admin may demote the first
    await expect(db.rpc("set_staff", { p_by: second, p_party: second, p_name: "Second admin", p_role: "picker" })).rejects.toThrow(/CANNOT_CHANGE_SELF/);
    await db.rpc("set_staff", { p_by: second, p_party: admin, p_name: "Rasheed", p_role: "admin" });          // restored
    await expect(db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "X", p_role: "driver" })).rejects.toThrow(/UNKNOWN_ROLE/);
    await expect(db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "   ", p_role: "picker" })).rejects.toThrow(/NAME_REQUIRED/);
  });

  it("never reaches a customer, a rider or a probe party, and a blocked admin cannot act", async () => {
    const cust = (await db.one(`insert into parties(role, display_name) values ('customer', 'C') returning id`)).id;
    const probe = (await db.one(`insert into parties(role, display_name, is_probe) values ('ops_lead', 'Probe ops lead', true) returning id`)).id;
    await expect(db.rpc("set_staff", { p_by: admin, p_party: cust, p_name: "C", p_role: "picker" })).rejects.toThrow(/NOT_STAFF/);
    await expect(db.rpc("set_staff", { p_by: admin, p_party: probe, p_name: "P", p_role: "picker", p_blocked: true })).rejects.toThrow(/NOT_STAFF/);
    const gone = (await db.rpc("set_staff", { p_by: admin, p_party: null, p_name: "Gone admin", p_role: "admin" })).party_id;
    await db.rpc("set_staff", { p_by: admin, p_party: gone, p_name: "Gone admin", p_role: "admin", p_blocked: true });
    await expect(db.rpc("set_staff", { p_by: gone, p_party: null, p_name: "Y", p_role: "picker" })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("is not callable by the public roles", async () => {
    const grants = await db.all(`select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated') and has_function_privilege(r.rolname, 'set_staff(uuid,uuid,text,text,boolean)', 'execute')`);
    expect(grants).toEqual([]);
  });
});

describe("the sign-in throttle", () => {
  const k = (s: string) => `e:${s.padEnd(64, "0")}`;
  it("locks an address after five wrong tries in the window, for the lock time, and a good sign-in clears it", async () => {
    const keys = [k("aa"), `i:${"bb".padEnd(64, "0")}`];
    expect(await db.rpc("signin_allowed", { p_keys: keys })).toMatchObject({ allowed: true });
    for (let i = 0; i < 4; i++) await db.rpc("signin_failed", { p_keys: keys });
    expect(await db.rpc("signin_allowed", { p_keys: keys })).toMatchObject({ allowed: true });          // four: still open
    await db.rpc("signin_failed", { p_keys: keys });
    const blocked = await db.rpc("signin_allowed", { p_keys: keys });
    expect(blocked).toMatchObject({ allowed: false });
    expect(blocked.retry_after_s).toBeGreaterThan(14 * 60);
    expect(await db.rpc("signin_allowed", { p_keys: [k("cc")] })).toMatchObject({ allowed: true });       // another address is untouched
    await db.pg.exec(`update signin_attempts set locked_until = now() - interval '1 second'`);
    expect(await db.rpc("signin_allowed", { p_keys: keys })).toMatchObject({ allowed: true });          // the lock ran out
    await db.rpc("signin_ok", { p_key: k("aa") });
    expect((await db.one(`select count(*)::int n from signin_attempts where key_hash = $1`, [k("aa")])).n).toBe(0);
  });

  it("old failures do not add up: five tries spread over more than the window do not lock", async () => {
    const key = k("dd");
    for (let i = 0; i < 4; i++) await db.rpc("signin_failed", { p_keys: [key] });
    await db.pg.exec(`update signin_attempts set first_failure_at = now() - interval '16 minutes' where key_hash = '${key}'`);
    await db.rpc("signin_failed", { p_keys: [key] });
    expect(await db.rpc("signin_allowed", { p_keys: [key] })).toMatchObject({ allowed: true });
  });

  it("an address allows more tries than one email (a shop's shared connection), and only hashes are ever stored", async () => {
    const ip = `i:${"ee".padEnd(64, "0")}`;
    for (let i = 0; i < 19; i++) await db.rpc("signin_failed", { p_keys: [ip] });
    expect(await db.rpc("signin_allowed", { p_keys: [ip] })).toMatchObject({ allowed: true });
    await db.rpc("signin_failed", { p_keys: [ip] });
    expect(await db.rpc("signin_allowed", { p_keys: [ip] })).toMatchObject({ allowed: false });
    await expect(db.rpc("signin_failed", { p_keys: ["someone@example.com"] })).rejects.toThrow(/BAD_KEY/);   // a raw email is refused outright
  });
});

describe("what wakes a phone", () => {
  it("hand-offs, the dead-letter queue and a stalled probe are high priority", async () => {
    const kinds = (await db.one(`select value->'high_priority_kinds' k from settings where key = 'push_alerts'`)).k as string[];
    for (const k of ["agent_handoff", "model_capacity", "dead_letter", "heartbeat:probe_stuck", "heartbeat:inbound_silent", "model_account", "allergen_complaint"]) expect(kinds).toContain(k);
  });
});

describe("template health", () => {
  it("says for every template whether it is approved, pending or moved to marketing, and what is sent in its place", async () => {
    await db.pg.exec(`
      insert into wa_templates(name, line, category, language, body, status) values
        ('ak_t_ok_v1', 'customer', 'utility', 'ar', 'a', 'approved'),
        ('ak_t_new_v1', 'customer', 'utility', 'ar', 'b', 'submitted'),
        ('ak_t_moved_v1', 'customer', 'marketing', 'ar', 'c', 'approved'),
        ('ak_t_no_v1', 'customer', 'utility', 'ar', 'd', 'rejected'),
        ('ak_t_ops_v1', 'ops', 'utility', 'ar', 'e', 'draft');
      insert into agent_runs(agent, outcome, trace, created_at) values
        ('compliance_gateway', 'skipped', '{"reason":"template_not_utility","template":"ak_t_moved_v1"}', now() - interval '1 day'),
        ('compliance_gateway', 'skipped', '{"reason":"template_not_utility","template":"ak_t_moved_v1"}', now() - interval '2 day'),
        ('compliance_gateway', 'skipped', '{"reason":"template_not_utility","template":"ak_t_moved_v1"}', now() - interval '9 day');`);
    const rows = await db.all(`select name, state, fallback, skips_7d from template_health where name like 'ak\\_t\\_%' order by name`);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.ak_t_ok_v1).toMatchObject({ state: "approved", fallback: "none_needed", skips_7d: 0 });
    expect(by.ak_t_new_v1).toMatchObject({ state: "pending", fallback: "free_text_in_24h_window" });
    expect(by.ak_t_moved_v1).toMatchObject({ state: "moved_to_marketing", fallback: "free_text_in_24h_window", skips_7d: 2 });     // the 9-day-old skip is not counted
    expect(by.ak_t_no_v1).toMatchObject({ state: "not_usable", fallback: "free_text_in_24h_window" });
    expect(by.ak_t_ops_v1).toMatchObject({ state: "pending", fallback: "text_to_the_registered_phone" });
  });
  it("is not readable by the public roles", async () => {
    const g = await db.all(`select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated') and has_table_privilege(r.rolname, 'template_health', 'select')`);
    expect(g).toEqual([]);
  });
});
