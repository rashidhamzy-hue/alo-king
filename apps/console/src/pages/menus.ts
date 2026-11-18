// FD1: Menus (docs/DECISIONS.md, "FD1, 18 November 2026"). One page per place:
//   Photos     staff photograph the menu (each photo shrunk on the phone to 1600 px, JPEG 0.8, as LB1's capture page; /menus.js) into the
//              private media bucket under menus/<place>/<day>/<hash>.jpg, recorded by record_menu_photo (0246). The menu-read workflow reads the
//              waiting photos (one run, the Batch API, capped at USD 2) into dish proposals; a failed reading leaves the photo waiting.
//   To check   every dish the reading proposed, beside its photo: names in Arabic and English, the price as printed with its currency, sizes,
//              options and add-ons. A person approves it (correcting a name or the price first) or rejects it with a reason. Nothing is on
//              sale before that. A name that praises or makes a health claim is refused until it is changed (invariant 14).
//   On sale    the approved dishes: the printed price, today's dollars (an LBP price follows the day's rate), their option groups, and their
//              food facts: "declared by the vendor" or "not confirmed yet" (never anything else; invariant 15).
//   Stamp      "menu checked on <date>": refused while a photo or a dish waits. approve_merchant needs it (Places page).
// Functional, on the DS2 components. The console writes nothing itself: every change is a SQL function called as the signed-in person.
import { act, attempt, flashRedirect, html, id, render, text, upload, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, dataTable, empty } from "@ak/ui/components";

type Named = { name_ar: string | null; name_en: string | null };
type Waiting = Named & { id: string; photo_id: string; section_ar: string | null; section_en: string | null; translated: "ar" | "en" | null; price: number | string | null;
  currency: "USD" | "LBP" | null; price_text: string | null; sizes: (Named & { price: number | null; currency: string | null })[];
  options: { group_ar: string | null; group_en: string | null; required: boolean; min: number; max: number; choices: (Named & { price_delta: number | null })[] }[];
  addons: (Named & { price: number | null; currency: string | null })[]; name_claim: boolean };
type Dish = Named & { product_id: string; section: string | null; price_usd: number | string; is_available: boolean; printed_price: number | string | null; printed_currency: string | null; groups: number; declared: number };
type Photo = { photo_id: string; media_path: string; uploaded_at: string; read_status: "waiting" | "read"; read_at: string | null; failures: number; last_failure: string | null; dishes: number };
type Menu = { place: { source_id: string; name: string; visibility: string; approved: boolean; menu_checked_on: string | null; menu_checked_by: string | null } | null;
  fx: number | string | null; photos: Photo[]; waiting: Waiting[]; dishes: Dish[]; rejected: number };
type Place = { source_id: string; name: string; photos_waiting: number; dishes_waiting: number; dishes: number; menu_checked_on: string | null };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const nameOf = (n: Named, L: Lang) => (L === "ar" ? n.name_ar ?? n.name_en : n.name_en ?? n.name_ar) ?? "";
const money = (v: number | string | null, cur: string | null) => (v === null || v === undefined ? "" : cur === "LBP" ? `${Number(v).toLocaleString("en-US")} LBP` : `$${Number(v).toFixed(2)}`);
const both = (n: Named) => html`${n.name_en ?? ""}${n.name_ar ? html` <bdi>${n.name_ar}</bdi>` : ""}`;

function waitingCard(c: Ctx, d: Waiting, src: string, photoLink: string | null) {
  const L = c.lang;
  const extras = [
    d.sizes.length ? html`<li>${pick(L, "Sizes", "الأحجام")}: ${d.sizes.map((s, i) => html`${i ? " · " : ""}${both(s)} ${money(s.price, s.currency ?? d.currency)}`)}</li>` : "",
    ...d.options.map((o) => html`<li>${both({ name_en: o.group_en, name_ar: o.group_ar })} (${o.required ? pick(L, "required", "إلزامي") : pick(L, "optional", "اختياري")}, ${o.min} to ${o.max}): ${o.choices.map((x, i) => html`${i ? " · " : ""}${both(x)}${x.price_delta ? ` +${money(x.price_delta, d.currency)}` : ""}`)}</li>`),
    d.addons.length ? html`<li>${pick(L, "Add-ons", "إضافات")}: ${d.addons.map((a, i) => html`${i ? " · " : ""}${both(a)} ${money(a.price, a.currency ?? d.currency)}`)}</li>` : ""];
  return html`<section class="ak-card"><p><strong>${both(d)}</strong>${d.translated ? html` ${badge(pick(L, d.translated === "ar" ? "Arabic name not printed: written by the reader" : "English name not printed: written by the reader", d.translated === "ar" ? "الاسم العربي غير مطبوع: كتبه القارئ" : "الاسم الإنكليزي غير مطبوع: كتبه القارئ"), "warn")}` : ""}
${d.name_claim ? html` ${badge(pick(L, "The name praises or makes a health claim: change it", "الاسم يمدح أو يدّعي فائدة صحية: غيّره"), "warn")}` : ""}<br>
<small class="muted">${both({ name_en: d.section_en, name_ar: d.section_ar })} · ${pick(L, "printed", "مطبوع")}: <bdi>${d.price_text || pick(L, "no price", "بلا سعر")}</bdi>${photoLink ? html` · <a href="${photoLink}" target="_blank" rel="noopener">${pick(L, "the photo", "الصورة")}</a>` : ""}</small></p>
${extras.some((x) => x !== "") ? html`<ul>${extras}</ul>` : ""}
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="approve">
<label class="ak-field"><span>${pick(L, "Name in Arabic", "الاسم بالعربية")}</span><input class="ak-input" name="name_ar" value="${d.name_ar ?? ""}" maxlength="120" dir="rtl"></label>
<label class="ak-field"><span>${pick(L, "Name in English", "الاسم بالإنكليزية")}</span><input class="ak-input" name="name_en" value="${d.name_en ?? ""}" maxlength="120"></label>
<label class="ak-field"><span>${pick(L, "Section", "القسم")}</span><input class="ak-input" name="section_en" value="${d.section_en ?? d.section_ar ?? ""}" maxlength="120"></label>
<label class="ak-field"><span>${pick(L, "Price as printed", "السعر كما هو مطبوع")}</span><input class="ak-input" name="price" value="${d.price ?? ""}" inputmode="decimal" maxlength="14"></label>
<label class="ak-field"><span>${pick(L, "Currency", "العملة")}</span><select class="ak-input" name="currency"><option value="">${pick(L, "as read", "كما قُرئت")}</option>
${(["USD", "LBP"] as const).map((k) => html`<option value="${k}"${d.currency === k ? html` selected` : ""}>${k}</option>`)}</select></label>
<button class="ak-btn ak-btn--primary">${pick(L, "Approve this dish", "وافق على هذا الطبق")}</button>`)}
${form(c.f, `/menus/dish/${d.id}`, html`<input type="hidden" name="source" value="${src}"><input type="hidden" name="decision" value="reject">
<label class="ak-field"><span>${pick(L, "Reason to reject", "سبب الرفض")}</span><input class="ak-input" name="note" maxlength="500" required></label> <button class="ak-btn ak-btn--soft">${pick(L, "Reject", "ارفض")}</button>`)}</section>`;
}

async function index(c: Ctx) {
  const L = c.lang;
  const places = (await c.deps.db.rpc<Place[]>("places_console", {})) ?? [];
  return render(c, pick(L, "Menus", "القوائم"), html`<h1>${pick(L, "Menus", "القوائم")}</h1>
<p class="muted">${pick(L, "Photograph a place's menu, run the reading, check every dish, then stamp the menu as checked.", "صوّر قائمة المكان، شغّل القراءة، راجع كل طبق، ثم اختم القائمة كمفحوصة.")}</p>
${dataTable({ caption: pick(L, "Menus", "القوائم"), columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Photos waiting", "صور بالانتظار"), num: true },
    { label: pick(L, "Dishes to check", "أطباق للمراجعة"), num: true }, { label: pick(L, "On sale", "معروض"), num: true }, { label: pick(L, "Menu checked", "فُحصت القائمة") }],
  rows: places.map((p) => ({ cells: [html`<a href="/menus/${p.source_id}"><strong>${p.name}</strong></a>`, p.photos_waiting, p.dishes_waiting, p.dishes, p.menu_checked_on ? when(p.menu_checked_on) : pick(L, "not yet", "ليس بعد")] })),
  empty: empty({ title: pick(L, "No place yet.", "لا مكان بعد."), text: pick(L, "Make one on the Places page first.", "اصنع واحداً في صفحة الأماكن أولاً."), icon: "food", action: html`<a class="ak-btn" href="/places?tab=new">${pick(L, "New place", "مكان جديد")}</a>` }) })}`, { translated: true });
}

async function page(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const m = await c.deps.db.rpc<Menu>("menu_console", { p_source: src });
  if (!m?.place) return render(c, pick(L, "Menus", "القوائم"), html`<p class="flash err">${pick(L, "That place was not found.", "لم يُعثر على هذا المكان.")}</p>`, { translated: true });
  const links = new Map(await Promise.all(m.photos.map(async (p) => [p.photo_id, await c.deps.media.sign(p.media_path, 600)] as const)));
  const waitingPhotos = m.photos.filter((p) => p.read_status === "waiting").length;
  const upload = html`<form method="post" action="/menus/${src}/photo" enctype="multipart/form-data" data-menu-upload
 data-msg-working="${pick(L, "Shrinking and sending photo {i} of {n}…", "جارٍ تصغير الصورة {i} من {n} وإرسالها…")}" data-msg-failed="${pick(L, "{n} photo(s) were not saved: choose them again.", "لم تُحفظ {n} صورة: اخترها من جديد.")}">
<input type="hidden" name="_csrf" value="${c.f.csrf}"><input type="hidden" name="_key" value="${c.f.nonce()}">
<label class="ak-btn ak-btn--primary"><input type="file" name="photo" accept="image/*" capture="environment" multiple> ${pick(L, "Photograph a menu page", "صوّر صفحة من القائمة")}</label>
<button class="ak-btn" data-nojs>${pick(L, "Save the photo", "احفظ الصورة")}</button> <span data-status class="muted" aria-live="polite"></span></form>
<p class="muted">${pick(L, "One page per photo, flat and sharp, the whole page in the frame.", "صفحة واحدة في كل صورة، مسطحة وواضحة، والصفحة كلها داخل الإطار.")}</p>`;
  const photos = dataTable({ caption: pick(L, "Photos", "الصور"), columns: [{ label: pick(L, "Photo", "الصورة") }, { label: pick(L, "Taken", "التُقطت") }, { label: pick(L, "Reading", "القراءة") }, { label: pick(L, "Dishes", "الأطباق"), num: true }],
    rows: m.photos.map((p, i) => ({ cells: [links.get(p.photo_id) ? html`<a href="${links.get(p.photo_id)}" target="_blank" rel="noopener">${pick(L, "Photo", "صورة")} ${i + 1}</a>` : `${i + 1}`, when(p.uploaded_at),
      p.read_status === "read" ? badge(pick(L, "Read", "قُرئت"), "ok") : p.failures ? badge(pick(L, `Failed ${p.failures}×: waits for the next run`, `فشلت ${p.failures} مرة: تنتظر القراءة التالية`), "warn") : badge(pick(L, "Waits for the reading run", "بانتظار القراءة"), "neutral"), p.dishes] })),
    empty: empty({ title: pick(L, "No photo yet.", "لا صور بعد."), icon: "camera" }) });
  const photoLink = (pid: string) => links.get(pid) ?? null;
  const dishes = dataTable({ caption: pick(L, "On sale", "معروض"), columns: [{ label: pick(L, "Dish", "الطبق") }, { label: pick(L, "Section", "القسم") }, { label: pick(L, "Printed", "مطبوع") },
      { label: pick(L, "Today", "اليوم"), num: true }, { label: pick(L, "Choices", "الخيارات"), num: true }, { label: pick(L, "Food facts", "المعلومات الغذائية") }],
    rows: m.dishes.map((d) => ({ cells: [html`<strong>${nameOf(d, L)}</strong>${L === "ar" ? "" : d.name_ar ? html`<br><bdi class="muted">${d.name_ar}</bdi>` : ""}`, d.section ?? "", money(d.printed_price, d.printed_currency),
      `$${Number(d.price_usd).toFixed(2)}`, d.groups,
      d.declared ? pick(L, `${d.declared} declared by the vendor; the rest not confirmed yet`, `${d.declared} صرّح بها البائع؛ والباقي غير مؤكد بعد`) : pick(L, "Not confirmed yet", "غير مؤكدة بعد")] })),
    empty: empty({ title: pick(L, "No dish approved yet.", "لا طبق موافق عليه بعد."), icon: "food" }) });
  const stamp = m.place.menu_checked_on
    ? html`<p>${badge(pick(L, `Menu checked on ${m.place.menu_checked_on}`, `فُحصت القائمة في ${m.place.menu_checked_on}`), "ok")}${m.place.menu_checked_by ? html` · ${m.place.menu_checked_by}` : ""}</p>` : "";
  const canStamp = !waitingPhotos && !m.waiting.length && m.dishes.length > 0;
  return render(c, `${pick(L, "Menu", "القائمة")}: ${m.place.name}`, html`<p><a href="/menus">${pick(L, "All menus", "كل القوائم")}</a> · <a href="/places/${src}">${pick(L, "The place", "المكان")}</a></p>
<h1>${pick(L, "Menu", "القائمة")}: ${m.place.name}</h1>
${stamp}
<h2>${pick(L, "Photos", "الصور")}</h2>${upload}${photos}
${waitingPhotos ? html`<p class="muted">${pick(L, `${waitingPhotos} photo(s) wait for the reading run: GitHub, Actions, menu-read, Run workflow, branch main.`, `${waitingPhotos} صورة بانتظار القراءة: GitHub، Actions، menu-read، Run workflow، الفرع main.`)}</p>` : ""}
<h2>${pick(L, "Dishes to check", "أطباق للمراجعة")} (${m.waiting.length})</h2>
${m.fx ? html`<p class="muted">${pick(L, `Today's rate: ${Number(m.fx).toLocaleString("en-US")} LBP to the dollar. A lira price follows the day's rate.`, `سعر اليوم: ${Number(m.fx).toLocaleString("en-US")} ليرة للدولار. السعر بالليرة يتبع سعر اليوم.`)}</p>` : html`<p class="flash err">${pick(L, "No lira rate is recorded: a lira price cannot be approved until one is.", "لا يوجد سعر صرف مسجّل: لا يمكن الموافقة على سعر بالليرة قبل تسجيله.")}</p>`}
${m.waiting.length ? m.waiting.map((d) => waitingCard(c, d, src, photoLink(d.photo_id))) : empty({ title: pick(L, "Nothing to check.", "لا شيء للمراجعة."), icon: "check", ok: true })}
${m.rejected ? html`<p class="muted">${pick(L, `${m.rejected} dish(es) rejected.`, `${m.rejected} طبق مرفوض.`)}</p>` : ""}
<h2>${pick(L, "On sale once the place is approved", "يُعرض بعد الموافقة على المكان")} (${m.dishes.length})</h2>${dishes}
<h2>${pick(L, "Menu checked", "فُحصت القائمة")}</h2>
${canStamp ? form(c.f, `/menus/${src}/checked`, html`<p class="muted">${pick(L, "Stamp it once every dish here matches the menu as printed today.", "اختمها حين يطابق كل طبق هنا القائمة المطبوعة اليوم.")}</p><button class="ak-btn ak-btn--primary">${pick(L, "Stamp: menu checked today", "اختم: فُحصت القائمة اليوم")}</button>`)
  : html`<p class="muted">${pick(L, "The stamp waits until every photo is read and every dish is decided.", "الختم ينتظر قراءة كل صورة والبت في كل طبق.")}</p>`}
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

async function dish(c: Ctx) {
  const L = c.lang; const d = id(c, "dish"); const src = id(c, "source");
  const approve = c.form.decision === "approve";
  if (!["approve", "reject"].includes(c.form.decision ?? "")) throw new UserError(pick(L, "Choose approve or reject.", "اختر موافقة أو رفض."));
  const note = text(c, "note", 500);
  if (!approve && note.length < 3) throw new UserError(pick(L, "Write the reason (at least 3 characters).", "اكتب السبب (٣ أحرف على الأقل)."));
  const edit: Record<string, unknown> = {};
  if (approve) {
    for (const k of ["name_ar", "name_en", "section_en"]) if (k in c.form) edit[k] = text(c, k, 120);
    const raw = text(c, "price", 14).replace(/,/g, "");
    if (raw) { const n = Number(raw); if (!Number.isFinite(n) || n <= 0) throw new UserError(pick(L, "The price is not a number above zero.", "السعر ليس رقماً أكبر من صفر.")); edit.price = n; }
    const cur = (c.form.currency ?? "").trim();
    if (cur === "USD" || cur === "LBP") edit.currency = cur;
  }
  return act(c, approve ? "menu_dish_approve" : "menu_dish_reject", { dish: d }, async () => {
    const r = await c.deps.db.rpc<{ price_usd?: number }>("review_menu_dish", { p_dish: d, p_by: c.staff.partyId, p_approve: approve, p_edit: edit, p_note: approve ? null : note });
    return approve ? pick(L, `Approved at $${Number(r.price_usd ?? 0).toFixed(2)} today.`, `تمت الموافقة بسعر $${Number(r.price_usd ?? 0).toFixed(2)} اليوم.`) : pick(L, "Rejected.", "رُفض.");
  }, `/menus/${src}`);
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
    { method: "GET", path: "/menus/:source", roles: LEADS, handler: page },
    { method: "POST", path: "/menus/:source/photo", roles: LEADS, handler: photo },
    { method: "POST", path: "/menus/:source/checked", roles: LEADS, handler: checked },
    { method: "POST", path: "/menus/dish/:dish", roles: LEADS, handler: dish },
  ],
};
