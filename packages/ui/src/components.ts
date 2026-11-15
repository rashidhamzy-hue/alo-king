// The components of docs/strategy/05, section C, as HTML functions. The console calls them directly; the website's Astro
// components (packages/ui/astro) wrap the same functions, so both apps print the same markup for the same thing.
// No function here reads data, formats money or knows a business rule: the caller passes words and numbers already decided.
// Styles: packages/ui/styles/components*.css. No inline style and no inline script is ever written (both apps' content policy).
import { Raw, attr, html } from "./h";
import { ICONS, type IconName } from "./icons";

export { crown } from "./crown";
export type { IconName } from "./icons";
type Body = Raw | Raw[] | string;
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---------- icon ----------
/** A Lucide icon. With `label` it is read out; without, it is decoration beside words. `flip` mirrors a forward arrow in right-to-left; `back` makes it a back arrow in both. */
export function icon(name: IconName, opts: { label?: string; flip?: boolean; back?: boolean; cls?: string } = {}): Raw {
  return html`<svg class="${cx("ak-icon", opts.flip && "ak-icon--flip", opts.back && "ak-icon--back", opts.cls)}" viewBox="0 0 24 24"${opts.label ? attr("role", "img") : attr("aria-hidden", "true")}${attr("aria-label", opts.label)}>${new Raw(ICONS[name])}</svg>`;
}

// ---------- button ----------
export type ButtonVariant = "default" | "primary" | "gold" | "on-ink" | "ghost" | "danger";
export interface ButtonOpts {
  label: string; variant?: ButtonVariant; icon?: IconName; iconOnly?: boolean; block?: boolean;
  /** A link when set, a <button> otherwise. */
  href?: string; external?: boolean; type?: "submit" | "button"; name?: string; value?: string; disabled?: boolean; cls?: string;
  /** Extra attributes, already safe (data-*, aria-*). */
  attrs?: Record<string, string | boolean>;
}
export function button(o: ButtonOpts): Raw {
  const cls = cx("ak-btn", o.variant && o.variant !== "default" && `ak-btn--${o.variant}`, o.block && "ak-btn--block", o.iconOnly && "ak-btn--icon", o.cls);
  const inner = html`${o.icon ? icon(o.icon) : ""}${o.iconOnly ? html`<span class="ak-sr">${o.label}</span>` : html`<span>${o.label}</span>`}`;
  const extra = Object.entries(o.attrs ?? {}).map(([k, v]) => attr(k, v));
  if (o.href !== undefined) return html`<a class="${cls}" href="${o.href}"${o.external ? new Raw(' rel="noopener"') : ""}${extra}>${inner}</a>`;
  return html`<button class="${cls}" type="${o.type ?? "submit"}"${attr("name", o.name)}${attr("value", o.value)}${attr("disabled", o.disabled)}${extra}>${inner}</button>`;
}

// ---------- input, select ----------
export interface InputOpts { name: string; label: string; value?: string; type?: string; placeholder?: string; required?: boolean; maxlength?: number; hideLabel?: boolean; invalid?: boolean; attrs?: Record<string, string | boolean> }
export function input(o: InputOpts): Raw {
  const extra = Object.entries(o.attrs ?? {}).map(([k, v]) => attr(k, v));
  const field = html`<input class="ak-input" type="${o.type ?? "text"}" name="${o.name}"${attr("value", o.value)}${attr("placeholder", o.placeholder)}${attr("maxlength", o.maxlength)}${attr("required", o.required)}${attr("aria-invalid", o.invalid ? "true" : null)}${o.hideLabel ? attr("aria-label", o.label) : ""}${extra}>`;
  return o.hideLabel ? field : html`<label class="ak-field"><span>${o.label}</span>${field}</label>`;
}
export interface SelectOpts { name: string; label: string; options: { value: string; label: string }[]; value?: string; hideLabel?: boolean; attrs?: Record<string, string | boolean> }
export function select(o: SelectOpts): Raw {
  const extra = Object.entries(o.attrs ?? {}).map(([k, v]) => attr(k, v));
  const field = html`<select class="ak-select" name="${o.name}"${o.hideLabel ? attr("aria-label", o.label) : ""}${extra}>${o.options.map((x) => html`<option value="${x.value}"${attr("selected", x.value === (o.value ?? ""))}>${x.label}</option>`)}</select>`;
  return o.hideLabel ? field : html`<label class="ak-field"><span>${o.label}</span>${field}</label>`;
}

// ---------- chip ----------
export interface ChipOpts { label: string; href: string; current?: boolean; count?: number }
export const chip = (o: ChipOpts): Raw => html`<a class="ak-chip" href="${o.href}"${attr("aria-current", o.current ? "true" : null)}>${o.label}${o.count !== undefined ? html` <span class="ak-num">${o.count}</span>` : ""}</a>`;
export const chips = (items: ChipOpts[], label?: string): Raw => html`<ul class="ak-chips"${attr("aria-label", label)}>${items.map((c) => html`<li>${chip(c)}</li>`)}</ul>`;

// ---------- badge, count ----------
export type Tone = "neutral" | "ok" | "warn" | "danger" | "gold";
export const badge = (label: string, tone: Tone = "neutral", ic?: IconName): Raw => html`<span class="${cx("ak-badge", tone !== "neutral" && `ak-badge--${tone}`)}">${ic ? icon(ic) : ""}${label}</span>`;
export const countText = (n: number) => (n > 99 ? "99+" : String(n));
export const count = (n: number, label?: string): Raw | "" => (n > 0 ? html`<span class="ak-count"${attr("aria-label", label)}>${countText(n)}</span>` : "");

// ---------- card ----------
export const card = (body: Body, opts: { title?: string; cls?: string } = {}): Raw => html`<section class="${cx("ak-card", opts.cls)}">${opts.title ? html`<h2>${opts.title}</h2>` : ""}${body}</section>`;

// ---------- KPI tile ----------
/** A trend line drawn on the server: no script, prints, and reads as a picture with a label. An empty or flat series still draws. */
export function sparkline(values: number[], label?: string): Raw {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return html``;
  const W = 100, H = 28, P = 3;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [P + (i * (W - 2 * P)) / (v.length - 1), H - P - ((y - min) * (H - 2 * P)) / span] as const);
  const last = pts[pts.length - 1]!;
  return html`<svg class="ak-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"${label ? attr("role", "img") : attr("aria-hidden", "true")}${attr("aria-label", label)}><polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2"/></svg>`;
}
export interface Compare { label: string; text: string; direction?: "up" | "down" | "flat"; /** Is this direction good news? Colours follow it; an arrow alone never carries the meaning. */ good?: boolean | null }
export interface KpiOpts { label: string; value: string; compare?: Compare[]; trend?: number[]; trendLabel?: string; alert?: boolean; href?: string; note?: string }
export function kpiTile(o: KpiOpts): Raw {
  const cmp = (o.compare ?? []).map((c) => html`<span class="${c.good === true ? "up" : c.good === false ? "down" : ""}">${c.direction === "up" ? icon("up") : c.direction === "down" ? icon("downArrow") : ""}<bdi>${c.text}</bdi> <span class="ak-muted">${c.label}</span></span>`);
  const inner = html`<span class="label">${o.label}</span><span class="value"><bdi>${o.value}</bdi></span>${cmp.length ? html`<span class="cmp">${cmp}</span>` : ""}${o.note ? html`<span class="cmp">${o.note}</span>` : ""}${o.trend ? sparkline(o.trend, o.trendLabel) : ""}`;
  return html`<li class="${cx("ak-kpi", o.alert && "ak-kpi--alert")}">${inner}${o.href ? html`<a class="ak-small" href="${o.href}">${icon("chevron", { flip: true })}<span class="ak-sr">${o.label}</span></a>` : ""}</li>`;
}
export const kpis = (tiles: Raw[]): Raw => html`<ul class="ak-kpis">${tiles}</ul>`;

// ---------- timer chip ----------
/** The share of a promise after which a timer turns amber. A display choice, not a business rule: the promise itself comes from the database. */
export const TIMER_AMBER_SHARE = 0.75;
export type TimerState = "ok" | "warn" | "late" | "idle";
export function timerState(minutes: number, promise: number | null): TimerState {
  if (promise === null || promise <= 0) return "idle";
  return minutes > promise ? "late" : minutes >= promise * TIMER_AMBER_SHARE ? "warn" : "ok";
}
export function timerChip(o: { minutes: number; promise: number | null; text: string; state?: TimerState }): Raw {
  const s = o.state ?? timerState(o.minutes, o.promise);
  return html`<span class="${cx("ak-timer", s !== "ok" && `ak-timer--${s}`)}">${icon(s === "late" ? "warn" : "clock")}${o.text}</span>`;
}

// ---------- a bar against a limit ----------
/** A value against one or two limits (a rider's cash against the soft and hard caps). The words beside it say the same thing. */
export function limitBar(o: { value: number; soft?: number | null; hard: number; label: string }): Raw {
  const max = Math.max(o.hard, o.value) * 1.08 || 1;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100)).toFixed(1)}%`;
  const tone = o.value >= o.hard ? "ak-bar--danger" : o.soft && o.value >= o.soft ? "ak-bar--warn" : "";
  return html`<svg class="${cx("ak-bar", tone)}" role="img" aria-label="${o.label}" preserveAspectRatio="none"><rect class="track" width="100%" height="100%" rx="4"/><rect class="fill" width="${pct(o.value)}" height="100%" rx="4"/>${o.soft ? html`<line class="mark mark--soft" x1="${pct(o.soft)}" x2="${pct(o.soft)}" y1="0" y2="100%"/>` : ""}<line class="mark" x1="${pct(o.hard)}" x2="${pct(o.hard)}" y1="0" y2="100%"/></svg>`;
}

// ---------- data table ----------
export interface Column { label: string; /** The address that sorts by this column (the server sorts). */ sortHref?: string; sorted?: "ascending" | "descending" | null; num?: boolean; wrap?: boolean }
export interface Row { cells: (Raw | string | number | null)[]; selected?: boolean; cls?: string }
export function dataTable(o: { columns: Column[]; rows: Row[]; caption: string; empty?: Raw }): Raw {
  if (o.rows.length === 0 && o.empty) return o.empty;
  return html`<div class="ak-table-wrap"><table class="ak-table"><caption class="ak-sr">${o.caption}</caption><thead><tr>${o.columns.map((c) => html`<th scope="col"${attr("class", c.num ? "num" : null)}${attr("aria-sort", c.sorted ?? null)}>${c.sortHref ? html`<a href="${c.sortHref}">${c.label}${icon(c.sorted === "ascending" ? "up" : c.sorted === "descending" ? "downArrow" : "sort")}</a>` : c.label}</th>`)}</tr></thead>
<tbody>${o.rows.map((r) => html`<tr${attr("class", r.cls)}${attr("aria-selected", r.selected ? "true" : null)}>${r.cells.map((cell, i) => html`<td${attr("class", cx(o.columns[i]?.num && "num", o.columns[i]?.wrap && "wrap") || null)}>${cell}</td>`)}</tr>`)}</tbody></table></div>`;
}

// ---------- tabs ----------
export const tabs = (items: { label: string; href: string; current?: boolean; count?: number }[], label: string): Raw =>
  html`<ul class="ak-tabs" aria-label="${label}">${items.map((t) => html`<li><a class="ak-tab" href="${t.href}"${attr("aria-current", t.current ? "page" : null)}>${t.label}${t.count ? count(t.count) : ""}</a></li>`)}</ul>`;

// ---------- drawer, dialog, toast ----------
/** A side panel rendered by the server: `closeHref` is the same list without it, so Back and a shared link both work, with no script. */
export function drawer(o: { title: string; closeHref: string; closeLabel: string; body: Body; id?: string }): Raw {
  return html`<a class="ak-drawer-scrim" href="${o.closeHref}" aria-label="${o.closeLabel}" tabindex="-1"></a><aside class="ak-drawer"${attr("id", o.id)} aria-label="${o.title}"><header><h2>${o.title}</h2>${button({ label: o.closeLabel, href: o.closeHref, icon: "close", iconOnly: true, variant: "ghost" })}</header>${o.body}</aside>`;
}
/** A native <dialog>: opened by a button with data-open-dialog="<id>" (the page script), closed by a form with method="dialog". */
export function dialog(o: { id: string; title: string; body: Body; actions: Body; open?: boolean }): Raw {
  return html`<dialog class="ak-dialog" id="${o.id}" aria-labelledby="${o.id}-t"${attr("open", o.open)}><h2 id="${o.id}-t">${o.title}</h2>${o.body}<div class="actions">${o.actions}</div></dialog>`;
}
export const toast = (o: { text: string; tone?: "ok" | "err" }): Raw => html`<div class="${cx("ak-toast", `ak-toast--${o.tone ?? "ok"}`)}" role="status">${icon(o.tone === "err" ? "alert" : "check")}<span>${o.text}</span></div>`;

// ---------- command bar ----------
export interface Command { label: string; href: string; hint?: string; icon?: IconName }
/** Jump to a page by typing; anything else typed searches orders (code, name or phone). Opened by Ctrl+K or the search button. */
export function commandBar(o: { id: string; label: string; placeholder: string; commands: Command[]; searchAction: string; searchName: string; hint: string }): Raw {
  return html`<dialog class="ak-cmdk" id="${o.id}" aria-label="${o.label}" data-cmdk><form method="get" action="${o.searchAction}">${icon("search")}<input name="${o.searchName}" type="search" autocomplete="off" placeholder="${o.placeholder}" aria-label="${o.label}" maxlength="60" enterkeyhint="go"></form>
<ul>${o.commands.map((c) => html`<li><a href="${c.href}">${icon(c.icon ?? "chevron", { flip: !c.icon })}<span>${c.label}</span>${c.hint ? html`<small>${c.hint}</small>` : ""}</a></li>`)}</ul><p class="hint">${o.hint}</p></dialog>`;
}

// ---------- bell ----------
export interface BellItem { label: string; href: string; meta?: string }
export function bell(o: { count: number; label: string; items: BellItem[]; empty: string; allHref: string; allLabel: string }): Raw {
  return html`<details class="ak-bell" data-bell><summary aria-label="${o.label}${o.count ? ` (${countText(o.count)})` : ""}">${icon("bell")}${count(o.count)}</summary><div class="panel">${o.items.length === 0 ? html`<p class="ak-muted ak-small">${o.empty}</p>` : html`<ul>${o.items.map((i) => html`<li><a href="${i.href}">${i.label}${i.meta ? html`<small>${i.meta}</small>` : ""}</a></li>`)}</ul>`}<a class="all" href="${o.allHref}">${o.allLabel}</a></div></details>`;
}

// ---------- empty, loading, error ----------
export function empty(o: { title: string; text?: string; icon?: IconName; ok?: boolean; action?: Raw; cls?: string }): Raw {
  return html`<div class="${cx("ak-empty", o.ok && "ak-empty--ok", o.cls)}">${icon(o.icon ?? (o.ok ? "check" : "inbox"))}<strong>${o.title}</strong>${o.text ? html`<span>${o.text}</span>` : ""}${o.action ?? ""}</div>`;
}
/** What stands in the place of content that is on its way: the same shapes, no words. `label` is read out once. */
export function loading(o: { label: string; tiles?: number; rows?: number }): Raw {
  const n = (k: number) => Array.from({ length: k });
  return html`<div role="status" aria-label="${o.label}">${o.tiles ? html`<ul class="ak-kpis">${n(o.tiles).map(() => html`<li class="ak-skeleton ak-skeleton--tile"></li>`)}</ul>` : ""}${n(o.rows ?? 3).map(() => html`<span class="ak-skeleton ak-skeleton--row"></span>`)}</div>`;
}
export function errorState(o: { title: string; text?: string; action?: Raw }): Raw {
  return html`<div class="ak-error" role="alert">${icon("alert")}<div><p><strong>${o.title}</strong></p>${o.text ? html`<p>${o.text}</p>` : ""}${o.action ?? ""}</div></div>`;
}

// ---------- product card ----------
export interface ProductCardOpts {
  href: string; name: string; meta?: string; price: string; inStock: boolean;
  picture: { src: string; width: number; height: number } | null;
  labels: { inStock: string; outOfStock: string; noPicture: string };
  /** The one-tap action. Until the cart exists (WEB2) it is "order this on WhatsApp"; then it becomes "add". */
  action?: { href: string; label: string; icon: IconName; external?: boolean } | null;
  /** schema.org Product microdata (no script): the shop's pages set it, the gallery does not. */
  microdata?: { sku: string; brand?: string | null; priceUsd: number };
}
export function productCard(o: ProductCardOpts): Raw {
  const md = o.microdata;
  return html`<li class="${cx("ak-product", !o.inStock && "ak-product--out")}"${md ? new Raw(' itemscope itemtype="https://schema.org/Product"') : ""}><a class="cover" href="${o.href}"${md ? new Raw(' itemprop="url"') : ""}>${o.picture
    ? html`<img class="pic" src="${o.picture.src}" alt="" loading="lazy" decoding="async" width="${o.picture.width}" height="${o.picture.height}"${md ? new Raw(' itemprop="image"') : ""}>`
    : html`<span class="ph" role="img" aria-label="${o.labels.noPicture}">${icon("image")}</span>`}
<span class="body"><span class="name"${md ? new Raw(' itemprop="name"') : ""}>${o.name}</span>${o.meta ? html`<span class="meta">${o.meta}</span>` : ""}${o.inStock ? badge(o.labels.inStock, "ok") : badge(o.labels.outOfStock, "warn")}</span></a>
<div class="foot"${md ? new Raw(' itemprop="offers" itemscope itemtype="https://schema.org/Offer"') : ""}>${md ? html`<meta itemprop="sku" content="${md.sku}"><meta itemprop="priceCurrency" content="USD"><meta itemprop="price" content="${md.priceUsd.toFixed(2)}"><link itemprop="availability" href="https://schema.org/${o.inStock ? "InStock" : "OutOfStock"}">` : ""}<span class="price"><bdi>${o.price}</bdi></span>${o.action ? button({ label: o.action.label, href: o.action.href, icon: o.action.icon, iconOnly: true, variant: "primary", cls: "add", external: o.action.external }) : ""}</div></li>`;
}

// ---------- cart bar ----------
export function cartBar(o: { count: number; total: string; note: string; progress?: { value: number; max: number; label: string } | null; cta: { href: string; label: string } }): Raw {
  return html`<div class="ak-cartbar">${icon("cart")}<span class="sum"><strong><bdi>${o.total}</bdi> · <span class="ak-num">${o.count}</span></strong><small>${o.note}</small>${o.progress ? html`<progress value="${o.progress.value}" max="${o.progress.max}" aria-label="${o.progress.label}"></progress>` : ""}</span>${button({ label: o.cta.label, href: o.cta.href, variant: "gold" })}</div>`;
}

// ---------- order timeline ----------
export interface TimelineStep { at?: string; kind?: string; text: Raw | string; state?: "done" | "now" | "bad" | "todo" }
export const orderTimeline = (steps: TimelineStep[]): Raw =>
  html`<ol class="ak-timeline">${steps.map((s) => html`<li${attr("class", s.state && s.state !== "todo" ? s.state : null)}>${s.at ? html`<time>${s.at}</time>` : ""}${s.kind ? html`<span class="k">${s.kind}</span>` : ""}${s.text}</li>`)}</ol>`;

// ---------- case row ----------
export interface CaseRowOpts { href: string; timer: Raw; title: string; order?: string | null; last?: string; tags?: Raw[]; state?: "open" | "claimed" | "late"; openLabel: string }
export function caseRow(o: CaseRowOpts): Raw {
  return html`<li><a class="${cx("ak-case", o.state === "late" && "ak-case--late", o.state === "claimed" && "ak-case--claimed")}" href="${o.href}">${o.timer}<span class="what"><strong>${o.title}${o.order ? html` · <bdi>${o.order}</bdi>` : ""}</strong>${o.last ? html`<span class="last">${o.last}</span>` : ""}${o.tags?.length ? html`<span class="tags">${o.tags}</span>` : ""}</span>${icon("chevron", { flip: true, label: o.openLabel })}</a></li>`;
}
export const caseList = (rows: Raw[]): Raw => html`<ul class="ak-cases">${rows}</ul>`;
