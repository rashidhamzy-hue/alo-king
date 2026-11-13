// The console: routing, sign-in, roles, CSRF, the action log. Pages live in ./pages and register routes here.
//
// Security rules (BUILD_PLAN Phase 3):
// - The acting party passed to every SQL function is the signed-in staff member's party, read from the session and the
//   database. No route takes "who is acting" from the browser.
// - The role is read from `parties` on every request. The SQL functions check it again (NOT_AUTHORISED).
// - Every action is written to the action log before it runs; if the log cannot be written, the action does not run.
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import type { Db } from "./db";
import { DbError, isMissingFunction } from "./db";
import type { StaffAuth } from "./auth";
import { AuthUnavailable, MIN_PASSWORD } from "./auth";
import type { Media } from "./media";
import { CSS, form, html, page, type FormCtx, type NavItem, type Raw } from "./html";
import {
  FLASH_COOKIE, SESSION_COOKIE, SESSION_SECONDS, SETPW_COOKIE, clearCookie, hmac, randomToken, readCookie, same, seal, setCookie, unseal,
} from "./session";

import { STAFF_ROLES, type Role } from "./roles";
export type { Role } from "./roles";

export interface Deps {
  db: Db;
  auth: StaffAuth;
  media: Media;
  /** The gateway's send (packages/wa/src/gateway.ts): preflight, can_send, outbox claim. The console has no other way out. */
  send(req: SendRequest): Promise<SendResult>;
  secret: string;
  environment: string;
  supabaseUrl: string;
  now(): Date;
}

export interface Staff { partyId: string; userId: string; role: Role; name: string; csrf: string }
export interface Ctx {
  req: Request; url: URL; deps: Deps; staff: Staff; params: Record<string, string>; sections: Section[];
  form: Record<string, string>; flash: { ok?: string; err?: string } | null; f: FormCtx;
}
export type Handler = (c: Ctx) => Promise<Response>;
export interface Route { method: "GET" | "POST"; path: string; roles: readonly Role[]; handler: Handler }
export interface Section { nav: { href: string; label: string; roles: readonly Role[] }; routes: Route[] }

// ---------- helpers for pages ----------
export function render(c: Ctx, title: string, body: Raw | Raw[]): Response {
  const nav: NavItem[] = c.sections.filter((s) => s.nav.roles.includes(c.staff.role)).map((s) => ({ href: s.nav.href, label: s.nav.label }));
  return withHeaders(page({ title, staff: { name: c.staff.name, role: c.staff.role, csrf: c.staff.csrf }, nav, flash: c.flash, environment: c.deps.environment, body }), c.deps);
}

export function redirect(to: string, cookies: string[] = []): Response {
  const h = new Headers({ location: to });
  for (const ck of cookies) h.append("set-cookie", ck);
  return new Response(null, { status: 303, headers: h });
}

export const can = (c: Ctx, roles: readonly Role[]) => roles.includes(c.staff.role);

/** Plain words for the database's refusals. The SQL functions decide; this only explains. */
export function explain(e: unknown): string {
  if (isMissingFunction(e)) {
    const fn = /function\s+(?:public\.)?([a-z_]+)/i.exec((e as Error).message)?.[1] ?? "a function";
    return `Not available yet: the database has no ${fn}(). See "Console" in docs/HANDOFF.md.`;
  }
  if (e instanceof DbError) {
    const m = e.message;
    const known: [RegExp, string][] = [
      [/^NOT_AUTHORISED/, "Your role cannot do this."],
      [/^REFERENCE_REQUIRED/, "Type the transfer reference (at least 4 characters)."],
      [/^REFERENCE_ALREADY_USED/, "That reference was already used for another confirmed payment."],
      [/^UNDERPAID/, "The amount is less than the order total. Not confirmed."],
      [/^AMOUNT_REQUIRED/, "Type the amount received."],
      [/^COD_ORDER/, "This is a cash-on-delivery order; the rider records the cash."],
      [/^ORDER_CANCELLED_REFUND_NEEDED/, "The order is cancelled: this money needs a refund, not a confirmation."],
      [/^DROP_EXCEEDS_BALANCE/, "The drop is more than the rider holds. Not confirmed: count again with the rider."],
      [/^NEEDS_OPS_LEAD/, "Above the picker limit: an ops lead must make this change."],
      [/^BELOW_RESERVED/, "That would leave less on the shelf than is reserved for open orders."],
      [/^NOTE_REQUIRED/, "Write a note for reason 'other'."],
      [/^REASON_DOES_NOT_FIT/, "That reason does not fit the direction of the change."],
      [/^UNKNOWN_REASON/, "Pick a reason from the list."],
      [/^NO_CHANGE/, "The change is zero."],
      [/^BAD_COUNT/, "Type a count of zero or more."],
      [/^COMMISSION_REQUIRED/, "Type the contracted commission (above 0, at most 40%)."],
      [/^NO_APPROVED_MENU/, "Apply an approved menu with prices first."],
      [/^NOT_A_FAILED_DELIVERY/, "This order is not a failed delivery."],
      [/^IMAGE_REJECTED/, "This picture was rejected; it has to be proposed again before it can be approved."],
      [/^IMAGE_SUPERSEDED/, "A newer picture replaced this one."],
      [/^PRODUCT_ON_HOLD/, "The product is on hold (recall)."],
      [/^REASON_REQUIRED/, "Write the reason for the change."],
    ];
    for (const [re, say] of known) if (re.test(m)) return say;
    return `The database refused: ${m}`;
  }
  if (e instanceof UserError) return e.message;
  return "Something failed; nothing was changed by the console. Try again, and tell the admin if it repeats.";
}

/** A refusal written by the console itself, before the database is asked (a field left empty, a bad number). */
export class UserError extends Error {}

export function num(c: Ctx, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  const raw = (c.form[field] ?? "").trim().replace(/,/g, "");
  if (raw === "") { if (opts.optional) return null; throw new UserError(`Fill in ${field.replace(/_/g, " ")}.`); }
  const n = Number(raw);
  if (!Number.isFinite(n) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) throw new UserError(`${field.replace(/_/g, " ")} is not a valid number.`);
  return n;
}
export const text = (c: Ctx, field: string, max = 500) => (c.form[field] ?? "").trim().slice(0, max);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(c: Ctx, field: string): string {
  const v = (c.params[field] ?? c.form[field] ?? "").trim();
  if (!UUID.test(v)) throw new UserError("That record is not valid.");
  return v;
}

/**
 * Runs one staff action: log the intent, call the SQL function(s), log the outcome, come back with a message.
 * If the log cannot be written, nothing runs ("every admin action logged", task 3.1).
 */
export async function act(c: Ctx, action: string, args: Record<string, unknown>, run: () => Promise<string>, back: string): Promise<Response> {
  const ref = randomToken(8);
  try { await audit(c.deps, c.staff, { action, phase: "intent", ref, args }); }
  catch { return flashRedirect(c.deps, back, { err: "Not done: the action log could not be written. Try again in a minute." }); }
  let msg: { ok?: string; err?: string };
  try { msg = { ok: await run() }; await auditQuietly(c.deps, c.staff, { action, phase: "done", ref, ok: true, result: msg.ok }); }
  catch (e) {
    msg = { err: explain(e) };
    if (!(e instanceof UserError) && !(e instanceof DbError)) console.error(JSON.stringify({ level: "error", event: "console_action_failed", action, err: String(e).slice(0, 300) }));
    await auditQuietly(c.deps, c.staff, { action, phase: "done", ref, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
  }
  return flashRedirect(c.deps, back, msg);
}

// ---------- the action log ----------
// Objects in the private media bucket, one per entry, never overwritten: console_audit/<day>/<time>_<party>_<ref>_<phase>.json
// Supabase Storage, because D1 owns no migration. A table (staff_actions) is proposed in apps/console/sql/proposed_functions.sql.
export interface AuditEntry { action: string; phase: "intent" | "done" | "event"; ref?: string; args?: Record<string, unknown>; ok?: boolean; result?: string; error?: string }
export async function audit(deps: Deps, staff: { partyId: string; userId: string; role: string } | null, e: AuditEntry): Promise<void> {
  const at = deps.now().toISOString();
  const who = staff?.partyId ?? "anonymous";
  const path = `console_audit/${at.slice(0, 10)}/${at.replace(/[:.]/g, "-")}_${who}_${e.ref ?? randomToken(6)}_${e.phase}.json`;
  await deps.media.put(path, JSON.stringify({ at, environment: deps.environment, party_id: staff?.partyId ?? null, user_id: staff?.userId ?? null, role: staff?.role ?? null, ...e }), "application/json");
}
async function auditQuietly(deps: Deps, staff: Staff | null, e: AuditEntry) {
  try { await audit(deps, staff, e); }
  catch (err) { console.error(JSON.stringify({ level: "error", event: "console_audit_write_failed", action: e.action, phase: e.phase, err: String(err).slice(0, 200) })); }
}

async function flashRedirect(deps: Deps, to: string, msg: { ok?: string; err?: string }) {
  return redirect(to, [setCookie(FLASH_COOKIE, await seal(deps.secret, "flash", { ok: msg.ok?.slice(0, 400), err: msg.err?.slice(0, 400) }, 120, deps.now()), 120)]);
}

// ---------- staff ----------
async function loadStaff(deps: Deps, partyId: string, userId: string, nonce: string): Promise<Staff | null> {
  const rows = await deps.db.rows<{ id: string; role: string; display_name: string | null; is_blocked: boolean }>("parties", {
    select: "id,role,display_name,is_blocked", where: { id: partyId }, limit: 1,
  });
  const p = rows[0];
  if (!p || p.is_blocked || !STAFF_ROLES.includes(p.role as Role)) return null;
  return { partyId: p.id, userId, role: p.role as Role, name: p.display_name ?? "Staff", csrf: await hmac(deps.secret, `csrf:${nonce}`) };
}

async function newSession(deps: Deps, user: { id: string; partyId: string }): Promise<string> {
  return setCookie(SESSION_COOKIE, await seal(deps.secret, "session", { u: user.id, p: user.partyId, n: randomToken() }, SESSION_SECONDS, deps.now()), SESSION_SECONDS);
}

function withHeaders(res: Response, deps: Deps): Response {
  const h = new Headers(res.headers);
  let img = "'self'";
  try { img += " " + new URL(deps.supabaseUrl).origin; } catch { /* no supabase url in tests */ }
  h.set("content-security-policy", `default-src 'none'; img-src ${img}; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  h.set("x-content-type-options", "nosniff");
  // Not "no-referrer": with it Chrome sends `Origin: null` on our own form posts, and the cross-site check below refused them.
  h.set("referrer-policy", "same-origin");
  h.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers: h });
}

const plain = (deps: Deps, title: string, body: Raw | Raw[], flash: { ok?: string; err?: string } | null = null) =>
  withHeaders(page({ title, body, flash, environment: deps.environment }), deps);

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(":")) { if (!b[i]) return null; params[a[i]!.slice(1)] = decodeURIComponent(b[i]!); }
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function readForm(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) return out;
  const fd = await req.formData();
  for (const [k, v] of fd) if (typeof v === "string") out[k] = v;
  return out;
}

const CALLBACK_JS = `(function(){var h=new URLSearchParams(location.hash.slice(1));var t=h.get("access_token");
var f=document.getElementById("cb");if(!t||!f){document.getElementById("msg").textContent="This link has no sign-in token. Ask the admin for a new one.";return;}
f.access_token.value=t;f.type.value=h.get("type")||"";history.replaceState(null,"",location.pathname);f.submit();})();`;

// ---------- the request handler ----------
export async function handle(req: Request, deps: Deps, sections: Section[]): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/console.css") return new Response(CSS, { headers: { "content-type": "text/css", "cache-control": "max-age=300" } });
  if (path === "/callback.js") return new Response(CALLBACK_JS, { headers: { "content-type": "text/javascript", "cache-control": "max-age=300" } });
  if (path === "/health") return new Response("ok", { headers: { "content-type": "text/plain" } });
  if (method !== "GET" && method !== "POST") return new Response("method not allowed", { status: 405 });

  // Cross-site requests are refused before anything else (the session cookie is SameSite=Strict as well).
  if (method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("cross-site request refused", { status: 403 });
  }
  const now = deps.now();
  const form = method === "POST" ? await readForm(req) : {};

  // ----- signed-out routes -----
  if (path === "/sign-in" && method === "GET") return signInPage(deps, url.searchParams.get("e") === "1");
  if (path === "/sign-in" && method === "POST") return signIn(deps, form);
  if (path === "/auth/callback" && method === "GET") {
    return plain(deps, "Signing in", html`<p id="msg">One moment…</p><form id="cb" method="post" action="/auth/callback">
<input type="hidden" name="access_token"><input type="hidden" name="type"><noscript>This page needs JavaScript to read the link.</noscript></form>
<script src="/callback.js"></script>`);
  }
  if (path === "/auth/callback" && method === "POST") return callback(deps, form);

  const session = await unseal<{ u: string; p: string; n: string }>(deps.secret, "session", readCookie(req, SESSION_COOKIE), now);
  const setpw = await unseal<{ u: string; p: string }>(deps.secret, "setpw", readCookie(req, SETPW_COOKIE), now);

  if (path === "/set-password") {
    const who = session ? { u: session.u, p: session.p } : setpw;
    if (!who) return redirect("/sign-in");
    if (method === "GET") return setPasswordPage(deps, null, session ? await hmac(deps.secret, `csrf:${session.n}`) : await hmac(deps.secret, `setpw:${who.u}`));
    return setPassword(deps, form, who, session ? await hmac(deps.secret, `csrf:${session.n}`) : await hmac(deps.secret, `setpw:${who.u}`));
  }

  if (!session) return method === "GET" ? redirect("/sign-in") : new Response("signed out", { status: 401 });
  let staff: Staff | null;
  try { staff = await loadStaff(deps, session.p, session.u, session.n); }
  catch { return plain(deps, "Database unavailable", html`<p>The database did not answer. Try again in a minute.</p>`); }
  if (!staff) return redirect("/sign-in", [clearCookie(SESSION_COOKIE)]);

  if (method === "POST" && !same(form._csrf ?? "", staff.csrf)) return new Response("form expired: go back, reload and try again", { status: 403 });
  if (path === "/sign-out" && method === "POST") {
    await auditQuietly(deps, staff, { action: "sign_out", phase: "event" });
    return redirect("/sign-in", [clearCookie(SESSION_COOKIE)]);
  }

  let flash: Ctx["flash"] = null;
  const flashCookie = readCookie(req, FLASH_COOKIE);
  if (flashCookie) flash = await unseal<{ ok?: string; err?: string }>(deps.secret, "flash", flashCookie, now);

  for (const s of sections) for (const r of s.routes) {
    if (r.method !== method) continue;
    const params = match(r.path, path);
    if (!params) continue;
    const ctx: Ctx = { req, url, deps, staff, params, sections, form, flash, f: { csrf: staff.csrf, nonce: () => randomToken(12) } };
    if (!r.roles.includes(staff.role)) {
      const denied = render(ctx, "Not for your role", html`<p>Your role (${staff.role.replace("_", " ")}) cannot open this page.</p>`);
      return new Response(denied.body, { status: 403, headers: denied.headers });
    }
    let res: Response;
    try { res = await r.handler(ctx); }
    catch (e) {
      if (method === "POST" && e instanceof UserError) {
        // A form filled in wrong, refused before anything ran: back to the page it came from, with the reason.
        let back = "/";
        try { const ref = new URL(req.headers.get("referer") ?? ""); if (ref.origin === url.origin) back = ref.pathname + ref.search; } catch { /* no referer */ }
        return flashRedirect(deps, back, { err: e.message });
      }
      console.error(JSON.stringify({ level: "error", event: "console_page_failed", path, err: String(e).slice(0, 300) }));
      res = render(ctx, "Error", html`<p class="flash err">${explain(e)}</p>`);
    }
    if (flashCookie && method === "GET") { const h = new Headers(res.headers); h.append("set-cookie", clearCookie(FLASH_COOKIE)); res = new Response(res.body, { status: res.status, headers: h }); }
    return res.status === 303 ? res : withHeaders(res, deps);
  }
  return withHeaders(new Response("not found", { status: 404, headers: { "content-type": "text/plain" } }), deps);
}

// ---------- sign-in pages ----------
function signInPage(deps: Deps, failed: boolean): Response {
  return plain(deps, "Sign in", html`<form method="post" action="/sign-in">
<p><label>Email<br><input type="email" name="email" autocomplete="username" required></label></p>
<p><label>Password<br><input type="password" name="password" autocomplete="current-password" required></label></p>
<p><button>Sign in</button></p></form>
<p class="muted">Staff only. Accounts are added by the admin; a new account gets an email with a link to choose a password.</p>`,
  failed ? { err: "Email or password is wrong, or this account has no console access." } : null);
}

async function signIn(deps: Deps, form: Record<string, string>): Promise<Response> {
  const email = (form.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = (form.password ?? "").slice(0, 200);
  if (!email || !password) return redirect("/sign-in?e=1");
  let user;
  try { user = await deps.auth.signIn(email, password); }
  catch (e) {
    if (e instanceof AuthUnavailable) return plain(deps, "Sign in", html`<p>Sign-in is not answering right now. Try again in a minute.</p>`);
    throw e;
  }
  const staff = user?.partyId ? await loadStaff(deps, user.partyId, user.id, "x") : null;
  if (!user || !staff) {
    await auditQuietly(deps, null, { action: "sign_in", phase: "event", ok: false, error: user ? "not_staff" : "bad_credentials" });
    return redirect("/sign-in?e=1");
  }
  await auditQuietly(deps, staff, { action: "sign_in", phase: "event", ok: true });
  return redirect("/", [await newSession(deps, { id: user.id, partyId: staff.partyId })]);
}

async function callback(deps: Deps, form: Record<string, string>): Promise<Response> {
  const token = (form.access_token ?? "").slice(0, 4000);
  const user = token ? await deps.auth.userFromToken(token).catch(() => null) : null;
  const staff = user?.partyId ? await loadStaff(deps, user.partyId, user.id, "x") : null;
  if (!user || !staff) {
    await auditQuietly(deps, null, { action: "email_link", phase: "event", ok: false });
    return plain(deps, "Link not valid", html`<p>This link is not valid any more, or the account has no console access. Ask the admin for a new one.</p>`);
  }
  await auditQuietly(deps, staff, { action: "email_link", phase: "event", ok: true, result: (form.type ?? "").slice(0, 20) });
  return redirect("/set-password", [setCookie(SETPW_COOKIE, await seal(deps.secret, "setpw", { u: user.id, p: staff.partyId }, 900, deps.now()), 900)]);
}

function setPasswordPage(deps: Deps, err: string | null, csrf: string): Response {
  return plain(deps, "Choose a password", html`<form method="post" action="/set-password"><input type="hidden" name="_csrf" value="${csrf}">
<p><label>New password (at least ${MIN_PASSWORD} characters)<br><input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required></label></p>
<p><label>Again<br><input type="password" name="again" autocomplete="new-password" required></label></p>
<p><button>Save and sign in</button></p></form>`, err ? { err } : null);
}

async function setPassword(deps: Deps, form: Record<string, string>, who: { u: string; p: string }, csrf: string): Promise<Response> {
  if (!same(form._csrf ?? "", csrf)) return new Response("form expired: go back, reload and try again", { status: 403 });
  const pw = form.password ?? "";
  if (pw.length < MIN_PASSWORD || pw.length > 200) return setPasswordPage(deps, `Use at least ${MIN_PASSWORD} characters.`, csrf);
  if (pw !== form.again) return setPasswordPage(deps, "The two passwords differ.", csrf);
  const staff = await loadStaff(deps, who.p, who.u, "x");
  if (!staff) return redirect("/sign-in", [clearCookie(SETPW_COOKIE), clearCookie(SESSION_COOKIE)]);
  try { await audit(deps, staff, { action: "set_password", phase: "intent" }); }
  catch { return setPasswordPage(deps, "Not done: the action log could not be written. Try again in a minute.", csrf); }
  await deps.auth.setPassword(who.u, pw);
  return redirect("/", [clearCookie(SETPW_COOKIE), await newSession(deps, { id: who.u, partyId: staff.partyId })]);
}

export { form, html };
