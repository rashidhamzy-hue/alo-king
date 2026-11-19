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
import type { ScreensStore } from "../../../scripts/screens/storage.mjs";
import { CSS, THEMES, form, html, page, type FlashUndo, type FormCtx, type Raw, type Theme } from "./html";
import {
  FLASH_COOKIE, SESSION_COOKIE, SESSION_SECONDS, SETPW_COOKIE, clearCookie, hmac, randomToken, readCookie, same, seal, setCookie, unseal,
} from "./session";
import { LANGS, LANG_COOKIE, type Lang } from "./i18n";
import { buildNav, computeBadges, computeBell, type BellData } from "./nav";
import { LEADS } from "./roles";
import { staticRoute } from "./pwa";

import { STAFF_ROLES, type Role } from "./roles";
export type { Role } from "./roles";

export interface Deps {
  db: Db;
  auth: StaffAuth;
  media: Media;
  /** DOC2: the private `screens` bucket (screenshots of the console and the website, listed by the Screens page). Absent in a rig that has none. */
  screens?: Pick<ScreensStore, "list" | "sign">;
  /** The gateway's send (packages/wa/src/gateway.ts): preflight, can_send, outbox claim. The console has no other way out. */
  send(req: SendRequest): Promise<SendResult>;
  secret: string;
  environment: string;
  supabaseUrl: string;
  now(): Date;
  /** 5.15: the label reader (src/label.ts), when the console has a model key; absent, intake is typed by hand. */
  readLabel?: (images: import("./label").LabelImage[], hint?: string) => Promise<import("./label").LabelReading | null>;
  /** The model the label reader uses, recorded with each reading. */
  labelModel?: string;
  /** The VAPID public key (a Worker secret's public half) when web push is set up; absent, the alerts switch says so. */
  pushPublicKey?: string;
  /** OPS1: one test alert to this staff member's own phones. Present when web push is set up. */
  pushTest?: (partyId: string) => Promise<{ subscribers: number; sent: number }>;
  /**
   * CON1: the errors of the last 24 hours, counted by Sentry (a read-only token as a Worker secret). Absent (no token, local, tests), Today says
   * "not connected" instead of a number. A failed read is null: Today says the count could not be read, never 0.
   */
  errorsLast24h?: () => Promise<{ count: number; link: string } | null>;
}

export interface Staff { partyId: string; userId: string; role: Role; name: string; csrf: string }
export interface Ctx {
  req: Request; url: URL; deps: Deps; staff: Staff; params: Record<string, string>; sections: Section[];
  form: Record<string, string>; files: Record<string, File>; flash: { ok?: string; err?: string; undo?: FlashUndo } | null; f: FormCtx;
  /** The staff member's language (cookie), and what is waiting per page address (computed on a page view, empty on a post). */
  lang: Lang; badges: Record<string, number>;
  /** The appearance this person chose (a cookie), and the bell's items (the open high-priority exceptions; computed on a page view). */
  theme: Theme; bell: BellData;
  /** CON1: a frame drawn above the page's own body (the tabs of the page a merged older page now lives in). Set by that page, read by render(). */
  top?: Raw;
}
export type Handler = (c: Ctx) => Promise<Response>;
export interface Route { method: "GET" | "POST"; path: string; roles: readonly Role[]; handler: Handler }
export interface Section { nav: { href: string; label: string; roles: readonly Role[] }; routes: Route[] }

// ---------- helpers for pages ----------
/** `translated`: the body's words follow `c.lang` (Today, Orders, the hubs). Pages built before D5 are English and are marked as such in an Arabic shell. */
export function render(c: Ctx, title: string, body: Raw | Raw[], opts: { translated?: boolean } = {}): Response {
  const nav = buildNav(c.sections, c.staff.role, c.lang, c.url.pathname.replace(/\/+$/, "") || "/", c.badges);
  const framed = c.top ? html`${c.top}${body}` : body;
  return withHeaders(page({ title, staff: { name: c.staff.name, role: c.staff.role, csrf: c.staff.csrf }, nav, lang: c.lang, translated: opts.translated ?? false, flash: c.flash, environment: c.deps.environment, body: framed,
    theme: c.theme, bell: LEADS.includes(c.staff.role) ? c.bell : null, canSearchOrders: LEADS.includes(c.staff.role) }), c.deps);
}

/** WH1a: a page with no menu, in a language chosen for it (a purchase order printed in Arabic or English, whatever the staff member reads). */
export function renderBare(c: Ctx, lang: Lang, title: string, body: Raw | Raw[]): Response {
  return withHeaders(page({ title, staff: { name: c.staff.name, role: c.staff.role, csrf: c.staff.csrf }, nav: null, lang, translated: true, flash: null,
    environment: c.deps.environment, body, theme: "light" }), c.deps);
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
      [/^NEEDS_OPS_LEAD to pay from the till/, "Only the ops lead pays from the drawer. Receive it on credit."],
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
      [/^ORDER_NOT_PAID/, "Nothing was paid on this order: correct it, do not refund it."],
      [/^REFUND_EXCEEDS_PAID/, "That is more than was paid on this order, counting earlier refunds."],
      [/^REFUND_EXCEEDS_REVENUE revenue_delivery/, "The delivery fee belongs to the rider now. Charge compensation to goodwill instead."],
      [/^REFUND_EXCEEDS_REVENUE/, "That is more than is still booked for this order under that heading."],
      [/^EXCEEDS_CREDIT/, "That is more than the customer's free credit."],
      [/^ITEM_NOT_ON_ORDER/, "That item is not on this order."],
      [/^BAD_AMOUNT/, "Type an amount above zero."],
      [/^NOT_ENOUGH_CASH hub_cash/, "The drawer does not hold that much by the books. Count it, and check what came in today."],
      [/^NOT_ENOUGH_CASH bank/, "The bank does not hold that much by the books."],
      [/^NAME_REQUIRED/, "Write the name."],
      [/^CANNOT_CHANGE_SELF/, "You cannot change or block your own account. Ask another admin."],
      [/^UNKNOWN_ROLE/, "Pick admin, ops lead or picker."],
      [/^NOT_STAFF/, "That person is not a staff member."],
      [/^EXPIRY_REQUIRED (.*) is/, "Chilled, frozen and fresh goods need their expiry date."],
      [/^COST_REQUIRED/, "Type the unit cost of every line."],
      [/^UNKNOWN_CATEGORY/, "Pick a category from the list."],
      [/^UNKNOWN_SUPPLIER/, "That supplier is not active."],
      [/^DIFFERENCE_NOTE_REQUIRED/, "The count differs from the books: write a note saying what you know."],
      [/^PRODUCT_REQUIRED/, "An allergen complaint needs the item it is about."],
      [/^DETAIL_REQUIRED/, "Write what the customer said."],
      [/^OUTCOME_REQUIRED/, "Write the outcome."],
      [/^CASE_CLOSED/, "This case is closed."],
      [/^REFUND_NOT_ON_ORDER/, "That refund is for another order."],
      [/^SAME_PERSON/, "You asked for this change: a second person must approve it."],
      [/^EVIDENCE_REQUIRED/, "Attach the pack (a photo) or the document, or give its reference."],
      [/^EVIDENCE_NOT_FOR_PRODUCT/, "That evidence is for another item."],
      [/^CERTIFIED_NEEDS_CERTIFICATE/, "Certified needs a certificate or a lab report as evidence."],
      [/^FACT_VALUE/, "That value does not fit what the fact is about."],
      [/^SECOND_OPINION_ONLY/, "Open Food Facts is a second opinion only: confirm the field against the pack."],
      [/^FACT_NOT_PENDING/, "That field was already decided."],
      [/^CONFIRM_STATUS/, "Confirm as declared, certified or unknown: the pack either says it or it does not."],
      [/^DAY_NOT_OVER/, "That day has not come yet."],
      [/^SLIP_ALREADY_USED/, "That slip number was already recorded for another deposit."],
      [/^UNKNOWN_SKU/, "That item is not on sale (or has no SKU), so it gets no search words."],
      [/^LABEL_DISAGREES/, "The label says otherwise. Confirm the label's field (corrected where the pack differs), then set the web proposal aside."],
      [/^PROPOSAL_NOT_FOUND/, "That proposal was not found."],
      [/^ITEM_NOT_IN_CATALOG/, "That item is not in the catalog database, so no name can be applied."],
      [/^NAME_TOO_LONG/, "A name is at most 160 characters and a size at most 40."],
      [/^NAME_AR_NOT_ARABIC/, "The Arabic name or size has no Arabic letters."],
      [/^CLAIM_WORDS ([^:]*)/, "A name may not praise, or make a health, diet or religion claim. Remove: $1."],
      [/^NAME_CHANGED_SINCE/, "The catalog name was changed after this approval, so it is not put back from here."],
      [/^UNKNOWN_DECISION/, "Choose approve, correct or reject."],
      [/^NOT_PENDING/, "That one was already decided."],
      [/^CAPTURE_SHOT/, "Choose front, back or side."],
      [/^CAPTURE_PATH/, "That photo does not belong to this item."],
      [/^PRODUCT_NOT_FOUND/, "That item was not found."],
      [/^WEEKDAYS_INVALID/, "Tick at least one day of the week."],
      [/^WINDOW_ENDS_BEFORE_START/, "A window must end after it starts."],
      [/^CAPACITY_INVALID/, "Capacity is a number of orders, zero or more."],
      [/^CUTOFF_INVALID/, "Fresh goods must close at least as early as the rest."],
      [/^CALENDAR_KIND_INVALID/, "Pick the kind: ramadan, lent, holiday or other."],
      [/^DATES_INVALID/, "The last day is before the first."],
      [/^UNKNOWN_ZONE/, "That zone does not exist."],
      [/^UNKNOWN_PLAN/, "That plan was not found."],
      [/^UNKNOWN_ENTRY/, "That calendar entry was not found."],
      [/^UNKNOWN_SLOT/, "That window was not found."],
      [/^ORDER_NOT_FOUND/, "That order was not found."],
      [/^ILLEGAL_TRANSITION/, "The order machine does not allow that step from where the order is."],
      [/^NOT_YOUR_ORDER/, "That order is not the customer's own."],
      [/^REASON_REQUIRED/, "Write the reason (at least 3 characters)."],
      [/^NOT_HIDDEN/, "That page is not hidden."],
      [/^ALREADY_HIDDEN/, "That page is already hidden."],
      [/^UNKNOWN_LISTING/, "That place was not found."],
      [/^REQUEST_NOT_OPEN/, "That request is already closed."],
      // FD1: places and menus (0245 to 0247)
      [/^OWNER_NOT_ON_FILE/, "A place is public only once its owner's claim or application is on file. Keep it on testers only."],
      [/^PLACE_EXISTS/, "A place was already made from this listing."],
      [/^LISTING_NOT_FOUND/, "That listing was not found, or it is hidden."],
      [/^VILLAGE_REQUIRED/, "Choose the place's village."],
      [/^PHONE_INVALID/, "Type the number in full: + and the country code (+961...)."],
      [/^PREP_MINUTES/, "Preparation time is 0 to 180 minutes."],
      [/^HOURS_INVALID/, "Opening and closing are times like 11:00 and 22:00."],
      [/^VISIBILITY_INVALID/, "Choose off, testers only or public."],
      [/^NOT_A_PLACE/, "That is not a place made from a listing."],
      [/^MENU_PATH/, "That photo does not belong to this place."],
      [/^MENU_PHOTOS_UNREAD/, "A menu photo is still waiting for the reading run."],
      [/^MENU_DISHES_WAITING/, "Approve or reject every dish first."],
      [/^MENU_NOT_CHECKED/, "Stamp the menu as checked first (Menus page)."],
      [/^DISH_NAME_CLAIM/, "A dish name says what it is, never how good or healthy it is. Change the name, then approve."],
      [/^PRICE_REQUIRED/, "Type the price as printed and choose USD or LBP."],
      [/^DISH_ALREADY_REVIEWED/, "That dish was already decided."],
      [/^DISH_NOT_FOUND/, "That dish was not found."],
      [/^NO_FX_RATE/, "Record today's lira rate (Money, Rate) before approving a lira price."],
    ];
    for (const [re, say] of known) { const hit = re.exec(m); if (hit) return say.replace(/\$(\d)/g, (_, i) => hit[Number(i)] ?? ""); }
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
 * UX2b: the Approve page's cards post to the same routes as the older list pages (names, pictures, label approvals, second approvals), and
 * come back to the next card. `return_to` is honoured only for an address of that page and nothing else; anything else is the page's own way back.
 */
export function returnTo(c: Ctx, fallback: string): string {
  const v = c.form.return_to ?? "";
  return /^\/approve\?tab=(names|pictures|photos|labels|money|second|refunds|dishes|places|auto)(&n=\d{1,4})?$/.test(v) || /^\/photos\?f=(all|review|later|missing)(&n=\d{1,4})?$/.test(v) ? v : fallback;
}

/**
 * CON1: the console's older addresses that now live inside another page (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026").
 * A GET of one of these exact paths answers 301 with the new address, keeping its own query (a page number, a filter); its posts and its
 * item pages (/intake/<id>, /food-facts/<id>) are unchanged. The new page draws the older page's own handler, so nothing that worked stops.
 */
export const MOVED: Record<string, string> = {
  "/approvals": "/approve?tab=second&view=list",
  "/names": "/approve?tab=names&view=list",
  "/label-queue": "/approve?tab=labels&view=list",
  "/auto-approvals": "/approve?tab=auto&view=list",
  "/pictures": "/photos?f=list",
  "/gallery": "/photos",
  "/intake": "/labels",
  "/food-facts": "/labels?step=facts",
};
/** The new address for an older one, with the older address's own query added (its keys win only where the new address has none). */
export function movedTo(path: string, search: URLSearchParams): string | null {
  const to = MOVED[path];
  if (!to) return null;
  const u = new URL(to, "https://console.invalid");
  for (const [k, v] of search) if (!u.searchParams.has(k)) u.searchParams.append(k, v);
  return u.pathname + (u.searchParams.size ? `?${u.searchParams.toString()}` : "");
}
/**
 * CON1: draws an older page's own GET handler inside the page it moved into (the handler, its reads and its forms are unchanged). The older
 * route's roles still decide: a role that could not open the older page cannot open it here either.
 */
export async function drawOlder(c: Ctx, path: string, top?: Raw): Promise<Response> {
  const r = c.sections.flatMap((s) => s.routes).find((x) => x.method === "GET" && x.path === path);
  if (!r) return render(c, "Not found", html`<p class="muted">That page is not part of this console.</p>`);
  if (!r.roles.includes(c.staff.role)) {
    const denied = render(c, "Not for your role", html`<p>Your role (${c.staff.role.replace("_", " ")}) cannot open this page.</p>`);
    return new Response(denied.body, { status: 403, headers: denied.headers });
  }
  return r.handler(top ? { ...c, top } : c);
}

/**
 * Runs one staff action: log the intent, call the SQL function(s), log the outcome, come back with a message.
 * If the log cannot be written, nothing runs ("every admin action logged", task 3.1).
 */
export async function act(c: Ctx, action: string, args: Record<string, unknown>, run: () => Promise<string>, back: string): Promise<Response> {
  const r = await attempt(c, action, args, run);
  // CON1: a card of the Approvals inbox comes back to the next card (only an address of that inbox or of Photos is honoured; returnTo).
  return flashRedirect(c.deps, returnTo(c, back), r.logged ? r.msg : { err: "Not done: the action log could not be written. Try again in a minute." });
}

/**
 * The same, without the redirect: for a page that does several things in one request (the names batch). Log the intent first and
 * do nothing if that fails (`logged: false`); run; log the outcome. The message is the page's to show.
 */
export async function attempt(c: Ctx, action: string, args: Record<string, unknown>, run: () => Promise<string>): Promise<{ logged: boolean; ref: string; ok: boolean; msg: { ok?: string; err?: string } }> {
  const ref = randomToken(8);
  try { await audit(c.deps, c.staff, { action, phase: "intent", ref, args }); }
  catch { return { logged: false, ref, ok: false, msg: {} }; }
  let msg: { ok?: string; err?: string };
  try { msg = { ok: await run() }; await auditQuietly(c.deps, c.staff, { action, phase: "done", ref, ok: true, result: msg.ok }); }
  catch (e) {
    msg = { err: explain(e) };
    if (!(e instanceof UserError) && !(e instanceof DbError)) console.error(JSON.stringify({ level: "error", event: "console_action_failed", action, err: String(e).slice(0, 300) }));
    await auditQuietly(c.deps, c.staff, { action, phase: "done", ref, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
  }
  return { logged: true, ref, ok: msg.err === undefined, msg };
}

// ---------- the action log ----------
// The staff_actions table (0113), written by log_staff_action() and nothing else: ordered by a sequence, append-only, queryable.
// Until 0113 reaches a database (staging can lag behind this Worker) the entry goes to the private media bucket instead, as it
// did before, so "log first or nothing" holds either way: console_audit/<day>/<time>_<party>_<ref>_<phase>.json, never overwritten.
// Who changed configuration, and why, is also in config_changes (0045).
export interface AuditEntry { action: string; phase: "intent" | "done" | "event"; ref?: string; args?: Record<string, unknown>; ok?: boolean; result?: string; error?: string }
export async function audit(deps: Deps, staff: { partyId: string; userId: string; role: string } | null, e: AuditEntry): Promise<void> {
  try {
    await deps.db.rpc("log_staff_action", {
      p_party: staff?.partyId ?? null, p_user: staff?.userId ?? null, p_role: staff?.role ?? null, p_environment: deps.environment,
      p_action: e.action, p_phase: e.phase, p_ref: e.ref ?? null, p_args: e.args ?? null, p_ok: e.ok ?? null, p_result: e.result ?? null, p_error: e.error ?? null,
    });
  } catch (err) {
    if (!isMissingFunction(err)) throw err;
    await auditToBucket(deps, staff, e);
  }
}
async function auditToBucket(deps: Deps, staff: { partyId: string; userId: string; role: string } | null, e: AuditEntry): Promise<void> {
  const at = deps.now().toISOString();
  const who = staff?.partyId ?? "anonymous";
  const path = `console_audit/${at.slice(0, 10)}/${at.replace(/[:.]/g, "-")}_${who}_${e.ref ?? randomToken(6)}_${e.phase}.json`;
  await deps.media.put(path, JSON.stringify({ at, environment: deps.environment, party_id: staff?.partyId ?? null, user_id: staff?.userId ?? null, role: staff?.role ?? null, ...e }), "application/json");
}
export async function auditQuietly(deps: Deps, staff: Staff | null, e: AuditEntry) {
  try { await audit(deps, staff, e); }
  catch (err) { console.error(JSON.stringify({ level: "error", event: "console_audit_write_failed", action: e.action, phase: e.phase, err: String(err).slice(0, 200) })); }
}

/**
 * `undo` (UX2a): a reversible action says so in the toast. It is a POST to one of the console's own routes, built here on the server and
 * sealed in the cookie, so the browser cannot make one up. The toast carries it only for an action the database can take back
 * (a pick line marked or unmarked); money and messages are never undoable and never get one.
 */
export async function flashRedirect(deps: Deps, to: string, msg: { ok?: string; err?: string }, undo?: FlashUndo) {
  const safe = undo && undo.action.startsWith("/") && !undo.action.startsWith("//") && !undo.action.includes("\\") ? { label: undo.label.slice(0, 40), action: undo.action.slice(0, 200), fields: undo.fields } : undefined;
  return redirect(to, [setCookie(FLASH_COOKIE, await seal(deps.secret, "flash", { ok: msg.ok?.slice(0, 400), err: msg.err?.slice(0, 400), undo: msg.ok ? safe : undefined }, 120, deps.now()), 120)]);
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
  h.set("content-security-policy", `default-src 'none'; img-src ${img}; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  h.set("x-content-type-options", "nosniff");
  // Not "no-referrer": with it Chrome sends `Origin: null` on our own form posts, and the cross-site check below refused them.
  h.set("referrer-policy", "same-origin");
  h.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers: h });
}

const plain = (deps: Deps, title: string, body: Raw | Raw[], flash: { ok?: string; err?: string; undo?: FlashUndo } | null = null, lang: Lang = "en", theme: Theme = "auto") =>
  withHeaders(page({ title, body, flash, lang, translated: false, environment: deps.environment, theme }), deps);

export const THEME_COOKIE = "ak_theme";
function readTheme(req: Request): Theme {
  const v = readCookie(req, THEME_COOKIE);
  return (THEMES as readonly string[]).includes(v ?? "") ? (v as Theme) : "auto";
}
/** A path on this site only: never another host, never a protocol-relative address. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/");

function readLang(req: Request): Lang {
  const v = readCookie(req, LANG_COOKIE);
  return (LANGS as readonly string[]).includes(v ?? "") ? (v as Lang) : "en";
}

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

async function readForm(req: Request): Promise<{ fields: Record<string, string>; files: Record<string, File> }> {
  const fields: Record<string, string> = {}; const files: Record<string, File> = {};
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) return { fields, files };
  const fd = await req.formData();
  for (const [k, v] of fd) {
    if (typeof v === "string") fields[k] = v;
    else if (v && typeof v === "object" && "arrayBuffer" in v && (v as File).size > 0) files[k] = v as File;
  }
  return { fields, files };
}

// ---------- photos and documents (slips, receipts, labels) ----------
const UPLOAD_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const MAX_UPLOAD = 8 * 1024 * 1024;
/**
 * Stores one uploaded file in the private media bucket under `<prefix>/<day>/<sha256>.<ext>` and returns its path, or null when
 * the field was left empty. The name is the content's hash: the same photo sent twice is one object. Never logged, never public.
 */
export async function upload(c: Ctx, field: string, prefix: string): Promise<string | null> {
  const f = c.files[field];
  if (!f) return null;
  const ext = UPLOAD_TYPES[f.type];
  if (!ext) throw new UserError("Attach a photo (JPEG, PNG, WebP) or a PDF.");
  if (f.size > MAX_UPLOAD) throw new UserError("The file is larger than 8 MB.");
  const bytes = await f.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${prefix}/${c.deps.now().toISOString().slice(0, 10)}/${hash}.${ext}`;
  try { await c.deps.media.put(path, bytes, f.type); }
  catch (e) { if (!(await c.deps.media.sign(path, 30))) throw e; }   // already stored by an earlier tap
  return path;
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
  // The installable shell (manifest, icons, service worker, page script, offline page): static, public, no one's data.
  const asset = method === "GET" ? staticRoute(path) : null;
  if (asset) return asset;
  const lang = readLang(req);
  // The language choice: a cookie, no account setting. `next` must be a path on this site.
  if (path === "/lang" && method === "GET") {
    const to = url.searchParams.get("to");
    const next = url.searchParams.get("next") ?? "/";
    const h = new Headers({ location: safeNext(next) });
    if (to && (LANGS as readonly string[]).includes(to)) h.append("set-cookie", setCookie(LANG_COOKIE, to, 365 * 86400));
    return new Response(null, { status: 303, headers: h });
  }
  // The appearance (light, dark, or as the phone says): a cookie as well, so the page arrives in the right colours with no script.
  const theme = readTheme(req);
  if (path === "/theme" && method === "GET") {
    const to = url.searchParams.get("to");
    const h = new Headers({ location: safeNext(url.searchParams.get("next")) });
    if (to && (THEMES as readonly string[]).includes(to)) h.append("set-cookie", setCookie(THEME_COOKIE, to, 365 * 86400));
    return new Response(null, { status: 303, headers: h });
  }

  // Cross-site requests are refused before anything else (the session cookie is SameSite=Strict as well).
  if (method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("cross-site request refused", { status: 403 });
  }
  const now = deps.now();
  const posted = method === "POST" ? await readForm(req) : { fields: {}, files: {} };
  const form = posted.fields;

  // ----- signed-out routes -----
  if (path === "/sign-in" && method === "GET") return signInPage(deps, url.searchParams.get("e") === "1", lang);
  if (path === "/sign-in" && method === "POST") return signIn(deps, form, req.headers.get("cf-connecting-ip"));
  if (path === "/auth/callback" && method === "GET") {
    return plain(deps, "Signing in", html`<p id="msg">One moment…</p><form id="cb" method="post" action="/auth/callback">
<input type="hidden" name="access_token"><input type="hidden" name="type"><noscript>This page needs JavaScript to read the link.</noscript></form>
<script src="/callback.js"></script>`, null, lang);
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
  catch { return plain(deps, "Database unavailable", html`<p>The database did not answer. Try again in a minute.</p>`, null, lang); }
  if (!staff) return redirect("/sign-in", [clearCookie(SESSION_COOKIE)]);
  // CON1: an older address that moved into another page (a bookmark, a link in a message, a form's way back).
  const moved = method === "GET" ? movedTo(path, url.searchParams) : null;
  if (moved) return new Response(null, { status: 301, headers: { location: moved, "cache-control": "no-store" } });

  if (method === "POST" && !same(form._csrf ?? "", staff.csrf)) return new Response("form expired: go back, reload and try again", { status: 403 });
  if (path === "/sign-out" && method === "POST") {
    await auditQuietly(deps, staff, { action: "sign_out", phase: "event" });
    return redirect("/sign-in", [clearCookie(SESSION_COOKIE)]);
  }

  let flash: Ctx["flash"] = null;
  const flashCookie = readCookie(req, FLASH_COOKIE);
  if (flashCookie) flash = await unseal<{ ok?: string; err?: string; undo?: FlashUndo }>(deps.secret, "flash", flashCookie, now);

  for (const s of sections) for (const r of s.routes) {
    if (r.method !== method) continue;
    const params = match(r.path, path);
    if (!params) continue;
    const [badges, bell] = method === "GET"
      ? await Promise.all([computeBadges(deps, staff.role).catch(() => ({} as Record<string, number>)), computeBell(deps, staff.role, lang, now)])
      : [{} as Record<string, number>, { count: 0, items: [] } as BellData];
    const ctx: Ctx = { req, url, deps, staff, params, sections, form, files: posted.files, flash, lang, badges, theme, bell, f: { csrf: staff.csrf, nonce: () => randomToken(12) } };
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
function signInPage(deps: Deps, failed: boolean, lang: Lang = "en"): Response {
  return plain(deps, "Sign in", html`<form method="post" action="/sign-in">
<p><label>Email<br><input type="email" name="email" autocomplete="username" required></label></p>
<p><label>Password<br><input type="password" name="password" autocomplete="current-password" required></label></p>
<p><button>Sign in</button></p></form>
<p class="muted">Staff only. Accounts are added by the admin; a new account gets an email with a link to choose a password.</p>`,
  failed ? { err: "Email or password is wrong, or this account has no console access." } : null, lang);
}

/** 0141: failures are counted per email and per address, as keyed hashes (nothing readable is stored). A database without 0141 yet is not throttled. */
async function throttleKeys(deps: Deps, email: string, ip: string | null): Promise<string[]> {
  const hex = async (label: string, v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await hmac(deps.secret, `${label}:${v}`))))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [`e:${await hex("signin-email", email)}`, ...(ip ? [`i:${await hex("signin-ip", ip.slice(0, 64))}`] : [])];
}

async function signIn(deps: Deps, form: Record<string, string>, ip: string | null = null): Promise<Response> {
  const email = (form.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = (form.password ?? "").slice(0, 200);
  if (!email || !password) return redirect("/sign-in?e=1");
  const keys = await throttleKeys(deps, email, ip);
  try {
    const gate = await deps.db.rpc<{ allowed: boolean; retry_after_s?: number } | null>("signin_allowed", { p_keys: keys });
    if (gate && gate.allowed === false) {
      const wait = Math.max(1, Math.ceil(Number(gate.retry_after_s ?? 900) / 60));
      const res = plain(deps, "Sign in", html`<p>Too many wrong tries. Wait about ${wait} minutes and try again.</p>`);
      return new Response(res.body, { status: 429, headers: (() => { const h = new Headers(res.headers); h.set("retry-after", String(gate.retry_after_s ?? 900)); return h; })() });
    }
  } catch (e) {
    if (!isMissingFunction(e)) return plain(deps, "Sign in", html`<p>Sign-in is not answering right now. Try again in a minute.</p>`);   // fail closed: if we cannot count, we do not let tries through
  }
  const failed = () => deps.db.rpc("signin_failed", { p_keys: keys }).catch((e) => { if (!isMissingFunction(e)) console.error(JSON.stringify({ level: "error", event: "signin_throttle_write_failed", err: String(e).slice(0, 200) })); });
  let user;
  try { user = await deps.auth.signIn(email, password); }
  catch (e) {
    if (e instanceof AuthUnavailable) return plain(deps, "Sign in", html`<p>Sign-in is not answering right now. Try again in a minute.</p>`);
    throw e;
  }
  const staff = user?.partyId ? await loadStaff(deps, user.partyId, user.id, "x") : null;
  if (!user || !staff) {
    await failed();
    await auditQuietly(deps, null, { action: "sign_in", phase: "event", ok: false, error: user ? "not_staff" : "bad_credentials" });
    return redirect("/sign-in?e=1");
  }
  await deps.db.rpc("signin_ok", { p_key: keys[0] }).catch(() => undefined);
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
