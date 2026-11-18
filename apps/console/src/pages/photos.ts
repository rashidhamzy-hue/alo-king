// PIX4: Photos. A fast approval screen for the pictures waiting in the queue (PIX3's), one at a time: a big picture, the name and the size,
// Approve / Reject / Later. Keys on a laptop: a approves, r rejects, l puts it aside, the arrows move; on a phone, three big buttons.
// Filters: To approve (all waiting), Needs review (a check found something: the reasons are on the card), Later, and Needs a photo (items
// with no picture at all, by aisle; the front photo on label day closes each one).
// Nothing here decides anything itself: Approve and Reject call review_product_image() (0050), Later calls defer_product_image() (0242).
// A picture shows to customers only once approved, and only if its licence is one a customer may see (product_image_licence_usable).
// The older pages stay: Approve > Pictures (one card at a time with the rest of the queue) and /pictures (the list, approved and rejected too).
import { act, html, id, render, returnTo, text, UserError, type Ctx, type Section } from "../app";
import { form } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, button, empty, icon, tabs } from "@ak/ui/components";
import { Raw } from "../html";
import { bySpeed, LICENCE, safeHref, type Img } from "./pictures";

const FILTERS = ["all", "review", "later", "missing"] as const;
type Filter = (typeof FILTERS)[number];
export type Missing = { sku: string; product_id: string; name_en: string; name_ar: string | null; brand: string | null; sell_unit: string; aisle_code: string; aisle_en: string; aisle_ar: string; rejected_before: boolean };

const href = (f: Filter, n = 0) => `/photos?f=${f}${n > 0 ? `&n=${n}` : ""}`;
const kb = (b: number | null) => (b ? `${Math.round(b / 1000)} KB` : "");

/** The order to decide in: clean pictures first (fastest sellers first), then the ones with something to look at; "Later" is its own list. */
export const order = (rows: Img[]) => [...rows].sort((a, b) => Number(!!a.needs_review) - Number(!!b.needs_review) || bySpeed(a, b));
export const split = (rows: Img[]) => ({
  all: order(rows.filter((r) => !r.deferred_at)),
  review: order(rows.filter((r) => !r.deferred_at && r.needs_review)),
  later: order(rows.filter((r) => r.deferred_at)),
});

/** One reason from the import's checks, in words. The stored text is kept (it names the other product, the size, the percentages). */
export function noteWords(L: Lang, n: string): { text: string; info: boolean } {
  const rest = (p: string) => n.slice(p.length).replace(/^[:\s]+/, "");
  if (n.startsWith("duplicate:")) return { text: pick(L, `Looks like the picture of another item: ${rest("duplicate:")}. Check it is not the wrong pack.`, `تشبه صورة صنف آخر: ${rest("duplicate:")}. تأكد أنها ليست العبوة الخطأ.`), info: false };
  if (n.startsWith("background:")) return { text: pick(L, `The background is not white (${rest("background:")}).`, `الخلفية ليست بيضاء (${rest("background:")}).`), info: false };
  if (n.startsWith("fill:")) return { text: pick(L, `The product is small in the square (${rest("fill:")}).`, `المنتج صغير داخل المربع (${rest("fill:")}).`), info: false };
  if (n.startsWith("small:")) return { text: pick(L, `The picture is small (${rest("small:")}).`, `الصورة صغيرة (${rest("small:")}).`), info: false };
  if (n.startsWith("heavy:")) return { text: pick(L, `The file is heavy (${rest("heavy:")}).`, `الملف ثقيل (${rest("heavy:")}).`), info: false };
  if (n.startsWith("in the review folder")) return { text: pick(L, "The founder's script packaged it for a person to judge.", "جهّزها نصّ المؤسس لشخص يحكم عليها."), info: false };
  if (n.startsWith("report status:")) return { text: pick(L, `The fetch report marks it "${rest("report status:")}".`, `تقرير الجلب يصنّفها «${rest("report status:")}».`), info: false };
  if (n.startsWith("note:")) return { text: pick(L, `Note: ${rest("note:")}.`, `ملاحظة: ${rest("note:")}.`), info: true };
  return { text: n, info: false };
}

async function load(c: Ctx) {
  const rows = (await c.deps.db.rpc<Img[] | null>("product_images_review", { p_status: "proposed", p_limit: 1000 })) ?? [];
  return { rows, ...split(rows) };
}
const loadMissing = async (c: Ctx) => (await c.deps.db.rpc<Missing[] | null>("pictures_missing", {})) ?? [];

function missingList(c: Ctx, items: Missing[]) {
  const L = c.lang;
  if (!items.length) return empty({ title: pick(L, "Every stocked item has a picture waiting or approved.", "لكل صنف صورة بانتظار القرار أو معتمدة."), ok: true, icon: "check" });
  const by = new Map<string, Missing[]>();
  for (const m of items) by.set(L === "ar" ? m.aisle_ar : m.aisle_en, [...(by.get(L === "ar" ? m.aisle_ar : m.aisle_en) ?? []), m]);
  return html`<p class="muted">${pick(L, `${items.length} items have no picture. Each is marked "needs a photo": the front photo on label day closes it (Stock, Label day photos).`, `لا صورة لـ ${items.length} صنفاً. كل واحد منها «يحتاج صورة»: صورة الواجهة في يوم الملصقات تغلقه (المخزون، صور يوم الملصقات).`)}
${button({ label: pick(L, "Open the label day page", "افتح صفحة يوم الملصقات"), href: "/capture", variant: "soft", icon: "camera" })}</p>
${[...by.entries()].map(([aisle, list]) => html`<section class="ak-card"><h2>${aisle} <span class="muted">(${list.length})</span></h2>
<ul>${list.map((m) => html`<li><bdi>${m.sku}</bdi> · <bdi>${m.name_en}</bdi>${m.name_ar ? html` · <bdi lang="ar">${m.name_ar}</bdi>` : ""} <span class="muted">${m.sell_unit}</span> ${badge(pick(L, "needs a photo", "يحتاج صورة"), "gold", "camera")}${m.rejected_before ? html` <span class="muted">${pick(L, "(a picture was rejected before)", "(رُفضت صورة سابقة)")}</span>` : ""}</li>`)}</ul></section>`)}`;
}

async function card(c: Ctx, f: Filter, n: number, total: number, r: Img) {
  const L = c.lang;
  const link = await c.deps.media.sign(r.media_path, 600);
  const notes = (r.check_notes ?? []).map((x) => noteWords(L, x));
  const flagged = notes.filter((x) => !x.info); const info = notes.filter((x) => x.info);
  const back = html`<input type="hidden" name="return_to" value="${href(f, n)}">`;
  const later = f === "later";
  return html`<article class="ak-card ak-approve-card ak-photo-card" data-card="photos" data-image="${r.image_id}">
<div class="ak-compare">
<div class="ak-photo">${link ? html`<a href="${link}" target="_blank" rel="noopener"><img class="proof" src="${link}" alt="${pick(L, "Proposed picture of", "الصورة المقترحة لـ")} ${r.name_en}"></a>` : html`<p class="note">${icon("alert")} ${pick(L, "Picture not available.", "الصورة غير متاحة.")}</p>`}</div>
<div>
<p class="ak-what"><strong><bdi>${r.name_en}</bdi></strong>${r.name_ar ? html`<br><bdi lang="ar">${r.name_ar}</bdi>` : ""}</p>
<p>${r.sku ?? ""} · ${r.brand ?? pick(L, "no brand", "بلا علامة")} · ${r.sell_unit}</p>
<p class="muted">${r.width_px ?? "?"} × ${r.height_px ?? "?"} px${r.bytes ? ` · ${kb(r.bytes)}` : ""}${r.needs_review ? "" : ""}</p>
${r.needs_review ? html`<p>${badge(pick(L, "Needs review", "تحتاج مراجعة"), "warn", "alert")}</p>` : ""}
${form(c.f, `/photos/${r.image_id}`, html`${back}
<div class="actions-row ak-photo-actions">
${later ? button({ label: pick(L, "Bring back", "أعدها"), variant: "soft", icon: "clock", name: "decision", value: "unlater" }) : button({ label: pick(L, "Later", "لاحقاً"), variant: "soft", icon: "clock", name: "decision", value: "later", attrs: { "data-key": "l" } })}
${button({ label: pick(L, "Reject", "ارفض"), variant: "danger", icon: "close", name: "decision", value: "reject", attrs: { "data-key": "r-now" } })}
${button({ label: pick(L, "Approve", "وافق"), variant: "gold", icon: "check", name: "decision", value: "approve", attrs: { "data-key": "a" } })}
</div>
<label class="muted">${pick(L, "Note (why), optional", "ملاحظة (السبب)، اختيارية")} <input class="ak-input" name="note" maxlength="300"></label>`)}
${flagged.length ? html`<div class="note">${icon("alert")} <strong>${pick(L, "Why it needs a second look", "لماذا تحتاج نظرة ثانية")}</strong><ul>${flagged.map((x) => html`<li>${x.text}</li>`)}</ul></div>` : ""}
${info.length ? html`<p class="muted">${info.map((x) => x.text).join(" ")}</p>` : ""}
<p class="muted">${pick(L, "Approve only if the picture shows exactly this item: same brand, product and size, one pack, plain background, no price tag, logo or text.", "وافق فقط إن كانت الصورة تُظهر هذا الصنف تماماً: العلامة والمنتج والحجم نفسها، عبوة واحدة، خلفية سادة، بلا بطاقة سعر أو شعار أو كتابة.")}
 ${r.customer_visible ? pick(L, "After approval it shows to customers.", "بعد الموافقة تظهر للزبائن.") : pick(L, "Its licence is not one customers may see: approving keeps it as a guide only.", "ترخيصها ليس مما يجوز عرضه للزبائن: الموافقة تبقيها دليلاً فقط.")}</p>
<p class="muted">${pick(L, "Source: ", "المصدر: ")}${LICENCE[r.licence] ?? r.licence}${r.source_note ? html` · ${r.source_note}` : ""}${safeHref(r.page_url) ? html` · <a href="${safeHref(r.page_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "page", "الصفحة")}</a>` : ""}${safeHref(r.source_url) ? html` · <a href="${safeHref(r.source_url)}" target="_blank" rel="noopener noreferrer">${pick(L, "original", "الأصل")}</a>` : ""}</p>
</div></div>
<nav class="ak-approve-step" aria-label="${pick(L, "Pictures", "الصور")}"><p><strong>${pick(L, `Picture ${n + 1} of ${total}`, `الصورة ${n + 1} من ${total}`)}</strong></p>
<p class="actions-row">${n > 0 ? button({ label: pick(L, "Previous", "السابقة"), href: href(f, n - 1), variant: "ghost", icon: "chevron", attrs: { "data-key": "prev" } }) : ""}${total > 1 ? button({ label: pick(L, "Skip", "تخطَّ"), href: href(f, n + 1 < total ? n + 1 : 0), variant: "soft", icon: "chevron", attrs: { "data-key": "skip" } }) : ""}</p></nav>
</article>`;
}

async function page(c: Ctx) {
  const L = c.lang;
  const asked = c.url.searchParams.get("f") ?? "";
  const f: Filter = (FILTERS as readonly string[]).includes(asked) ? (asked as Filter) : "all";
  let q: Awaited<ReturnType<typeof load>> | null = null; let failed = false;
  try { q = await load(c); } catch { failed = true; }
  const missing = await loadMissing(c).catch(() => [] as Missing[]);
  const counts: Record<Filter, number> = { all: q?.all.length ?? 0, review: q?.review.length ?? 0, later: q?.later.length ?? 0, missing: missing.length };
  const waiting = q?.rows.length ?? 0;
  const label: Record<Filter, string> = { all: pick(L, "To approve", "للموافقة"), review: pick(L, "Needs review", "تحتاج مراجعة"), later: pick(L, "Later", "لاحقاً"), missing: pick(L, "Needs a photo", "تحتاج صورة") };
  const list = f === "missing" ? [] : q?.[f] ?? [];
  const total = list.length;
  const n = total === 0 ? 0 : Math.min(total - 1, Math.max(0, Math.floor(Number(c.url.searchParams.get("n"))) || 0));
  let body: Raw;
  if (failed) body = html`<p class="note">${icon("alert")} ${pick(L, "The picture queue is not available yet: the database is missing a part of it.", "قائمة الصور غير متاحة بعد: قاعدة البيانات ينقصها جزء منها.")}</p>`;
  else if (f === "missing") body = missingList(c, missing);
  else if (total === 0) body = empty({ title: f === "later" ? pick(L, "Nothing is put aside.", "لا شيء مؤجَّل.") : f === "review" ? pick(L, "Nothing needs review.", "لا شيء يحتاج مراجعة.") : pick(L, "No pictures are waiting.", "لا صور بانتظار القرار."), ok: true, icon: "check" });
  else body = await card(c, f, n, total, list[n]!);
  return render(c, pick(L, "Photos", "الصور"), html`<div data-approve>
<p><strong>${pick(L, `${waiting} pictures to approve`, `${waiting} صورة للموافقة`)}</strong>${counts.review ? pick(L, `, ${counts.review} of them need review`, `، منها ${counts.review} تحتاج مراجعة`) : ""}.
 <span class="muted">${pick(L, "Nothing shows on the website or WhatsApp until you approve it. Keys: a approves, r rejects, l puts it aside, the arrows move.", "لا يظهر شيء في الموقع أو واتساب حتى توافق عليه. المفاتيح: a للموافقة، r للرفض، l للتأجيل، والأسهم للتنقل.")}</span></p>
${tabs(FILTERS.map((x) => ({ label: label[x], href: href(x), current: x === f, count: counts[x] })), pick(L, "Photos", "الصور"))}
${body}
<p class="muted ak-approve-foot">${pick(L, "Prefer a list, or want to withdraw an approved picture? ", "تفضّل قائمة، أو تريد سحب صورة معتمدة؟ ")}<a href="/pictures">${pick(L, "Pictures as a list", "الصور كقائمة")}</a></p>
</div>`, { translated: true });
}

async function decide(c: Ctx) {
  const image = id(c, "image");
  const d = c.form.decision;
  if (!["approve", "reject", "later", "unlater"].includes(d ?? "")) throw new UserError("Choose approve, reject or later.");
  const note = text(c, "note", 300) || null;
  return act(c, `photo_${d}`, { image, note }, async () => {
    if (d === "later" || d === "unlater") {
      await c.deps.db.rpc("defer_product_image", { p_image: image, p_by: c.staff.partyId, p_undo: d === "unlater" });
      return d === "later" ? "Put aside: it comes back at the end." : "Brought back to the queue.";
    }
    const r = await c.deps.db.rpc<{ already: boolean; status: string; customer_visible?: boolean; replaced?: string | null }>("review_product_image", { p_image: image, p_by: c.staff.partyId, p_decision: d, p_note: note });
    if (r.already) return `Already ${r.status}.`;
    if (r.status === "rejected") return "Rejected.";
    return `Approved${r.replaced ? ", replacing the earlier picture" : ""}.${r.customer_visible ? " Customers can now see it." : " Kept as a guide only: customers never see a licence-unknown picture."}`;
  }, returnTo(c, "/photos"));
}

export const photosSection: Section = {
  nav: { href: "/photos", label: "Photos", roles: LEADS },
  routes: [
    { method: "GET", path: "/photos", roles: LEADS, handler: page },
    { method: "POST", path: "/photos/:image", roles: LEADS, handler: decide },
  ],
};
