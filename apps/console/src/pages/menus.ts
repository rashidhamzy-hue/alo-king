// FD1: Menus (docs/DECISIONS.md, "FD1, 18 November 2026"); MENU2: menus from any source ("MENU2, 19 November 2026"). One page per place:
//   Add a menu  one box for every way staff hold a menu: photos (shrunk on the phone to 1600 px, JPEG 0.8, /menus.js; record_menu_photo,
//               0246), and a PDF, a link to a web page, pasted text, a Word file (.docx), an Excel or CSV file (add_menu_source, 0259). Several
//               may be added for one place. Files go to the private media bucket under menus/<place>/src/<day>/<hash>.<ext>. The menu-read
//               workflow fetches links and files, then reads everything waiting in one batch (one cap, USD 2) into dish proposals.
//   Sources     what was added, how its fetch went, its pages (a web page's screenshot, a text's lines: the source record).
//   To check    every dish proposed, by section, beside its source (the photo, the screenshot, the PDF and page, the text line). "Approve all
//               clean dishes in this section" approves the rows with a clear name and price and no flag that the person sees (each recorded
//               per dish, with who approved it; approve_menu_section). A flagged row, or one whose price is to be confirmed, is approved one
//               by one, the price typed. A re-import shows only what changed: new, price changed (the old price beside), removed (approve
//               takes it off sale). Nothing is on sale before a person approves it; prices only from approved dishes.
//   On sale     the approved dishes: the printed price, today's dollars (an LBP price follows the day's rate), their option groups, and their
//               food facts: "declared by the vendor" or "not confirmed yet" (never anything else; invariant 15).
//   Stamp       "menu checked on <date>": refused while a photo, a source or a dish waits. approve_merchant needs it (Places page).
// Functional, on the DS2 components. The console writes nothing itself: every change is a SQL function called as the signed-in person.
import { act, attempt, flashRedirect, html, id, MAX_UPLOAD, render, text, upload, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, dataTable, empty } from "@ak/ui/components";

type Named = { name_ar: string | null; name_en: string | null };
type Size = Named & { price: number | null; currency: string | null };
type Waiting = Named & { id: string; photo_id: string | null; page_id: string | null; menu_source_id: string | null; section_ar: string | null; section_en: string | null;
  translated: "ar" | "en" | null; price: number | string | null; currency: "USD" | "LBP" | null; price_text: string | null; sizes: Size[];
  options: { group_ar: string | null; group_en: string | null; required: boolean; min: number; max: number; choices: (Named & { price_delta: number | null })[] }[];
  addons: Size[]; name_claim: boolean; clean: boolean; description: string | null; price_status: "clear" | "to_confirm"; flags: string[]; flag_note: string | null;
  source_text: string | null; pdf_page: number | null; change: "new" | "price_changed" | "removed" | null; old_price: number | string | null; old_currency: string | null; old_sizes: Size[] | null };
type Dish = Named & { product_id: string; section: string | null; price_usd: number | string; is_available: boolean; printed_price: number | string | null; printed_currency: string | null; groups: number; declared: number };
type Photo = { photo_id: string; media_path: string; uploaded_at: string; read_status: "waiting" | "read"; read_at: string | null; failures: number; last_failure: string | null; dishes: number };
type Source = { menu_source_id: string; kind: "pdf" | "link" | "text" | "docx" | "sheet"; url: string | null; file_name: string | null; media_path: string | null; full_menu: boolean;
  status: "waiting" | "fetched" | "failed" | "done"; added_at: string; failures: number; last_failure: string | null; pages: number; pages_waiting: number; dishes: number };
type Page = { page_id: string; menu_source_id: string; position: number; url: string | null; title: string | null; shot_path: string | null; doc_path: string | null;
  status: "waiting" | "read" | "skipped"; skip_reason: string | null; failures: number; chars: number; dishes: number };
type Menu = { place: { source_id: string; name: string; visibility: string; approved: boolean; menu_checked_on: string | null; menu_checked_by: string | null; has_dishes: boolean } | null;
  fx: number | string | null; photos: Photo[]; sources: Source[]; pages: Page[]; waiting: Waiting[]; dishes: Dish[]; unchanged: number; rejected: number };
type Place = { source_id: string; name: string; photos_waiting: number; dishes_waiting: number; dishes: number; menu_checked_on: string | null };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// MENU2: the files the "Add a menu" box takes besides photos, by type or (phones often send no type) by name
const FILE_KINDS: { kind: "pdf" | "docx" | "sheet"; ext: string; types: string[]; re: RegExp }[] = [
  { kind: "pdf", ext: "pdf", types: ["application/pdf"], re: /\.pdf$/i },
  { kind: "docx", ext: "docx", types: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], re: /\.docx$/i },
  { kind: "sheet", ext: "xlsx", types: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], re: /\.xlsx$/i },
  { kind: "sheet", ext: "csv", types: ["text/csv", "application/csv"], re: /\.csv$/i },
];
const fileKindOf = (f: File) => FILE_KINDS.find((k) => k.types.includes(f.type) || k.re.test(f.name ?? ""));
const nameOf = (n: Named, L: Lang) => (L === "ar" ? n.name_ar ?? n.name_en : n.name_en ?? n.name_ar) ?? "";
const money = (v: number | string | null, cur: string | null) => (v === null || v === undefined ? "" : cur === "LBP" ? `${Number(v).toLocaleString("en-US")} LBP` : `$${Number(v).toFixed(2)}`);
const both = (n: Named) => html`${n.name_en ?? ""}${n.name_ar ? html` <bdi>${n.name_ar}</bdi>` : ""}`;
const sectionKey = (d: { section_en: string | null; section_ar: string | null }) => d.section_en ?? d.section_ar ?? "";

function flagWords(L: Lang, f: string) {
  const w: Record<string, [string, string]> = {
    cut_off: ["Cut off in the source", "مقطوع في المصدر"], unclear_name: ["Name unclear", "الاسم غير واضح"], unclear_price: ["Price unclear", "السعر غير واضح"],
    price_range: ["A price range, not one price", "نطاق أسعار وليس سعراً واحداً"], unclear_section: ["Section unclear", "القسم غير واضح"], other: ["Something unclear", "أمر غير واضح"],
    name_claim: ["The name praises or makes a health claim: change it", "الاسم يمدح أو يدّعي فائدة صحية: غيّره"],
    description_claim: ["The description praises or makes a health claim: change it", "الوصف يمدح أو يدّعي فائدة صحية: غيّره"],
  };
  const x = w[f] ?? [f, f];
  return pick(L, x[0], x[1]);
}

/** The source of a dish, as a link the person opens beside it. */
function sourceOf(L: Lang, d: Waiting, links: { photo: Map<string, string>; shot: Map<string, string>; doc: Map<string, string>; page: Map<string, Page> }) {
  if (d.photo_id) { const u = links.photo.get(d.photo_id); return u ? html`<a href="${u}" target="_blank" rel="noopener">${pick(L, "the photo", "الصورة")}</a>` : ""; }
  if (!d.page_id) return "";
  const p = links.page.get(d.page_id);
  const parts = [];
  if (p?.shot_path && links.shot.get(d.page_id)) parts.push(html`<a href="${links.shot.get(d.page_id)}" target="_blank" rel="noopener">${pick(L, "the screenshot", "لقطة الشاشة")}</a>`);
  if (p?.doc_path && links.doc.get(d.page_id)) parts.push(html`<a href="${links.doc.get(d.page_id)}" target="_blank" rel="noopener">${pick(L, "the PDF", "ملف PDF")}${d.pdf_page ? html`, ${pick(L, "page", "صفحة")} ${d.pdf_page}` : ""}</a>`);
  if (p && p.chars > 0) parts.push(html`<a href="/menus/page/${d.page_id}" target="_blank" rel="noopener">${pick(L, "the text", "النص")}</a>`);
  if (p?.url) parts.push(html`<a href="${p.url}" target="_blank" rel="noopener noreferrer">${pick(L, "the web page", "صفحة الويب")}</a>`);
  return html`${parts.map((x, i) => html`${i ? " · " : ""}${x}`)}`;
}

function changeBadge(L: Lang, d: Waiting) {
  if (d.change === "new") return badge(pick(L, "New", "جديد"), "neutral");
  if (d.change === "removed") return badge(pick(L, "No longer in the menu", "لم يعد في القائمة"), "warn");
  if (d.change === "price_changed") {
    const was = d.old_price !== null && d.old_price !== undefined ? money(d.old_price, d.old_currency) : (d.old_sizes ?? []).map((s) => money(s.price, s.currency ?? d.old_currency)).join(" / ");
    const before = was === "" ? "?" : was;
    return badge(pick(L, `Price changed (was ${before})`, `تغيّر السعر (كان ${before})`), "warn");
  }
  return "";
}

function waitingCard(c: Ctx, d: Waiting, src: string, source: unknown) {
  const L = c.lang;
  const extras = [
    d.sizes.length ? html`<li>${pick(L, "Sizes", "الأحجام")}: ${d.sizes.map((s, i) => html`${i ? " · " : ""}${both(s)} ${s.price === null ? badge(pick(L, "price to confirm", "السعر للتأكيد"), "warn") : money(s.price, s.currency ?? d.currency)}`)}</li>` : "",
    ...d.options.map((o) => html`<li>${both({ name_en: o.group_en, name_ar: o.group_ar })} (${o.required ? pick(L, "required", "إلزامي") : pick(L, "optional", "اختياري")}, ${o.min} to ${o.max}): ${o.choices.map((x, i) => html`${i ? " · " : ""}${both(x)}${x.price_delta ? ` +${money(x.price_delta, d.currency)}` : ""}`)}</li>`),
    d.addons.length ? html`<li>${pick(L, "Add-ons", "إضافات")}: ${d.addons.map((a, i) => html`${i ? " · " : ""}${both(a)} ${money(a.price, a.currency ?? d.currency)}`)}</li>` : ""];
  const flags = [...d.flags.map((f) => badge(flagWords(L, f), "warn")),
    d.price_status === "to_confirm" ? badge(pick(L, "Price to confirm: type it from the source", "السعر للتأكيد: اكتبه من المصدر"), "warn") : "",
    d.name_claim && !d.flags.includes("name_claim") ? badge(flagWords(L, "name_claim"), "warn") : ""];
  const head = html`<p><strong>${both(d)}</strong> ${changeBadge(L, d)}${d.translated ? html` ${badge(pick(L, d.translated === "ar" ? "Arabic name not printed: written by the reader" : "English name not printed: written by the reader", d.translated === "ar" ? "الاسم العربي غير مطبوع: كتبه القارئ" : "الاسم الإنكليزي غير مطبوع: كتبه القارئ"), "warn")}` : ""}
${flags.map((x) => html` ${x}`)}<br>
<small class="muted">${both({ name_en: d.section_en, name_ar: d.section_ar })} · ${pick(L, "printed", "مطبوع")}: <bdi>${d.price_text || pick(L, "no price", "بلا سعر")}</bdi>${source ? html` · ${source}` : ""}</small>
${d.flag_note ? html`<br><small>${pick(L, "Reader's note", "ملاحظة القارئ")}: ${d.flag_note}</small>` : ""}
${d.source_text ? html`<br><small class="muted">${pick(L, "Source line", "سطر المصدر")}: <bdi>${d.source_text}</bdi></small>` : ""}
${d.description ? html`<br><small>${pick(L, "Description as printed", "الوصف كما هو مطبوع")}: <bdi>${d.description}</bdi></small>` : ""}</p>`;
  if (d.change === "removed") {
    return html`<section class="ak-card">${head}<p class="muted">${pick(L, "This dish is on sale but the new menu no longer shows it.", "هذا الطبق معروض لكن القائمة الجديدة لم تعد تذكره.")}</p>
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="approve"><button class="ak-btn ak-btn--primary">${pick(L, "Take it off sale", "أوقف عرضه")}</button>`)}
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="reject">
<label class="ak-field"><span>${pick(L, "Why keep it on sale", "لماذا يبقى معروضاً")}</span><input class="ak-input" name="note" maxlength="500" required></label> <button class="ak-btn ak-btn--soft">${pick(L, "Keep it on sale", "أبقه معروضاً")}</button>`)}</section>`;
  }
  return html`<section class="ak-card">${head}
${extras.some((x) => x !== "") ? html`<ul>${extras}</ul>` : ""}
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="approve">
<label class="ak-field"><span>${pick(L, "Name in Arabic", "الاسم بالعربية")}</span><input class="ak-input" name="name_ar" value="${d.name_ar ?? ""}" maxlength="120" dir="rtl"></label>
<label class="ak-field"><span>${pick(L, "Name in English", "الاسم بالإنكليزية")}</span><input class="ak-input" name="name_en" value="${d.name_en ?? ""}" maxlength="120"></label>
<label class="ak-field"><span>${pick(L, "Section", "القسم")}</span><input class="ak-input" name="section_en" value="${d.section_en ?? d.section_ar ?? ""}" maxlength="120"></label>
${d.description !== null ? html`<label class="ak-field"><span>${pick(L, "Description as printed", "الوصف كما هو مطبوع")}</span><input class="ak-input" name="description" value="${d.description ?? ""}" maxlength="500"></label>` : ""}
${d.sizes.length ? d.sizes.map((s, i) => html`<label class="ak-field"><span>${pick(L, "Price as printed", "السعر كما هو مطبوع")}: ${both(s)}</span><input class="ak-input" name="size_price_${i}" value="${s.price ?? ""}" inputmode="decimal" maxlength="14"${d.price_status === "to_confirm" ? html` required` : ""}></label>`)
  : html`<label class="ak-field"><span>${pick(L, "Price as printed", "السعر كما هو مطبوع")}</span><input class="ak-input" name="price" value="${d.price ?? ""}" inputmode="decimal" maxlength="14"${d.price_status === "to_confirm" ? html` required` : ""}></label>`}
${d.sizes.length ? html`<input type="hidden" name="sizes" value="${d.sizes.length}">` : ""}
${d.price_status === "to_confirm" ? html`<input type="hidden" name="typed" value="1">` : ""}
<label class="ak-field"><span>${pick(L, "Currency", "العملة")}</span><select class="ak-input" name="currency"><option value="">${pick(L, "as read", "كما قُرئت")}</option>
${(["USD", "LBP"] as const).map((k) => html`<option value="${k}"${d.currency === k ? html` selected` : ""}>${k}</option>`)}</select></label>
<button class="ak-btn ak-btn--primary">${pick(L, "Approve this dish", "وافق على هذا الطبق")}</button>`)}
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="reject">
<label class="ak-field"><span>${pick(L, "Reason to reject", "سبب الرفض")}</span><input class="ak-input" name="note" maxlength="500" required></label> <button class="ak-btn ak-btn--soft">${pick(L, "Reject", "ارفض")}</button>`)}</section>`;
}

/** A clean row: one line, its source beside it; approved with its section (or opened to edit). */
function cleanRow(L: Lang, d: Waiting, source: unknown) {
  const price = d.sizes.length ? d.sizes.map((s) => html`${both(s)} ${money(s.price, s.currency ?? d.currency)}`).map((x, i) => html`${i ? " · " : ""}${x}`) : money(d.price, d.currency);
  return html`<li><strong>${both(d)}</strong> ${changeBadge(L, d)} · <bdi>${price}</bdi>${d.price_text ? html` <small class="muted">(${pick(L, "printed", "مطبوع")} <bdi>${d.price_text}</bdi>)</small>` : ""}
${source ? html` · <small>${source}</small>` : ""}${d.source_text ? html`<br><small class="muted"><bdi>${d.source_text}</bdi></small>` : ""}${d.description ? html`<br><small><bdi>${d.description}</bdi></small>` : ""}</li>`;
}

async function index(c: Ctx) {
  const L = c.lang;
  const places = (await c.deps.db.rpc<Place[]>("places_console", {})) ?? [];
  return render(c, pick(L, "Menus", "القوائم"), html`<h1>${pick(L, "Menus", "القوائم")}</h1>
<p class="muted">${pick(L, "Add a place's menu (photos, a PDF, a link, text, a Word or Excel file), run the reading, check every dish, then stamp the menu as checked.", "أضف قائمة المكان (صور، PDF، رابط، نص، ملف Word أو Excel)، شغّل القراءة، راجع كل طبق، ثم اختم القائمة كمفحوصة.")}</p>
${dataTable({ caption: pick(L, "Menus", "القوائم"), columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Waiting to be read", "بانتظار القراءة"), num: true },
    { label: pick(L, "Dishes to check", "أطباق للمراجعة"), num: true }, { label: pick(L, "On sale", "معروض"), num: true }, { label: pick(L, "Menu checked", "فُحصت القائمة") }],
  rows: places.map((p) => ({ cells: [html`<a href="/menus/${p.source_id}"><strong>${p.name}</strong></a>`, p.photos_waiting, p.dishes_waiting, p.dishes, p.menu_checked_on ? when(p.menu_checked_on) : pick(L, "not yet", "ليس بعد")] })),
  empty: empty({ title: pick(L, "No place yet.", "لا مكان بعد."), text: pick(L, "Make one on the Places page first.", "اصنع واحداً في صفحة الأماكن أولاً."), icon: "food", action: html`<a class="ak-btn" href="/places?tab=new">${pick(L, "New place", "مكان جديد")}</a>` }) })}`, { translated: true });
}

function kindWord(L: Lang, k: Source["kind"]) {
  const w: Record<Source["kind"], [string, string]> = { pdf: ["PDF", "PDF"], link: ["Web page", "صفحة ويب"], text: ["Pasted text", "نص ملصوق"], docx: ["Word file", "ملف Word"], sheet: ["Excel or CSV file", "ملف Excel أو CSV"] };
  return pick(L, w[k][0], w[k][1]);
}
function sourceState(L: Lang, s: Source) {
  if (s.status === "failed") return badge(pick(L, `Could not be fetched: ${s.last_failure ?? ""}`, `تعذّر جلبه: ${s.last_failure ?? ""}`), "warn");
  if (s.status === "waiting") return s.failures ? badge(pick(L, `Fetch failed ${s.failures}×: tried again by the next run`, `فشل الجلب ${s.failures} مرة: يُعاد في القراءة التالية`), "warn") : badge(pick(L, "Waits for the reading run", "بانتظار القراءة"), "neutral");
  if (s.pages_waiting) return badge(pick(L, `${s.pages_waiting} page(s) wait for the reading run`, `${s.pages_waiting} صفحة بانتظار القراءة`), "neutral");
  return badge(pick(L, "Read", "قُرئ"), "ok");
}

async function page(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const m = await c.deps.db.rpc<Menu>("menu_console", { p_source: src });
  if (!m?.place) return render(c, pick(L, "Menus", "القوائم"), html`<p class="flash err">${pick(L, "That place was not found.", "لم يُعثر على هذا المكان.")}</p>`, { translated: true });
  const sign = async (path: string | null) => (path ? await c.deps.media.sign(path, 600) : null);
  const photoLinks = new Map(await Promise.all(m.photos.map(async (p) => [p.photo_id, (await sign(p.media_path)) ?? ""] as const)));
  const pages = new Map(m.pages.map((p) => [p.page_id, p]));
  const shotLinks = new Map(await Promise.all(m.pages.filter((p) => p.shot_path).map(async (p) => [p.page_id, (await sign(p.shot_path)) ?? ""] as const)));
  const docLinks = new Map(await Promise.all(m.pages.filter((p) => p.doc_path).map(async (p) => [p.page_id, (await sign(p.doc_path)) ?? ""] as const)));
  const links = { photo: photoLinks, shot: shotLinks, doc: docLinks, page: pages };
  const waitingPhotos = m.photos.filter((p) => p.read_status === "waiting").length;
  const waitingSources = m.sources.filter((s) => s.status === "waiting").length + m.pages.filter((p) => p.status === "waiting").length;

  // ---------- Add a menu ----------
  const addBox = html`<section class="ak-card"><h2>${pick(L, "Add a menu", "أضف قائمة")}</h2>
<p class="muted">${pick(L, "Use whatever you have; several may be added for one place. Every dish still waits for a person here.", "استعمل ما لديك؛ يمكن إضافة أكثر من مصدر للمكان نفسه. كل طبق ينتظر موافقة شخص هنا.")}</p>
<form method="post" action="/menus/${src}/photo" enctype="multipart/form-data" data-menu-upload
 data-msg-working="${pick(L, "Shrinking and sending photo {i} of {n}…", "جارٍ تصغير الصورة {i} من {n} وإرسالها…")}" data-msg-failed="${pick(L, "{n} photo(s) were not saved: choose them again.", "لم تُحفظ {n} صورة: اخترها من جديد.")}">
<input type="hidden" name="_csrf" value="${c.f.csrf}"><input type="hidden" name="_key" value="${c.f.nonce()}">
<label class="ak-btn ak-btn--primary"><input type="file" name="photo" accept="image/*" capture="environment" multiple> ${pick(L, "Photograph a menu page", "صوّر صفحة من القائمة")}</label>
<button class="ak-btn" data-nojs>${pick(L, "Save the photo", "احفظ الصورة")}</button> <span data-status class="muted" aria-live="polite"></span>
<small class="muted">${pick(L, "One page per photo, flat and sharp, the whole page in the frame.", "صفحة واحدة في كل صورة، مسطحة وواضحة، والصفحة كلها داخل الإطار.")}</small></form>
${form(c.f, `/menus/${src}/add`, html`
<label class="ak-field"><span>${pick(L, "A file: PDF, Word (.docx), Excel (.xlsx) or CSV (a photo works too)", "ملف: PDF أو Word (.docx) أو Excel (.xlsx) أو CSV (والصورة أيضاً)")}</span>
<input class="ak-input" type="file" name="file" accept=".pdf,.docx,.xlsx,.csv,application/pdf,image/*"></label>
<label class="ak-field"><span>${pick(L, "A link to the menu's web page", "رابط صفحة القائمة على الويب")}</span><input class="ak-input" type="url" name="link" placeholder="https://" maxlength="500" dir="ltr"></label>
<label class="ak-field"><span>${pick(L, "Or paste the menu's text", "أو الصق نص القائمة")}</span><textarea class="ak-input" name="text" rows="5" maxlength="60000"></textarea></label>
<label><input type="checkbox" name="full_menu" value="1" checked> ${pick(L, "This is the whole menu (a later import then shows what is gone)", "هذه القائمة كاملة (فيُظهر الاستيراد اللاحق ما حُذف)")}</label>
<p><button class="ak-btn ak-btn--primary">${pick(L, "Add", "أضف")}</button></p>`, { files: true })}
<p class="muted">${pick(L, "Then: GitHub, Actions, menu-read, Run workflow, branch main. Links and files are fetched, then everything waiting is read.", "ثم: GitHub، Actions، menu-read، Run workflow، الفرع main. تُجلب الروابط والملفات ثم يُقرأ كل ما ينتظر.")}</p></section>`;

  // ---------- Sources ----------
  const photos = m.photos.length ? dataTable({ caption: pick(L, "Photos", "الصور"), columns: [{ label: pick(L, "Photo", "الصورة") }, { label: pick(L, "Taken", "التُقطت") }, { label: pick(L, "Reading", "القراءة") }, { label: pick(L, "Dishes", "الأطباق"), num: true }],
    rows: m.photos.map((p, i) => ({ cells: [photoLinks.get(p.photo_id) ? html`<a href="${photoLinks.get(p.photo_id)}" target="_blank" rel="noopener">${pick(L, "Photo", "صورة")} ${i + 1}</a>` : `${i + 1}`, when(p.uploaded_at),
      p.read_status === "read" ? badge(pick(L, "Read", "قُرئت"), "ok") : p.failures ? badge(pick(L, `Failed ${p.failures}×: waits for the next run`, `فشلت ${p.failures} مرة: تنتظر القراءة التالية`), "warn") : badge(pick(L, "Waits for the reading run", "بانتظار القراءة"), "neutral"), p.dishes] })) }) : "";
  const sources = m.sources.length ? dataTable({ caption: pick(L, "Other sources", "مصادر أخرى"), columns: [{ label: pick(L, "Source", "المصدر") }, { label: pick(L, "Added", "أضيف") }, { label: pick(L, "State", "الحالة") },
      { label: pick(L, "Pages", "الصفحات"), num: true }, { label: pick(L, "Dishes", "الأطباق"), num: true }],
    rows: m.sources.map((s) => ({ cells: [html`${kindWord(L, s.kind)}${s.full_menu ? html` ${badge(pick(L, "whole menu", "قائمة كاملة"), "neutral")}` : ""}<br><small class="muted"><bdi>${s.url ?? s.file_name ?? ""}</bdi></small>`,
      when(s.added_at), sourceState(L, s), s.pages, s.dishes] })) }) : "";
  const pageList = m.pages.filter((p) => p.status === "skipped").length
    ? html`<details><summary>${pick(L, "Pages kept but not read", "صفحات محفوظة لم تُقرأ")} (${m.pages.filter((p) => p.status === "skipped").length})</summary><ul>
${m.pages.filter((p) => p.status === "skipped").map((p) => html`<li>${p.title ?? p.url ?? ""}: ${p.skip_reason ?? ""}${shotLinks.get(p.page_id) ? html` · <a href="${shotLinks.get(p.page_id)}" target="_blank" rel="noopener">${pick(L, "the screenshot", "لقطة الشاشة")}</a>` : ""}${p.chars ? html` · <a href="/menus/page/${p.page_id}" target="_blank" rel="noopener">${pick(L, "the text", "النص")}</a>` : ""}</li>`)}</ul></details>` : "";

  // ---------- To check, by section ----------
  const order: string[] = []; const bySection = new Map<string, Waiting[]>();
  for (const d of m.waiting) { const k = sectionKey(d); if (!bySection.has(k)) { bySection.set(k, []); order.push(k); } bySection.get(k)!.push(d); }
  const sections = order.map((k) => {
    const rows = bySection.get(k)!; const clean = rows.filter((d) => d.clean); const rest = rows.filter((d) => !d.clean);
    const title = rows[0] ? both({ name_en: rows[0].section_en, name_ar: rows[0].section_ar }) : "";
    return html`<section class="ak-card"><h3>${k ? title : pick(L, "No section", "بلا قسم")} <small class="muted">(${rows.length})</small></h3>
${clean.length ? html`<ul>${clean.map((d) => cleanRow(L, d, sourceOf(L, d, links)))}</ul>
${form(c.f, `/menus/${src}/section`, html`<input type="hidden" name="ids" value="${clean.map((d) => d.id).join(",")}"><button class="ak-btn ak-btn--primary">${pick(L, `Approve all ${clean.length} clean dish(es) in this section`, `وافق على كل الأطباق السليمة في هذا القسم (${clean.length})`)}</button>
<small class="muted">${pick(L, "Clear name and price, no flag. Each is recorded under your name.", "اسم وسعر واضحان، بلا ملاحظة. يُسجَّل كل طبق باسمك.")}</small>`)}` : ""}
${rest.length ? html`<p class="muted">${pick(L, `${rest.length} to approve one by one:`, `${rest.length} للموافقة واحداً واحداً:`)}</p>${rest.map((d) => waitingCard(c, d, src, sourceOf(L, d, links)))}` : ""}</section>`;
  });

  const dishes = dataTable({ caption: pick(L, "On sale", "معروض"), columns: [{ label: pick(L, "Dish", "الطبق") }, { label: pick(L, "Section", "القسم") }, { label: pick(L, "Printed", "مطبوع") },
      { label: pick(L, "Today", "اليوم"), num: true }, { label: pick(L, "Choices", "الخيارات"), num: true }, { label: pick(L, "Food facts", "المعلومات الغذائية") }],
    rows: m.dishes.map((d) => ({ cells: [html`<strong>${nameOf(d, L)}</strong>${L === "ar" ? "" : d.name_ar ? html`<br><bdi class="muted">${d.name_ar}</bdi>` : ""}`, d.section ?? "", money(d.printed_price, d.printed_currency),
      `$${Number(d.price_usd).toFixed(2)}`, d.groups,
      d.declared ? pick(L, `${d.declared} declared by the vendor; the rest not confirmed yet`, `${d.declared} صرّح بها البائع؛ والباقي غير مؤكد بعد`) : pick(L, "Not confirmed yet", "غير مؤكدة بعد")] })),
    empty: empty({ title: pick(L, "No dish approved yet.", "لا طبق موافق عليه بعد."), icon: "food" }) });
  const stamp = m.place.menu_checked_on
    ? html`<p>${badge(pick(L, `Menu checked on ${m.place.menu_checked_on}`, `فُحصت القائمة في ${m.place.menu_checked_on}`), "ok")}${m.place.menu_checked_by ? html` · ${m.place.menu_checked_by}` : ""}</p>` : "";
  const canStamp = !waitingPhotos && !waitingSources && !m.waiting.length && m.dishes.length > 0;
  return render(c, `${pick(L, "Menu", "القائمة")}: ${m.place.name}`, html`<p><a href="/menus">${pick(L, "All menus", "كل القوائم")}</a> · <a href="/places/${src}">${pick(L, "The place", "المكان")}</a></p>
<h1>${pick(L, "Menu", "القائمة")}: ${m.place.name}</h1>
${stamp}
${addBox}
<h2>${pick(L, "Sources", "المصادر")}</h2>${photos}${sources}${pageList}
${!m.photos.length && !m.sources.length ? empty({ title: pick(L, "No menu added yet.", "لم تُضف قائمة بعد."), icon: "camera" }) : ""}
${waitingPhotos + waitingSources ? html`<p class="muted">${pick(L, `${waitingPhotos + waitingSources} item(s) wait for the reading run: GitHub, Actions, menu-read, Run workflow, branch main.`, `${waitingPhotos + waitingSources} عنصر بانتظار القراءة: GitHub، Actions، menu-read، Run workflow، الفرع main.`)}</p>` : ""}
<h2>${pick(L, "Dishes to check", "أطباق للمراجعة")} (${m.waiting.length})</h2>
${m.fx ? html`<p class="muted">${pick(L, `Today's rate: ${Number(m.fx).toLocaleString("en-US")} LBP to the dollar. A lira price follows the day's rate.`, `سعر اليوم: ${Number(m.fx).toLocaleString("en-US")} ليرة للدولار. السعر بالليرة يتبع سعر اليوم.`)}</p>` : html`<p class="flash err">${pick(L, "No lira rate is recorded: a lira price cannot be approved until one is.", "لا يوجد سعر صرف مسجّل: لا يمكن الموافقة على سعر بالليرة قبل تسجيله.")}</p>`}
${m.place.has_dishes && m.waiting.length ? html`<p class="muted">${pick(L, "This place already has dishes on sale: only what changed is listed (new, price changed, no longer in the menu).", "لهذا المكان أطباق معروضة: تظهر هنا التغييرات فقط (جديد، تغيّر السعر، لم يعد في القائمة).")}</p>` : ""}
${m.waiting.length ? sections : empty({ title: pick(L, "Nothing to check.", "لا شيء للمراجعة."), icon: "check", ok: true })}
${m.unchanged ? html`<p class="muted">${pick(L, `${m.unchanged} dish(es) read again unchanged: nothing to do.`, `${m.unchanged} طبق قُرئ من جديد دون تغيير: لا شيء لفعله.`)}</p>` : ""}
${m.rejected ? html`<p class="muted">${pick(L, `${m.rejected} dish(es) rejected.`, `${m.rejected} طبق مرفوض.`)}</p>` : ""}
<h2>${pick(L, "On sale once the place is approved", "يُعرض بعد الموافقة على المكان")} (${m.dishes.length})</h2>${dishes}
<h2>${pick(L, "Menu checked", "فُحصت القائمة")}</h2>
${canStamp ? form(c.f, `/menus/${src}/checked`, html`<p class="muted">${pick(L, "Stamp it once every dish here matches the menu as printed today.", "اختمها حين يطابق كل طبق هنا القائمة المطبوعة اليوم.")}</p><button class="ak-btn ak-btn--primary">${pick(L, "Stamp: menu checked today", "اختم: فُحصت القائمة اليوم")}</button>`)
  : html`<p class="muted">${pick(L, "The stamp waits until every photo and source is read and every dish is decided.", "الختم ينتظر قراءة كل صورة ومصدر والبت في كل طبق.")}</p>`}
<script src="/menus.js" defer></script>`, { translated: true });
}

async function photo(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const json = (c.req.headers.get("accept") ?? "").includes("application/json");
  const back = `/menus/${src}`;
  const refuse = (en: string, ar: string) => { const m = pick(L, en, ar); if (json) return Response.json({ ok: false, error: m }, { status: 422 }); throw new UserError(m); };
  const file = c.files.photo;
  if (!file) return refuse("Choose a photo first.", "اختر صورة أولاً.");
  if (!IMAGE_TYPES.has(file.type)) return refuse("Attach a photo (JPEG, PNG or WebP).", "أرفق صورة (JPEG أو PNG أو WebP).");
  const r = await attempt(c, "menu_photo", { source: src }, async () => {
    const path = await upload(c, "photo", `menus/${src}`);
    const saved = await c.deps.db.rpc<{ already: boolean }>("record_menu_photo", { p_source: src, p_media_path: path, p_by: c.staff.partyId });
    return saved.already ? pick(L, "Saved already.", "محفوظة من قبل.") : pick(L, "Saved. It waits for the reading run.", "حُفظت. تنتظر القراءة.");
  });
  const msg = r.logged ? r.msg : { err: pick(L, "Not done: the action log could not be written. Try again.", "لم يتم: تعذّر تسجيل الإجراء. حاول من جديد.") };
  if (json) return Response.json({ ok: r.logged && r.ok, message: msg.ok ?? msg.err }, { status: r.logged && r.ok ? 200 : 502 });
  return flashRedirect(c.deps, back, msg);
}

/** MENU2: the "Add a menu" box. Files (a photo too), a link, pasted text, in one press; each becomes its own source. */
async function add(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const files = Object.entries(c.files).filter(([k]) => k === "file" || k.startsWith("file")).map(([, f]) => f);
  const link = text(c, "link", 500); const body = (c.form.text ?? "").trim().slice(0, 60000); const full = c.form.full_menu === "1";
  if (!files.length && !link && !body) throw new UserError(pick(L, "Choose a file, type a link or paste the text first.", "اختر ملفاً أو اكتب رابطاً أو الصق النص أولاً."));
  for (const f of files) {
    if (!IMAGE_TYPES.has(f.type) && !fileKindOf(f)) throw new UserError(pick(L, "A menu file is a photo, a PDF, a Word file (.docx), an Excel file (.xlsx) or a CSV file.", "ملف القائمة صورة أو PDF أو ملف Word (.docx) أو Excel (.xlsx) أو CSV."));
    if (f.size > MAX_UPLOAD) throw new UserError(pick(L, "The file is larger than 8 MB.", "الملف أكبر من 8 ميغابايت."));
  }
  return act(c, "menu_source_add", { source: src, files: files.length, link: Boolean(link), text: Boolean(body) }, async () => {
    let n = 0; let again = 0;
    for (const f of files) {
      if (IMAGE_TYPES.has(f.type)) {
        c.files.photo = f;
        const path = await upload(c, "photo", `menus/${src}`);
        const r = await c.deps.db.rpc<{ already: boolean }>("record_menu_photo", { p_source: src, p_media_path: path, p_by: c.staff.partyId });
        if (r.already) again++; else n++;
        continue;
      }
      const k = fileKindOf(f)!;
      const bytes = await f.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const path = `menus/${src}/src/${c.deps.now().toISOString().slice(0, 10)}/${hash.slice(0, 40)}.${k.ext}`;
      const type = k.types[0]!;
      try { await c.deps.media.put(path, bytes, type); } catch (e) { if (!(await c.deps.media.sign(path, 30))) throw e; }
      const r = await c.deps.db.rpc<{ already: boolean }>("add_menu_source", { p_place: src, p_kind: k.kind, p_by: c.staff.partyId,
        p_detail: { media_path: path, file_name: (f.name ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120), full_menu: full } });
      if (r.already) again++; else n++;
    }
    if (link) { const r = await c.deps.db.rpc<{ already: boolean }>("add_menu_source", { p_place: src, p_kind: "link", p_by: c.staff.partyId, p_detail: { url: link, full_menu: full } }); if (r.already) again++; else n++; }
    if (body) { const r = await c.deps.db.rpc<{ already: boolean }>("add_menu_source", { p_place: src, p_kind: "text", p_by: c.staff.partyId, p_detail: { body, full_menu: full } }); if (r.already) again++; else n++; }
    const words = pick(L, `Added ${n}. It waits for the reading run.`, `أضيف ${n}. ينتظر القراءة.`);
    return again ? `${words} ${pick(L, `${again} was already added.`, `${again} مضاف من قبل.`)}` : words;
  }, `/menus/${src}`);
}

async function dish(c: Ctx) {
  const L = c.lang; const d = id(c, "dish"); const src = id(c, "source");
  const approve = c.form.decision === "approve";
  if (!["approve", "reject"].includes(c.form.decision ?? "")) throw new UserError(pick(L, "Choose approve or reject.", "اختر موافقة أو رفض."));
  const note = text(c, "note", 500);
  if (!approve && note.length < 3) throw new UserError(pick(L, "Write the reason (at least 3 characters).", "اكتب السبب (٣ أحرف على الأقل)."));
  const edit: Record<string, unknown> = {};
  const num = (raw: string) => { const n = Number(raw.replace(/,/g, "")); if (!Number.isFinite(n) || n <= 0) throw new UserError(pick(L, "The price is not a number above zero.", "السعر ليس رقماً أكبر من صفر.")); return n; };
  if (approve) {
    for (const k of ["name_ar", "name_en", "section_en"]) if (k in c.form) edit[k] = text(c, k, 120);
    if ("description" in c.form) edit.description = text(c, "description", 500);
    const raw = text(c, "price", 14);
    if (raw) edit.price = num(raw);
    const sizes = Number(c.form.sizes ?? 0);
    if (sizes > 0 && sizes <= 20) {
      const typed = Array.from({ length: sizes }, (_, i) => text(c, `size_price_${i}`, 14));
      if (typed.some((t) => t)) {
        if (typed.some((t) => !t)) throw new UserError(pick(L, "Type one price for each size.", "اكتب سعراً لكل حجم."));
        edit.size_prices = typed.map(num);
      }
    }
    const cur = (c.form.currency ?? "").trim();
    if (cur === "USD" || cur === "LBP") edit.currency = cur;
  }
  return act(c, approve ? "menu_dish_approve" : "menu_dish_reject", { dish: d }, async () => {
    const r = await c.deps.db.rpc<{ price_usd?: number; off_sale?: boolean }>("review_menu_dish", { p_dish: d, p_by: c.staff.partyId, p_approve: approve, p_edit: edit, p_note: approve ? null : note });
    if (r.off_sale) return pick(L, "Taken off sale.", "أوقف عرضه.");
    return approve ? pick(L, `Approved at $${Number(r.price_usd ?? 0).toFixed(2)} today.`, `تمت الموافقة بسعر $${Number(r.price_usd ?? 0).toFixed(2)} اليوم.`) : pick(L, "Rejected.", "رُفض.");
  }, `/menus/${src}`);
}

/** MENU2: "Approve all clean dishes in this section": the ids the person saw; the database approves only the clean ones, each on its own. */
async function section(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const ids = (c.form.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200);
  if (!ids.length) throw new UserError(pick(L, "No dish to approve in that section.", "لا طبق للموافقة في هذا القسم."));
  return act(c, "menu_section_approve", { source: src, dishes: ids.length }, async () => {
    const r = await c.deps.db.rpc<{ approved: number; left: number }>("approve_menu_section", { p_place: src, p_ids: ids, p_by: c.staff.partyId });
    return r.left ? pick(L, `Approved ${r.approved}. ${r.left} changed since the page was shown: check them one by one.`, `تمت الموافقة على ${r.approved}. ${r.left} تغيّر منذ عرض الصفحة: راجعها واحداً واحداً.`)
      : pick(L, `Approved ${r.approved}.`, `تمت الموافقة على ${r.approved}.`);
  }, `/menus/${src}`);
}

/** MENU2: the text of one source page (a web page's text, pasted text, a file's text): the source record beside the dishes. */
async function pageText(c: Ctx) {
  const L = c.lang; const pid = id(c, "page");
  const p = await c.deps.db.rpc<{ page_id: string; source_id: string; title: string | null; url: string | null; body: string | null } | null>("menu_page_text", { p_page: pid });
  if (!p) return render(c, pick(L, "Menus", "القوائم"), html`<p class="flash err">${pick(L, "That page was not found.", "لم يُعثر على هذه الصفحة.")}</p>`, { translated: true });
  return render(c, p.title ?? pick(L, "Source text", "نص المصدر"), html`<p><a href="/menus/${p.source_id}">${pick(L, "Back to the menu", "العودة إلى القائمة")}</a></p>
<h1><bdi>${p.title ?? pick(L, "Source text", "نص المصدر")}</bdi></h1>${p.url ? html`<p><a href="${p.url}" target="_blank" rel="noopener noreferrer"><bdi>${p.url}</bdi></a></p>` : ""}
<pre dir="auto" style="white-space:pre-wrap">${p.body ?? ""}</pre>`, { translated: true });
}

async function checked(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  return act(c, "menu_checked", { source: src }, async () => {
    const r = await c.deps.db.rpc<{ menu_checked_on: string }>("stamp_menu_checked", { p_source: src, p_by: c.staff.partyId });
    return pick(L, `Menu checked on ${r.menu_checked_on}.`, `فُحصت القائمة في ${r.menu_checked_on}.`);
  }, `/menus/${src}`);
}

export const menusSection: Section = {
  nav: { href: "/menus", label: "Menus", roles: LEADS },
  routes: [
    { method: "GET", path: "/menus", roles: LEADS, handler: index },
    { method: "GET", path: "/menus/page/:page", roles: LEADS, handler: pageText },
    { method: "GET", path: "/menus/:source", roles: LEADS, handler: page },
    { method: "POST", path: "/menus/:source/photo", roles: LEADS, handler: photo },
    { method: "POST", path: "/menus/:source/add", roles: LEADS, handler: add },
    { method: "POST", path: "/menus/:source/section", roles: LEADS, handler: section },
    { method: "POST", path: "/menus/:source/checked", roles: LEADS, handler: checked },
    { method: "POST", path: "/menus/dish/:dish", roles: LEADS, handler: dish },
  ],
};
