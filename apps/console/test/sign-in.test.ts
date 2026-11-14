// 3.1 Sign-in and roles: Supabase Auth, staff only, roles read from the database on every request, every action logged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, html, render, type Section } from "../src/app";
import { ALL, LEADS } from "../src/roles";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
let ran = 0;
// A tiny section of our own, so these tests do not depend on any real page.
const testSections: Section[] = [
  { nav: { href: "/", label: "Home", roles: ALL }, routes: [{ method: "GET", path: "/", roles: ALL, handler: async (c) => render(c, "Home", html`<p>hello ${c.staff.name}</p>`) }] },
  { nav: { href: "/lead", label: "Lead", roles: LEADS }, routes: [
    { method: "GET", path: "/lead", roles: LEADS, handler: async (c) => render(c, "Lead", html`<p>lead page</p>`) },
    { method: "POST", path: "/lead/do", roles: LEADS, handler: async (c) => act(c, "test_action", { x: 1 }, async () => { ran++; return "Done."; }, "/lead") },
  ] },
];

beforeEach(async () => { r = await rig(); ran = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("sign-in", () => {
  it("sends a signed-out visitor to the sign-in page, and refuses a signed-out POST", async () => {
    const b = r.browser(testSections);
    expect((await b.get("/")).location).toBe("/sign-in");
    expect((await b.post("/lead/do", {}, { follow: false })).status).toBe(401);
    expect(ran).toBe(0);
  });

  it("signs a staff member in with a strict, HttpOnly session cookie and shows their name", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser(testSections);
    await b.get("/sign-in");
    const res = await b.post("/sign-in", { email: lead.email, password: lead.password }, { follow: false });
    expect(res.status).toBe(303);
    expect(res.location).toBe("/");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("ak_console="))!;
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=Strict/);
    const home = await b.get("/");
    expect(home.text).toContain("hello Maya");
    expect(home.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.media.audit().map((a) => [a.action, a.ok, a.party_id])).toEqual([["sign_in", true, lead.partyId]]);
  });

  it("refuses a wrong password with one message that does not say which part was wrong, and never logs the password", async () => {
    const lead = await r.staff("ops_lead");
    const b = r.browser(testSections);
    const page = await b.signIn({ email: lead.email, password: "wrong password!" });
    expect(flashOf(page.text)).toBe("Email or password is wrong, or this account has no console access.");
    expect((await b.get("/")).location).toBe("/sign-in");
    const log = JSON.stringify(r.media.audit());
    expect(log).toContain("bad_credentials");
    expect(log).not.toContain("wrong password");
  });

  it("refuses an Auth user whose party is not staff (customer, rider), and one with no party", async () => {
    for (const role of ["customer", "driver"] as const) {
      const p = await r.staff(role);
      const page = await r.browser(testSections).signIn(p);
      expect(flashOf(page.text)).toContain("no console access");
    }
    r.auth.add("nobody@staff.test", "a long password 1", null);
    expect(flashOf((await r.browser(testSections).signIn({ email: "nobody@staff.test", password: "a long password 1" })).text)).toContain("no console access");
    expect(r.media.audit().filter((a) => a.error === "not_staff")).toHaveLength(3);
  });

  it("says plainly when Supabase Auth is down", async () => {
    const lead = await r.staff("ops_lead");
    r.auth.down = true;
    expect((await r.browser(testSections).signIn(lead)).text).toContain("Sign-in is not answering");
  });

  it("signs out", async () => {
    const lead = await r.staff("admin");
    const b = r.browser(testSections);
    await b.signIn(lead);
    await b.get("/");
    expect((await b.post("/sign-out", {}, { follow: false })).location).toBe("/sign-in");
    expect((await b.get("/")).location).toBe("/sign-in");
  });
});

describe("roles come from the database on every request", () => {
  it("a picker cannot open or post to a lead page; the menu hides it", async () => {
    const picker = await r.staff("picker");
    const b = r.browser(testSections);
    await b.signIn(picker);
    const home = await b.get("/");
    expect(home.text).not.toContain('href="/lead"');
    const lead = await b.get("/lead");
    expect(lead.status).toBe(403);
    expect(lead.text).toContain("cannot open this page");
    await b.get("/");
    expect((await b.post("/lead/do", {}, { follow: false })).status).toBe(403);
    expect(ran).toBe(0);
  });

  it("blocking a staff member, or changing their role, takes effect on their next click", async () => {
    const lead = await r.staff("ops_lead");
    const b = r.browser(testSections);
    await b.signIn(lead);
    expect((await b.get("/lead")).status).toBe(200);
    await r.db.pg.query("update parties set role = 'picker' where id = $1", [lead.partyId]);
    expect((await b.get("/lead")).status).toBe(403);
    await r.db.pg.query("update parties set is_blocked = true where id = $1", [lead.partyId]);
    expect((await b.get("/")).location).toBe("/sign-in");
  });

  it("a session ends after twelve hours", async () => {
    const lead = await r.staff("ops_lead");
    const b = r.browser(testSections);
    await b.signIn(lead);
    const start = Date.now();
    r.deps.now = () => new Date(start + 12 * 3600_000 + 60_000);
    expect((await b.get("/")).location).toBe("/sign-in");
  });

  it("a forged or altered session cookie is ignored", async () => {
    const lead = await r.staff("ops_lead");
    const admin = await r.staff("admin");
    const b = r.browser(testSections);
    await b.signIn(lead);
    const [payload, sig] = b.cookies.get("ak_console")!.split(".");
    const body = JSON.parse(Buffer.from(payload!, "base64url").toString());
    body.p = admin.partyId;
    b.cookies.set("ak_console", `${Buffer.from(JSON.stringify(body)).toString("base64url")}.${sig}`);
    expect((await b.get("/")).location).toBe("/sign-in");
  });
});

describe("forms", () => {
  it("refuses a POST without the page's token, and one from another site", async () => {
    const lead = await r.staff("ops_lead");
    const b = r.browser(testSections);
    await b.signIn(lead);
    // "no-referrer" makes Chrome send `Origin: null` on our own forms, which the cross-site check refuses (13 Nov, sign-in link failed).
    expect((await b.get("/lead")).headers.get("referrer-policy")).toBe("same-origin");
    expect((await b.post("/lead/do", {}, { csrf: "nope", follow: false })).status).toBe(403);
    expect((await b.post("/lead/do", {}, { follow: false, headers: { origin: "https://evil.test" } })).status).toBe(403);
    expect(ran).toBe(0);
    const ok = await b.post("/lead/do");
    expect(flashOf(ok.text)).toBe("Done.");
    expect(ran).toBe(1);
  });

  it("logs every action before it runs, with who did it; if the log cannot be written, the action does not run", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser(testSections);
    await b.signIn(lead);
    await b.get("/lead");
    await b.post("/lead/do");
    // The log is a table in order of a sequence (0113), so "intent before done" does not depend on the clock (G1-16).
    const entries = (await r.actions()).filter((a) => a.action === "test_action");
    expect(entries.map((e) => e.phase)).toEqual(["intent", "done"]);
    expect(Number(entries[0]!.seq)).toBeLessThan(Number(entries[1]!.seq));
    expect(entries[0]!.ref).toBe(entries[1]!.ref);
    expect(entries.every((e) => e.party_id === lead.partyId && e.role === "ops_lead")).toBe(true);
    expect(entries[0]!.args).toEqual({ x: 1 });
    expect(entries[1]).toMatchObject({ ok: true, result: "Done." });
    // Nothing went to the bucket: the table replaces the objects.
    expect([...r.media.objects.keys()].filter((k) => k.startsWith("console_audit/"))).toEqual([]);

    r.media.failPut = true;
    const page = await b.post("/lead/do");
    expect(flashOf(page.text)).toContain("action log could not be written");
    expect(ran).toBe(1);
  });

  it("many actions in the same instant keep their order: intent before done, every time", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser(testSections);
    await b.signIn(lead);
    await b.get("/lead");
    for (let i = 0; i < 8; i++) await b.post("/lead/do");
    const rows = (await r.actions()).filter((a) => a.action === "test_action");
    expect(rows).toHaveLength(16);
    for (let i = 0; i < rows.length; i += 2) {
      expect([rows[i]!.phase, rows[i + 1]!.phase]).toEqual(["intent", "done"]);
      expect(rows[i]!.ref).toBe(rows[i + 1]!.ref);
    }
    const seqs = rows.map((x) => Number(x.seq));
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
  });

  it("the log is append-only: nothing updates, deletes or truncates it, and only staff can have an entry", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const seq = await r.db.rpc("log_staff_action", { p_party: lead.partyId, p_user: "u", p_role: "ops_lead", p_environment: "test", p_action: "x", p_phase: "event" });
    expect(Number(seq)).toBeGreaterThan(0);
    await expect(r.db.pg.query(`update staff_actions set action = 'y'`)).rejects.toThrow(/STAFF_ACTIONS_APPEND_ONLY/);
    await expect(r.db.pg.query(`delete from staff_actions`)).rejects.toThrow(/STAFF_ACTIONS_APPEND_ONLY/);
    await expect(r.db.pg.query(`truncate staff_actions`)).rejects.toThrow(/STAFF_ACTIONS_APPEND_ONLY/);
    const customer = await r.staff("customer");
    await expect(r.db.rpc("log_staff_action", { p_party: customer.partyId, p_user: "u", p_role: "customer", p_environment: "test", p_action: "x", p_phase: "intent" })).rejects.toThrow(/NOT_STAFF/);
    await expect(r.db.rpc("log_staff_action", { p_party: null, p_user: null, p_role: null, p_environment: "test", p_action: "x", p_phase: "intent" })).rejects.toThrow(/PARTY_REQUIRED/);
    await expect(r.db.rpc("log_staff_action", { p_party: null, p_user: null, p_role: null, p_environment: "test", p_action: "x", p_phase: "later" })).rejects.toThrow(/BAD_PHASE/);
  });

  it("a refused sign-in is an entry with no party; the password is never in the log", async () => {
    const lead = await r.staff("ops_lead");
    await r.browser(testSections).signIn({ email: lead.email, password: "wrong password!" });
    const rows = await r.actions();
    expect(rows.find((x) => x.action === "sign_in" && x.ok === false)).toMatchObject({ party_id: null, phase: "event", error: "bad_credentials" });
    expect(JSON.stringify(rows)).not.toContain("wrong password");
  });

  it("a database without 0113 (staging can lag the Worker) still gets its log, in the bucket, and an action still waits for it", async () => {
    const lagging = await rig({ without: ["log_staff_action"] });
    const lead = await lagging.staff("ops_lead", "Maya");
    const b = lagging.browser(testSections);
    await b.signIn(lead);
    await b.get("/lead");
    await b.post("/lead/do");
    expect([...lagging.media.objects.keys()].filter((k) => k.startsWith("console_audit/")).length).toBeGreaterThanOrEqual(3);   // sign-in, intent, done
    expect(lagging.media.audit().filter((a) => a.action === "test_action").map((a) => a.phase).sort()).toEqual(["done", "intent"]);
    const ranBefore = ran;
    lagging.media.failPut = true;
    expect(flashOf((await b.post("/lead/do")).text)).toContain("action log could not be written");
    expect(ran).toBe(ranBefore);
  });
});

describe("emailed link (new account or forgotten password)", () => {
  it("takes the token from the link, lets the person choose a password and signs them in", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const user = r.auth.users.get(lead.email)!.user;
    r.auth.tokens.set("tok-1", user);
    const b = r.browser(testSections);
    const landing = await b.get("/auth/callback");
    expect(landing.text).toContain('src="/callback.js"');
    const set = await b.post("/auth/callback", { access_token: "tok-1", type: "recovery" }, { follow: false });
    expect(set.location).toBe("/set-password");
    await b.get("/set-password");
    expect(flashOf((await b.post("/set-password", { password: "short", again: "short" })).text)).toContain("at least 12");
    expect(flashOf((await b.post("/set-password", { password: "a long new password", again: "another long one" })).text)).toContain("differ");
    const done = await b.post("/set-password", { password: "a long new password", again: "a long new password" }, { follow: false });
    expect(done.location).toBe("/");
    expect(r.auth.passwordsSet).toEqual([{ userId: user.id, password: "a long new password" }]);
    expect((await b.get("/")).text).toContain("hello Maya");
    expect(r.media.audit().some((a) => a.action === "set_password" && a.party_id === lead.partyId)).toBe(true);
  });

  it("refuses a bad token, and a token for someone who is not staff", async () => {
    const b = r.browser(testSections);
    expect((await b.post("/auth/callback", { access_token: "nope" })).text).toContain("not valid");
    const rider = await r.staff("driver");
    r.auth.tokens.set("tok-r", r.auth.users.get(rider.email)!.user);
    expect((await b.post("/auth/callback", { access_token: "tok-r" })).text).toContain("not valid");
    expect((await b.get("/set-password")).location).toBe("/sign-in");
  });

  it("the short-lived set-password cookie is not a session", async () => {
    const lead = await r.staff("ops_lead");
    r.auth.tokens.set("tok-2", r.auth.users.get(lead.email)!.user);
    const b = r.browser(testSections);
    await b.post("/auth/callback", { access_token: "tok-2" }, { follow: false });
    expect((await b.get("/")).location).toBe("/sign-in");
    b.cookies.set("ak_console", b.cookies.get("ak_setpw")!);
    expect((await b.get("/")).location).toBe("/sign-in");
  });
});
