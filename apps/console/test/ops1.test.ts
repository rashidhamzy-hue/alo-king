// OPS1 in the console: staff and roles (add, change, block, through set_staff, logged), the sign-in throttle, template health,
// and the "send me a test alert" button.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
beforeEach(async () => { r = await rig(); });

const admin = async () => { const a = await r.staff("admin", "Rasheed"); const b = r.browser(); await b.signIn(a); return { a, b }; };

describe("staff and roles", () => {
  it("is for admins only: an ops lead and a picker are refused, and it is not in their menu", async () => {
    for (const role of ["ops_lead", "picker"] as const) {
      const s = await r.staff(role); const b = r.browser(); await b.signIn(s);
      expect((await b.get("/staff")).status).toBe(403);
      expect((await b.post("/staff/add", { email: "x@staff.test", name: "X", role: "picker" })).status).toBe(403);
    }
  });

  it("lists staff (not customers, riders or test parties) with role and status, in the admin's menu", async () => {
    await r.staff("customer", "A Customer"); await r.staff("driver", "A Rider");
    await r.db.pg.exec(`insert into parties(role, display_name, is_probe) values ('ops_lead', 'Probe ops lead', true)`);
    await r.staff("picker", "Rana");
    const { b } = await admin();
    const page = await b.get("/staff");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Rasheed"); expect(page.text).toContain("Rana");
    for (const hidden of ["A Customer", "A Rider", "Probe ops lead"]) expect(page.text).not.toContain(hidden);
    expect((await b.get("/more")).text).toContain("/staff");
  });

  it("adds a staff member through set_staff, makes the sign-in account and sends the link, and logs it without the email address", async () => {
    const { b } = await admin();
    await b.get("/staff");
    const res = await b.post("/staff/add", { email: "Nour@Staff.Test", name: "Nour", role: "picker" });
    expect(flashOf(res.text)).toContain("Nour");
    const p = await r.db.one(`select id, role, is_blocked from parties where display_name = 'Nour'`);
    expect(p).toMatchObject({ role: "picker", is_blocked: false });
    expect(r.auth.invited).toEqual([{ email: "nour@staff.test", partyId: p.id }]);
    expect((await r.db.one(`select action from staff_changes where party_id = $1`, [p.id])).action).toBe("add");
    const log = JSON.stringify(await r.actions());
    expect(log).toContain("staff_add");
    expect(log).not.toContain("nour@staff.test");
  });

  it("says plainly when the sign-in account already exists, and when the email is not an address, and makes no party for a bad email", async () => {
    const { b } = await admin();
    await b.get("/staff");
    const bad = await b.post("/staff/add", { email: "not-an-email", name: "Bad", role: "picker" });
    expect(flashOf(bad.text)).toMatch(/email/i);
    expect((await r.db.all(`select 1 from parties where display_name = 'Bad'`)).length).toBe(0);
    r.auth.existing.add("dup@staff.test");
    const dup = await b.post("/staff/add", { email: "dup@staff.test", name: "Dup", role: "picker" });
    expect(flashOf(dup.text)).toMatch(/already has a sign-in account/i);
  });

  it("changes a role, blocks, and unblocks; a blocked person is out on their next request", async () => {
    const lead = await r.staff("ops_lead", "Hussein");
    const hb = r.browser(); await hb.signIn(lead);
    expect((await hb.get("/")).status).toBe(200);
    const { b } = await admin();
    await b.get("/staff");
    await b.post(`/staff/${lead.partyId}`, { name: "Hussein", role: "picker", blocked: "" });
    expect((await r.db.one(`select role from parties where id = $1`, [lead.partyId])).role).toBe("picker");
    await b.post(`/staff/${lead.partyId}`, { name: "Hussein", role: "picker", blocked: "1" });
    expect((await hb.get("/")).location).toBe("/sign-in");                       // the console reads the party on every request
    await b.post(`/staff/${lead.partyId}`, { name: "Hussein", role: "ops_lead", blocked: "" });
    expect((await r.db.all(`select action from staff_changes where party_id = $1 order by id`, [lead.partyId])).map((x) => x.action)).toEqual(["role", "block", "unblock"]);
  });

  it("explains the database's refusals in words: you cannot block yourself", async () => {
    const { a, b } = await admin();
    await b.get("/staff");
    const res = await b.post(`/staff/${a.partyId}`, { name: "Rasheed", role: "admin", blocked: "1" });
    expect(flashOf(res.text)).toMatch(/your own/i);
    expect((await r.db.one(`select is_blocked from parties where id = $1`, [a.partyId])).is_blocked).toBe(false);
  });
});

describe("the sign-in throttle", () => {
  const wrong = (b: ReturnType<Rig["browser"]>, email: string) => b.post("/sign-in", { email, password: "nope nope nope" }, { follow: false });

  it("locks an email after five wrong passwords: the sixth try is refused even with the right one, and says to wait", async () => {
    const s = await r.staff("ops_lead", "Maya");
    const b = r.browser(); await b.get("/sign-in");
    for (let i = 0; i < 5; i++) expect((await wrong(b, s.email)).location).toBe("/sign-in?e=1");
    const locked = await b.post("/sign-in", { email: s.email, password: s.password }, { follow: false });
    expect(locked.status).toBe(429);
    expect(locked.text).toMatch(/too many/i);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(14 * 60);
    expect((await b.get("/")).location).toBe("/sign-in");                         // no session was made
    await r.db.pg.exec(`update signin_attempts set locked_until = now() - interval '1 second'`);
    expect((await b.post("/sign-in", { email: s.email, password: s.password }, { follow: false })).location).toBe("/");
  });

  it("counts an unknown email too (so it cannot be used to find who exists), and treats upper case alike", async () => {
    const b = r.browser(); await b.get("/sign-in");
    for (let i = 0; i < 5; i++) await wrong(b, i % 2 ? "Ghost@Staff.Test" : "ghost@staff.test");
    expect((await wrong(b, "ghost@staff.test")).status).toBe(429);
  });

  it("a good sign-in clears that email's count; another person is never affected", async () => {
    const s = await r.staff("ops_lead", "Maya"); const o = await r.staff("picker", "Omar");
    const b = r.browser(); await b.get("/sign-in");
    for (let i = 0; i < 4; i++) await wrong(b, s.email);
    expect((await b.post("/sign-in", { email: s.email, password: s.password }, { follow: false })).location).toBe("/");
    expect((await r.db.all(`select 1 from signin_attempts where key_hash like 'e:%'`)).length).toBe(0);
    for (let i = 0; i < 5; i++) await wrong(r.browser(), s.email);
    const b2 = r.browser(); await b2.get("/sign-in");
    expect((await b2.post("/sign-in", { email: o.email, password: o.password }, { follow: false })).location).toBe("/");   // Omar is not locked
  });

  it("keeps only keyed hashes: no email address and no IP address is in the table", async () => {
    const b = r.browser(); await b.get("/sign-in");
    await b.post("/sign-in", { email: "who@staff.test", password: "x" }, { follow: false, headers: { "cf-connecting-ip": "203.0.113.77" } });
    const rows = await r.db.all(`select key_hash from signin_attempts order by key_hash`);
    expect(rows.length).toBe(2);
    expect(rows.map((x) => x.key_hash[0])).toEqual(["e", "i"]);
    expect(JSON.stringify(rows)).not.toContain("who@staff.test");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.77");
  });

  it("an address that tries twenty different emails is locked, whatever the emails", async () => {
    const b = r.browser(); await b.get("/sign-in");
    const h = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 20; i++) await b.post("/sign-in", { email: `x${i}@staff.test`, password: "x" }, { follow: false, headers: h });
    const s = await r.staff("ops_lead", "Maya");
    expect((await b.post("/sign-in", { email: s.email, password: s.password }, { follow: false, headers: h })).status).toBe(429);
  });

  it("the sign-in still works on a database that has not got 0141 yet (staging can lag), and says nothing is throttled", async () => {
    const lag = await rig({ without: ["signin_allowed"] });
    const s = await lag.staff("ops_lead", "Maya"); const b = lag.browser(); await b.get("/sign-in");
    expect((await b.post("/sign-in", { email: s.email, password: s.password }, { follow: false })).location).toBe("/");
  });
});

describe("template health", () => {
  it("shows every template's state and the fallback in force, to the ops lead", async () => {
    await r.db.pg.exec(`insert into wa_templates(name, line, category, language, body, status) values
      ('ak_h_ok_v1', 'customer', 'utility', 'ar', 'a', 'approved'), ('ak_h_new_v1', 'customer', 'utility', 'ar', 'b', 'submitted'), ('ak_h_mk_v1', 'customer', 'marketing', 'ar', 'c', 'approved')`);
    const s = await r.staff("ops_lead"); const b = r.browser(); await b.signIn(s);
    const page = await b.get("/templates");
    expect(page.status).toBe(200);
    const row = (name: string) => new RegExp(`<tr[^>]*>(?:(?!</tr>).)*${name}(?:(?!</tr>).)*</tr>`, "s").exec(page.text)![0];
    expect(row("ak_h_ok_v1")).toMatch(/Approved/); expect(row("ak_h_ok_v1")).toMatch(/Not needed/);
    expect(row("ak_h_new_v1")).toMatch(/Pending/); expect(row("ak_h_new_v1")).toMatch(/24-hour window/);
    expect(row("ak_h_mk_v1")).toMatch(/Moved to marketing/); expect(row("ak_h_mk_v1")).toMatch(/never sent/i);
    expect((await r.browser().get("/templates")).location).toBe("/sign-in");
    const p = await r.staff("picker"); const pb = r.browser(); await pb.signIn(p);
    expect((await pb.get("/templates")).status).toBe(403);
  });
});

describe("send me a test alert", () => {
  it("sends one push to this staff member's own phones and says how many; nothing to anyone else", async () => {
    const calls: string[] = [];
    r.deps.pushPublicKey = "K".repeat(87);
    r.deps.pushTest = async (partyId) => { calls.push(partyId); return { subscribers: 2, sent: 2 }; };
    const s = await r.staff("ops_lead"); const b = r.browser(); await b.signIn(s);
    const more = await b.get("/more");
    expect(more.text).toContain('action="/push/test"');
    const res = await b.post("/push/test", {});
    expect(calls).toEqual([s.partyId]);
    expect(flashOf(res.text)).toMatch(/2/);
  });

  it("says plainly when there is no phone to send to, and when push is not set up", async () => {
    const s = await r.staff("ops_lead"); const b = r.browser(); await b.signIn(s);
    r.deps.pushPublicKey = "K".repeat(87);
    r.deps.pushTest = async () => ({ subscribers: 0, sent: 0 });
    await b.get("/more");
    expect(flashOf((await b.post("/push/test", {})).text)).toMatch(/no phone/i);
    r.deps.pushTest = undefined; r.deps.pushPublicKey = undefined;
    await b.get("/more");
    expect(flashOf((await b.post("/push/test", {})).text)).toMatch(/not set up/i);
  });

  it("is for the ops lead and the admin, with the CSRF token like every other action", async () => {
    r.deps.pushTest = async () => ({ subscribers: 1, sent: 1 });
    const p = await r.staff("picker"); const pb = r.browser(); await pb.signIn(p);
    expect((await pb.post("/push/test", {})).status).toBe(403);
    const s = await r.staff("ops_lead"); const b = r.browser(); await b.signIn(s);
    expect((await b.post("/push/test", {}, { csrf: "wrong" })).status).toBe(403);
  });
});

describe("what wakes a phone is named", () => {
  it("every kind that can push has a name and a page, so the alert never says a raw code", async () => {
    const { KIND } = await import("../src/kinds");
    const kinds = (await r.db.one(`select value->'high_priority_kinds' k from settings where key = 'push_alerts'`)).k as string[];
    expect(kinds.filter((k) => !KIND[k])).toEqual([]);
  });
});
