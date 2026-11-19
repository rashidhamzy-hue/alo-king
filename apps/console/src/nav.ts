// Navigation. CON1 (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026") redrew it as seven sections, phone first, in Arabic and English:
//   Today · Orders · Approvals · Products · Stock · People · Money
// and Settings behind the signed-in person's name (the /more page's "Settings" part), with the rarely used tools under "Advanced".
// Roles: a picker sees Pick and Stock only; an ops lead sees the seven sections; an admin sees everything (the seven, Settings, Staff).
// The pages register themselves as sections (pages/index.ts); this file only decides where each section's link is shown, by its address.
// A page that moved into another (app.ts, MOVED) keeps its route, and its group is current on it (`also`). A section in no group and not in
// ADVANCED lands in "Other" (none does today). Removed from navigation only, never from the routes: Vendors (/merchants), until the first vendor.
import type { Deps, Section } from "./app";
import type { IconName } from "@ak/ui/components";
import { kindHref, kindName } from "./kinds";
import { ALL, LEADS, type Role } from "./roles";
import { NAV_AR, t, type Lang, type Key } from "./i18n";

export interface NavLink { href: string; label: string; badge: number; current: boolean }
export interface NavGroup { id: string; heading: string | null; icon: IconName; hubHref: string | null; links: NavLink[]; badge: number; current: boolean }
export interface Nav { bottom: (NavLink & { icon: IconName })[]; groups: NavGroup[]; advanced: NavLink[] }

type GroupId = "pick" | "today" | "orders" | "approvals" | "products" | "stock" | "people" | "money";
/** A link that is not a section of its own: a tab of a page (Testers on Places, Applicants on Riders), shown when the role can open `base`. */
type Extra = { href: string; base: string; en: string; ar: string };
/** Which group shows which pages, in order, and to which roles. */
export const GROUPS: { id: GroupId; key: Key; icon: IconName; roles: readonly Role[]; hrefs: string[]; also?: string[]; extra?: Extra[] }[] = [
  { id: "pick", key: "nav_pick", icon: "pick", roles: ["picker"], hrefs: ["/pick"] },
  { id: "today", key: "nav_today", icon: "home", roles: LEADS, hrefs: ["/", "/inbox"], also: ["/exceptions", "/cases"] },
  { id: "orders", key: "nav_orders", icon: "orders", roles: LEADS, hrefs: ["/orders", "/food", "/pick", "/rider-jobs"], also: ["/rider-incidents"] },
  { id: "approvals", key: "nav_approvals", icon: "approve", roles: LEADS, hrefs: ["/approve"], also: ["/approvals", "/names", "/label-queue", "/auto-approvals"] },
  { id: "products", key: "g_products", icon: "basket", roles: LEADS, hrefs: ["/catalog", "/photos", "/labels", "/readiness", "/search-words", "/weights"], also: ["/pictures", "/intake", "/food-facts"] },
  { id: "stock", key: "nav_stock", icon: "stock", roles: ALL, hrefs: ["/stock", "/purchase-orders", "/receiving", "/bins", "/capture", "/temperature", "/returns"] },
  { id: "people", key: "g_people", icon: "users", roles: LEADS, hrefs: ["/riders", "/staff", "/places", "/listings", "/menus"],
    extra: [{ href: "/riders?tab=applicants", base: "/riders", en: "Rider applicants", ar: "المتقدّمون للتوصيل" }, { href: "/places?tab=testers", base: "/places", en: "Testers", ar: "المختبرون" }] },
  { id: "money", key: "g_money", icon: "money", roles: LEADS, hrefs: ["/money", "/payments", "/refunds", "/day-open", "/day-close"], also: ["/money/drops"] },
];
/** Settings and the rarely used tools: the "Settings" part of /more (behind the person's name), never the sidebar. In this order. */
export const ADVANCED = ["/settings", "/screens", "/templates", "/zones", "/windows", "/fx", "/components"];
/** A link that is current on another page too: a tab of its page (All exceptions on Today, Complaints on the Inbox), or a page that moved into it. */
const LINK_ALSO: Record<string, string[]> = { "/": ["/exceptions"], "/inbox": ["/cases"], "/orders": ["/rider-incidents"], "/approve": ["/approvals", "/names", "/label-queue", "/auto-approvals"],
  "/photos": ["/pictures"], "/labels": ["/intake", "/food-facts"], "/money": ["/money/drops"] };
/** Pages that keep their route and are in no menu (section A: "Hide until the first vendor"). */
export const HIDDEN = ["/merchants"];

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

/** The label for a page link: the section's own label in English, the Arabic name where one is written. */
export function labelFor(s: Section, lang: Lang): string {
  if (lang === "ar") return NAV_AR[s.nav.href] ?? s.nav.label;
  return s.nav.label;
}

export function buildNav(sections: Section[], role: Role, lang: Lang, path: string, badges: Record<string, number>): Nav {
  const mine = sections.filter((s) => s.nav.roles.includes(role) && !HIDDEN.includes(s.nav.href));
  const under = (h: string) => path === h || path.startsWith(h + "/");
  const link = (s: Section): NavLink => ({ href: s.nav.href, label: labelFor(s, lang), badge: badges[s.nav.href] ?? 0,
    current: (s.nav.href === "/" ? path === "/" : under(s.nav.href)) || (LINK_ALSO[s.nav.href] ?? []).some(under) });
  const seen = new Set<string>();
  const groups: NavGroup[] = [];
  for (const g of GROUPS) {
    if (!g.roles.includes(role)) continue;
    const links = g.hrefs.flatMap((h) => mine.filter((s) => s.nav.href === h)).map((s) => { seen.add(s.nav.href); return link(s); });
    for (const x of g.extra ?? []) if (mine.some((s) => s.nav.href === x.base)) links.push({ href: x.href, label: lang === "ar" ? x.ar : x.en, badge: 0, current: false });
    (g.also ?? []).forEach((h) => seen.add(h));
    if (!links.length) continue;
    const current = links.some((l) => l.current) || (g.also ?? []).some(under);
    groups.push({ id: g.id, heading: t(lang, g.key), icon: g.icon, hubHref: links[0]!.href, links, badge: links.reduce((a, l) => a + l.badge, 0), current });
  }
  // A picker sees Pick and Stock only (CON1, 4): no Advanced tools are listed for them (Screens stays open to every role by its address).
  const advanced = role === "picker" ? [] : ADVANCED.flatMap((h) => mine.filter((s) => s.nav.href === h)).map((s) => { seen.add(s.nav.href); return link(s); });
  ADVANCED.forEach((h) => seen.add(h));
  // A picker sees Pick and Stock only: what other sections the role may open by address are not listed (CON1, 4).
  const other = role === "picker" ? [] : mine.filter((s) => !seen.has(s.nav.href) && !GROUPS.some((g) => g.hrefs.includes(s.nav.href))).map(link);
  if (other.length) groups.push({ id: "other", heading: t(lang, "g_other"), icon: "list", hubHref: "/more", links: other, badge: other.reduce((a, l) => a + l.badge, 0), current: other.some((l) => l.current) });

  const g = (id: string) => groups.find((x) => x.id === id);
  const onMore = path === "/more" || path === "/install" || path === "/components" || advanced.some((l) => l.current);
  // The phone's bar (CON1): leads and the admin Today, Orders, Approvals, Stock; a picker Pick, Stock, Label photos; More for everyone.
  const mineHas = (h: string) => mine.some((x) => x.nav.href === h);
  const place: Record<string, () => (NavLink & { icon: IconName }) | null> = {
    today: () => (g("today") ? { href: "/", label: t(lang, "nav_today"), icon: "home", badge: g("today")!.badge, current: g("today")!.current } : null),
    orders: () => (g("orders") ? { href: "/orders", label: t(lang, "nav_orders"), icon: "orders", badge: g("orders")!.badge, current: g("orders")!.current } : null),
    approvals: () => (g("approvals") ? { href: "/approve", label: t(lang, "nav_approvals"), icon: "approve", badge: g("approvals")!.badge, current: g("approvals")!.current } : null),
    pick: () => (mineHas("/pick") && role === "picker" ? { href: "/pick", label: t(lang, "nav_pick"), icon: "pick", badge: badges["/pick"] ?? 0, current: under("/pick") } : null),
    stock: () => (g("stock") ? { href: "/stock", label: t(lang, "nav_stock"), icon: "stock", badge: g("stock")!.badge, current: g("stock")!.current && !(role === "picker" && under("/capture")) } : null),
    intake: () => (mineHas("/capture") ? { href: "/capture", label: t(lang, "nav_intake"), icon: "camera", badge: badges["/capture"] ?? 0, current: under("/capture") } : null),
  };
  const BAR: Record<Role, string[]> = { admin: ["today", "orders", "approvals", "stock"], ops_lead: ["today", "orders", "approvals", "stock"], picker: ["pick", "stock", "intake"] };
  const bottom: Nav["bottom"] = BAR[role].map((k) => place[k]!()).filter((x): x is NavLink & { icon: IconName } => x !== null);
  // More holds every group that has no place of its own in the bar, and Settings.
  const inBar = new Set(["today", "orders", "approvals", "stock", "pick"].filter((k) => BAR[role].includes(k)));
  const rest = groups.filter((x) => !inBar.has(x.id));
  bottom.push({ href: "/more", label: t(lang, "nav_more"), icon: "menu", badge: rest.reduce((a, x) => a + x.badge, 0), current: onMore || (!bottom.some((x) => x.current) && rest.some((x) => x.current)) });
  return { bottom, groups, advanced };
}

/**
 * What is waiting, per page address. Cheap reads only, each on its own: a database that lags behind (a table or function not
 * there yet) costs that one badge, never the page. Exception counts are for the roles that can open the exceptions page.
 */
export async function computeBadges(deps: Deps, role: Role): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const lead = LEADS.includes(role);
  const count = async (href: string, f: () => Promise<number>) => { try { const n = await f(); if (n > 0) out[href] = (out[href] ?? 0) + n; } catch { /* that badge stays off */ } };
  const rows = async (table: string, where: Record<string, unknown>) => (await deps.db.rows<{ id?: string }>(table, { select: "*", where: where as never, limit: 500 })).length;
  const rpcCount = async (fn: string) => { const r = await deps.db.rpc<unknown[] | null>(fn, {}); return Array.isArray(r) ? r.length : 0; };
  if (lead) {
    await Promise.all([
      count("/exceptions", () => rows("ops_exceptions", { status: { in: ["open", "acknowledged"] } })),
      count("/orders", async () => (await deps.db.rows<{ id: string }>("orders", { select: "id", where: { status: { in: ["delivered", "failed_delivery"] } }, limit: 500 })).length),
      count("/inbox", () => rows("support_cases", { state: { in: ["open", "claimed"] } })),
      // CON1: one Approvals inbox, one badge: everything that waits for a person's decision there (the cheap counts).
      count("/approve", () => rows("pending_approvals", { status: "pending" })),
      count("/approve", () => rows("product_name_proposals", { status: "proposed" })),
      count("/approve", () => rows("product_images", { status: "proposed" })),
      count("/payments", () => rpcCount("payment_proofs_open")),
      count("/returns", () => rpcCount("returns_pending")),
    ]);
    out["/"] = out["/exceptions"] ?? 0;
  }
  return out;
}

export interface BellData { count: number; items: { label: string; href: string; meta: string }[] }
/**
 * The bell: the open exceptions of the kinds that are pushed to a phone (settings.push_alerts.high_priority_kinds), oldest first.
 * The same items as the push alerts, so the bell never shows something a phone was not told. A lagging database gives an empty bell.
 */
export async function computeBell(deps: Deps, role: Role, lang: Lang, now: Date): Promise<BellData> {
  if (!LEADS.includes(role)) return { count: 0, items: [] };
  try {
    const cfg = await deps.db.rpc<{ high_priority_kinds?: string[] } | null>("setting", { p_key: "push_alerts" });
    const kinds = cfg?.high_priority_kinds ?? [];
    if (kinds.length === 0) return { count: 0, items: [] };
    const rows = await deps.db.rows<{ id: string; kind: string; ref: string; detail: Record<string, unknown> | null; created_at: string }>("ops_exceptions", {
      select: "id,kind,ref,detail,created_at", where: { status: { in: ["open", "acknowledged"] }, kind: { in: kinds } }, order: [{ col: "created_at" }], limit: 100 });
    const mins = (at: string) => Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60000));
    return { count: rows.length, items: rows.slice(0, 6).map((e) => ({ label: kindName(e.kind, lang), href: kindHref(e), meta: `${mins(e.created_at)} ${t(lang, "min")}` })) };
  } catch { return { count: 0, items: [] }; }
}
