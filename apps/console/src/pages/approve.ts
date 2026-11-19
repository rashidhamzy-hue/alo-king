// CON1: the one Approvals inbox (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026"). Eight kinds, each with its count, one card
// at a time: Names, Photos, Label readings, Dishes (FD1's menus), Places (approve_merchant), Second approvals (price, rate, settings, a
// large transfer), Refunds (above the limit) and Auto-approvals (the day's spot checks). Every card posts to the route its page already has
// (/names, /pictures, /label-queue, /menus/dish, /places/<id>/approve, /approvals, /auto-approvals/check) with `return_to`, so every SQL
// function, role and refusal stands. The older list pages live here as "view=list" (app.ts drawOlder) and their addresses move here (MOVED).
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
import { drawOlder, html, redirect, render, type Ctx, type Section } from "../app";
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

const TABS = ["names", "photos", "labels", "dishes", "places", "second", "refunds", "auto"] as const;
type Tab = (typeof TABS)[number];
/** Older addresses of a kind (a bookmark, a page that sends here): Pictures is now Photos, and the second approvals were "money". */
const ALIAS: Record<string, Tab> = { pictures: "photos", money: "second" };
/** Each kind as a list: drawn here from its older page (view=list), or the page that owns it (Photos, Menus, Places). */
const LEGACY: Record<Tab, string> = { names: "/approve?tab=names&view=list", photos: "/photos", labels: "/approve?tab=labels&view=list", dishes: "/menus", places: "/places",
  second: "/approve?tab=second&view=list", refunds: "/approve?tab=refunds&view=list", auto: "/approve?tab=auto&view=list" };
/** The older list page drawn for "view=list", or the page a kind's list lives on. */
const LIST_ROUTE: Record<Tab, { draw?: string; go?: string }> = { names: { draw: "/names" }, photos: { go: "/photos" }, labels: { draw: "/label-queue" }, dishes: { go: "/menus" },
  places: { go: "/places" }, second: { draw: "/approvals" }, refunds: { draw: "/approvals" }, auto: { draw: "/auto-approvals" } };

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
type PlaceRow = { source_id: string; name: string; village_en: string | null; village_ar: string | null; visibility: string; approved: boolean; owner_on_file: boolean;
  menu_checked_on: string | null; photos_waiting: number; dishes_waiting: number; dishes: number };
type Named = { name_ar: string | null; name_en: string | null };
type DishRow = Named & { id: string; photo_id: string; section_ar: string | null; section_en: string | null; price: number | string | null; currency: string | null;
  price_text: string | null; sizes: unknown[] | null; options: unknown[] | null; addons: unknown[] | null; name_claim: boolean; place: string; source_id: string; photo_path: string | null };
async function placesQueue(c: Ctx): Promise<PlaceRow[]> {
  return ((await c.deps.db.rpc<PlaceRow[] | null>("places_console", {})) ?? []);
}
/** Every dish waiting for a person, place by place (FD1's menu_console, read as the Menus page reads it). At most 12 places a view. */
async function dishesQueue(c: Ctx, places: PlaceRow[]): Promise<DishRow[]> {
  const waiting = places.filter((p) => Number(p.dishes_waiting) > 0).slice(0, 12);
  const menus = await Promise.all(waiting.map(async (p) => ({ p, m: await c.deps.db.rpc<{ photos?: { photo_id: string; media_path: string }[]; waiting?: Omit<DishRow, "place" | "source_id" | "photo_path">[] } | null>("menu_console", { p_source: p.source_id }) })));
  return menus.flatMap(({ p, m }) => (m?.waiting ?? []).map((d) => ({ ...d, place: p.name, source_id: p.source_id, photo_path: m?.photos?.find((x) => x.photo_id === d.photo_id)?.media_path ?? null })));
}
type SpotCheck = { check_id: string; sample_day: string; field: string; applied: boolean; sku: string; name_en: string; name_ar: string | null; brand: string | null;
  checks: Record<string, boolean> | null; picture: { media_path: string; source_kind: string; status: string } | null;
  name: { name_en: string; size_en: string | null; name_ar: string | null; size_ar: string | null; current_name_en: string } | null;
  fact: { attribute: string; text?: string | null; values?: Record<string, unknown> | null } | null };
/** AUTO1: a decision of an approval rule, sampled for the week's check (automation_overview, 0264). */
export type WeekCheck = { check_id: string; kind: "dish" | "photo"; week: string; decision_id: string; action: string; title: string; reason: string; version: string;
  at: string; target_id: string; product_id: string | null; media_path: string | null; place: string | null };
type AutoItem = { spot?: SpotCheck; week?: WeekCheck };
async function autoQueue(c: Ctx): Promise<AutoItem[]> {
  // the week's checks of the AUTO1 rules first (they keep each rule on), then I1's daily spot checks; either may be missing on an older database
  const [week, spot] = await Promise.all([
    c.deps.db.rpc<{ checks?: WeekCheck[] } | null>("automation_overview", { p_limit: 60 }).then((o) => o?.checks ?? []).catch(() => [] as WeekCheck[]),
    c.deps.db.rpc<{ spot_checks?: SpotCheck[] } | null>("auto_approvals_overview", { p_limit: 60 }).then((o) => o?.spot_checks ?? []),
  ]);
  return [...week.map((w) => ({ week: w })), ...spot.map((x) => ({ spot: x }))];
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
  return html`<article class="ak-card ak-approve-card" data-card="photos">
<header class="head"><p><strong>${badge(pick(L, "Photo", "صورة"), "gold", "approve")} <bdi>${r.name_en}</bdi></strong>${r.name_ar ? html` · <bdi lang="ar">${r.name_ar}</bdi>` : ""}</p>
<p class="muted"><bdi>${r.sku ?? ""}</bdi> · ${r.brand ?? pick(L, "no brand", "بلا علامة")} · ${r.sell_unit}${r.barcode ? html` · ${pick(L, "barcode", "الباركود")} <bdi>${r.barcode}</bdi>` : ""}</p></header>
<div class="ak-compare ak-compare--photo"><div class="ak-photo">${link ? html`<a href="${link}" target="_blank" rel="noopener"><img class="proof" src="${link}" alt="${pick(L, "Proposed picture of", "الصورة المقترحة لـ")} ${r.name_en}"></a>` : html`<p class="note">${pick(L, "Picture not available.", "الصورة غير متاحة.")}</p>`}
<p class="muted">${r.width_px ?? "?"} × ${r.height_px ?? "?"} px${r.bytes ? `, ${Math.round(r.bytes / 1024)} KB` : ""}</p></div>
<dl class="ak-facts"><dt>${pick(L, "Source", "المصدر")}</dt><dd>${r.source_kind}${safeHref(r.page_url) ? html` · <a href="${safeHref(r.page_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "page", "الصفحة")}</a>` : ""}${safeHref(r.source_url) ? html` · <a href="${safeHref(r.source_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "original", "الأصل")}</a>` : ""}</dd>
<dt>${pick(L, "Licence", "الترخيص")}</dt><dd>${LICENCE[r.licence] ?? r.licence}${r.attribution ? html` · ${r.attribution}` : ""}</dd>
<dt>${pick(L, "Fetched", "جُلبت")}</dt><dd>${when(r.fetched_at)}</dd></dl></div>
${r.customer_visible ? "" : html`<p class="note">${icon("alert")} <strong>${pick(L, "Never shown to customers", "لا تُعرض للزبائن أبداً")}</strong> ${pick(L, "(licence unknown): approving keeps it only as a guide for the intake photo.", "(الترخيص غير معروف): الموافقة تبقيها دليلاً لصورة الإدخال فقط.")}</p>`}
<p class="muted">${pick(L, "Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, shop logo or text on top.", "وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار متجر أو كتابة فوقها.")}</p>
${form(c.f, `/pictures/${r.image_id}`, html`${back("photos", n)}<div class="actions-row">${button({ label: pick(L, "Approve", "وافق"), variant: "gold", icon: "check", name: "decision", value: "approve", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "A picture's approval cannot be undone from here: it replaces the earlier picture. A wrong one is withdrawn on the Photos page (Approved).", "لا يمكن التراجع عن الموافقة على صورة من هنا: فهي تحلّ محل الصورة السابقة. الصورة الخاطئة تُسحب في صفحة الصور (المعتمدة).")}</p>`)}
${rejectForm(c, `/pictures/${r.image_id}`, "photos", n)}
</article>${list(L, "photos")}`;
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

async function moneyCard(c: Ctx, n: number, rows: Approval[], tab: "second" | "refunds") {
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
${mine ? "" : form(c.f, `/approvals/${a.id}/approve`, html`${back(tab, n)}<div class="actions-row">${button({ label: pick(L, "Approve: make the change", "وافق: نفّذ التغيير"), variant: "gold", icon: "check", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Approving makes the change as it was asked, in the asker's name. Money and settings are not undone from here.", "الموافقة تنفّذ التغيير كما طُلب، باسم من طلبه. لا يُتراجع عن المال والإعدادات من هنا.")}</p>`)}
${form(c.f, `/approvals/${a.id}/reject`, html`${back(tab, n)}
${input({ name: "note", label: mine ? pick(L, "Why (optional)", "السبب (اختياري)") : pick(L, "Reason (needed to reject)", "السبب (مطلوب للرفض)"), maxlength: 200, required: !mine, attrs: { "data-key": "reason" } })}
<div class="actions-row">${button({ label: mine ? pick(L, "Withdraw my request", "اسحب طلبي") : pick(L, "Reject", "ارفض"), variant: "danger", icon: "close", attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" })}
</article>${list(L, tab)}`;
}

// ---------- Dishes (FD1): a dish the menu reading proposed, beside its menu photo ----------
const nameOf = (n: Named, L: Lang) => (L === "ar" ? n.name_ar ?? n.name_en : n.name_en ?? n.name_ar) ?? "";
async function dishCard(c: Ctx, n: number, rows: DishRow[]) {
  const L = c.lang;
  const d = rows[n]!;
  const photo = d.photo_path ? await c.deps.media.sign(d.photo_path, 600) : null;
  const price = d.price !== null && d.price !== undefined ? `${Number(d.price).toLocaleString("en-US")} ${d.currency ?? ""}`.trim() : d.price_text ?? pick(L, "no price read", "لم يُقرأ سعر");
  const hidden = html`<input type="hidden" name="source" value="${d.source_id}">${back("dishes", n)}`;
  return html`<article class="ak-card ak-approve-card" data-card="dishes">
<header class="head"><p>${badge(pick(L, "Dish", "طبق"), "gold", "food")} <strong><bdi>${d.place}</bdi></strong></p></header>
<div class="ak-compare ak-compare--photo"><div class="ak-photo">${photo ? html`<a href="${photo}" target="_blank" rel="noopener"><img class="proof" src="${photo}" alt="${pick(L, "Menu photo", "صورة القائمة")}"></a>` : html`<p class="note">${pick(L, "Menu photo not available.", "صورة القائمة غير متاحة.")}</p>`}</div>
<dl class="ak-facts"><dt>${pick(L, "Arabic name", "الاسم بالعربية")}</dt><dd><bdi lang="ar">${d.name_ar ?? ""}</bdi></dd>
<dt>${pick(L, "English name", "الاسم بالإنجليزية")}</dt><dd><bdi>${d.name_en ?? ""}</bdi></dd>
<dt>${pick(L, "Section", "القسم")}</dt><dd><bdi>${(L === "ar" ? d.section_ar ?? d.section_en : d.section_en ?? d.section_ar) ?? ""}</bdi></dd>
<dt>${pick(L, "Price as printed", "السعر كما هو مطبوع")}</dt><dd><bdi>${price}</bdi></dd>
<dt>${pick(L, "Sizes, choices, add-ons", "الأحجام والخيارات والإضافات")}</dt><dd>${(d.sizes ?? []).length} · ${(d.options ?? []).length} · ${(d.addons ?? []).length}</dd></dl></div>
${d.name_claim ? html`<p class="note">${icon("alert")} ${pick(L, "The name praises the dish or makes a health claim: correct it on the Menus page first (the database refuses it as it is).", "الاسم يمدح الطبق أو يدّعي فائدة صحية: صحّحه في صفحة القوائم أولاً (ترفضه قاعدة البيانات كما هو).")}</p>` : ""}
${form(c.f, `/menus/dish/${d.id}`, html`${hidden}<input type="hidden" name="decision" value="approve"><div class="actions-row">${button({ label: pick(L, "Approve as read", "وافق كما قُرئ"), variant: "gold", icon: "check", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "To correct a name or the price first, open the place's menu: ", "لتصحيح الاسم أو السعر أولاً افتح قائمة المكان: ")}<a href="/menus/${d.source_id}">${pick(L, "the Menus page", "صفحة القوائم")}</a>.</p>`)}
${form(c.f, `/menus/dish/${d.id}`, html`${hidden}<input type="hidden" name="decision" value="reject">
${input({ name: "note", label: pick(L, "Reason (needed to reject)", "السبب (مطلوب للرفض)"), maxlength: 200, required: true, attrs: { "data-key": "reason", minlength: "3" } })}
<div class="actions-row">${button({ label: pick(L, "Reject", "ارفض"), variant: "danger", icon: "close", attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" })}
</article>${list(L, "dishes")}`;
}

// ---------- Places (FD1): a place made from a listing, not yet approved by approve_merchant() ----------
function placeCard(c: Ctx, n: number, rows: PlaceRow[]) {
  const L = c.lang;
  const p = rows[n]!;
  const yes = (v: boolean) => (v ? pick(L, "yes", "نعم") : pick(L, "not yet", "ليس بعد"));
  return html`<article class="ak-card ak-approve-card" data-card="places">
<header class="head"><p>${badge(pick(L, "Place", "مكان"), "gold", "store")} <strong><bdi>${p.name}</bdi></strong> · ${(L === "ar" ? p.village_ar ?? p.village_en : p.village_en) ?? ""}</p></header>
<dl class="ak-facts"><dt>${pick(L, "Menu checked", "فُحصت القائمة")}</dt><dd>${p.menu_checked_on ?? pick(L, "not yet", "ليس بعد")}</dd>
<dt>${pick(L, "Dishes on sale, waiting", "أطباق للبيع، بالانتظار")}</dt><dd>${p.dishes} · ${p.dishes_waiting}</dd>
<dt>${pick(L, "Menu photos waiting for the reading", "صور قائمة بانتظار القراءة")}</dt><dd>${p.photos_waiting}</dd>
<dt>${pick(L, "Visibility", "الظهور")}</dt><dd>${p.visibility}</dd>
<dt>${pick(L, "Owner's claim on file", "مطالبة المالك في الملف")}</dt><dd>${yes(p.owner_on_file)}</dd></dl>
<p class="muted">${pick(L, "A place is orderable only through this approval, and only by those its visibility allows. The database refuses it while a photo or a dish waits, or before the menu is stamped as checked.", "لا يمكن الطلب من مكان إلا بهذه الموافقة، ولمن يسمح لهم ظهوره فقط. ترفضها قاعدة البيانات ما دامت صورة أو طبق بالانتظار، أو قبل ختم القائمة كمفحوصة.")}</p>
${form(c.f, `/places/${p.source_id}/approve`, html`${back("places", n)}<div class="actions-row">${button({ label: pick(L, "Approve the place", "وافق على المكان"), variant: "gold", icon: "check", attrs: { "data-key": "a" } })}
${button({ label: pick(L, "Open the place", "افتح المكان"), href: `/places/${p.source_id}`, variant: "soft", icon: "store" })}</div>`)}
</article>${list(L, "places")}`;
}

// ---------- Auto-approvals (I1): the day's spot checks, one at a time ----------
const words = (k: string) => k.replace(/_/g, " ");
async function weekCard(c: Ctx, n: number, w: WeekCheck) {
  const L = c.lang;
  const pic = w.kind === "photo" && w.media_path ? await c.deps.media.sign(w.media_path, 600) : null;
  const what = w.kind === "dish" ? pick(L, "A dish approved by the rule", "طبق وافقت عليه القاعدة")
    : w.action === "rejected" ? pick(L, "A picture rejected by the rule", "صورة رفضتها القاعدة") : pick(L, "A picture approved by the rule", "صورة وافقت عليها القاعدة");
  return html`<article class="ak-card ak-approve-card" data-card="auto-week">
<header class="head"><p>${badge(pick(L, "Weekly check", "فحص أسبوعي"), "gold", "shield")} ${what} · <span class="muted"><bdi>${w.version}</bdi> · ${pick(L, "week of", "أسبوع")} ${w.week}</span></p>
<p><strong><bdi>${w.title}</bdi></strong>${w.place ? html` <span class="muted">· <bdi>${w.place}</bdi></span>` : ""}</p></header>
${pic ? html`<div class="ak-photo"><a href="${pic}" target="_blank" rel="noopener"><img class="proof" src="${pic}" alt="${w.title}"></a></div>` : ""}
<p>${pick(L, "Why:", "السبب:")} <bdi>${w.reason}</bdi></p>
${w.kind === "dish" && w.place ? html`<p class="muted">${pick(L, "Compare with the source on the Menus page.", "قارن بالمصدر في صفحة القوائم.")}</p>` : ""}
${form(c.f, `/automation/check/${w.check_id}`, html`${back("auto", n)}<div class="actions-row">${button({ label: pick(L, "Right", "صحيح"), variant: "gold", icon: "check", name: "verdict", value: "correct", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Wrong undoes it at once. More than one wrong in a week's sample switches the rule off, and Today says why.", "«خطأ» يتراجع عنه فوراً. أكثر من خطأ واحد في عيّنة الأسبوع يوقف القاعدة، وتقول صفحة اليوم السبب.")}</p>`)}
${form(c.f, `/automation/check/${w.check_id}`, html`${back("auto", n)}
${input({ name: "note", label: pick(L, "What is wrong (needed for wrong)", "ما الخطأ (مطلوب عند «خطأ»)"), maxlength: 300, required: true, attrs: { "data-key": "reason" } })}
<div class="actions-row">${button({ label: pick(L, "Wrong", "خطأ"), variant: "danger", icon: "close", name: "verdict", value: "wrong", attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" })}
</article>${list(L, "auto")}`;
}
async function autoCard(c: Ctx, n: number, rows: AutoItem[]) {
  const L = c.lang;
  if (rows[n]!.week) return weekCard(c, n, rows[n]!.week!);
  const s = rows[n]!.spot!;
  const pic = s.picture?.media_path ? await c.deps.media.sign(s.picture.media_path, 600) : null;
  return html`<article class="ak-card ak-approve-card" data-card="auto">
<header class="head"><p>${badge(pick(L, "Spot check", "فحص عيّنة"), "gold", "shield")} ${words(s.field)} · <span class="muted">${s.applied ? pick(L, "approved by the rule", "وافقت عليه القاعدة") : pick(L, "the rule was off: it would have approved this", "القاعدة متوقفة: كانت ستوافق على هذا")} · ${s.sample_day}</span></p>
<p><strong><bdi>${s.name_en}</bdi></strong>${s.name_ar ? html` · <bdi lang="ar">${s.name_ar}</bdi>` : ""} <span class="muted"><bdi>${s.sku}</bdi> · ${s.brand ?? pick(L, "no brand", "بلا علامة")}</span></p></header>
${pic ? html`<div class="ak-photo"><a href="${pic}" target="_blank" rel="noopener"><img class="proof" src="${pic}" alt="${s.name_en}"></a></div>` : ""}
${s.name ? html`<p>${pick(L, "Proposed", "المقترح")}: <strong><bdi>${[s.name.name_en, s.name.size_en].filter(Boolean).join(" ")}</bdi></strong>${s.name.name_ar ? html` · <bdi lang="ar">${[s.name.name_ar, s.name.size_ar].filter(Boolean).join(" ")}</bdi>` : ""} <span class="muted">(${pick(L, "was", "كان")} <bdi>${s.name.current_name_en}</bdi>)</span></p>` : ""}
${s.fact ? html`<p>${words(s.fact.attribute)}: <bdi>${s.fact.text ?? (s.fact.values ? Object.entries(s.fact.values).map(([k, v]) => `${words(k)} ${String(v)}`).join(", ") : "")}</bdi></p>` : ""}
<p class="muted">${pick(L, "Checks passed:", "الفحوص الناجحة:")} ${Object.keys(s.checks ?? {}).map(words).join(", ")}</p>
${form(c.f, `/auto-approvals/check/${s.check_id}`, html`${back("auto", n)}<div class="actions-row">${button({ label: pick(L, "Right", "صحيح"), variant: "gold", icon: "check", name: "verdict", value: "correct", attrs: { "data-key": "a" } })}</div>
<p class="muted">${pick(L, "Right on a rule's first sample switches it on; one wrong switches it off and undoes that approval.", "«صحيح» على أول عيّنة لقاعدة يشغّلها؛ و«خطأ» واحد يوقفها ويتراجع عن تلك الموافقة.")}</p>`)}
${form(c.f, `/auto-approvals/check/${s.check_id}`, html`${back("auto", n)}
${input({ name: "note", label: pick(L, "What is wrong (needed for wrong)", "ما الخطأ (مطلوب عند «خطأ»)"), maxlength: 300, required: true, attrs: { "data-key": "reason" } })}
<div class="actions-row">${button({ label: pick(L, "Wrong", "خطأ"), variant: "danger", icon: "close", name: "verdict", value: "wrong", attrs: { "data-key": "r" } })}</div>`, { cls: "ak-reject" })}
</article>${list(L, "auto")}`;
}

/** CON1: what waits in each kind, for Today and the inbox's tabs. A kind whose read fails counts 0 and says so on its tab. */
export async function approvalCounts(c: Ctx): Promise<Record<Tab, number>> {
  const q = await queues(c);
  return Object.fromEntries(TABS.map((k) => [k, q[k].v.length])) as Record<Tab, number>;
}
async function queues(c: Ctx) {
  const [names, photos, labels, money, places, auto] = await Promise.all([
    safely(async () => (await namesQueue(c)).rows, [] as Proposal[]), safely(() => picturesQueue(c), [] as Img[]),
    safely(() => labelsQueue(c), [] as LabelRow[]), safely(() => moneyQueue(c), [] as Approval[]),
    safely(() => placesQueue(c), [] as PlaceRow[]), safely(() => autoQueue(c), [] as AutoItem[]),
  ]);
  const dishes = await safely(() => dishesQueue(c, places.v), [] as DishRow[]);
  return {
    names, photos, labels, dishes, auto,
    places: { v: places.v.filter((p) => !p.approved), error: places.error },
    second: { v: money.v.filter((a) => a.kind !== "refund"), error: money.error },
    refunds: { v: money.v.filter((a) => a.kind === "refund"), error: money.error },
  };
}

// ---------- the page ----------
const KIND_LABEL: Record<Tab, [string, string]> = { names: ["Names", "الأسماء"], photos: ["Photos", "الصور"], labels: ["Label readings", "قراءات الملصقات"], dishes: ["Dishes", "الأطباق"],
  places: ["Places", "الأماكن"], second: ["Second approvals", "الموافقات الثانية"], refunds: ["Refunds", "المبالغ المستردة"], auto: ["Auto-approvals", "الموافقات التلقائية"] };
const kindLabel = (L: Lang, k: Tab) => pick(L, KIND_LABEL[k][0], KIND_LABEL[k][1]);
const tabOf = (asked: string | null): Tab | null => (asked && (TABS as readonly string[]).includes(asked) ? (asked as Tab) : asked && ALIAS[asked] ? ALIAS[asked]! : null);

/** The inbox's tabs, with the count of each kind: also drawn above an older list page shown here. */
function kindTabs(L: Lang, current: Tab, counts: Record<Tab, number>, list = false) {
  return html`${tabs(TABS.map((x) => ({ label: kindLabel(L, x), href: list && x === current ? href(x) : href(x), current: x === current, count: counts[x] })), t(L, "nav_approvals"))}`;
}

/** AUTO1: what the approval rules decided today, in one line, with the way to see and undo each; and a rule the weekly check switched off. */
async function automaticToday(c: Ctx): Promise<Raw | string> {
  const L = c.lang;
  const o = await c.deps.db.rpc<AutomationOverview | null>("automation_overview", { p_limit: 0 }).catch(() => null);
  if (!o) return "";
  const k = o.today?.counts ?? {};
  const n = (x: number | undefined) => Number(x ?? 0);
  const off = (["dish", "photo"] as const).filter((x) => !o.rules?.[x]?.enabled);
  return html`<p class="ak-auto-today"><a href="/approve?tab=auto&view=list#automatic-today">${icon("shield")} ${pick(L, "Approved automatically today", "تمت الموافقة عليه تلقائياً اليوم")}</a>:
 ${pick(L, `${n(k.dishes_approved)} dish(es), ${n(k.photos_approved)} picture(s) approved, ${n(k.photos_rejected)} picture(s) rejected, ${n(k.menus_stamped)} menu(s) stamped`,
        `${n(k.dishes_approved)} طبق، ${n(k.photos_approved)} صورة مقبولة، ${n(k.photos_rejected)} صورة مرفوضة، ${n(k.menus_stamped)} قائمة مختومة`)}${n(k.undone) ? pick(L, ` (${n(k.undone)} undone)`, ` (${n(k.undone)} تم التراجع عنها)`) : ""}.
 <span class="muted">${pick(L, "Each can be undone in one tap.", "يمكن التراجع عن كل واحد بنقرة.")}</span></p>
${off.map((x) => html`<p class="note">${icon("alert")} ${x === "dish" ? pick(L, "Dishes are not approved by rule now", "الأطباق لا تُقبل بالقاعدة الآن") : pick(L, "Pictures are not decided by rule now", "الصور لا تُقرَّر بالقاعدة الآن")}${o.rules?.[x]?.off_reason ? html`: <bdi>${o.rules[x]!.off_reason}</bdi>` : ""}</p>`)}`;
}
export type AutomationOverview = { rules?: Partial<Record<"dish" | "photo", { enabled: boolean; version: string; off_reason: string | null; off_at: string | null }>>;
  checks?: WeekCheck[]; checks_waiting?: number;
  today?: { day: string; counts?: Partial<Record<"dishes_approved" | "photos_approved" | "photos_rejected" | "menus_stamped" | "undone", number>>;
    decisions?: { id: string; kind: string; action: string; version: string; title: string; reason: string; place: string | null; at: string; undone: boolean; undone_by: string | null }[] } };

async function page(c: Ctx) {
  const L = c.lang;
  const asked = tabOf(c.url.searchParams.get("tab"));
  // An older list page, drawn here (view=list), or the page that owns a kind's list.
  if (asked && c.url.searchParams.get("view") === "list") {
    const r = LIST_ROUTE[asked];
    if (r.go) return redirect(r.go);
    const q = await queues(c);
    const counts = Object.fromEntries(TABS.map((k) => [k, q[k].v.length])) as Record<Tab, number>;
    return drawOlder(c, r.draw!, html`${kindTabs(L, asked, counts, true)}<p class="muted ak-approve-foot"><a href="${href(asked)}">${pick(L, "Back to one card at a time", "عودة إلى بطاقة واحدة في كل مرة")}</a></p>`);
  }
  const q = await queues(c);
  const counts = Object.fromEntries(TABS.map((k) => [k, q[k].v.length])) as Record<Tab, number>;
  const tab: Tab = asked ?? TABS.find((x) => counts[x] > 0) ?? "names";
  const total = counts[tab];
  const n = total === 0 ? 0 : Math.min(total - 1, Math.max(0, Math.floor(Number(c.url.searchParams.get("n"))) || 0));
  const failed = q[tab].error;
  let card: Raw;
  if (failed) card = html`<p class="note">${icon("alert")} ${pick(L, "This list is not available yet: the database is missing a part of it.", "هذه القائمة غير متاحة بعد: قاعدة البيانات ينقصها جزء منها.")}</p>`;
  else if (total === 0) card = noMore(L, tab, pick(L, "Nothing waits here.", "لا شيء ينتظر هنا."));
  else if (tab === "names") card = await namesCard(c, n, { rows: q.names.v });
  else if (tab === "photos") card = await picturesCard(c, n, q.photos.v);
  else if (tab === "labels") card = await labelsCard(c, n, q.labels.v, q.labels.v[n]!.group);
  else if (tab === "dishes") card = await dishCard(c, n, q.dishes.v);
  else if (tab === "places") card = placeCard(c, n, q.places.v);
  else if (tab === "auto") card = await autoCard(c, n, q.auto.v);
  else card = await moneyCard(c, n, q[tab].v, tab);
  const waiting = TABS.reduce((a, k) => a + counts[k], 0);
  return render(c, t(L, "nav_approvals"), html`<div data-approve>
<p><strong>${pick(L, `${waiting} waiting for a person`, `${waiting} بانتظار شخص`)}</strong>.
 <span class="muted">${pick(L, "One card at a time. Nothing is decided by moving between cards, and nothing is decided by a swipe.", "بطاقة واحدة في كل مرة. لا يُقرَّر شيء بالتنقل بين البطاقات، ولا بالسحب.")}
${pick(L, " Keys: a approves, r rejects (it asks for a reason), the arrow or space skips.", " المفاتيح: a للموافقة، r للرفض (يطلب سبباً)، السهم أو المسافة للتخطي.")}</span></p>
${await automaticToday(c)}
${kindTabs(L, tab, counts)}
${total > 0 && !failed ? stepper(L, tab, n, total) : ""}
${card}
</div>`, { translated: true });
}

export const approveSection: Section = {
  // CON1: the one Approvals inbox; the older list pages are drawn here (view=list) and their addresses move here (app.ts, MOVED).
  nav: { href: "/approve", label: "Approvals", roles: LEADS },
  routes: [{ method: "GET", path: "/approve", roles: LEADS, handler: page }],
};
