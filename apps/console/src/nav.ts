// Navigation (redesigned in DS1; docs/strategy/05, section A): six groups and Settings in a sidebar on a laptop, each with an icon
// and a badge; the bottom bar on a phone, by role (DS2: admin Today, Orders, Inbox, Approve; lead Today, Orders, Inbox, Dispatch;
// picker Pick, Stock, Intake; More for all); and the list the command bar searches.
// The pages register themselves as sections (pages/index.ts); this file only decides where each section's link is shown, by its
// address, so no page module had to change. A section not listed here lands in "Other". Reports has no page yet (session AN1), so
// the group is not shown. Removed from navigation only, never from the routes: Vendors (/merchants), until the first vendor.
import type { Deps, Section } from "./app";
import type { IconName } from "@ak/ui/components";
import { kindHref, kindName } from "./kinds";
import { LEADS, type Role } from "./roles";
import { NAV_AR, t, type Lang, type Key } from "./i18n";

export interface NavLink { href: string; label: string; badge: number; current: boolean }
export interface NavGroup { id: string; heading: string | null; icon: IconName; hubHref: string | null; links: NavLink[]; badge: number; current: boolean }
export interface Nav { bottom: (NavLink & { icon: IconName })[]; groups: NavGroup[] }

type GroupId = "today" | "inbox" | "orders" | "approve" | "stock" | "money" | "riders" | "settings";
/** Which group shows which pages, in order. `hub` is the page a phone opens for the group (the sidebar needs none). */
export const GROUPS: { id: GroupId; key: Key; icon: IconName; hub: string | null; hrefs: string[]; /** Pages merged into the group's one page as a tab (section A): no link of their own, but the group is current on them. */ also?: string[] }[] = [
  { id: "today", key: "nav_today", icon: "home", hub: null, hrefs: ["/"], also: ["/exceptions"] },
  { id: "inbox", key: "nav_inbox", icon: "inbox", hub: null, hrefs: ["/inbox"], also: ["/cases"] },
  { id: "orders", key: "nav_orders", icon: "orders", hub: null, hrefs: ["/orders"] },
  { id: "approve", key: "g_approve", icon: "approve", hub: "/approve", hrefs: ["/approve", "/approvals", "/names", "/pictures", "/food-facts", "/intake", "/label-queue", "/search-words", "/auto-approvals", "/listings"] },
  { id: "stock", key: "nav_stock", icon: "stock", hub: "/stock", hrefs: ["/pick", "/purchase-orders", "/bins", "/temperature", "/capture", "/catalog", "/readiness", "/receiving", "/returns"] },
  { id: "money", key: "g_money", icon: "money", hub: "/more", hrefs: ["/money", "/payments", "/refunds", "/day-open", "/day-close", "/fx"], also: ["/money/drops"] },
  { id: "riders", key: "g_riders", icon: "bike", hub: "/more", hrefs: ["/riders", "/rider-jobs"], also: ["/rider-incidents"] },
  { id: "settings", key: "g_settings", icon: "settings", hub: "/more", hrefs: ["/settings", "/zones", "/windows", "/staff", "/templates", "/screens"] },
];
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
  const link = (s: Section): NavLink => ({ href: s.nav.href, label: labelFor(s, lang), badge: badges[s.nav.href] ?? 0, current: s.nav.href === "/" ? path === "/" : path === s.nav.href || path.startsWith(s.nav.href + "/") });
  const seen = new Set<string>();
  const groups: NavGroup[] = [];
  const under = (h: string) => path === h || path.startsWith(h + "/");
  const group = (id: string, heading: string, icon: IconName, hub: string | null, links: NavLink[], also: string[] = []) =>
    groups.push({ id, heading, icon, hubHref: hub, links, badge: links.reduce((a, l) => a + l.badge, 0), current: links.some((l) => l.current) || also.some(under) || (hub !== null && hub !== "/more" && path === hub) });
  for (const g of GROUPS) {
    const links = g.hrefs.flatMap((h) => mine.filter((s) => s.nav.href === h)).map((s) => { seen.add(s.nav.href); return link(s); });
    const also = (g.also ?? []).filter((h) => mine.some((s) => s.nav.href === h));
    also.forEach((h) => seen.add(h));
    if (links.length) group(g.id, t(lang, g.key), g.icon, g.hub, links, also);
  }
  const other = mine.filter((s) => !seen.has(s.nav.href)).map(link);
  if (other.length) group("other", t(lang, "g_other"), "list", "/more", other);

  const g = (id: string) => groups.find((x) => x.id === id);
  const has = (id: string) => (g(id)?.links.length ?? 0) > 0;
  const onMore = path === "/more" || path === "/install" || path === "/gallery";
  // DS2 (the design reference, docs/DECISIONS.md "Design reference, 17 November 2026"): the phone bar follows the role.
  //   admin:  Today, Orders, Inbox, Approve          lead:  Today, Orders, Inbox, Dispatch          picker:  Pick, Stock, Intake
  // and More for every role. A place is shown only when the role can open its page; Today stays reachable from the crown and More.
  const mineHas = (h: string) => mine.some((x) => x.nav.href === h);
  const on = (h: string) => path === h || path.startsWith(h + "/");
  const place: Record<string, () => (NavLink & { icon: IconName }) | null> = {
    today: () => ({ href: "/", label: t(lang, "nav_today"), icon: "home", badge: badges["/"] ?? 0, current: g("today")?.current ?? path === "/" }),
    orders: () => (has("orders") ? { href: "/orders", label: t(lang, "nav_orders"), icon: "orders", badge: g("orders")!.badge, current: g("orders")!.current } : null),
    inbox: () => (has("inbox") ? { href: "/inbox", label: t(lang, "nav_inbox"), icon: "inbox", badge: g("inbox")!.badge, current: g("inbox")!.current } : null),
    approve: () => (has("approve") ? { href: "/approve", label: t(lang, "nav_approve"), icon: "approve", badge: g("approve")!.badge, current: g("approve")!.current && !on("/capture") } : null),
    dispatch: () => (mineHas("/rider-jobs") ? { href: "/rider-jobs", label: t(lang, "nav_dispatch"), icon: "dispatch", badge: badges["/rider-jobs"] ?? 0, current: on("/rider-jobs") || on("/rider-incidents") } : null),
    pick: () => (mineHas("/pick") ? { href: "/pick", label: t(lang, "nav_pick"), icon: "pick", badge: badges["/pick"] ?? 0, current: on("/pick") } : null),
    stock: () => (has("stock") ? { href: "/stock", label: t(lang, "nav_stock"), icon: "stock", badge: g("stock")!.badge, current: g("stock")!.current && !on("/pick") && !on("/capture") } : null),
    intake: () => (mineHas("/capture") ? { href: "/capture", label: t(lang, "nav_intake"), icon: "camera", badge: badges["/capture"] ?? 0, current: on("/capture") } : null),
  };
  const BAR: Record<Role, string[]> = { admin: ["today", "orders", "inbox", "approve"], ops_lead: ["today", "orders", "inbox", "dispatch"], picker: ["pick", "stock", "intake"] };
  const bottom: Nav["bottom"] = BAR[role].map((k) => place[k]!()).filter((x): x is NavLink & { icon: IconName } => x !== null);
  // More holds every group that has no place of its own in the bar.
  const shown = new Set(bottom.map((b) => b.href));
  const rest = groups.filter((x) => !(shown.has("/") && x.id === "today") && !["inbox", "orders"].includes(x.id) && !(x.hubHref && shown.has(x.hubHref)));
  bottom.push({ href: "/more", label: t(lang, "nav_more"), icon: "menu", badge: rest.reduce((a, x) => a + x.badge, 0), current: onMore || (!bottom.some((x) => x.current) && rest.some((x) => x.current)) });
  return { bottom, groups };
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
      count("/approvals", () => rows("pending_approvals", { status: "pending" })),
      count("/names", () => rows("product_name_proposals", { status: "proposed" })),
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
