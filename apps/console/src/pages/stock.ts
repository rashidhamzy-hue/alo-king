// UX2a: Stock, the page the phone bar's Stock opens (the reference's `/ops/stock`): what is out, what is running low, what to use soon, and on each item the two
// things a person does on the shelf: count it, or adjust it. Both go through the functions the Catalog page already calls (count_stock and adjust_stock, 0023): a count is
// one adjustment with reason "count" for the difference; an adjustment has a reason from the database's list. The reason is required: no adjustment is sent without one,
// "other" needs a note, and a count that differs from the books needs a note saying what you know. The picker's limit and "never below what is reserved" are the database's
// (NEEDS_OPS_LEAD, BELOW_RESERVED), shown in words. Nothing is undoable here: a movement is a record, so the way back from a mistake is a new, named one.
// The other stock pages (catalog, receiving, returns, the pick queue, label day photos) stay one tap away at the foot, as the old hub listed them.
import { act, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form } from "../html";
import { pick, t } from "../i18n";
import { buildNav } from "../nav";
import { ALL } from "../roles";
import { badge, button, chips, empty, icon, input, select, tabs } from "@ak/ui/components";

type Product = { id: string; sku: string | null; name_en: string; name_ar: string | null; brand: string | null; storage: string; sell_unit: string; is_active: boolean };
type Level = { product_id: string; on_hand: number | string; reserved: number | string; reorder_point: number | string };
type Soon = { product_id: string; expiry_date: string; lot: string | null; on_hand: number | string };
/** The reasons the database accepts for an adjustment (0023). The database checks them again, and which way each may go. */
const REASONS: { id: string; en: string; ar: string }[] = [
  { id: "found", en: "Found more", ar: "وُجدت زيادة" }, { id: "damaged", en: "Damaged", ar: "تالف" }, { id: "expired", en: "Expired", ar: "منتهي الصلاحية" },
  { id: "spoiled", en: "Spoiled", ar: "فاسد" }, { id: "theft", en: "Stolen", ar: "مسروق" }, { id: "recall", en: "Recalled", ar: "مسحوب من السوق" },
  { id: "sample", en: "Sample", ar: "عيّنة" }, { id: "other", en: "Other (write a note)", ar: "أخرى (اكتب ملاحظة)" },
];
/** The days that count as "use soon" on this page: a window for looking, not a rule; the dates themselves are the database's. */
export const USE_SOON_DAYS = 2;
const LIMIT = 60;
const n = (v: number | string) => Number(v);
const num_ = (v: number) => String(Math.round(v * 1000) / 1000);

async function hub(c: Ctx): Promise<string> {
  const s = (await c.deps.db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, order: [{ col: "id" }], limit: 1 }))[0];
  if (!s) throw new UserError(pick(c.lang, "There is no hub (dark store) in the database.", "لا يوجد مستودع في قاعدة البيانات."));
  return s.id;
}

const formKey = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, ""); return k.length >= 8 ? `console:${k}` : null; };
/** Back to the same view and search, so a count in a long list leaves you where you were. */
const backTo = (c: Ctx) => {
  const view = c.form.view === "all" ? "all" : "";
  const q = (c.form.q ?? "").trim().slice(0, 80);
  const p = new URLSearchParams(); if (view) p.set("view", view); if (q) p.set("q", q);
  const s = p.toString();
  return s ? `/stock?${s}` : "/stock";
};

export async function stockPage(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const src = await hub(c);
  const view = c.url.searchParams.get("view") === "all" ? "all" : "needs";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const [products, levels, soonRows] = await Promise.all([
    db.rows<Product>("products", { select: "id,sku,name_en,name_ar,brand,storage,sell_unit,is_active", where: { owner_source_id: null }, order: [{ col: "sku" }], limit: 5000 }),
    db.rows<Level>("stock_levels", { select: "product_id,on_hand,reserved,reorder_point", where: { source_id: src }, limit: 5000 }),
    db.rpc<Soon[] | null>("expiring_stock", { p_source: src, p_days: USE_SOON_DAYS }).catch(() => null),
  ]);
  const level = new Map(levels.map((l) => [l.product_id, l]));
  const byId = new Map(products.map((p) => [p.id, p]));
  const avail = (p: Product) => { const l = level.get(p.id); return l ? n(l.on_hand) - n(l.reserved) : 0; };
  const out = products.filter((p) => p.is_active && level.has(p.id) && avail(p) <= 0);
  const low = products.filter((p) => p.is_active && level.has(p.id) && avail(p) > 0 && n(level.get(p.id)!.reorder_point) > 0 && avail(p) <= n(level.get(p.id)!.reorder_point));
  const soon = new Map<string, Soon>();
  for (const s of soonRows ?? []) if (byId.has(s.product_id) && !soon.has(s.product_id)) soon.set(s.product_id, s);
  const matches = (p: Product) => !q || [p.sku, p.name_en, p.name_ar, p.brand].some((v) => (v ?? "").toLowerCase().includes(q));
  const name = (p: Product) => (L === "ar" ? p.name_ar || p.name_en : p.name_en);
  const back = html`<input type="hidden" name="view" value="${view}"><input type="hidden" name="q" value="${q}">`;

  const item = (p: Product) => {
    const l = level.get(p.id);
    const onHand = l ? n(l.on_hand) : 0, reserved = l ? n(l.reserved) : 0, free = onHand - reserved;
    const s = soon.get(p.id);
    return html`<li><div class="head"><strong><bdi>${name(p)}</bdi></strong><span class="tags">${badge(pick(L, `${num_(free)} available`, `المتاح ${num_(free)}`), free <= 0 ? "danger" : "neutral", free <= 0 ? "alert" : "stock")}
${l && n(l.reorder_point) > 0 && free > 0 && free <= n(l.reorder_point) ? badge(pick(L, "running low", "ينفد قريباً"), "warn", "alert") : ""}${s ? badge(pick(L, `use by ${s.expiry_date}`, `يُستهلك قبل ${s.expiry_date}`), "warn", "clock") : ""}</span></div>
<p class="muted"><bdi>${p.sku ?? ""}</bdi> · ${pick(L, `on hand ${num_(onHand)}, reserved for open orders ${num_(reserved)}`, `في المخزن ${num_(onHand)}، محجوز لطلبات مفتوحة ${num_(reserved)}`)}${l && n(l.reorder_point) > 0 ? pick(L, `, reorder at ${num_(n(l.reorder_point))}`, `، يُعاد الطلب عند ${num_(n(l.reorder_point))}`) : ""}</p>
<details class="ak-more"><summary>${icon("pick")} ${pick(L, "Count or adjust", "جرد أو تعديل")}</summary>
${form(c.f, `/stock/${p.id}/count`, html`${back}<p><strong>${pick(L, "Count the shelf", "جرد الرف")}</strong></p>
<div class="ak-money-fields">${input({ name: "counted", label: pick(L, "Counted", "المعدود"), type: "number", required: true, attrs: { min: "0", step: "any", inputmode: "decimal" } })}${input({ name: "note", label: pick(L, "Why it differs (needed if it does)", "سبب الفرق (مطلوب إن وُجد)"), maxlength: 200 })}</div>
<div class="actions-row">${button({ label: pick(L, "Save the count", "احفظ الجرد"), icon: "check" })}</div>`)}
${form(c.f, `/stock/${p.id}/adjust`, html`${back}<p><strong>${pick(L, "Adjust the stock", "تعديل المخزون")}</strong></p>
<div class="ak-money-fields">${input({ name: "delta", label: pick(L, "Change (+ or −)", "التغيير (+ أو −)"), type: "number", required: true, attrs: { step: "any", inputmode: "decimal" } })}
${select({ name: "reason", label: pick(L, "Reason (required)", "السبب (مطلوب)"), options: [{ value: "", label: pick(L, "Choose a reason", "اختر سبباً") }, ...REASONS.map((r) => ({ value: r.id, label: pick(L, r.en, r.ar) }))], attrs: { required: true } })}
${input({ name: "note", label: pick(L, "Note", "ملاحظة"), maxlength: 200 })}</div>
<p class="muted">${pick(L, "A movement is a record and is never edited: a mistake is put right by a new one with its own reason.", "الحركة سجل لا يُعدَّل: يُصحَّح الخطأ بحركة جديدة بسببها.")}</p>
<div class="actions-row">${button({ label: pick(L, "Save the change", "احفظ التغيير"), icon: "check" })}</div>`)}</details></li>`;
  };
  const section = (title: string, list: Product[], none: string) => html`<h2>${title} (${list.length})</h2>${list.length ? html`<ul class="ak-rows">${list.slice(0, LIMIT).map(item)}</ul>${list.length > LIMIT ? html`<p class="muted">${pick(L, `The first ${LIMIT} are shown: search to find the rest.`, `المعروض أول ${LIMIT}: ابحث لتجد البقية.`)}</p>` : ""}` : html`<p class="muted">${none}</p>`}`;

  const hits = products.filter((p) => p.is_active && matches(p)).slice(0, LIMIT);
  const nav = buildNav(c.sections, c.staff.role, L, c.url.pathname, c.badges).groups.find((g) => g.id === "stock");
  const body = view === "all"
    ? html`<p class="muted">${hits.length ? pick(L, `${hits.length} shown${q ? ` for “${q}”` : ""}.`, `المعروض ${hits.length}${q ? ` لـ «${q}»` : ""}.`) : ""}</p>${hits.length ? html`<ul class="ak-rows">${hits.map(item)}</ul>` : empty({ title: pick(L, "No item matches.", "لا صنف مطابق."), icon: "search" })}`
    : html`${section(pick(L, "Out", "نفد"), out.filter(matches), pick(L, "Nothing is out.", "لا شيء نافد."))}
${section(pick(L, "Running low", "ينفد قريباً"), low.filter(matches), pick(L, "Nothing is below its reorder point.", "لا شيء تحت حدّ إعادة الطلب."))}
${section(pick(L, `Use within ${USE_SOON_DAYS} days`, `يُستهلك خلال ${USE_SOON_DAYS} أيام`), [...soon.keys()].map((i) => byId.get(i)!).filter(matches), pick(L, "Nothing expires soon.", "لا شيء تنتهي صلاحيته قريباً."))}`;

  return render(c, t(L, "nav_stock"), html`
${tabs([{ label: pick(L, "Needs a look", "يحتاج نظرة"), href: "/stock", current: view === "needs", count: out.length + low.length + soon.size }, { label: pick(L, "Every item", "كل الأصناف"), href: "/stock?view=all", current: view === "all" }], t(L, "nav_stock"))}
<form method="get" action="/stock" class="ak-filters"><input type="hidden" name="view" value="${view}">
<label class="ak-field ak-field--grow"><span>${pick(L, "Find an item", "ابحث عن صنف")}</span><input class="ak-input" name="q" value="${q}" placeholder="${pick(L, "name, brand or SKU", "الاسم أو العلامة أو الرمز")}" maxlength="80" enterkeyhint="search"></label>
<button>${pick(L, "Search", "بحث")}</button></form>
${body}
<h2>${pick(L, "More stock pages", "صفحات مخزون أخرى")}</h2>
${nav && nav.links.length ? html`<ul class="hub">${nav.links.map((l) => html`<li><a href="${l.href}"><span>${l.label}</span>${l.badge > 0 ? html` <span class="badge">${l.badge}</span>` : ""}</a></li>`)}</ul>` : html`<p class="muted">${t(L, "hub_empty")}</p>`}`, { translated: true });
}

async function count(c: Ctx) {
  const product = id(c, "product");
  const L = c.lang;
  const counted = num(c, "counted", { min: 0 })!;
  const note = text(c, "note", 200) || null;
  const src = await hub(c);
  const lvl = (await c.deps.db.rows<{ on_hand: number | string }>("stock_levels", { select: "on_hand", where: { source_id: src, product_id: product }, limit: 1 }))[0];
  // The books say what is expected: a count that differs needs the person's own words for why (the same rule the day close keeps for cash).
  if (counted !== n(lvl?.on_hand ?? 0) && !note) throw new UserError(pick(L, `The books say ${num_(n(lvl?.on_hand ?? 0))}: write why the count differs.`, `الدفاتر تقول ${num_(n(lvl?.on_hand ?? 0))}: اكتب سبب اختلاف الجرد.`));
  return act(c, "stock_count", { product, counted, note }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; expected: number | string; difference: number | string }>("count_stock", { p_source: src, p_product: product, p_counted: counted, p_by: c.staff.partyId, p_note: note, p_key: formKey(c) });
    if (r.duplicate) return pick(L, "That count was already saved.", "حُفظ هذا الجرد بالفعل.");
    const diff = n(r.difference);
    return diff === 0 ? pick(L, "Count saved: it matches the books.", "حُفظ الجرد: يطابق الدفاتر.") : pick(L, `Count saved: the books had ${num_(n(r.expected))}, a difference of ${diff > 0 ? "+" : ""}${num_(diff)}.`, `حُفظ الجرد: كان في الدفاتر ${num_(n(r.expected))}، والفرق ${diff > 0 ? "+" : ""}${num_(diff)}.`);
  }, backTo(c));
}

async function adjust(c: Ctx) {
  const product = id(c, "product");
  const L = c.lang;
  const delta = num(c, "delta")!;
  const reason = c.form.reason ?? "";
  if (!REASONS.some((r) => r.id === reason)) throw new UserError(pick(L, "Choose the reason first: no change is saved without one.", "اختر السبب أولاً: لا يُحفظ أي تغيير بدونه."));
  const note = text(c, "note", 200) || null;
  if (reason === "other" && (note ?? "").length < 3) throw new UserError(pick(L, "Write a note for the reason Other.", "اكتب ملاحظة للسبب «أخرى»."));
  const src = await hub(c);
  return act(c, "stock_adjust", { product, delta, reason, note }, async () => {
    const r = await c.deps.db.rpc<{ duplicate?: boolean; on_hand?: number | string }>("adjust_stock", { p_source: src, p_product: product, p_delta: delta, p_reason: reason, p_by: c.staff.partyId, p_note: note, p_key: formKey(c) });
    return r?.duplicate ? pick(L, "That change was already saved.", "حُفظ هذا التغيير بالفعل.") : pick(L, `Saved. On hand now ${num_(n(r?.on_hand ?? 0))}.`, `حُفظ. في المخزن الآن ${num_(n(r?.on_hand ?? 0))}.`);
  }, backTo(c));
}

export const stockSection: Section = {
  // No menu entry of its own: the phone bar and the Stock group link to it.
  nav: { href: "/stock", label: "Stock", roles: [] },
  routes: [
    { method: "GET", path: "/stock", roles: ALL, handler: stockPage },
    { method: "POST", path: "/stock/:product/count", roles: ALL, handler: count },
    { method: "POST", path: "/stock/:product/adjust", roles: ALL, handler: adjust },
  ],
};
