// UX2b: Approve (the reference's `/ops/approve`): one card at a time, for everything that waits for a decision from a person.
// Four tabs, each with its count: Names, Pictures, Label readings (LB1's queue, in its order: allergens, halal and certificates, warnings,
// disagreements, the rest), and Second approvals (refunds, price changes, the LBP rate and the settings that are two-person).
// Nothing here decides anything itself. Each card posts to the route its older list page already has (names, pictures, label approvals,
// approvals), which calls the same SQL function as before (review_product_name, review_product_image, review_proposed_fact and its
// siblings, decide_approval); `return_to` brings the person back to the next card. The older list pages stay, one tap away at the foot.
//   * The two-person rule is on the card: who asked, and that the person who asked can never approve (the database refuses it too).
//   * Undo is offered only where the database can take the action back as it is: approving a name (rejecting it puts the earlier name
//     back). A picture, a label reading, a payment or a refund is not undoable here, and says so.
//   * No swipe decides anything: buttons, and the keys a (approve), r (reject, which asks for a reason) and the arrow or space to skip.
//   * Unknown is never safe (invariant 15): an allergen, halal or warning row asks for a tick that the person looked at the label photo.
import { html, render, type Ctx, type Section } from "../app";
import { badgeText, buildNav } from "../nav";
import { form, usd, when } from "../html";
import { pick, t, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, button, empty, icon, input, tabs } from "@ak/ui/components";
import { Raw } from "../html";
import { bySpeed, LICENCE, safeHref, type Img } from "./pictures";
import { GROUP, label as labelWords, LIST_FIELDS, type Row as LabelRow } from "./labelqueue";
import { ar as arSpan, diff, drifted, withSize, type Live, type Proposal } from "./names";
import { KIND as APPROVAL_KIND, type Approval } from "./approvals";
import { settingWords } from "./settingmeta";

const TABS = ["names", "pictures", "labels", "money"] as const;
type Tab = (typeof TABS)[number];
const LEGACY: Record<Tab, string> = { names: "/names", pictures: "/pictures", labels: "/label-queue", money: "/approvals" };

type Loaded = { count: number; error?: boolean };
const num = (v: unknown) => Number(v);

// ---------- loaders: the queue of each tab, and only the first thing that tab's card needs ----------
async function namesQueue(c: Ctx): Promise<{ rows: Proposal[]; live: Map<string, Live> }> {
  const rows = await c.deps.db.rows<Proposal>("product_name_proposals", { where: { status: "proposed" }, order: [{ col: "sku" }], limit: 5000 });
  return { rows, live: new Map() };
}
async function picturesQueue(c: Ctx): Promise<Img[]> {
  return ((await c.deps.db.rpc<Img[] | null>("product_images_review", { p_status: "proposed", p_limit: 1000 })) ?? []).sort(bySpeed);
}
async function labelsQueue(c: Ctx): Promise<LabelRow[]> {
  return (await c.deps.db.rpc<LabelRow[] | null>("approval_queue", { p_limit: 400 })) ?? [];
}
async function moneyQueue(c: Ctx): Promise<Approval[]> {
  return c.deps.db.rows<Approval>("pending_approvals", { where: { status: "pending" }, order: [{ col: "requested_at" }], limit: 100 });
}
const safely = async <T,>(f: () => Promise<T>, none: T): Promise<{ v: T; error: boolean }> => { try { return { v: await f(), error: false }; } catch { return { v: none, error: true }; } };

// ---------- the pieces every card shares ----------
const href = (tab: Tab, n = 0) => `/approve?tab=${tab}${n > 0 ? `&n=${n}` : ""}`;
const back = (tab: Tab, n: number) => html`<input type="hidden" name="return_to" value="${href(tab, n)}">`;

/** Where this card is in its queue, and the ways to move: previous, skip. Skip is a link: nothing is decided by moving. */
function stepper(L: Lang, tab: Tab, n: number, total: number) {
  return html`<nav class="ak-approve-step" aria-label="${pick(L, "Cards", "البطاقات")}"><p><strong>${pick(L, `Card ${n + 1} of ${total}`, `البطاقة ${n + 1} من ${total}`)}</strong></p>
<p class="actions-row">${n > 0 ? button({ label: pick(L, "Previous", "السابقة"), href: href(tab, n - 1), variant: "ghost", icon: "chevron", attrs: { "data-key": "prev" } }) : ""}${total > 1 ? button({ label: pick(L, "Skip for now", "تخطَّ الآن"), href: href(tab, n + 1 < total ? n + 1 : 0), variant: "soft", icon: "chevron", attrs: { "data-key": "skip" } }) : ""}</p></nav>`;
}

/** The reference's rule for rejecting: a reason is needed. The field is required in the page; the database keeps the note. */
const rejectForm = (c: Ctx, action: string, tab: Tab, n: number, name = "decision", value = "reject", reasonName = "note") => form(c.f, action, html`${back(tab, n)}
${input({ name: reasonName, label: pick(c.lang, "Reason (needed to reject)", "السبب (مطلوب للرفض)"), maxlength: 200, required: true, attrs: { "data-key": "reason" } })}
<div class="actions-row">${button({ label: pick(c.lang, "Reject", "ارفض"), variant: "danger", icon: "close", name, value, attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" });

const list = (L: Lang, tab: Tab) => html`<p class="muted ak-approve-foot">${pick(L, "Prefer a list? ", "تفضّل قائمة؟ ")}<a href="${LEGACY[tab]}">${pick(L, "See all of these as a list", "اعرض كلها كقائمة")}</a></p>`;
const noMore = (L: Lang, tab: Tab, text: string) => html`${empty({ title: text, ok: true, icon: "check" })}${list(L, tab)}`;

// ---------- Names ----------
async function namesCard(c: Ctx, n: number, q: { rows: Proposal[] }) {
  const L = c.lang;
  const r = q.rows[n]!;
  const p = (await c.deps.db.rows<Live>("products", { select: "sku,name_en,name_ar,brand,sell_unit", where: { sku: r.sku }, limit: 1 }))[0];
  const saveEn = withSize(r.name_en, r.size_en); const saveAr = withSize(r.name_ar, r.size_ar) ?? p?.name_ar ?? null;
  const warns: Raw[] = [];
  if (!p) warns.push(html`<p class="note">${icon("alert")} ${pick(L, "This item is not in the catalog database, so nothing can be applied.", "هذا الصنف غير موجود في قاعدة الكتالوج، فلا يمكن تطبيق شيء.")}</p>`);
  if (drifted(p, r)) warns.push(html`<p class="note">${icon("alert")} ${pick(L, "The catalog name has changed since this was proposed: check that the proposal still fits.", "تغيّر اسم الكتالوج منذ اقتراح هذا: تأكد أن الاقتراح ما زال مناسباً.")}</p>`);
  if (r.ar_source === "model_written") warns.push(html`<p class="note">${icon("alert")} ${pick(L, "The Arabic was written by a model: it needs a person who reads Arabic.", "العربية كتبها نموذج: تحتاج شخصاً يقرأ العربية.")}</p>`);
  if (r.added_words.length) warns.push(html`<p class="note">${pick(L, "Words the generator had to add:", "كلمات اضطر المولّد لإضافتها:")} ${r.added_words.join(", ")}.</p>`);
  const same = (a: string | null, b: string | null) => !diff(a, b);
  return html`<article class="ak-card ak-approve-card" data-card="names" data-sku="${r.sku}">
<header class="head"><p><strong>${badge(pick(L, "Name", "اسم"), "gold", "approve")} <bdi>${r.sku}</bdi></strong> · ${r.current_brand ?? pick(L, "no brand", "بلا علامة")} · ${r.current_sell_unit ?? ""}</p></header>
<div class="ak-compare">
<section aria-label="${pick(L, "In the catalog now", "في الكتالوج الآن")}"><h3>${pick(L, "In the catalog now", "في الكتالوج الآن")}</h3>
<dl class="ak-facts"><dt>${pick(L, "English name", "الاسم بالإنجليزية")}</dt><dd><bdi>${p?.name_en ?? r.current_name_en}</bdi></dd>
<dt>${pick(L, "Arabic name", "الاسم بالعربية")}</dt><dd>${arSpan(p?.name_ar ?? r.current_name_ar)}</dd></dl></section>
<section aria-label="${pick(L, "Proposed", "المقترح")}"><h3>${pick(L, "Proposed", "المقترح")}</h3>
<dl class="ak-facts"><dt>${pick(L, "English name", "الاسم بالإنجليزية")}</dt><dd class="${same(p?.name_en ?? r.current_name_en, r.name_en) ? "" : "ak-changed"}"><bdi>${r.name_en}</bdi>${r.size_en ? html` <span class="muted">· ${r.size_en}</span>` : ""}</dd>
<dt>${pick(L, "Arabic name", "الاسم بالعربية")}</dt><dd class="${same(p?.name_ar ?? r.current_name_ar, r.name_ar) ? "" : "ak-changed"}">${arSpan(r.name_ar)}${r.size_ar ? html` <span class="muted">· ${arSpan(r.size_ar)}</span>` : ""}</dd></dl></section></div>
<p class="ak-saved-as">${pick(L, "Will be saved as", "سيُحفظ باسم")}: <strong><bdi>${saveEn}</bdi></strong> · ${arSpan(saveAr)}</p>
${warns}
${r.off_hint ? html`<p class="muted">${pick(L, "Open Food Facts calls it:", "يسمّيه Open Food Facts:")} ${[r.off_hint.name, r.off_hint.brands, r.off_hint.quantity].filter(Boolean).join(" · ")}.</p>` : ""}
${form(c.f, `/names/${r.id}`, html`${back("names", n)}<div class="actions-row">${button({ label: pick(L, "Approve", "وافق"), variant: "gold", icon: "check", name: "decision", value: "approve", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Approving saves the name, queues its search words again, and shows an Undo for a moment: undoing puts the earlier name back.", "الموافقة تحفظ الاسم وتعيد بناء كلمات بحثه، وتظهر «تراجع» للحظات: التراجع يعيد الاسم السابق.")}</p>`)}
<details class="ak-more"><summary>${pick(L, "Correct it first", "صحّحه أولاً")}</summary>
${form(c.f, `/names/${r.id}`, html`${back("names", n)}<div class="ak-money-fields">
${input({ name: "name_en", label: pick(L, "English name", "الاسم بالإنجليزية"), value: r.name_en, maxlength: 160 })}${input({ name: "size_en", label: pick(L, "English size", "الحجم بالإنجليزية"), value: r.size_en ?? "", maxlength: 40 })}
${input({ name: "name_ar", label: pick(L, "Arabic name", "الاسم بالعربية"), value: r.name_ar ?? "", maxlength: 160, attrs: { dir: "rtl", lang: "ar" } })}${input({ name: "size_ar", label: pick(L, "Arabic size", "الحجم بالعربية"), value: r.size_ar ?? "", maxlength: 40, attrs: { dir: "rtl", lang: "ar" } })}
${input({ name: "note", label: pick(L, "Note (why)", "ملاحظة (السبب)"), maxlength: 300 })}</div>
<div class="actions-row">${button({ label: pick(L, "Save my correction", "احفظ تصحيحي"), icon: "check", name: "decision", value: "correct", attrs: { "data-key": "c" } })}</div>`)}</details>
${rejectForm(c, `/names/${r.id}`, "names", n)}
</article>${list(L, "names")}`;
}

// ---------- Pictures ----------
async function picturesCard(c: Ctx, n: number, rows: Img[]) {
  const L = c.lang;
  const r = rows[n]!;
  const link = await c.deps.media.sign(r.media_path, 600);
  return html`<article class="ak-card ak-approve-card" data-card="pictures">
<header class="head"><p><strong>${badge(pick(L, "Picture", "صورة"), "gold", "approve")} <bdi>${r.name_en}</bdi></strong>${r.name_ar ? html` · <bdi lang="ar">${r.name_ar}</bdi>` : ""}</p>
<p class="muted"><bdi>${r.sku ?? ""}</bdi> · ${r.brand ?? pick(L, "no brand", "بلا علامة")} · ${r.sell_unit}${r.barcode ? html` · ${pick(L, "barcode", "الباركود")} <bdi>${r.barcode}</bdi>` : ""}</p></header>
<div class="ak-compare ak-compare--photo"><div class="ak-photo">${link ? html`<a href="${link}" target="_blank" rel="noopener"><img class="proof" src="${link}" alt="${pick(L, "Proposed picture of", "الصورة المقترحة لـ")} ${r.name_en}"></a>` : html`<p class="note">${pick(L, "Picture not available.", "الصورة غير متاحة.")}</p>`}
<p class="muted">${r.width_px ?? "?"} × ${r.height_px ?? "?"} px${r.bytes ? `, ${Math.round(r.bytes / 1024)} KB` : ""}</p></div>
<dl class="ak-facts"><dt>${pick(L, "Source", "المصدر")}</dt><dd>${r.source_kind}${safeHref(r.page_url) ? html` · <a href="${safeHref(r.page_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "page", "الصفحة")}</a>` : ""}${safeHref(r.source_url) ? html` · <a href="${safeHref(r.source_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "original", "الأصل")}</a>` : ""}</dd>
<dt>${pick(L, "Licence", "الترخيص")}</dt><dd>${LICENCE[r.licence] ?? r.licence}${r.attribution ? html` · ${r.attribution}` : ""}</dd>
<dt>${pick(L, "Fetched", "جُلبت")}</dt><dd>${when(r.fetched_at)}</dd></dl></div>
${r.customer_visible ? "" : html`<p class="note">${icon("alert")} <strong>${pick(L, "Never shown to customers", "لا تُعرض للزبائن أبداً")}</strong> ${pick(L, "(licence unknown): approving keeps it only as a guide for the intake photo.", "(الترخيص غير معروف): الموافقة تبقيها دليلاً لصورة الإدخال فقط.")}</p>`}
<p class="muted">${pick(L, "Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, shop logo or text on top.", "وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار متجر أو كتابة فوقها.")}</p>
${form(c.f, `/pictures/${r.image_id}`, html`${back("pictures", n)}<div class="actions-row">${button({ label: pick(L, "Approve", "وافق"), variant: "gold", icon: "check", name: "decision", value: "approve", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "A picture's approval cannot be undone from here: it replaces the earlier picture. A wrong one is rejected on the Pictures page.", "لا يمكن التراجع عن الموافقة على صورة من هنا: فهي تحلّ محل الصورة السابقة. الصورة الخاطئة تُرفض في صفحة الصور.")}</p>`)}
${rejectForm(c, `/pictures/${r.image_id}`, "pictures", n)}
</article>${list(L, "pictures")}`;
}

// ---------- Label readings (LB1's order of one sitting) ----------
async function labelsCard(c: Ctx, n: number, rows: LabelRow[], group: number) {
  const L = c.lang;
  const x = rows[n]!;
  const sign = async (path: string | null) => (path ? c.deps.media.sign(path, 900) : null);
  const [front, back_, side] = await Promise.all([sign(x.photos.front), sign(x.photos.back), sign(x.photos.side)]);
  const photos = [["front", front, pick(L, "Front", "الواجهة")], ["back", back_, pick(L, "Back", "الخلف")], ["side", side, pick(L, "Side", "الجانب")]] as const;
  const safety = x.group <= 3;                                                       // allergens, halal and certificates, warnings
  const edit = () => {
    if (x.kind === "fact" && /^(milk|eggs|gluten|crustaceans|fish|peanuts|soy|tree_nuts|celery|mustard|sesame|sulphites|lupin|molluscs)$/.test(x.label))
      return html`<label class="ak-field"><span>${pick(L, "The pack says", "العبوة تقول")}</span><select class="ak-select" name="value">${["contains", "may_contain", "free"].map((v) => html`<option${v === x.value_text ? " selected" : ""}>${v}</option>`)}</select></label>`;
    if (x.kind === "fact" && ["halal", "vegetarian", "vegan"].includes(x.label))
      return html`<label class="ak-field"><span>${pick(L, "The pack says", "العبوة تقول")}</span><select class="ak-select" name="value">${["yes", "no"].map((v) => html`<option${v === x.value_text ? " selected" : ""}>${v}</option>`)}</select></label>`;
    if (x.kind === "field" && LIST_FIELDS.has(x.label)) return html`<label class="ak-field"><span>${pick(L, "One line each, as printed", "سطر لكل تحذير كما هو مطبوع")}</span><textarea class="ak-input" name="corrected" rows="3">${x.value_text.split("; ").join("\n")}</textarea></label>`;
    if (x.kind === "field") return input({ name: "corrected", label: pick(L, "As printed", "كما هو مطبوع"), value: x.value_text, maxlength: 500 });
    return "";
  };
  return html`<article class="ak-card ak-approve-card" data-card="labels" data-group="${x.group}">
<header class="head"><p>${badge(pick(L, `Group ${x.group} of 5: ${GROUP(L, x.group)[0]}`, `المجموعة ${x.group} من 5: ${GROUP(L, x.group)[0]}`), safety ? "warn" : "gold", "approve")}</p>
<p class="muted">${GROUP(L, x.group)[1]}</p>
<p><strong><a href="/intake/${x.product_id}"><bdi>${x.name_en}</bdi></a></strong> <bdi class="muted" lang="ar">${x.name_ar ?? ""}</bdi><br><small class="muted"><bdi>${x.aisle}</bdi> · <bdi>${x.sku}</bdi></small></p></header>
<div class="ak-compare ak-compare--photo"><div class="ak-photos">${photos.map(([k, l, w]) => l ? html`<figure><a href="${l}" target="_blank" rel="noopener"><img class="proof" src="${l}" alt="${w}"></a><figcaption>${w}</figcaption></figure>` : html`<figure class="ak-nophoto"><p class="muted">${w}: ${pick(L, "no photo", "لا صورة")}</p></figure>`)}</div>
<dl class="ak-facts"><dt>${labelWords(x.label)}</dt><dd><strong><bdi>${x.value_text}</bdi></strong></dd>
${x.quote ? html`<dt>${pick(L, "Printed words", "الكلمات المطبوعة")}</dt><dd>“<bdi>${x.quote}</bdi>”</dd>` : ""}
<dt>${pick(L, "Read from", "مأخوذ من")}</dt><dd>${x.source}</dd></dl></div>
${x.disagrees?.length ? html`<p class="note">${icon("alert")} ${pick(L, "Another source said otherwise:", "مصدر آخر قال غير ذلك:")} ${x.disagrees.map((d) => `${d.source}${d.value !== undefined ? `: ${typeof d.value === "string" ? d.value : JSON.stringify(d.value)}` : ""}`).join("; ")}. ${pick(L, "The label's reading wins; check the photo.", "قراءة الملصق هي المعتمدة؛ تحقق من الصورة.")}</p>` : ""}
${form(c.f, `/label-queue/${x.kind}/${x.id}/confirm`, html`${back("labels", n)}${edit()}
${safety ? html`<label class="ak-check"><input type="checkbox" name="looked" value="1" required> <span>${pick(L, "I looked at the label photo and it says this.", "نظرت إلى صورة الملصق وهو يقول هذا.")}</span></label>` : ""}
<div class="actions-row">${button({ label: pick(L, "Confirm", "أكّد"), variant: "gold", icon: "check", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Nothing is published until you confirm it, and a confirmation cannot be undone here: a wrong fact is corrected on the item's own page.", "لا يُنشر شيء حتى تؤكده، ولا يمكن التراجع عن التأكيد من هنا: تُصحَّح المعلومة الخاطئة في صفحة الصنف.")}</p>`)}
${rejectForm(c, `/label-queue/${x.kind}/${x.id}/reject`, "labels", n, "decision", "reject")}
</article>${list(L, "labels")}`;
}

// ---------- Second approvals: refunds, price changes, the LBP rate, the settings that are two-person ----------
const KIND_AR: Record<string, string> = { price: "سعر", refund: "استرداد", payment: "دفعة", fx: "سعر الصرف", setting: "إعداد" };
type Limits = { price_change_pct?: number; refund_usd?: number; fx_rate_second_person?: boolean } | null;
const sign = (v: number) => `${v > 0 ? "+" : ""}${(Math.round(v * 10) / 10).toString()}%`;

async function moneyCard(c: Ctx, n: number, rows: Approval[]) {
  const L = c.lang;
  const a = rows[n]!;
  const { db } = c.deps;
  const [limits, people] = await Promise.all([
    db.rpc<Limits>("setting", { p_key: "approvals" }),
    db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: [a.requested_by] } } }),
  ]);
  const by = people[0]?.display_name ?? pick(L, "Staff", "موظف");
  const p = a as unknown as { ref: string; payload: Record<string, any> };
  let ref = ""; let what: Raw | string = a.summary; let rule = "";
  if (a.kind === "refund") {
    const o = (await db.rows<{ short_code: string; total_usd: number | string }>("orders", { select: "short_code,total_usd", where: { id: p.ref }, limit: 1 }))[0];
    ref = o?.short_code ?? "";
    what = html`${pick(L, "Refund", "استرداد")} <strong><bdi>${usd(p.payload.amount_usd)}</bdi></strong> ${pick(L, "on order", "على الطلب")} <bdi>${ref}</bdi>${o ? html` (${pick(L, "total", "المجموع")} <bdi>${usd(o.total_usd)}</bdi>)` : ""}<br><span class="muted">${p.payload.charged_to}, ${p.payload.reason}, ${pick(L, "given back as", "يُعاد عبر")} ${p.payload.settle}${p.payload.note ? ` · ${p.payload.note}` : ""}</span>`;
    rule = pick(L, `A refund above ${usd(limits?.refund_usd ?? 10)} needs a second person.`, `استرداد فوق ${usd(limits?.refund_usd ?? 10)} يحتاج شخصاً ثانياً.`);
  } else if (a.kind === "price") {
    const prod = (await db.rows<{ name_en: string }>("products", { select: "name_en", where: { id: p.ref }, limit: 1 }))[0];
    const offer = (await db.rows<{ price_usd: number | string }>("offers", { select: "price_usd", where: { product_id: p.ref }, limit: 1 }))[0];
    const to = num(p.payload.price_usd), from = offer ? num(offer.price_usd) : null;
    what = html`${pick(L, "Price of", "سعر")} <strong><bdi>${prod?.name_en ?? ""}</bdi></strong>: ${from !== null ? html`<bdi>${usd(from)}</bdi> → ` : ""}<strong><bdi>${usd(to)}</bdi></strong>${from ? html` <span class="muted">(${sign(((to - from) / from) * 100)})</span>` : ""}<br><span class="muted">${p.payload.reason ?? ""}</span>`;
    rule = pick(L, `A price change of more than ${limits?.price_change_pct ?? 10}% needs a second person.`, `تغيير سعر بأكثر من ${limits?.price_change_pct ?? 10}% يحتاج شخصاً ثانياً.`);
  } else if (a.kind === "fx") {
    const to = num(p.payload.lbp_per_usd), from = p.payload.current ? num(p.payload.current) : null;
    what = html`${pick(L, "Exchange rate", "سعر الصرف")}: ${from ? html`<bdi>${Math.round(from).toLocaleString("en-US")}</bdi> → ` : ""}<strong><bdi>${Math.round(to).toLocaleString("en-US")}</bdi></strong> LBP / USD${from ? html` <span class="muted">(${sign(((to - from) / from) * 100)})</span>` : ""}`;
    rule = pick(L, "Any change to the LBP rate needs a second person.", "أي تغيير في سعر الليرة يحتاج شخصاً ثانياً.");
  } else if (a.kind === "setting") {
    const w = settingWords(L, String(p.payload.key), String(p.payload.field ?? ""));
    what = html`${pick(L, "Setting", "إعداد")}: <strong>${w}</strong>: <bdi>${String(p.payload.before ?? "")}</bdi> → <strong><bdi>${String(p.payload.value ?? "")}</bdi></strong><br><span class="muted">${p.payload.reason ?? ""}</span>`;
    rule = pick(L, "A change to this rule needs a second person.", "تغيير هذه القاعدة يحتاج شخصاً ثانياً.");
  } else if (a.kind === "payment") {
    rule = pick(L, "A transfer more than 5% over the order total needs a second person.", "تحويل يزيد عن مجموع الطلب بأكثر من 5% يحتاج شخصاً ثانياً.");
  }
  const mine = a.requested_by === c.staff.partyId;
  return html`<article class="ak-card ak-approve-card" data-card="money" data-kind="${a.kind}">
<header class="head"><p>${badge(L === "ar" ? KIND_AR[a.kind] ?? a.kind : APPROVAL_KIND[a.kind] ?? a.kind, "gold", "money")} <span class="muted">${when(a.requested_at)}</span></p></header>
<p class="ak-what">${what}</p>
<div class="ak-two" role="group" aria-label="${pick(L, "Two-person rule", "قاعدة الشخصين")}">
<p>${icon("check")} <strong>${pick(L, "Asked by", "طلبها")} ${by}</strong></p>
<p>${mine ? html`${icon("clock")} <strong>${pick(L, "Waiting for someone else: the person who asked can never approve.", "بانتظار شخص آخر: من طلبها لا يستطيع الموافقة أبداً.")}</strong>` : html`${icon("approve")} <strong>${pick(L, "Needs you as the second person.", "تحتاجك كشخص ثانٍ.")}</strong>`}</p>
<p class="muted">${rule}</p></div>
${mine ? "" : form(c.f, `/approvals/${a.id}/approve`, html`${back("money", n)}<div class="actions-row">${button({ label: pick(L, "Approve: make the change", "وافق: نفّذ التغيير"), variant: "gold", icon: "check", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Approving makes the change as it was asked, in the asker's name. Money and settings are not undone from here.", "الموافقة تنفّذ التغيير كما طُلب، باسم من طلبه. لا يُتراجع عن المال والإعدادات من هنا.")}</p>`)}
${form(c.f, `/approvals/${a.id}/reject`, html`${back("money", n)}
${input({ name: "note", label: mine ? pick(L, "Why (optional)", "السبب (اختياري)") : pick(L, "Reason (needed to reject)", "السبب (مطلوب للرفض)"), maxlength: 200, required: !mine, attrs: { "data-key": "reason" } })}
<div class="actions-row">${button({ label: mine ? pick(L, "Withdraw my request", "اسحب طلبي") : pick(L, "Reject", "ارفض"), variant: "danger", icon: "close", attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" })}
</article>${list(L, "money")}`;
}

// ---------- the page ----------
async function page(c: Ctx) {
  const L = c.lang;
  const [names, pictures, labels, money] = await Promise.all([
    safely(() => namesQueue(c), { rows: [] as Proposal[], live: new Map<string, Live>() }), safely(() => picturesQueue(c), [] as Img[]),
    safely(() => labelsQueue(c), [] as LabelRow[]), safely(() => moneyQueue(c), [] as Approval[]),
  ]);
  const counts: Record<Tab, number> = { names: names.v.rows.length, pictures: pictures.v.length, labels: labels.v.length, money: money.v.length };
  const asked = c.url.searchParams.get("tab") ?? "";
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : TABS.find((x) => counts[x] > 0) ?? "names";
  const total = counts[tab];
  const n = total === 0 ? 0 : Math.min(total - 1, Math.max(0, Math.floor(Number(c.url.searchParams.get("n"))) || 0));
  const label: Record<Tab, string> = { names: pick(L, "Names", "الأسماء"), pictures: pick(L, "Pictures", "الصور"), labels: pick(L, "Label readings", "قراءات الملصقات"), money: pick(L, "Second approvals", "الموافقات الثانية") };
  const failed = { names: names.error, pictures: pictures.error, labels: labels.error, money: money.error }[tab];
  let card: Raw;
  if (failed) card = html`<p class="note">${icon("alert")} ${pick(L, "This list is not available yet: the database is missing a part of it.", "هذه القائمة غير متاحة بعد: قاعدة البيانات ينقصها جزء منها.")}</p>`;
  else if (total === 0) card = noMore(L, tab, pick(L, "Nothing waits here.", "لا شيء ينتظر هنا."));
  else if (tab === "names") card = await namesCard(c, n, names.v);
  else if (tab === "pictures") card = await picturesCard(c, n, pictures.v);
  else if (tab === "labels") card = await labelsCard(c, n, labels.v, labels.v[n]!.group);
  else card = await moneyCard(c, n, money.v);
  const more = buildNav(c.sections, c.staff.role, L, c.url.pathname, c.badges).groups.find((g) => g.id === "approve");
  return render(c, t(L, "nav_approve"), html`<div data-approve>
<p class="muted">${pick(L, "One card at a time. Nothing is decided by moving between cards, and nothing is decided by a swipe.", "بطاقة واحدة في كل مرة. لا يُقرَّر شيء بالتنقل بين البطاقات، ولا بالسحب.")}
${pick(L, " Keys: a approves, r rejects (it asks for a reason), the arrow or space skips.", " المفاتيح: a للموافقة، r للرفض (يطلب سبباً)، السهم أو المسافة للتخطي.")}</p>
${tabs(TABS.map((x) => ({ label: label[x], href: href(x), current: x === tab, count: counts[x] })), t(L, "nav_approve"))}
${total > 0 && !failed ? stepper(L, tab, n, total) : ""}
${card}
<h2>${pick(L, "Approval pages as lists", "صفحات الموافقات كقوائم")}</h2>
${more && more.links.filter((l) => l.href !== "/approve").length ? html`<ul class="hub">${more.links.filter((l) => l.href !== "/approve").map((l) => html`<li><a href="${l.href}"><span>${l.label}</span>${l.badge > 0 ? html` <span class="badge">${badgeText(l.badge)}</span>` : ""}</a></li>`)}</ul>` : html`<p class="muted">${t(L, "hub_empty")}</p>`}
</div>`, { translated: true });
}

export const approveSection: Section = {
  // The page the phone's Approve and the sidebar group open; its older list pages stay under the Approve group.
  nav: { href: "/approve", label: "Approve", roles: LEADS },
  routes: [{ method: "GET", path: "/approve", roles: LEADS, handler: page }],
};
