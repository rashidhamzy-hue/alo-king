// Navigation (session D5): five places on a phone (Today, Orders, Approve, Stock, More), one list on a wide screen, and a badge
// on every place that has something waiting. The pages register themselves as sections (pages/index.ts); this file only decides
// where each section's link is shown, by its address, so no page module had to change. A section not listed here lands in "Other".
import type { Deps, Section } from "./app";
import { LEADS, type Role } from "./roles";
import { NAV_AR, t, type Lang, type Key } from "./i18n";

export interface NavLink { href: string; label: string; badge: number; current: boolean }
export interface NavGroup { id: string; heading: string | null; hubHref: string | null; links: NavLink[] }
export interface Nav { bottom: (NavLink & { icon: string })[]; groups: NavGroup[] }

/** Which hub shows which pages, in order. The home page and the orders page are first-level and belong to no group. */
export const GROUPS: { id: "run" | "approve" | "stock"; key: Key; hub: string | null; hrefs: string[] }[] = [
  { id: "run", key: "g_run", hub: "/more", hrefs: ["/day-open", "/day-close", "/exceptions", "/riders", "/windows", "/cases", "/merchants"] },
  { id: "approve", key: "g_approve", hub: "/approve", hrefs: ["/approvals", "/names", "/readiness", "/pictures", "/food-facts", "/search-words", "/auto-approvals", "/intake"] },
  { id: "stock", key: "g_stock", hub: "/stock", hrefs: ["/payments", "/catalog", "/receiving", "/returns", "/refunds", "/money", "/fx", "/zones"] },
];
const TOP = ["/", "/orders"];

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

/** The label for a page link: the section's own label in English, the Arabic name where one is written. */
export function labelFor(s: Section, lang: Lang): string {
  if (lang === "ar") return NAV_AR[s.nav.href] ?? s.nav.label;
  return s.nav.label;
}

export function buildNav(sections: Section[], role: Role, lang: Lang, path: string, badges: Record<string, number>): Nav {
  const mine = sections.filter((s) => s.nav.roles.includes(role));
  const link = (s: Section): NavLink => ({ href: s.nav.href, label: labelFor(s, lang), badge: badges[s.nav.href] ?? 0, current: s.nav.href === "/" ? path === "/" : path === s.nav.href || path.startsWith(s.nav.href + "/") });
  const seen = new Set<string>();
  const groups: NavGroup[] = [];
  const top = TOP.flatMap((h) => mine.filter((s) => s.nav.href === h)).map((s) => { seen.add(s.nav.href); return link(s); });
  if (top.length) groups.push({ id: "top", heading: null, hubHref: null, links: top });
  for (const g of GROUPS) {
    const links = g.hrefs.flatMap((h) => mine.filter((s) => s.nav.href === h)).map((s) => { seen.add(s.nav.href); return link(s); });
    if (links.length) groups.push({ id: g.id, heading: t(lang, g.key), hubHref: g.hub, links });
  }
  const other = mine.filter((s) => !seen.has(s.nav.href)).map(link);
  if (other.length) groups.push({ id: "other", heading: t(lang, "g_other"), hubHref: "/more", links: other });

  groups.push({ id: "menu", heading: null, hubHref: null, links: [{ href: "/more", label: t(lang, "nav_more"), badge: 0, current: path === "/more" || path === "/install" }] });
  const sum = (id: string) => (groups.find((g) => g.id === id)?.links ?? []).reduce((a, l) => a + l.badge, 0);
  const has = (id: string) => (groups.find((g) => g.id === id)?.links.length ?? 0) > 0;
  const ordersHere = mine.some((s) => s.nav.href === "/orders");
  const bottom: Nav["bottom"] = [
    { href: "/", label: t(lang, "nav_today"), icon: "●", badge: badges["/"] ?? 0, current: path === "/" },
    ...(ordersHere ? [{ href: "/orders", label: t(lang, "nav_orders"), icon: "▤", badge: badges["/orders"] ?? 0, current: path === "/orders" || path.startsWith("/orders/") }] : []),
    ...(has("approve") ? [{ href: "/approve", label: t(lang, "nav_approve"), icon: "✓", badge: sum("approve"), current: path === "/approve" || groups.find((g) => g.id === "approve")!.links.some((l) => l.current) }] : []),
    ...(has("stock") ? [{ href: "/stock", label: t(lang, "nav_stock"), icon: "▦", badge: sum("stock"), current: path === "/stock" || groups.find((g) => g.id === "stock")!.links.some((l) => l.current) }] : []),
    { href: "/more", label: t(lang, "nav_more"), icon: "≡", badge: sum("run") + sum("other"),
      current: path === "/more" || [...(groups.find((g) => g.id === "run")?.links ?? []), ...(groups.find((g) => g.id === "other")?.links ?? [])].some((l) => l.current) },
  ];
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
      count("/approvals", () => rows("pending_approvals", { status: "pending" })),
      count("/names", () => rows("product_name_proposals", { status: "proposed" })),
      count("/payments", () => rpcCount("payment_proofs_open")),
      count("/returns", () => rpcCount("returns_pending")),
    ]);
    out["/"] = out["/exceptions"] ?? 0;
  }
  return out;
}
