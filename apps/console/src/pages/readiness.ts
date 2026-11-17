// Product readiness (session D4): one row per active hub item from product_readiness() (0111): its name, picture, food facts, cost,
// search words, catalog placement and price, each ok or what is missing, with a link to the page that fixes it. The two filters
// answer different questions: "blocks the catalog" (the Meta feed leaves the item out) and "blocks ordering" (a customer cannot
// order it). No approved picture blocks the catalog, not ordering. Reads only; ops lead and admin.
import { html, render, type Ctx, type Section } from "../app";
import { usd } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, empty, kpis, tabs, tileLink } from "@ak/ui/components";
import { intakeTabs } from "./intakeframe";

export type Ready = {
  product_id: string; sku: string; name_en: string; name_ar: string | null; brand: string | null;
  name: "approved" | "waiting" | "rejected" | "none"; picture: "approved" | "guide_only" | "waiting" | "none";
  facts: { approved: number; waiting: number; ingredients: boolean; allergens: number; allergens_of: number; ok: boolean };
  cost: boolean; search_words: "built" | "queued" | "failed" | "none"; placement: boolean; category: string | null;
  price: boolean; price_usd: number | string | null; available: boolean;
  blocks_catalog: string[]; blocks_ordering: string[]; missing: string[]; ready: boolean;
  // PD1 (0206): the two levels of the product data standard, and what each misses.
  level?: "not_sellable" | "sellable" | "fact_complete"; template?: string | null;
  missing_sellable?: string[]; missing_fact_complete?: string[];
  // SELL1 (0226): a pack to read? and has its label been read and approved? (loose produce, meat and bakery with no real barcode are not packaged)
  packaged?: boolean; label_ready?: boolean; missing_label?: string[];
};
type Summary = { sell_requires_label: boolean; packaged: number; label_ready: number;
  by_template: Record<string, { active: number; sellable: number; fact_complete: number; packaged: number; label_ready: number }> };
const SHOW = ["all", "not_sellable", "sellable", "fact_complete", "label", "catalog", "ordering", "missing", "ready"] as const;
const SHOW_WORDS = (L: Lang): Record<(typeof SHOW)[number], string> => ({
  all: pick(L, "all items", "كل المنتجات"), not_sellable: pick(L, "not sellable", "غير قابل للبيع"), sellable: pick(L, "sellable, facts not confirmed", "قابل للبيع، حقائقه غير مؤكدة"), fact_complete: pick(L, "fact-complete", "حقائقه مكتملة"),
  label: pick(L, "packaged, not label-ready", "معبّأ، ملصقه غير جاهز"), catalog: pick(L, "blocks the catalog", "يمنع الكتالوج"), ordering: pick(L, "blocks ordering", "يمنع الطلب"), missing: pick(L, "something missing", "ينقصه شيء"), ready: pick(L, "ready", "جاهز"),
});
const words = (keys: string[] | undefined) => (keys ?? []).map((k) => k.replace(/_/g, " ")).join(", ");
const pill = (label: string, tone: "ok" | "warn" | "neutral", href?: string) => (href ? html`<a class="ak-badge ak-badge--${tone}" href="${href}">${label}</a>` : badge(label, tone));

/** PD1: the item's level, with the fields it still misses for the next one. */
function levelCell(L: Lang, r: Ready) {
  if (r.level === "fact_complete") return pill(pick(L, "fact-complete", "حقائقه مكتملة"), "ok");
  if (r.level === "sellable") return html`${pill(pick(L, "sellable", "قابل للبيع"), "neutral")}<br><small class="muted">${pick(L, "for fact-complete:", "لتكتمل حقائقه:")} ${words(r.missing_fact_complete)}</small>`;
  return html`${pill(pick(L, "not sellable", "غير قابل للبيع"), "warn")}<br><small class="muted">${pick(L, "needs:", "يحتاج:")} ${words(r.missing_sellable)}</small>`;
}

/** SELL1: loose, or packaged with its label read and approved, or what the label still has to give. */
function labelCell(L: Lang, r: Ready) {
  if (!r.packaged) return html`<span class="muted">${pick(L, "loose", "سائب")}</span>`;
  if (r.label_ready) return pill(pick(L, "packaged, label-ready", "معبّأ، ملصقه جاهز"), "ok");
  return html`${pill(pick(L, "packaged, not label-ready", "معبّأ، ملصقه غير جاهز"), "warn")}<br><small class="muted">${pick(L, "label missing:", "ينقص الملصق:")} ${words(r.missing_label)}</small>`;
}

function cells(L: Lang, r: Ready) {
  const q = encodeURIComponent(r.sku);
  return [
    [pick(L, "Name", "الاسم"), r.name === "approved" ? pill(pick(L, "approved", "معتمد"), "ok") : r.name === "waiting" ? pill(pick(L, "waiting", "بالانتظار"), "warn", `/names?q=${q}`) : r.name === "rejected" ? pill(pick(L, "kept as is", "كما هو"), "ok") : html`<span class="muted">${pick(L, "not reviewed", "لم يُراجَع")}</span>`],
    [pick(L, "Picture", "الصورة"), r.picture === "approved" ? pill(pick(L, "approved", "معتمدة"), "ok") : r.picture === "guide_only" ? pill(pick(L, "guide only (licence unknown)", "دليل فقط (ترخيص مجهول)"), "warn", "/pictures?status=approved") : r.picture === "waiting" ? pill(pick(L, "waiting", "بالانتظار"), "warn", "/pictures") : pill(pick(L, "none", "لا توجد"), "warn", "/intake")],
    [pick(L, "Food facts", "المعلومات الغذائية"), r.facts.ok ? pill(pick(L, `all ${r.facts.allergens_of} allergens`, `كل مسبّبات الحساسية (${r.facts.allergens_of})`), "ok")
      : pill(`${r.facts.ingredients ? pick(L, "ingredients ok", "المكوّنات سليمة") : pick(L, "no ingredients", "لا مكوّنات")}, ${pick(L, "allergens", "مسبّبات الحساسية")} ${r.facts.allergens}/${r.facts.allergens_of}${r.facts.waiting ? `, ${r.facts.waiting} ${pick(L, "waiting", "بالانتظار")}` : ""}`, "warn", r.facts.waiting ? `/intake/${r.product_id}` : `/food-facts/${r.product_id}`)],
    [pick(L, "Cost", "التكلفة"), r.cost ? pill(pick(L, "known", "معروفة"), "ok") : pill(pick(L, "none", "لا توجد"), "warn", "/receiving")],
    [pick(L, "Search words", "كلمات البحث"), r.search_words === "built" ? pill(pick(L, "built", "جاهزة"), "ok") : pill(r.search_words === "queued" ? pick(L, "queued", "في الطابور") : r.search_words === "failed" ? pick(L, "failed", "فشلت") : pick(L, "none", "لا توجد"), "warn", "/search-words")],
    [pick(L, "Catalog", "الكتالوج"), r.placement ? pill(r.category ?? pick(L, "placed", "موضوع"), "ok") : pill(pick(L, "not placed", "غير موضوع"), "warn")],
    [pick(L, "Price", "السعر"), r.price ? pill(usd(r.price_usd), "ok") : pill(r.price_usd === null ? pick(L, "none", "لا يوجد") : pick(L, "unavailable", "غير متاح"), "warn", `/catalog/${r.product_id}`)],
  ] as const;
}

/** SELL1 and PD1: the setting, and per template how many items are sellable, fact-complete and (of the packaged) label-ready. */
function labels(L: Lang, s: Summary | null | undefined) {
  if (!s) return "";
  const rows = Object.entries(s.by_template ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return html`<h3>${pick(L, "Packaged items and their labels", "المنتجات المعبّأة وملصقاتها")}</h3>
<p>${pick(L, "Selling requires a label: ", "لا بيع قبل الملصق: ")}${s.sell_requires_label ? pick(L, "on", "مفعّل") : pick(L, "off", "معطّل")}. <span class="muted">(${pick(L, "The setting", "الإعداد")} <code>sell_requires_label</code>${pick(L, ", read only here: the steps are on the Progress tab and the switch is in Settings. When on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card, found as orderable or shown as orderable: the chat and the site say “coming soon”. Loose produce, meat and bakery with no real barcode are not packaged and sell on the core.", "، للقراءة فقط هنا: الخطوات في تبويب التقدّم والمفتاح في الإعدادات. عند تفعيله لا يمكن تسعير منتج معبّأ لم يُقرأ ملصقه ويعتمده شخص، ولا إضافته إلى بطاقة ولا عرضه قابلاً للطلب: تقول المحادثة والموقع «جايي قريباً». الخضار والفواكه واللحوم والمخبوزات السائبة بلا باركود حقيقي ليست معبّأة وتُباع على الأساسيات.")})</span></p>
<div class="ak-table-wrap"><table class="ak-table"><caption class="ak-sr">${pick(L, "Readiness per template", "الجاهزية لكل قالب")}</caption>
<thead><tr><th scope="col">${pick(L, "Template", "القالب")}</th><th scope="col" class="num">${pick(L, "Items", "المنتجات")}</th><th scope="col" class="num">${pick(L, "Sellable", "قابل للبيع")}</th><th scope="col" class="num">${pick(L, "Fact-complete", "حقائقه مكتملة")}</th><th scope="col" class="num">${pick(L, "Packaged", "معبّأ")}</th><th scope="col" class="num">${pick(L, "Label-ready", "ملصقه جاهز")}</th></tr></thead><tbody>
${rows.map(([code, v]) => html`<tr><td>${code.replace(/_/g, " ")}</td><td class="num">${v.active}</td><td class="num">${v.sellable} ${pick(L, "of", "من")} ${v.active}</td><td class="num">${v.fact_complete} ${pick(L, "of", "من")} ${v.active}</td><td class="num">${v.packaged}</td><td class="num">${v.packaged > 0 ? html`${v.label_ready} ${pick(L, "of", "من")} ${v.packaged}` : "—"}</td></tr>`)}
<tr><td><strong>${pick(L, "all", "الكل")}</strong></td><td class="num">${rows.reduce((a, [, v]) => a + v.active, 0)}</td><td class="num">${rows.reduce((a, [, v]) => a + v.sellable, 0)}</td><td class="num">${rows.reduce((a, [, v]) => a + v.fact_complete, 0)}</td><td class="num">${s.packaged}</td><td class="num">${s.label_ready} ${pick(L, "of", "من")} ${s.packaged}</td></tr></tbody></table></div>
<p class="muted">${pick(L, "The packaged items not label-ready, with what each misses, are under “packaged, not label-ready” below.", "المنتجات المعبّأة غير الجاهزة بملصقاتها، وما ينقص كل واحد، تحت «معبّأ، ملصقه غير جاهز» أدناه.")}</p>`;
}

async function page(c: Ctx) {
  const L = c.lang;
  const show = (SHOW as readonly string[]).includes(c.url.searchParams.get("show") ?? "") ? (c.url.searchParams.get("show") as (typeof SHOW)[number]) : "all";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const all = (await c.deps.db.rpc<Ready[]>("product_readiness", {})) ?? [];
  // SELL1: the per-template table is built from the rows above (one pass over the items), not from a second query
  const on = await c.deps.db.rpc<boolean>("sell_requires_label", {});
  const by: Summary["by_template"] = {};
  for (const r of all) {
    const t = by[r.template ?? "none"] ??= { active: 0, sellable: 0, fact_complete: 0, packaged: 0, label_ready: 0 };
    t.active++; if (r.level && r.level !== "not_sellable") t.sellable++; if (r.level === "fact_complete") t.fact_complete++; if (r.packaged) t.packaged++; if (r.label_ready) t.label_ready++;
  }
  const summary: Summary = { sell_requires_label: !!on, packaged: all.filter((r) => r.packaged).length, label_ready: all.filter((r) => r.label_ready).length, by_template: by };
  const keep = (r: Ready) => show === "all" || (show === r.level) || (show === "label" && !!r.packaged && !r.label_ready) || (show === "catalog" && r.blocks_catalog.length > 0) || (show === "ordering" && r.blocks_ordering.length > 0)
    || (show === "missing" && r.missing.length > 0) || (show === "ready" && r.ready);
  const rows = all.filter(keep).filter((r) => !q || [r.sku, r.name_en, r.name_ar, r.brand].some((v) => (v ?? "").toLowerCase().includes(q)));
  const n = (f: (r: Ready) => boolean) => all.filter(f).length;
  const W = SHOW_WORDS(L);
  const counts: Record<(typeof SHOW)[number], number> = { all: all.length, not_sellable: n((r) => r.level === "not_sellable"), sellable: n((r) => r.level === "sellable"), fact_complete: n((r) => r.level === "fact_complete"),
    label: n((r) => !!r.packaged && !r.label_ready), catalog: n((r) => r.blocks_catalog.length > 0), ordering: n((r) => r.blocks_ordering.length > 0), missing: n((r) => r.missing.length > 0), ready: n((r) => r.ready) };
  const link = (s: (typeof SHOW)[number]) => `/readiness?show=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const tab = (s: (typeof SHOW)[number]) => ({ label: `${W[s]} (${counts[s]})`, href: link(s), current: s === show });
  const sellable = counts.sellable + counts.fact_complete;
  return render(c, pick(L, "Product readiness", "جاهزية المنتجات"), html`${intakeTabs(c, "readiness")}
${kpis([
    tileLink({ label: pick(L, "Sellable", "قابل للبيع"), value: `${sellable} / ${all.length}`, href: link("not_sellable"), icon: "stock", state: counts.not_sellable > 0 ? "warn" : "ok", stateWord: pick(L, `${counts.not_sellable} not sellable`, `${counts.not_sellable} غير قابل للبيع`) }),
    tileLink({ label: pick(L, "Fact-complete", "حقائقه مكتملة"), value: `${counts.fact_complete} / ${all.length}`, href: link("fact_complete"), icon: "check", note: pick(L, "answers a filter such as “no added sugar”", "يجيب عن مرشّح مثل «بلا سكر مضاف»") }),
    tileLink({ label: pick(L, "Label-ready", "ملصقه جاهز"), value: `${summary.label_ready} / ${summary.packaged}`, href: link("label"), icon: "shield", state: counts.label > 0 ? "warn" : "ok", stateWord: pick(L, `${counts.label} packaged not ready`, `${counts.label} معبّأ غير جاهز`) }),
    tileLink({ label: pick(L, "Blocks ordering", "يمنع الطلب"), value: String(counts.ordering), href: link("ordering"), icon: "alert", state: counts.ordering > 0 ? "late" : "ok", stateWord: pick(L, "customers cannot order these", "لا يستطيع الزبائن طلبها") })])}
${labels(L, summary)}
<p class="muted"><strong>${pick(L, "Sellable", "قابل للبيع")}</strong>: ${pick(L, "the core is complete (names in English and Arabic, category with its template, storage, sale unit, price); it can be ordered and its facts read “not confirmed yet”.", "الأساسيات مكتملة (الاسم بالإنجليزية والعربية، الفئة مع قالبها، التخزين، وحدة البيع، السعر)؛ يمكن طلبه وتُقرأ حقائقه «غير مؤكدة بعد».")}
<strong>${pick(L, "Fact-complete", "حقائقه مكتملة")}</strong>: ${pick(L, "its template is complete too (for packaged food: ingredients, the 14 allergens and the nutrition panel; for a cleaning product: hazard warnings as printed); only these answer a filter such as “no added sugar” or “fragrance-free”. Facts need a re-check after 12 months.", "قالبه مكتمل أيضاً (للأغذية المعبّأة: المكوّنات ومسبّبات الحساسية الأربعة عشر وجدول القيم الغذائية؛ ولمنتج التنظيف: تحذيرات الخطر كما هي مطبوعة)؛ هذه وحدها تجيب عن مرشّح مثل «بلا سكر مضاف» أو «بلا عطر». تحتاج الحقائق إعادة فحص بعد 12 شهراً.")}</p>
${tabs(SHOW.slice(0, 5).map(tab), pick(L, "Level", "المستوى"))}
${tabs(SHOW.slice(5).map(tab), pick(L, "What blocks", "ما يمنع"))}
<p class="muted"><strong>${pick(L, "Blocks the catalog", "يمنع الكتالوج")}</strong>: ${pick(L, "the WhatsApp catalog leaves the item out (no approved picture a customer may see, not placed in a category, or no price).", "يستبعد كتالوج واتساب المنتج (لا صورة معتمدة يجوز للزبون رؤيتها، أو غير موضوع في فئة، أو بلا سعر).")}
<strong>${pick(L, "Blocks ordering", "يمنع الطلب")}</strong>: ${pick(L, "a customer cannot order it at all (no price at the hub, or marked unavailable). A missing picture blocks the catalog, not ordering. Names, food facts, cost and search words do not stop a sale; they are listed so nothing is forgotten. Click what is missing to open the page that fixes it.", "لا يستطيع الزبون طلبه أبداً (لا سعر في المستودع، أو معلَّم غير متاح). غياب الصورة يمنع الكتالوج لا الطلب. الأسماء والحقائق الغذائية والتكلفة وكلمات البحث لا توقف البيع؛ تُسرد كي لا يُنسى شيء. اضغط على الناقص لتفتح الصفحة التي تصلحه.")}</p>
<form method="get" action="/readiness" class="ak-filters"><input type="hidden" name="show" value="${show}">
<label class="ak-field ak-field--grow"><span>${pick(L, "Find an item", "ابحث عن منتج")}</span><input class="ak-input" name="q" value="${q}" placeholder="${pick(L, "SKU, name or brand", "الرمز أو الاسم أو العلامة")}" maxlength="60" enterkeyhint="search"></label>
<button>${pick(L, "Find", "بحث")}</button></form>
${rows.length === 0 ? empty({ title: pick(L, "Nothing here.", "لا شيء هنا."), icon: "search" }) : html`<ul class="ak-rows">${rows.slice(0, 200).map((r) => html`<li>
<div class="head"><strong><a href="/catalog/${r.product_id}"><bdi>${r.name_en}</bdi></a></strong><span class="tags">${levelCell(L, r)}</span></div>
<p class="muted"><bdi>${r.sku}</bdi>${r.brand ? ` · ${r.brand}` : ""}${r.template ? ` · ${r.template.replace(/_/g, " ")}` : ""} · ${labelCell(L, r)}</p>
<p class="tags">${cells(L, r).map(([k, v]) => html`<span class="ak-cell"><small class="muted">${k}</small> ${v}</span>`)}</p>
${r.blocks_ordering.length ? html`<p>${badge(pick(L, "ordering", "الطلب"), "warn", "alert")} ${r.blocks_ordering.join("; ")}</p>` : ""}${r.blocks_catalog.length ? html`<p>${badge(pick(L, "catalog", "الكتالوج"), "warn", "alert")} ${r.blocks_catalog.join("; ")}</p>` : ""}${r.ready ? html`<p>${pill(pick(L, "ready", "جاهز"), "ok")}</p>` : ""}</li>`)}</ul>
${rows.length > 200 ? html`<p class="muted">${pick(L, `The first 200 of ${rows.length} are shown: search to find the rest.`, `المعروض أول 200 من ${rows.length}: ابحث لتجد البقية.`)}</p>` : ""}`}`, { translated: true });
}

export const readinessSection: Section = {
  nav: { href: "/readiness", label: "Readiness", roles: LEADS },
  routes: [{ method: "GET", path: "/readiness", roles: LEADS, handler: page }],
};
