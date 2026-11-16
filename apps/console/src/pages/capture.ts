// LB1: the label day's capture page, for a phone (docs/NEXT_SESSIONS.md, LB1; docs/DECISIONS.md, coordinator decisions of 16 November).
// Every pack is photographed (front, back, and one optional side photo: the side with the nutrition panel or the directions) before the
// friends' test; the label, not a web page, is then the source of product facts (the reading run, the approval queue). This page is the
// photographing. Find the item (scan the barcode with the camera, type it, or pick it from a list: 63 of the 291 cannot be scanned: 34
// have no barcode and 29 carry only the store's own code), take the photos, and the page goes on to the next item not yet captured.
// A counter shows items done and left, by aisle. Functional, on the existing components (design is paused, NEXT_SESSIONS rule 10).
//
// It works without script (a plain form per photo); the script (src/capture-js.ts, /capture.js) only shrinks the photo, keeps it in the
// phone until the server has it and retries it, scans with the camera and moves on by itself. A photo is stored in the private media
// bucket under labels/<item id>/<day>/<hash>.<ext> (the same photo sent twice is one object) and recorded by record_label_capture() (0211),
// which is idempotent; the staff member acting is always the signed-in person; every save is in the action log first. Photos are personal
// data: never logged, never public, shown only as short-lived signed links.
import { attempt, explain, flashRedirect, html, render, UserError, UUID, upload, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { Raw, form } from "../html";
import { pick } from "../i18n";
import { ALL } from "../roles";

type Shots = { front: boolean; back: boolean; side: boolean; done: boolean };
type Item = { product_id: string; sku: string; name_en: string; name_ar: string | null; barcode: string | null; has_barcode: boolean; aisle: string; done: boolean; shots: Shots };
type Progress = { total: number; done: number; left: number; with_side: number; by_aisle: { aisle: string; total: number; done: number; left: number }[] };
const SHOTS = ["front", "back", "side"] as const;
type Shot = (typeof SHOTS)[number];

const itemOf = (c: Ctx, id: string) => c.deps.db.rpc<Item | null>("label_capture_json", { p_product: id });
const progressOf = (c: Ctx) => c.deps.db.rpc<Progress>("label_capture_progress", {});

async function page(c: Ctx) {
  const L = c.lang;
  const sp = c.url.searchParams;
  const progress = await progressOf(c);
  const wanted = sp.get("item") ?? "";
  const code = (sp.get("code") ?? "").trim().slice(0, 40);
  let item: Item | null = null;
  let note: string | null = null;
  if (UUID.test(wanted)) item = await itemOf(c, wanted);
  else if (code) {
    item = await c.deps.db.rpc<Item | null>("label_capture_find", { p_code: code });
    if (!item) note = pick(L, "No item has this barcode. Check the number, or pick the item from the list.", "لا يوجد منتج بهذا الباركود. تحقق من الرقم أو اختر المنتج من القائمة.");
  }
  if (!item && progress.left > 0) item = await c.deps.db.rpc<Item | null>("label_capture_next", { p_after: null });

  const thumbs: Partial<Record<Shot, string>> = {};
  if (item) {
    const cur = await c.deps.db.rows<{ shot: Shot; media_path: string }>("label_captures", { select: "shot,media_path", where: { product_id: item.product_id, superseded_at: null } });
    await Promise.all(cur.map(async (x) => { const link = await c.deps.media.sign(x.media_path, 600); if (link) thumbs[x.shot] = link; }));
  }

  const msgs = {
    saved: pick(L, "Saved", "تم الحفظ"), waiting: pick(L, "Waiting to be sent: it stays on this phone", "بانتظار الإرسال: تبقى على هذا الهاتف"),
    working: pick(L, "Preparing the photo…", "جارٍ تجهيز الصورة…"), refused: pick(L, "Refused: see below", "مرفوضة: انظر أدناه"),
    pending: pick(L, "{n} photo(s) waiting to be sent. They stay on this phone until the server has them.", "{n} صورة بانتظار الإرسال. تبقى على هذا الهاتف حتى يستلمها الخادم."),
    rejected: pick(L, "{n} photo(s) were refused:", "{n} صورة رُفضت:"),
    "no-camera": pick(L, "The camera could not be opened. Type the number or pick the item from the list.", "تعذّر فتح الكاميرا. اكتب الرقم أو اختر المنتج من القائمة."),
  };
  const attrs = new Raw(Object.entries(msgs).map(([k, v]) => ` data-msg-${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join(""));

  const counter = html`<p class="cap-count"><span><bdi data-count-done>${progress.done}</bdi> ${pick(L, "done", "تم")}</span> · <span><bdi data-count-left>${progress.left}</bdi> ${pick(L, "left", "بقي")}</span>
<small>${pick(L, "of", "من")} <bdi>${progress.total}</bdi></small></p>
<progress data-progress value="${progress.done}" max="${progress.total}">${progress.done} / ${progress.total}</progress>
<details><summary>${pick(L, "By aisle", "حسب الممر")}</summary><table>${progress.by_aisle.map((a) => html`<tr data-aisle-done="${a.done}" data-aisle-total="${a.total}">
<td>${a.aisle}</td><td><bdi>${a.done} / ${a.total}</bdi></td></tr>`)}</table></details>`;

  const slotName: Record<Shot, string> = { front: pick(L, "Front", "الواجهة"), back: pick(L, "Back", "الخلف"), side: pick(L, "Side", "الجانب") };
  const slotHelp: Record<Shot, string> = {
    front: pick(L, "The whole front of the pack.", "واجهة العبوة كاملة."),
    back: pick(L, "The whole back: ingredients, allergens, warnings.", "ظهر العبوة كاملاً: المكوّنات والمسبّبات والتحذيرات."),
    side: pick(L, "Optional: the side with the nutrition panel or the directions.", "اختياري: الجانب الذي فيه جدول القيم الغذائية أو طريقة الاستعمال."),
  };
  const slot = (s: Shot) => {
    const has = item!.shots[s];
    return html`<section class="cap-slot" data-slot="${s}" data-status="${has ? "done" : "empty"}">${form(c.f, "/capture/photo", html`<input type="hidden" name="product" value="${item!.product_id}"><input type="hidden" name="shot" value="${s}">
<h3>${slotName[s]}${s === "side" ? "" : html` <small class="muted">${pick(L, "needed", "مطلوبة")}</small>`}</h3>
<p class="muted">${slotHelp[s]}</p>
<p data-state>${has ? msgs.saved : pick(L, "Not yet", "لم تُلتقط بعد")}</p>
${thumbs[s] ? html`<p><a href="${thumbs[s]!}"><img class="proof cap-thumb" src="${thumbs[s]!}" alt="${slotName[s]}"></a></p>` : ""}
<label class="ak-btn cap-take"><input type="file" name="photo" accept="image/*" capture="environment" data-shot="${s}"><span>${has ? pick(L, "Take it again", "التقطها من جديد") : pick(L, "Take the photo", "التقط الصورة")}</span></label>
<button data-nojs>${pick(L, "Save the photo", "احفظ الصورة")}</button>`, { files: true })}</section>`;
  };
  const slots = item ? SHOTS.map(slot) : [];

  const find = html`<h2>${pick(L, "Another item", "منتج آخر")}</h2>
<form method="get" action="/capture" class="cap-find"><label>${pick(L, "Barcode or SKU", "الباركود أو الرمز")} <input name="code" inputmode="numeric" autocomplete="off" maxlength="40" value="${code}"></label>
<button>${pick(L, "Find", "ابحث")}</button></form>
<p><button type="button" data-scan hidden>${pick(L, "Scan with the camera", "امسح بالكاميرا")}</button> <button type="button" data-scan-stop hidden>${pick(L, "Stop", "إيقاف")}</button></p>
<video data-scan-video class="cap-video" playsinline muted hidden></video><p class="note" data-scan-note hidden></p>
<p><a class="ak-btn" href="/capture/list">${pick(L, "Pick from the list", "اختر من القائمة")}</a></p>`;

  const body = html`<div data-capture${item ? new Raw(` data-product="${item.product_id}" data-next="/capture/next?after=${item.product_id}"`) : ""}${attrs}>
${note ? html`<p class="note">${note}</p>` : ""}
${counter}
<div class="note" data-pending hidden><span data-pending-text></span> <button type="button" data-retry hidden>${pick(L, "Send again", "أرسل من جديد")}</button></div>
${item ? html`<h2>${item.name_en}</h2>
<p><bdi>${item.name_ar ?? ""}</bdi></p>
<p class="muted">${item.aisle} · ${item.sku}${item.barcode ? html` · <bdi>${item.barcode}</bdi>` : pick(L, " · no barcode", " · بلا باركود")}</p>
${slots}
<p><a class="ak-btn" href="/capture/next?after=${item.product_id}" data-next-link>${pick(L, "Next item", "المنتج التالي")}</a></p>`
  : html`<p class="flash ok">${pick(L, "Every item has its front and back photographed.", "كل المنتجات صُوّرت واجهتها وظهرها.")}</p>
<p><a class="ak-btn" href="/capture/list?all=1">${pick(L, "Pick an item to photograph again", "اختر منتجاً لتصويره من جديد")}</a></p>`}
${find}</div><script src="/capture.js" defer></script>`;
  return render(c, pick(L, "Label day: photograph the packs", "يوم الملصقات: صوّر العبوات"), body, { translated: true });
}

// ---------- the next item ----------
async function next(c: Ctx) {
  const after = c.url.searchParams.get("after") ?? "";
  const n = await c.deps.db.rpc<Item | null>("label_capture_next", { p_after: UUID.test(after) ? after : null });
  return new Response(null, { status: 303, headers: { location: n ? `/capture?item=${n.product_id}` : "/capture?done=1" } });
}

// ---------- the list ----------
async function list(c: Ctx) {
  const L = c.lang;
  const all = c.url.searchParams.get("all") === "1";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const items = (await c.deps.db.rpc<Item[] | null>("label_capture_items", { p_only_missing: !all, p_no_barcode: !all, p_limit: 400 })) ?? [];
  const shown = items.filter((x) => !q || [x.sku, x.name_en, x.name_ar, x.aisle, x.barcode].some((v) => (v ?? "").toLowerCase().includes(q)));
  const byAisle = new Map<string, Item[]>();
  for (const x of shown) byAisle.set(x.aisle, [...(byAisle.get(x.aisle) ?? []), x]);
  const intro = all
    ? pick(L, `${items.length} items, in shelf order. A tick means front and back are done.`, `${items.length} منتجاً بترتيب الرفوف. العلامة تعني أن الواجهة والخلف تم تصويرهما.`)
    : pick(L, `${items.length} items to pick from the list: they have no barcode, or only the store's own code, so the camera cannot find them.`,
           `${items.length} منتجاً للاختيار من القائمة: بلا باركود أو بباركود المتجر الداخلي فقط، فلا تجدها الكاميرا.`);
  return render(c, pick(L, "Pick an item", "اختر منتجاً"), html`<p><a class="ak-btn" href="/capture">${pick(L, "Back to the photographing", "العودة إلى التصوير")}</a></p>
<p>${intro}</p>
<form method="get" action="/capture/list" class="cap-find">${all ? html`<input type="hidden" name="all" value="1">` : ""}<label>${pick(L, "Find by name, SKU or aisle", "ابحث بالاسم أو الرمز أو الممر")} <input name="q" value="${q}" maxlength="60"></label> <button>${pick(L, "Find", "ابحث")}</button></form>
<p>${all ? html`<a href="/capture/list">${pick(L, "Only the items the camera cannot find", "فقط ما لا تجده الكاميرا")}</a>` : html`<a href="/capture/list?all=1">${pick(L, "All items", "كل المنتجات")}</a>`}</p>
${shown.length === 0 ? html`<p class="muted">${pick(L, "Nothing here.", "لا شيء هنا.")}</p>` : [...byAisle].map(([aisle, xs]) => html`<h2>${aisle} (${xs.length})</h2>
<ul class="cap-list">${xs.map((x) => html`<li data-state="${x.done ? "done" : ""}"><a href="/capture?item=${x.product_id}">${x.name_en}</a>
<small class="muted"><bdi>${x.name_ar ?? ""}</bdi> ${x.sku}${x.barcode ? html` · <bdi>${x.barcode}</bdi>` : ""}</small>${x.done ? html` <span class="ok">✓</span>` : ""}</li>`)}</ul>`)}`, { translated: true });
}

// ---------- one photo ----------
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const USER_CODES = /^(NOT_AUTHORISED|CAPTURE_|PRODUCT_NOT_FOUND)/;

async function photo(c: Ctx) {
  const json = (c.req.headers.get("accept") ?? "").includes("application/json");
  const product = (c.form.product ?? "").trim();
  const shot = (c.form.shot ?? "").trim();
  const back = UUID.test(product) ? `/capture?item=${product}` : "/capture";
  const say = (status: number, error: string, retry: boolean) => Response.json({ ok: false, error, retry }, { status });
  // What retrying cannot fix is refused first, before anything is stored (422); a plain form gets the reason on the page.
  const refuse = (en: string, ar: string) => { const m = pick(c.lang, en, ar); if (json) return say(422, m, false); throw new UserError(m); };
  if (!UUID.test(product)) return refuse("That item is not valid.", "هذا المنتج غير صالح.");
  if (!(SHOTS as readonly string[]).includes(shot)) return refuse("Choose front, back or side.", "اختر الواجهة أو الخلف أو الجانب.");
  const file = c.files.photo;
  if (!file) return refuse("Choose a photo first.", "اختر صورة أولاً.");
  if (!IMAGE_TYPES.has(file.type)) return refuse("Attach a photo (JPEG, PNG or WebP).", "أرفق صورة (JPEG أو PNG أو WebP).");
  const known = await itemOf(c, product);
  if (!known) return refuse("That item is not on the label-day list.", "هذا المنتج ليس في قائمة يوم الملصقات.");

  let out: Record<string, unknown> = {};
  let permanent = false;
  const r = await attempt(c, "label_capture", { product, shot }, async () => {
    try {
      const path = await upload(c, "photo", `labels/${product}`);
      const saved = await c.deps.db.rpc<{ capture_id: string; done: boolean; already: boolean }>("record_label_capture", { p_product: product, p_shot: shot, p_media_path: path, p_by: c.staff.partyId });
      const progress = await progressOf(c);
      out = { ok: true, shot, product_id: product, capture_id: saved.capture_id, done: saved.done, already: saved.already, progress, next_url: saved.done ? `/capture/next?after=${product}` : null };
      return saved.already ? pick(c.lang, "Saved already.", "محفوظة من قبل.") : pick(c.lang, "Saved.", "تم الحفظ.");
    } catch (e) {
      permanent = e instanceof UserError || (e instanceof DbError && USER_CODES.test(e.message));
      throw e;
    }
  });
  if (!r.logged) {
    const m = pick(c.lang, "Not done: the action log could not be written. The photo is kept on the phone and will be sent again.", "لم يتم: تعذّر تسجيل الإجراء. الصورة محفوظة على الهاتف وستُرسل من جديد.");
    return json ? say(503, m, true) : flashRedirect(c.deps, back, { err: m });
  }
  if (!r.ok) {
    const m = r.msg.err ?? explain(new Error("failed"));
    return json ? say(permanent ? 422 : 502, m, !permanent) : flashRedirect(c.deps, back, { err: m });
  }
  if (json) return Response.json({ ...out, message: r.msg.ok });
  return flashRedirect(c.deps, out.done ? `/capture/next?after=${product}` : back, { ok: r.msg.ok });
}

export const captureSection: Section = {
  nav: { href: "/capture", label: "Label day photos", roles: ALL },
  routes: [
    { method: "GET", path: "/capture", roles: ALL, handler: page },
    { method: "GET", path: "/capture/list", roles: ALL, handler: list },
    { method: "GET", path: "/capture/next", roles: ALL, handler: next },
    { method: "POST", path: "/capture/photo", roles: ALL, handler: photo },
  ],
};
