// Orders (session D5, drawn again in DS1; docs/strategy/05, section A): a real table. Find an order by its code, the customer's name
// or any part of their number; filter by status, channel, village, payment and dates; sort; choose columns; export what is shown.
// Everything is in the address, so a filter is a link that can be saved or sent, and the server does the work (no script needed).
// One order reads as a story: who, what, in which order things happened, what was said around it, what was paid and refunded.
// On a wide screen it opens in a drawer beside the list (the same address with `open=`); on a phone it is its own page.
// Read-only, except two buttons that file an eval case through file_order_eval_case() (0159): "wrong product" and "bot at fault".
// They change nothing on the order. The customer's phone is searched but never shown; a voice note is shown as "[audio]", never its words.
// Not here because nothing in the database gives it to this page yet (listed in docs/HANDOFF.md, DS1): a filter by rider, saved
// views kept per staff member, pictures on the lines.
import { act, audit, html, id, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, money, usd, when } from "../html";
import { pick, t, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { ACTIVE, beirutMidnight, statusWord } from "./today";
import { badge, button, chips, dataTable, drawer, empty, icon, input, orderTimeline, select, type Column, type Tone } from "@ak/ui/components";
import type { Raw } from "@ak/ui/h";

type Row = { id: string; short_code: string; status: string; created_at: string; total_usd: number | string; payment_method: string; channel: string; customer_name: string | null; village_name: string | null };
type Order = { id: string; short_code: string; customer_id: string; conversation_id: string | null; status: string; village_id: string | null; is_pickup: boolean; subtotal_usd: number | string;
  delivery_fee_usd: number | string; tip_usd: number | string; total_usd: number | string; payment_method: string; channel: string; customer_notes: string | null; cancel_reason: string | null;
  created_at: string; confirmed_at: string | null; delivered_at: string | null };
type Item = { id: string; name_snapshot: string; qty: number | string; unit_price_usd: number | string; status: string; substitution_of: string | null; note: string | null; modifiers: unknown };
type Ev = { created_at: string; from_status: string | null; to_status: string; actor: string; reason: string | null };
type Pay = { id: string; method: string; status: string; amount_usd: number | string; received_usd: number | string; received_lbp: number | string; external_ref: string | null; confirmed_at: string | null; created_at: string };
type Ref = { id: string; amount_usd: number | string; charged_to: string; reason: string; settle: string; note: string | null; created_at: string };
type Msg = { direction: string; type: string; body: string | null; created_at: string; order_id: string | null };

const when_ = (t_: unknown) => when(t_);
const STATUSES = [...ACTIVE, "closed", "cancelled"] as const;
const CHANNELS = ["whatsapp", "catalog", "web", "console", "app"] as const;
const PAYMENTS = ["cod", "whish", "omt"] as const;
const SORTS = { created_at: "created_at", total: "total_usd", status: "status" } as const;
const COLS = ["status", "customer", "village", "total", "payment", "channel", "placed"] as const;
type Col = (typeof COLS)[number];
const PAGE = 50, MAX = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const statusTone = (s: string): Tone => (s === "closed" ? "ok" : s === "cancelled" || s === "failed_delivery" ? "danger" : s === "delivered" || s === "awaiting_payment" ? "warn" : "neutral");

interface Filters { q: string; status: string; channel: string; payment: string; village: string; from: string; to: string; sort: keyof typeof SORTS; dir: "asc" | "desc"; cols: Col[]; before: string; open: string }
function readFilters(u: URL): Filters {
  const g = (k: string) => (u.searchParams.get(k) ?? "").trim();
  const one = <T extends string>(v: string, allowed: readonly T[]): T | "" => ((allowed as readonly string[]).includes(v) ? (v as T) : "");
  const cols = u.searchParams.getAll("col").filter((x): x is Col => (COLS as readonly string[]).includes(x));
  return { q: g("q").slice(0, 60), status: one(g("status"), [...STATUSES, "open"] as string[]), channel: one(g("channel"), CHANNELS), payment: one(g("payment"), PAYMENTS),
    village: UUID.test(g("village")) ? g("village") : "", from: DAY.test(g("from")) ? g("from") : "", to: DAY.test(g("to")) ? g("to") : "",
    sort: (one(g("sort"), Object.keys(SORTS) as (keyof typeof SORTS)[]) || "created_at") as keyof typeof SORTS, dir: g("dir") === "asc" ? "asc" : "desc",
    cols: cols.length ? cols : [...COLS], before: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(g("before")) ? g("before") : "", open: g("open").slice(0, 40) };
}
/** The list's address with these filters (and some changed). Defaults are left out, so the plain list is /orders. */
function address(f: Filters, change: Partial<Filters> = {}, path = "/orders"): string {
  const x = { ...f, ...change };
  const p = new URLSearchParams();
  for (const k of ["q", "status", "channel", "payment", "village", "from", "to", "before", "open"] as const) if (x[k]) p.set(k, x[k]);
  if (x.sort !== "created_at" || x.dir !== "desc") { p.set("sort", x.sort); p.set("dir", x.dir); }
  if (x.cols.length !== COLS.length) for (const col of x.cols) p.append("col", col);
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}
/** A Beirut calendar day as the instant it starts. */
const dayStart = (day: string) => beirutMidnight(new Date(`${day}T12:00:00Z`));

/** The rows for these filters, newest first unless sorted otherwise, and whether older ones exist. With words typed, the database's own search (0159) finds the orders and the other filters narrow them. */
async function findRows(c: Ctx, f: Filters, limit: number): Promise<{ rows: Row[]; more: boolean }> {
  const { db } = c.deps;
  const statusIn = f.status === "open" ? [...ACTIVE] : f.status ? [f.status] : null;
  const from = f.from ? dayStart(f.from).getTime() : null, to = f.to ? dayStart(f.to).getTime() + 86_400_000 : null;
  if (f.q) {
    const found = await db.rpc<Row[]>("search_orders", { p_q: f.q, p_limit: 100 });
    let village: string | null = null;
    if (f.village) village = (await db.rows<{ name_en: string }>("villages", { select: "name_en", where: { id: f.village }, limit: 1 }))[0]?.name_en ?? "\u0000";
    const rows = found.filter((o) => (!statusIn || statusIn.includes(o.status as never)) && (!f.channel || o.channel === f.channel) && (!f.payment || o.payment_method === f.payment)
      && (village === null || o.village_name === village) && (from === null || new Date(o.created_at).getTime() >= from) && (to === null || new Date(o.created_at).getTime() < to));
    const key = SORTS[f.sort];
    if (f.sort !== "created_at" || f.dir !== "desc") rows.sort((a, b) => { const x = key === "total_usd" ? Number(a.total_usd) - Number(b.total_usd) : String(a[key]).localeCompare(String(b[key])); return f.dir === "asc" ? x : -x; });
    return { rows: rows.slice(0, limit), more: false };
  }
  const where: Record<string, unknown> = {};
  if (statusIn) where.status = { in: statusIn };
  if (f.channel) where.channel = f.channel;
  if (f.payment) where.payment_method = f.payment;
  if (f.village) where.village_id = f.village;
  // The reader takes one bound per column. Newest first, the upper bound (the page point or the last day) goes to the database and the
  // first day is cut here, which is exact because everything after it is older. Sorted another way, one bound goes to the database and
  // the rest is cut here over up to 500 rows.
  const byTime = f.sort === "created_at" && f.dir === "desc";
  const upper = [f.before && byTime ? new Date(f.before).getTime() : null, to].filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
  if (upper !== null && (byTime || from === null)) where.created_at = { lt: new Date(upper).toISOString() };
  else if (from !== null) where.created_at = { gte: new Date(from).toISOString() };
  const got = await db.rows<Order>("orders", { select: "id,short_code,status,created_at,total_usd,payment_method,channel,customer_id,village_id", where: where as never,
    order: [{ col: SORTS[f.sort], desc: f.dir === "desc" }, ...(f.sort === "created_at" ? [] : [{ col: "created_at", desc: true }])], limit: (byTime && from === null ? limit : MAX) + 1 });
  const within = got.filter((o) => { const made = new Date(o.created_at).getTime(); return (from === null || made >= from) && (upper === null || made < upper); });
  const page = within.slice(0, limit);
  const [names, villages] = await Promise.all([
    page.length ? db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: [...new Set(page.map((o) => o.customer_id))] } } }) : Promise.resolve([]),
    db.rows<{ id: string; name_en: string }>("villages", { select: "id,name_en" }),
  ]);
  const name = new Map(names.map((p) => [p.id, p.display_name])), village = new Map(villages.map((v) => [v.id, v.name_en]));
  return { rows: page.map((o) => ({ id: o.id, short_code: o.short_code, status: o.status, created_at: o.created_at, total_usd: o.total_usd, payment_method: o.payment_method, channel: o.channel,
    customer_name: name.get(o.customer_id) ?? null, village_name: o.village_id ? village.get(o.village_id) ?? null : null })), more: within.length > limit };
}

const colLabel = (L: Lang, col: Col) => ({ status: pick(L, "Status", "الحالة"), customer: t(L, "customer"), village: t(L, "village"), total: t(L, "total"), payment: t(L, "payment"), channel: t(L, "channel"), placed: t(L, "placed") })[col];

async function search(c: Ctx) {
  const L = c.lang;
  const f = readFilters(c.url);
  const { db } = c.deps;
  const [{ rows, more }, villages] = await Promise.all([findRows(c, f, PAGE), db.rows<{ id: string; name_en: string }>("villages", { select: "id,name_en", order: [{ col: "name_en" }] }).catch(() => [])]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(c.deps.now());
  const blank: Filters = { ...f, q: "", status: "", channel: "", payment: "", village: "", from: "", to: "", before: "", open: "" };
  const plain = (x: Filters): Filters => ({ ...x, before: "", open: "", sort: "created_at", dir: "desc", cols: [...COLS] });
  const active = (x: Partial<Filters>) => address({ ...plain(blank), ...x }) === address(plain(f));
  // Views: filters that are asked for every day, as links. A view of your own is the address itself: bookmark it or send it.
  const views: [string, string, Partial<Filters>][] = [["Latest", "الأحدث", {}], ["Open now", "المفتوحة الآن", { status: "open" }], ["Today", "اليوم", { from: today }],
    ["Delivered, not paid", "سُلّم ولم يُدفع", { status: "delivered" }], ["Waiting for a transfer", "بانتظار تحويل", { status: "awaiting_payment" }], ["Failed deliveries", "فشل التوصيل", { status: "failed_delivery" }]];
  const sortable = (col: keyof typeof SORTS): Pick<Column, "sortHref" | "sorted"> => ({
    sortHref: address(f, { sort: col, dir: f.sort === col && f.dir === "desc" ? "asc" : "desc", before: "", open: "" }),
    sorted: f.sort === col ? (f.dir === "asc" ? "ascending" : "descending") : null });
  const columns: Column[] = [{ label: pick(L, "Order", "الطلب") }, ...f.cols.map((col): Column => ({ label: colLabel(L, col), ...(col === "total" ? { ...sortable("total"), num: true } : col === "placed" ? sortable("created_at") : col === "status" ? sortable("status") : {}) }))];
  const cell = (o: Row, col: Col): Raw | string => col === "status" ? badge(statusWord(L, o.status), statusTone(o.status)) : col === "customer" ? o.customer_name ?? "" : col === "village" ? o.village_name ?? ""
    : col === "total" ? money(o.total_usd) : col === "payment" ? o.payment_method : col === "channel" ? o.channel : when_(o.created_at);
  const opened = f.open ? await loadOrder(c, f.open) : null;
  const last = rows[rows.length - 1];
  const sel = (name: keyof Filters, label: string, options: readonly string[], word: (v: string) => string = (v) => v) =>
    select({ name, label, value: f[name] as string, options: [{ value: "", label: pick(L, "Any", "الكل") }, ...options.map((v) => ({ value: v, label: word(v) }))] });

  return render(c, t(L, "orders_title"), html`
${chips(views.map(([en, ar, x]) => ({ label: pick(L, en, ar), href: address(blank, x), current: active(x) })), pick(L, "Views", "طرق العرض"))}
<form method="get" action="/orders" class="ak-filters">
<label class="ak-field ak-field--grow"><span>${t(L, "orders_find")}</span><input class="ak-input" name="q" value="${f.q}" placeholder="${t(L, "orders_ph")}" maxlength="60" enterkeyhint="search"></label>
${sel("status", pick(L, "Status", "الحالة"), ["open", ...STATUSES], (v) => (v === "open" ? pick(L, "every open order", "كل الطلبات المفتوحة") : statusWord(L, v)))}
${sel("channel", t(L, "channel"), CHANNELS)}${sel("payment", t(L, "payment"), PAYMENTS)}
${select({ name: "village", label: t(L, "village"), value: f.village, options: [{ value: "", label: pick(L, "Any", "الكل") }, ...villages.map((v) => ({ value: v.id, label: v.name_en }))] })}
${input({ name: "from", label: pick(L, "From", "من"), type: "date", value: f.from })}${input({ name: "to", label: pick(L, "To", "إلى"), type: "date", value: f.to })}
${f.sort !== "created_at" || f.dir !== "desc" ? html`<input type="hidden" name="sort" value="${f.sort}"><input type="hidden" name="dir" value="${f.dir}">` : ""}
<details class="ak-field"><summary>${pick(L, "Columns", "الأعمدة")}</summary>${COLS.map((col) => html`<label><input type="checkbox" name="col" value="${col}"${f.cols.includes(col) ? html` checked` : ""}> ${colLabel(L, col)}</label> `)}</details>
<button>${pick(L, "Show", "اعرض")}</button></form>
<div class="with-drawer"${opened ? html` data-open` : ""}><div>
<div class="ak-table-foot"><span>${f.q ? t(L, "orders_found", { n: rows.length, q: f.q }) : f.status || f.channel || f.payment || f.village || f.from || f.to || f.before ? pick(L, `${rows.length} shown`, `المعروض: ${rows.length}`) : t(L, "orders_recent")}</span>
${button({ label: pick(L, "Download as CSV", "تنزيل CSV"), href: address(f, { before: "", open: "" }, "/orders.csv"), icon: "download", variant: "ghost" })}</div>
${dataTable({ caption: t(L, "orders_title"), columns, empty: empty({ title: t(L, "orders_none"), icon: "search" }),
    rows: rows.map((o) => ({ selected: opened?.o.id === o.id, cells: [html`<a href="/orders/${o.id}" data-drawer="${address(f, { open: o.id })}"><strong>${o.short_code}</strong></a>`, ...f.cols.map((col) => cell(o, col))] })) })}
<div class="ak-table-foot"><span>${f.q && rows.length >= 100 ? pick(L, "The search shows its first 100 matches: add a filter to narrow it.", "البحث يعرض أول 100 نتيجة: أضف تصفية لتضييقها.") : ""}</span>
${more && last && f.sort === "created_at" && f.dir === "desc" ? button({ label: pick(L, "Older orders", "طلبات أقدم"), href: address(f, { before: new Date(last.created_at).toISOString(), open: "" }), icon: "chevron" }) : more ? html`<span>${pick(L, `The first ${PAGE} are shown: sort by time to page through the rest.`, `المعروض أول ${PAGE}: رتّب حسب الوقت لتصفّح البقية.`)}</span>` : ""}</div></div>
${opened ? drawer({ id: "order", title: opened.o.short_code, closeHref: address(f, { open: "" }), closeLabel: pick(L, "Close", "إغلاق"),
    body: html`<p><a href="/orders/${opened.o.id}">${pick(L, "Open as a page", "افتح كصفحة")}</a></p>${orderBody(c, opened)}` }) : f.open ? html`<p class="flash err">${t(L, "order_not_found")}</p>` : ""}</div>`, { translated: true });
}

/** What is shown as CSV: the same rows as the screen's filters give, up to 500, never a phone number. Logged before it is read. */
async function csv(c: Ctx) {
  const f = readFilters(c.url);
  try { await audit(c.deps, c.staff, { action: "orders_export", phase: "event", args: { q: f.q ? "yes" : "", status: f.status, channel: f.channel, payment: f.payment, village: f.village, from: f.from, to: f.to } }); }
  catch { return new Response("Not done: the action log could not be written. Try again in a minute.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); }
  const { rows } = await findRows(c, { ...f, before: "" }, MAX);
  // A cell that a spreadsheet would run as a formula is written as text.
  const cell = (v: unknown) => { let x = String(v ?? ""); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lines = [["order", "status", "customer", "village", "total_usd", "payment", "channel", "placed_utc"], ...rows.map((o) => [o.short_code, o.status, o.customer_name, o.village_name, Number(o.total_usd).toFixed(2), o.payment_method, o.channel, new Date(o.created_at).toISOString()])];
  return new Response("﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orders-${c.deps.now().toISOString().slice(0, 10)}.csv"` } });
}

type Loaded = { o: Order; customer: string; village: string; items: Item[]; events: Ev[]; pays: Pay[]; refunds: Ref[]; around: Msg[] };
async function loadOrder(c: Ctx, ref: string): Promise<Loaded | null> {
  const { db } = c.deps;
  const o = (await db.rows<Order>("orders", { where: UUID.test(ref) ? { id: ref } : { short_code: ref.toUpperCase() }, limit: 1 }))[0];
  if (!o) return null;
  const [customer, village, items, events, pays, refunds, msgs] = await Promise.all([
    db.rows<{ display_name: string | null }>("parties", { select: "display_name", where: { id: o.customer_id }, limit: 1 }),
    o.village_id ? db.rows<{ name_en: string }>("villages", { select: "name_en", where: { id: o.village_id }, limit: 1 }) : Promise.resolve([]),
    db.rows<Item>("order_items", { select: "id,name_snapshot,qty,unit_price_usd,status,substitution_of,note,modifiers", where: { order_id: o.id }, order: [{ col: "name_snapshot" }] }),
    db.rows<Ev>("order_events", { select: "created_at,from_status,to_status,actor,reason", where: { order_id: o.id }, order: [{ col: "created_at" }], limit: 200 }),
    db.rows<Pay>("payments", { select: "id,method,status,amount_usd,received_usd,received_lbp,external_ref,confirmed_at,created_at", where: { order_id: o.id }, order: [{ col: "created_at" }] }),
    db.rows<Ref>("refunds", { select: "id,amount_usd,charged_to,reason,settle,note,created_at", where: { order_id: o.id }, order: [{ col: "created_at" }] }),
    // Messages around the order: those tied to it, and the customer's chat from just before it was placed to a while after it ended.
    db.rows<Msg>("wa_messages", { select: "direction,type,body,created_at,order_id", where: { party_id: o.customer_id, line: "customer", created_at: { gte: new Date(new Date(o.created_at).getTime() - 2 * 3600_000).toISOString() } }, order: [{ col: "created_at" }], limit: 120 }),
  ]);
  const until = new Date(o.delivered_at ?? c.deps.now().toISOString()).getTime() + 6 * 3600_000;
  return { o, customer: customer[0]?.display_name ?? "", village: village[0]?.name_en ?? "", items, events, pays, refunds, around: msgs.filter((m) => m.order_id === o.id || new Date(m.created_at).getTime() <= until).slice(-40) };
}

/** One order as a story. The same body in the page and in the drawer. */
function orderBody(c: Ctx, x: Loaded): Raw {
  const L = c.lang;
  const { o, items, events, pays, refunds, around } = x;
  const name = new Map(items.map((i) => [i.id, i.name_snapshot]));
  type T = { at: string; kind: string; text: unknown };
  const line: T[] = [
    { at: o.created_at, kind: pick(L, "placed", "أُنشئ"), text: `${usd(o.total_usd)} · ${o.payment_method}` },
    ...events.map((e) => ({ at: e.created_at, kind: pick(L, "status", "الحالة"), text: e.from_status === e.to_status
      ? `${statusWord(L, e.to_status)} · ${e.reason ?? ""} (${e.actor})`
      : `${e.from_status ? statusWord(L, e.from_status) + " → " : ""}${statusWord(L, e.to_status)} (${e.actor}${e.reason ? `, ${e.reason}` : ""})` })),
    ...pays.map((p) => ({ at: p.confirmed_at ?? p.created_at, kind: pick(L, "payment", "دفعة"), text: `${p.method} · ${p.status} · ${usd(p.amount_usd)}${Number(p.received_usd) ? ` (${pick(L, "received", "المستلم")} ${usd(p.received_usd)})` : ""}` })),
    ...refunds.map((r) => ({ at: r.created_at, kind: pick(L, "refund", "استرداد"), text: `${usd(r.amount_usd)} · ${r.reason} · ${r.settle}` })),
    ...around.map((m) => ({ at: m.created_at, kind: pick(L, "message", "رسالة"), text: `${m.direction === "inbound" ? pick(L, "customer", "الزبون") : pick(L, "us", "نحن")}: ${m.body ?? `[${m.type}]`}` })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return html`<div class="card"><dl class="facts">
<dt>${pick(L, "Status", "الحالة")}</dt><dd>${badge(statusWord(L, o.status), statusTone(o.status))}${o.cancel_reason ? html` · ${o.cancel_reason}` : ""}</dd>
<dt>${t(L, "customer")}</dt><dd>${x.customer}</dd>
<dt>${t(L, "village")}</dt><dd>${o.is_pickup ? pick(L, "pickup at the hub", "استلام من المركز") : x.village}</dd>
<dt>${t(L, "channel")}</dt><dd>${o.channel}</dd>
<dt>${t(L, "payment")}</dt><dd>${o.payment_method}</dd>
<dt>${t(L, "total")}</dt><dd><strong>${usd(o.total_usd)}</strong> <span class="muted">(${usd(o.subtotal_usd)} + ${pick(L, "delivery", "توصيل")} ${usd(o.delivery_fee_usd)}${Number(o.tip_usd) ? ` + ${pick(L, "tip", "بقشيش")} ${usd(o.tip_usd)}` : ""})</span></dd>
<dt>${t(L, "placed")}</dt><dd>${when_(o.created_at)}</dd>
${o.customer_notes ? html`<dt>${pick(L, "Notes", "ملاحظات")}</dt><dd>${o.customer_notes}</dd>` : ""}</dl></div>
<h2>${t(L, "lines_h")}</h2>
${dataTable({ caption: t(L, "lines_h"), columns: [{ label: pick(L, "Item", "الصنف"), wrap: true }, { label: pick(L, "Qty", "الكمية"), num: true }, { label: pick(L, "Price", "السعر"), num: true }, { label: pick(L, "Change", "التغيير") }],
    rows: items.map((i) => ({ cells: [html`${i.name_snapshot}${i.note ? html`<br><span class="muted">${i.note}</span>` : ""}`, Number(i.qty), usd(i.unit_price_usd),
      html`${i.status === "substituted" ? badge(pick(L, "substituted", "استُبدل"), "warn") : i.status === "removed" ? badge(pick(L, "removed", "أُزيل"), "danger") : ""}${i.substitution_of ? html`${pick(L, "replaces", "بديل عن")} ${name.get(i.substitution_of) ?? ""}` : ""}`] })) })}
<h2>${t(L, "timeline_h")}</h2>
${orderTimeline(line.map((s) => ({ at: when_(s.at), kind: s.kind, text: html` <span dir="auto">${s.text}</span>` })))}
<h2>${t(L, "file_h")}</h2><p class="muted">${t(L, "file_intro")}</p>
${form(c.f, `/orders/${o.id}/eval`, html`<p><input name="note" maxlength="300" placeholder="${t(L, "note_ph")}" size="34"></p>
<p><button name="kind" value="wrong_product">${t(L, "wrong_product")}</button> <button name="kind" value="bot_at_fault" class="secondary">${t(L, "bot_at_fault")}</button></p>`)}`;
}

async function one(c: Ctx) {
  const L = c.lang;
  const x = await loadOrder(c, (c.params.ref ?? "").trim());
  if (!x) return render(c, t(L, "orders_title"), html`<p class="flash err">${t(L, "order_not_found")}</p><p><a class="btn" href="/orders">${t(L, "orders_title")}</a></p>`, { translated: true });
  return render(c, x.o.short_code, html`<p><a href="/orders">${icon("chevron", { back: true })} ${t(L, "orders_title")}</a></p>${orderBody(c, x)}`, { translated: true });
}

async function file(c: Ctx) {
  const order = id(c, "id");
  const kind = (["wrong_product", "bot_at_fault"] as const).find((k) => k === c.form.kind);
  if (!kind) throw new UserError("Choose wrong product or bot at fault.");
  const note = text(c, "note", 300) || null;
  return act(c, `order_eval_${kind}`, { order, kind, characters: note?.length ?? 0 }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean }>("file_order_eval_case", { p_order: order, p_by: c.staff.partyId, p_kind: kind, p_note: note });
    return r.already ? "This was already filed for the next evaluation round." : "Filed for the next evaluation round. The order is unchanged.";
  }, `/orders/${order}`);
}

export const ordersSection: Section = {
  nav: { href: "/orders", label: "Orders", roles: LEADS },
  routes: [
    { method: "GET", path: "/orders", roles: LEADS, handler: search },
    { method: "GET", path: "/orders.csv", roles: LEADS, handler: csv },
    { method: "GET", path: "/orders/:ref", roles: LEADS, handler: one },
    { method: "POST", path: "/orders/:id/eval", roles: LEADS, handler: file },
  ],
};
