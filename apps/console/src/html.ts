// Server-rendered pages. The shell (head, navigation, language, install metadata) is built here; the stylesheet is style.ts.
// Every interpolated value is escaped unless it is itself a fragment built with `html`.

export class Raw { constructor(readonly s: string) {} toString() { return this.s; } }

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

function piece(v: unknown): string {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(piece).join("");
  if (v === null || v === undefined || v === false) return "";
  return escape(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => { out += piece(v) + strings[i + 1]!; });
  return new Raw(out);
}

export const usd = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `$${Number(n).toFixed(2)}`);
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
import type { Nav } from "./nav";
import { badgeText } from "./nav";
export { CSS } from "./style";

export interface PageOpts {
  title: string;
  staff?: { name: string; role: string; csrf: string } | null;
  nav?: Nav | null;
  lang?: Lang;
  /** True for a page whose words follow the language choice (the shell, Today, Orders, the hubs). Older pages stay English inside. */
  translated?: boolean;
  flash?: { ok?: string; err?: string } | null;
  environment: string;
  body: Raw | Raw[];
  /** The address, so the language switch comes back to the same page. */
  path?: string;
}

const badge = (n: number) => (n > 0 ? html`<span class="badge">${badgeText(n)}</span>` : "");

export function page(opts: PageOpts): Response {
  const lang: Lang = opts.lang ?? "en";
  const nav = opts.nav;
  const aside = nav ? html`<aside class="sidebar" aria-label="${t(lang, "all_pages")}">${nav.groups.map((g) => html`${g.heading ? html`<h2>${g.heading}</h2>` : ""}
${g.links.map((l) => html`<a href="${l.href}"${l.current ? new Raw(' aria-current="page"') : ""}><span>${l.label}</span>${badge(l.badge)}</a>`)}`)}</aside>` : "";
  const bottom = nav ? html`<nav class="bottom-nav" aria-label="${t(lang, "main_menu")}">${nav.bottom.map((l) => html`<a href="${l.href}"${l.current ? new Raw(' aria-current="page"') : ""}><span class="ic" aria-hidden="true">${l.icon}</span><span>${l.label}</span>${badge(l.badge)}</a>`)}</nav>` : "";
  const who = opts.staff ? html`<div class="who"><span>${opts.staff.name} (${opts.staff.role.replace("_", " ")})</span>
<form method="post" action="/sign-out"><input type="hidden" name="_csrf" value="${opts.staff.csrf}"><button>${t(lang, "sign_out")}</button></form></div>` : "";
  const banner = opts.environment === "production" ? "" : html`<div class="env">${t(lang, "test_data", { env: opts.environment.toUpperCase() })}</div>`;
  const flash = opts.flash?.err ? html`<p class="flash err">${opts.flash.err}</p>` : opts.flash?.ok ? html`<p class="flash ok">${opts.flash.ok}</p>` : "";
  // A page not yet translated keeps its own language inside an Arabic shell, so assistive technology is not told English is Arabic.
  const mainAttrs = lang === "ar" && !opts.translated ? new Raw(' lang="en" dir="ltr"') : "";
  const doc = html`<!doctype html><html lang="${lang}" dir="${dirOf(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#0f3d5e">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Alo King">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<title>${opts.title} · ${t(lang, "app_name")}</title><link rel="stylesheet" href="/console.css"></head>
<body><a class="skip" href="#main">${t(lang, "skip")}</a>${banner}<header class="top"><strong>${t(lang, "app_name")}</strong>${who}</header>
<div class="shell">${aside}<main id="main"${mainAttrs}><h1>${opts.title}</h1>${flash}${opts.body}</main></div>${bottom}<script src="/shell.js" defer></script></body></html>`;
  return new Response(doc.s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
