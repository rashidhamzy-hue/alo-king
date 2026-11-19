// Server-rendered pages. The shell (head, navigation, language, install metadata) is built here; the stylesheet is style.ts.
// Every interpolated value is escaped unless it is itself a fragment built with `html`.

// The fragment type and the tagged template are packages/ui's, so a component built there is a fragment here too.
import { Raw, escape, html } from "@ak/ui/h";
export { Raw, escape, html };

export const usd = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `$${Number(n).toFixed(2)}`);
/** An amount as a fragment that keeps its order inside Arabic text ($ first, Western digits). */
export const money = (n: unknown, more: string = "") => html`<bdi>${usd(n)}${more}</bdi>`;
export const lbp = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `${Math.round(Number(n)).toLocaleString("en-US")} LBP`);
export const when = (t: unknown) => {
  if (!t) return "";
  const d = new Date(String(t));
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString("en-GB", { timeZone: "Asia/Beirut", dateStyle: "short", timeStyle: "short" });
};
export const minutesSince = (t: unknown, now: Date) => (t ? Math.floor((now.getTime() - new Date(String(t)).getTime()) / 60000) : null);

export interface FormCtx { csrf: string; nonce: () => string }

/** A POST form. Every form carries the CSRF token and a one-time key, so a double tap is recognised downstream. */
export function form(f: FormCtx, action: string, body: Raw | Raw[], opts: { cls?: string; confirm?: boolean; files?: boolean } = {}) {
  return html`<form method="post" action="${action}" class="${opts.cls ?? ""}"${opts.files ? new Raw(' enctype="multipart/form-data"') : ""}>
<input type="hidden" name="_csrf" value="${f.csrf}"><input type="hidden" name="_key" value="${f.nonce()}">${body}</form>`;
}

import { dirOf, t, type Lang } from "./i18n";
import type { BellData, Nav } from "./nav";
import { badgeText } from "./nav";
import { bell as bellPanel, commandBar, crown, icon, previewNotice, type Command } from "@ak/ui/components";
export { CSS } from "./style";
import { UI_TOKENS } from "./ui.generated";

export type Theme = "auto" | "light" | "dark";
/** A reversible action's way back: a POST to a route of the console itself, with its fields (UX2a; see flashRedirect in app.ts). */
export interface FlashUndo { label: string; action: string; fields?: Record<string, string> }
export const THEMES: readonly Theme[] = ["auto", "light", "dark"];

export interface PageOpts {
  title: string;
  staff?: { name: string; role: string; csrf: string } | null;
  nav?: Nav | null;
  lang?: Lang;
  /** True for a page whose words follow the language choice (the shell, Today, Inbox, Orders, the hubs). Older pages stay English inside. */
  translated?: boolean;
  flash?: { ok?: string; err?: string; undo?: FlashUndo } | null;
  environment: string;
  body: Raw | Raw[];
  /** The address, so the language switch comes back to the same page. */
  path?: string;
  /** The staff member's own choice (a cookie); "auto" follows the phone. */
  theme?: Theme;
  /** The open high-priority exceptions: the same items the push alerts carry. Leads only. */
  bell?: BellData | null;
  /** May this person search orders from the command bar (the orders page is for leads)? */
  canSearchOrders?: boolean;
}

const badge = (n: number) => (n > 0 ? html`<span class="badge">${badgeText(n)}</span>` : "");
const cur = (on: boolean) => (on ? new Raw(' aria-current="page"') : "");

export function page(opts: PageOpts): Response {
  const lang: Lang = opts.lang ?? "en";
  const nav = opts.nav;
  // The sidebar: a group with one page is a link; a group with several opens to show them, and is open when you are in it.
  // DS2 (the design reference): the sidebar is the full height of the window on ink, with the crown and the signed-in role at its head.
  const brand = html`<a class="side-brand" href="/">${crown({ tone: "on-gold" })}<span><b>${t(lang, "app_name")}</b>${opts.staff ? html`<small>${opts.staff.role.replace("_", " ")}</small>` : ""}</span></a>`;
  const aside = nav ? html`<aside class="sidebar" aria-label="${t(lang, "all_pages")}">${brand}${nav.groups.map((g) => g.links.length === 1
    ? html`<a href="${g.links[0]!.href}"${cur(g.current)}>${icon(g.icon)}<span>${g.heading}</span>${badge(g.badge)}</a>`
    : html`<details${g.current ? new Raw(" open") : ""}><summary>${icon(g.icon)}<span>${g.heading}</span>${badge(g.badge)}${icon("chevron", { flip: true, cls: "chev" })}</summary>
${g.links.map((l) => html`<a href="${l.href}"${cur(l.current)}><span>${l.label}</span>${badge(l.badge)}</a>`)}</details>`)}</aside>` : "";
  const bottom = nav ? html`<nav class="bottom-nav" aria-label="${t(lang, "main_menu")}">${nav.bottom.map((l) => html`<a href="${l.href}"${cur(l.current)}><span class="ic">${icon(l.icon)}</span><span>${l.label}</span>${badge(l.badge)}</a>`)}</nav>` : "";
  const commands: Command[] = nav ? [
    ...nav.groups.flatMap((g) => g.links.map((l) => ({ label: l.label, href: l.href, hint: g.links.length > 1 ? g.heading ?? undefined : undefined, icon: g.icon }))),
    ...nav.advanced.filter((l) => l.href !== "/components" || opts.environment !== "production").map((l) => ({ label: l.label, href: l.href, hint: t(lang, "advanced_h"), icon: "settings" as const })),
    { label: t(lang, "nav_more"), href: "/more", icon: "menu" as const },
  ] : [];
  const tools = nav ? html`<a class="tool search" href="/more" data-open-cmdk aria-keyshortcuts="Control+K">${icon("search")}<span class="lbl">${t(lang, "cmd_open")}</span><kbd>Ctrl K</kbd></a>
${opts.bell ? bellPanel({ count: opts.bell.count, label: t(lang, "bell_label"), items: opts.bell.items, empty: t(lang, "bell_empty"), allHref: "/exceptions", allLabel: t(lang, "bell_all") }) : ""}` : "";
  // CON1: Settings sits behind the person's name (the "Settings" part of /more: Settings for the admin, Advanced, and this phone's own choices).
  const who = opts.staff ? html`<div class="who"><a class="name-link" href="/more#settings" title="${t(lang, "your_settings")}">${icon("settings")}<span class="name">${opts.staff.name} (${opts.staff.role.replace("_", " ")})</span></a>
<form method="post" action="/sign-out"><input type="hidden" name="_csrf" value="${opts.staff.csrf}"><button aria-label="${t(lang, "sign_out")}" title="${t(lang, "sign_out")}">${icon("signout", { flip: true })}</button></form></div>` : "";
  const banner = opts.environment === "production" ? "" : html`<div class="env">${previewNotice(t(lang, "test_data", { env: opts.environment.toUpperCase() }))}</div>`;
  // A toast: what happened, in words; with Undo (a small form that posts to the action's own way back) only where the database can take it back.
  const undo = opts.flash?.ok && opts.flash.undo && opts.staff
    ? html`<form method="post" action="${opts.flash.undo.action}"><input type="hidden" name="_csrf" value="${opts.staff.csrf}"><input type="hidden" name="_key" value="${crypto.randomUUID().replace(/-/g, "")}">${Object.entries(opts.flash.undo.fields ?? {}).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button class="ak-toast-undo">${opts.flash.undo.label}</button></form>` : "";
  const flash = opts.flash?.err ? html`<p class="flash err">${opts.flash.err}</p>` : opts.flash?.ok ? (undo ? html`<div class="flash-row" role="status"><p class="flash ok">${opts.flash.ok}</p>${undo}</div>` : html`<p class="flash ok">${opts.flash.ok}</p>`) : "";
  // A page not yet translated keeps its own language inside an Arabic shell, so assistive technology is not told English is Arabic.
  const mainAttrs = lang === "ar" && !opts.translated ? new Raw(' lang="en" dir="ltr"') : "";
  const theme = opts.theme && opts.theme !== "auto" ? new Raw(` data-theme="${opts.theme}"`) : "";
  const cmdk = nav ? commandBar({ id: "cmdk", label: t(lang, "cmd_label"), placeholder: t(lang, opts.canSearchOrders ? "cmd_ph" : "cmd_ph_pages"), commands,
    searchAction: "/go", searchName: "q", hint: t(lang, opts.canSearchOrders ? "cmd_hint" : "cmd_hint_pages") }) : "";
  // AST1: the assistant, for leads only (a picker has none), on every page but its own.
  const ask = !!(nav && opts.staff && (opts.staff.role === "admin" || opts.staff.role === "ops_lead") && opts.path !== "/assistant");
  const doc = html`<!doctype html><html lang="${lang}" dir="${dirOf(lang)}"${theme}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="${THEME_COLOR}">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Alo King">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preload" href="/fonts/${lang === "ar" ? "plex-arabic-400" : "plex-latin-400"}.woff2" as="font" type="font/woff2" crossorigin>
<title>${opts.title} · ${t(lang, "app_name")}</title><link rel="stylesheet" href="/console.css"></head>
<body><a class="skip" href="#main">${t(lang, "skip")}</a>
<div class="${nav ? "shell" : "shell shell--bare"}">${aside}<div class="col">${banner}<header class="top"><a class="ak-logo" href="/">${crown({ tone: "on-ink" })}<strong>${t(lang, "app_name")}</strong></a>${tools}${who}</header>
<main id="main"${mainAttrs}><h1>${opts.title}</h1>${flash}${opts.body}</main></div>${ask ? assistantPanel(lang, opts.staff!.csrf) : ""}</div>${ask ? assistantButton(lang) : ""}${bottom}${cmdk}<script src="/shell.js" defer></script></body></html>`;
  return new Response(doc.s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * AST1: the assistant (invariant 21: it answers from read-only reports and never acts). A button on every lead's page (above the phone's bar;
 * it opens /assistant) and, on a wide screen, a panel beside the page with the starter questions and a question box. With the page script the
 * answer appears in the panel; without it, the form posts and /assistant shows the conversation.
 */
export function assistantButton(lang: Lang): Raw {
  return html`<a class="ak-assistant-btn" href="/assistant" aria-label="${t(lang, "assistant")}">${icon("chat")}<span>${t(lang, "assistant")}</span></a>`;
}
const STARTERS = [["What's late right now?", "ما المتأخر الآن؟"], ["Which restaurant was slowest today?", "أي مطعم كان الأبطأ اليوم؟"], ["What should I fix first?", "ما الذي يجب أن أصلحه أولاً؟"]] as const;
export function assistantPanel(lang: Lang, csrf: string): Raw {
  const ar = lang === "ar";
  const starter = (q: string) => html`<form method="post" action="/assistant" data-ask><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="q" value="${q}"><button class="ak-chip">${q}</button></form>`;
  return html`<aside class="ak-assistant" aria-label="${t(lang, "assistant")}" data-assistant="AST1"><h2>${icon("chat")}<span>${t(lang, "assistant")}</span></h2>
<p class="muted">${t(lang, "assistant_note")}</p><ol class="ak-log" data-assistant-log aria-live="polite"></ol>
<div class="ak-starters">${STARTERS.map(([en, a]) => starter(ar ? a : en))}</div>
<form method="post" action="/assistant" class="ak-ask" data-ask><input type="hidden" name="_csrf" value="${csrf}"><label class="visually-hidden" for="ak-q-panel">${t(lang, "assistant_q")}</label>
<textarea id="ak-q-panel" name="q" rows="2" maxlength="600" required placeholder="${t(lang, "assistant_ph")}"></textarea><button>${t(lang, "assistant_ask")}</button>
<p class="muted ak-wait" data-ask-wait hidden>${t(lang, "assistant_wait")}</p></form><p><a href="/assistant">${t(lang, "assistant_all")}</a></p></aside>`;
}

/** The browser's own chrome (the status bar of the installed app): the brand's ink, in both themes. From tokens.css. */
export const THEME_COLOR = UI_TOKENS.ink;
