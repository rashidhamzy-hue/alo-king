// FD1: Places (the friends' test food; docs/DECISIONS.md, "Founder decisions, 18 November 2026" 3, and "FD1, 18 November 2026").
// A place is a restaurant Alo King buys from for the customer: a rider orders and pays at the counter, or staff call the order in; the
// restaurant does nothing new. Staff make it from an LV1 listing and set what the database keeps about it:
//   Places    every place: village, its public phone (shown here only; nothing ever sends to it), hours, preparation time, visibility,
//             the menu's state and its approval. One place opens on its own page to change any of these.
//   New       find the listing by name or village, then the village, phone, hours and preparation time. A new place is off and closed.
//   Testers   the customer numbers that see and order from a "testers only" place (settings.testers).
// Visibility: off, testers only, public. Public is refused by the database unless the owner's claim or application is on file (0245).
// Approving runs approve_merchant() (invariant 11): it needs approved dishes and the "menu checked" stamp (the Menus page); the place is then
// orderable for its visibility only. The console writes nothing itself: every change is a SQL function called as the signed-in person.
// Functional, on the DS2 components.
import { act, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, dataTable, empty, tabs } from "@ak/ui/components";

type Place = { source_id: string; listing_id: string; name: string; village_id: string | null; village_en: string | null; village_ar: string | null;
  phone: string | null; hours: { open?: string; close?: string; days_off?: string[] } | null; prep_minutes: number; visibility: "off" | "testers" | "public";
  is_open: boolean; approved: boolean; approved_at: string | null; owner_on_file: boolean; maps_url: string | null; listing_name: string | null;
  listing_village: string | null; menu_checked_on: string | null; photos_waiting: number; dishes_waiting: number; dishes: number;
  /** FD2 (0249): the other names customers use for the place («صفا», "safa"), for the chat to find it; never shown as its name. */
  aliases?: string[] };
type Listing = { listing_id: string; name: string; kind: string; village: string | null; km_from_hub: number | string; maps_url: string; hidden_at: string | null };
type Village = { id: string; name_en: string; name_ar: string | null; aliases: string[] | null; is_served: boolean };

const DAYS: [string, string, string][] = [["mon", "Mon", "الاثنين"], ["tue", "Tue", "الثلاثاء"], ["wed", "Wed", "الأربعاء"], ["thu", "Thu", "الخميس"],
  ["fri", "Fri", "الجمعة"], ["sat", "Sat", "السبت"], ["sun", "Sun", "الأحد"]];
const VIS: Record<Place["visibility"], [string, string, "neutral" | "warn" | "ok"]> = {
  off: ["Off", "متوقف", "neutral"], testers: ["Testers only", "للمختبرين فقط", "warn"], public: ["Public", "للجميع", "ok"] };
const visBadge = (v: Place["visibility"], L: Lang) => badge(pick(L, VIS[v][0], VIS[v][1]), VIS[v][2]);
const village = (p: Pick<Place, "village_en" | "village_ar">, L: Lang) => (L === "ar" ? p.village_ar ?? p.village_en : p.village_en) ?? pick(L, "no village", "بلا قرية");
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** The place's state in a few words: what it waits for. */
function state(p: Place, L: Lang) {
  if (p.approved) return p.visibility === "off" ? badge(pick(L, "Approved, off", "موافق عليه، متوقف"), "neutral") : badge(pick(L, "Orderable", "يمكن الطلب منه"), "ok");
  if (p.photos_waiting) return badge(pick(L, `${p.photos_waiting} photo(s) wait for the reading`, `${p.photos_waiting} صورة بانتظار القراءة`), "warn");
  if (p.dishes_waiting) return badge(pick(L, `${p.dishes_waiting} dish(es) to check`, `${p.dishes_waiting} طبق للمراجعة`), "warn");
  if (!p.dishes) return badge(pick(L, "No menu yet", "لا قائمة بعد"), "neutral");
  if (!p.menu_checked_on) return badge(pick(L, "Menu not stamped", "القائمة غير مختومة"), "warn");
  return badge(pick(L, "Ready to approve", "جاهز للموافقة"), "warn");
}

function hoursFields(L: Lang, h: Place["hours"] | null, prep: number) {
  const off = new Set(h?.days_off ?? []);
  return html`<label class="ak-field"><span>${pick(L, "Opens", "يفتح")}</span><input class="ak-input" type="time" name="open" value="${h?.open ?? ""}"></label>
<label class="ak-field"><span>${pick(L, "Closes", "يغلق")}</span><input class="ak-input" type="time" name="close" value="${h?.close ?? ""}"></label>
<fieldset class="ak-field"><legend>${pick(L, "Days off", "أيام العطلة")}</legend>${DAYS.map(([k, en, ar]) => html`<label class="ak-check"><input type="checkbox" name="off_${k}" value="1"${off.has(k) ? html` checked` : ""}> ${pick(L, en, ar)}</label> `)}</fieldset>
<label class="ak-field"><span>${pick(L, "Preparation time (minutes)", "وقت التحضير (دقائق)")}</span><input class="ak-input" type="number" name="prep_minutes" min="0" max="180" value="${prep}" required></label>`;
}
function villageSelect(L: Lang, villages: Village[], chosen: string | null) {
  return html`<label class="ak-field"><span>${pick(L, "Village", "القرية")}</span><select class="ak-input" name="village_id" required><option value="">${pick(L, "Choose", "اختر")}</option>
${villages.map((v) => html`<option value="${v.id}"${v.id === chosen ? html` selected` : ""}>${L === "ar" ? v.name_ar ?? v.name_en : v.name_en}${v.is_served ? "" : pick(L, " (not served)", " (خارج الخدمة)")}</option>`)}</select></label>`;
}
/** The village a listing names, if the villages list knows it (by name or alias, folded); staff confirm it. */
function guessVillage(villages: Village[], name: string | null): string | null {
  if (!name) return null;
  const f = fold(name);
  return villages.find((v) => fold(v.name_en) === f || (v.aliases ?? []).some((a) => fold(a) === f))?.id
    ?? villages.find((v) => { const a = fold(v.name_en); return a.length > 4 && f.length > 4 && a.slice(-4) === f.slice(-4) && a[0] === f[0]; })?.id ?? null;
}
function hoursFrom(c: Ctx, L: Lang) {
  const open = text(c, "open", 5), close = text(c, "close", 5);
  if ((open && !TIME.test(open)) || (close && !TIME.test(close))) throw new UserError(pick(L, "Opening and closing are times like 11:00.", "الفتح والإغلاق أوقات مثل 11:00."));
  const h: Record<string, unknown> = {};
  if (open) h.open = open; if (close) h.close = close;
  const off = DAYS.map(([k]) => k).filter((k) => c.form[`off_${k}`] === "1");
  if (off.length) h.days_off = off;
  return h;
}

async function page(c: Ctx) {
  const L = c.lang; const { db } = c.deps;
  const tab = ["new", "testers"].includes(c.url.searchParams.get("tab") ?? "") ? c.url.searchParams.get("tab")! : "places";
  const places = (await db.rpc<Place[]>("places_console", {})) ?? [];
  const testers = ((await db.rows<{ value: { numbers?: string[] } }>("settings", { select: "value", where: { key: "testers" } }))[0]?.value?.numbers) ?? [];
  const nav = tabs([
    { label: pick(L, "Places", "الأماكن"), href: "/places", current: tab === "places", count: places.length },
    { label: pick(L, "New place", "مكان جديد"), href: "/places?tab=new", current: tab === "new" },
    { label: pick(L, "Testers", "المختبرون"), href: "/places?tab=testers", current: tab === "testers", count: testers.length },
  ], pick(L, "Places", "الأماكن"));
  const intro = html`<p class="muted">${pick(L,
    "Restaurants for the friends' test. Alo King buys for the customer: a rider orders and pays at the counter, or we call the order in. The restaurant does nothing new. A place is orderable only once approved, and only by those its visibility allows; public needs the owner's claim or application on file. We never message a place's number.",
    "مطاعم تجربة الأصدقاء. ألو كينغ يشتري عن الزبون: المندوب يطلب ويدفع على الصندوق، أو نتصل بالطلب. لا يفعل المطعم شيئاً جديداً. لا يمكن الطلب من مكان إلا بعد الموافقة عليه، ولمن تسمح لهم الرؤية فقط؛ وللجميع يتطلّب مطالبة صاحبه أو طلبه. لا نراسل رقم أي مكان أبداً.")}</p>`;
  let body;
  if (tab === "testers") {
    body = html`<p>${pick(L, "Customers whose WhatsApp number is here see and order from places that are \"testers only\".", "الزبائن الذين رقم واتساب الخاص بهم هنا يرون الأماكن \"للمختبرين فقط\" ويطلبون منها.")}</p>
${dataTable({ caption: pick(L, "Testers", "المختبرون"), columns: [{ label: pick(L, "Number", "الرقم") }, { label: pick(L, "Remove", "إزالة") }],
      rows: testers.map((n) => ({ cells: [html`<bdi>${n}</bdi>`, form(c.f, "/places/testers", html`<input type="hidden" name="phone" value="${n}"><input type="hidden" name="on" value="0"><button class="ak-btn ak-btn--soft">${pick(L, "Remove", "أزل")}</button>`)] })),
      empty: empty({ title: pick(L, "No tester yet.", "لا مختبرين بعد."), icon: "users" }) })}
${form(c.f, "/places/testers", html`<input type="hidden" name="on" value="1"><label class="ak-field"><span>${pick(L, "A customer's WhatsApp number, in full (+961...)", "رقم واتساب الزبون كاملاً (+961...)")}</span><input class="ak-input" name="phone" inputmode="tel" maxlength="16" required></label> <button class="ak-btn ak-btn--primary">${pick(L, "Add the tester", "أضف المختبر")}</button>`)}`;
  } else if (tab === "new") {
    const q = (c.url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const chosen = (c.url.searchParams.get("listing") ?? "").trim().slice(0, 120);
    const villages = await db.rows<Village>("villages", { select: "id,name_en,name_ar,aliases,is_served", order: [{ col: "name_en" }], limit: 300 });
    const found = q ? ((await db.rpc<Listing[]>("listings_console", { p_q: q, p_state: "all", p_limit: 20 })) ?? []).filter((l) => !l.hidden_at) : [];
    const made = new Set(places.map((p) => p.listing_id));
    const pickOne = chosen ? ((await db.rpc<Listing[]>("listings_console", { p_q: chosen, p_state: "all", p_limit: 20 })) ?? []).find((l) => l.listing_id === chosen) : undefined;
    body = html`<form method="get" action="/places" class="ak-search"><input type="hidden" name="tab" value="new"><input class="ak-input" type="search" name="q" value="${q}" placeholder="${pick(L, "Listing name or village", "اسم الإدراج أو القرية")}" aria-label="${pick(L, "Find the listing", "ابحث عن الإدراج")}" maxlength="80"> <button class="ak-btn ak-btn--primary">${pick(L, "Find", "ابحث")}</button></form>
${q ? dataTable({ caption: pick(L, "Listings", "الإدراجات"), columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Village", "القرية") }, { label: "" }],
      rows: found.map((l) => ({ cells: [html`<strong>${l.name}</strong><br><small class="muted"><bdi>${l.listing_id}</bdi> · <a href="${l.maps_url}" rel="noopener">${pick(L, "map", "الخريطة")}</a></small>`, l.village ?? "",
        made.has(l.listing_id) ? html`<span class="muted">${pick(L, "already a place", "مكان من قبل")}</span>` : html`<a class="ak-btn" href="/places?tab=new&listing=${encodeURIComponent(l.listing_id)}">${pick(L, "Make a place", "اصنع مكاناً")}</a>`] })),
      empty: empty({ title: pick(L, "No listing matches.", "لا إدراج يطابق."), icon: "search" }) }) : ""}
${pickOne ? html`<h2>${pickOne.name}</h2>${form(c.f, "/places/new", html`<input type="hidden" name="listing" value="${pickOne.listing_id}">
<label class="ak-field"><span>${pick(L, "Name", "الاسم")}</span><input class="ak-input" name="name" value="${pickOne.name}" maxlength="120" required></label>
${villageSelect(L, villages, guessVillage(villages, pickOne.village))}
<label class="ak-field"><span>${pick(L, "The place's public phone (shown here only)", "هاتف المكان العام (يظهر هنا فقط)")}</span><input class="ak-input" name="phone" inputmode="tel" maxlength="16" placeholder="+961"></label>
${hoursFields(L, null, 20)}
<p class="muted">${pick(L, "A new place is off: nobody sees it until you set its visibility and approve it.", "المكان الجديد متوقف: لا يراه أحد حتى تضبط رؤيته وتوافق عليه.")}</p>
<button class="ak-btn ak-btn--primary">${pick(L, "Make the place", "اصنع المكان")}</button>`)}` : ""}`;
  } else {
    body = dataTable({ caption: pick(L, "Places", "الأماكن"),
      columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Village", "القرية") }, { label: pick(L, "Phone", "الهاتف") }, { label: pick(L, "Visibility", "الرؤية") },
        { label: pick(L, "Dishes", "الأطباق"), num: true }, { label: pick(L, "Menu checked", "فُحصت القائمة") }, { label: pick(L, "State", "الحالة") }],
      rows: places.map((p) => ({ cells: [html`<a href="/places/${p.source_id}"><strong>${p.name}</strong></a><br><small class="muted"><bdi>${p.listing_id}</bdi></small>`, village(p, L),
        p.phone ? html`<bdi>${p.phone}</bdi>` : html`<span class="muted">${pick(L, "none", "لا يوجد")}</span>`, visBadge(p.visibility, L), p.dishes,
        p.menu_checked_on ? when(p.menu_checked_on) : html`<a href="/menus/${p.source_id}">${pick(L, "not yet", "ليس بعد")}</a>`, state(p, L)] })),
      empty: empty({ title: pick(L, "No place yet.", "لا مكان بعد."), text: pick(L, "Make one from its listing: New place.", "اصنع واحداً من إدراجه: مكان جديد."), icon: "store" }) });
  }
  return render(c, pick(L, "Places", "الأماكن"), html`<h1>${pick(L, "Places", "الأماكن")}</h1>${intro}${nav}${body}`, { translated: true });
}

async function one(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const places = (await c.deps.db.rpc<Place[]>("places_console", {})) ?? [];
  const p = places.find((x) => x.source_id === src);
  if (!p) return render(c, pick(L, "Places", "الأماكن"), html`<p class="flash err">${pick(L, "That place was not found.", "لم يُعثر على هذا المكان.")}</p>`, { translated: true });
  const villages = await c.deps.db.rows<Village>("villages", { select: "id,name_en,name_ar,aliases,is_served", order: [{ col: "name_en" }], limit: 300 });
  const visForm = form(c.f, `/places/${src}/visibility`, html`<fieldset class="ak-field"><legend>${pick(L, "Who sees and orders from it", "من يراه ويطلب منه")}</legend>
${(["off", "testers", "public"] as const).map((v) => html`<label class="ak-check"><input type="radio" name="visibility" value="${v}"${p.visibility === v ? html` checked` : ""}> ${pick(L, VIS[v][0], VIS[v][1])}</label> `)}</fieldset>
<p class="muted">${p.owner_on_file ? pick(L, "The owner's claim or application is on file: public is allowed.", "مطالبة صاحب المكان أو طلبه موجودة: يُسمح بالعرض للجميع.")
    : pick(L, "No claim or application from the owner yet: public is refused until there is one.", "لا مطالبة ولا طلب من صاحب المكان بعد: يُرفض العرض للجميع حتى يوجد أحدهما.")}</p>
<label class="ak-field"><span>${pick(L, "Reason", "السبب")}</span><input class="ak-input" name="reason" maxlength="500" required></label> <button class="ak-btn ak-btn--primary">${pick(L, "Set the visibility", "اضبط الرؤية")}</button>`);
  const approve = p.approved ? html`<p>${badge(pick(L, "Approved", "موافق عليه"), "ok")} ${p.approved_at ? when(p.approved_at) : ""}. ${pick(L, "Orderable for its visibility only.", "يمكن الطلب منه حسب رؤيته فقط.")}</p>`
    : html`<p class="muted">${pick(L, "Approving needs approved dishes and the \"menu checked\" stamp. No commission and no terms: Alo King buys at the counter.", "الموافقة تحتاج أطباقاً موافقاً عليها وختم \"فُحصت القائمة\". لا عمولة ولا شروط: ألو كينغ يشتري على الصندوق.")}</p>
${form(c.f, `/places/${src}/approve`, html`<button class="ak-btn ak-btn--primary">${pick(L, "Approve the place", "وافق على المكان")}</button>`)}`;
  return render(c, p.name, html`<p><a href="/places">${pick(L, "All places", "كل الأماكن")}</a></p><h1>${p.name}</h1>
<p>${visBadge(p.visibility, L)} ${state(p, L)} · <bdi>${p.listing_id}</bdi>${p.maps_url ? html` · <a href="${p.maps_url}" rel="noopener">${pick(L, "map", "الخريطة")}</a>` : ""} · <a href="/menus/${src}">${pick(L, "Menu", "القائمة")} (${p.dishes})</a></p>
<h2>${pick(L, "Visibility", "الرؤية")}</h2>${visForm}
<h2>${pick(L, "Approval", "الموافقة")}</h2>${approve}
<h2>${pick(L, "Details", "التفاصيل")}</h2>${form(c.f, `/places/${src}/details`, html`<label class="ak-field"><span>${pick(L, "Name", "الاسم")}</span><input class="ak-input" name="name" value="${p.name}" maxlength="120" required></label>
${villageSelect(L, villages, p.village_id)}
<label class="ak-field"><span>${pick(L, "The place's public phone (shown here only; empty removes it)", "هاتف المكان العام (يظهر هنا فقط؛ فارغ يحذفه)")}</span><input class="ak-input" name="phone" value="${p.phone ?? ""}" inputmode="tel" maxlength="16"></label>
${hoursFields(L, p.hours, p.prep_minutes)}
<label class="ak-field"><span>${pick(L, "Other names customers use for it, separated by commas (the chat finds the place by these too)", "أسماء أخرى يستعملها الزبائن له، تفصل بينها فواصل (المحادثة تجد المكان بها أيضاً)")}</span><input class="ak-input" name="aliases" value="${(p.aliases ?? []).join(", ")}" maxlength="400"></label>
<button class="ak-btn ak-btn--primary">${pick(L, "Save the details", "احفظ التفاصيل")}</button>`)}`, { translated: true });
}

async function create(c: Ctx) {
  const L = c.lang;
  const listing = text(c, "listing", 120);
  if (!/^[^\s]{1,120}$/.test(listing)) throw new UserError(pick(L, "That listing is not valid.", "هذا الإدراج غير صالح."));
  const village = (c.form.village_id ?? "").trim();
  const details = { name: text(c, "name", 120), village_id: village, phone: text(c, "phone", 16), hours: hoursFrom(c, L), prep_minutes: num(c, "prep_minutes", { min: 0, max: 180 }) };
  let made = "";
  const r = await act(c, "place_create", { listing }, async () => {
    const out = await c.deps.db.rpc<{ source_id: string }>("create_place_from_listing", { p_listing: listing, p_by: c.staff.partyId, p_details: details });
    made = out.source_id;
    return pick(L, "The place is made. It is off: photograph its menu next.", "صُنع المكان. هو متوقف: صوّر قائمته الآن.");
  }, "/places?tab=new");
  if (made) r.headers.set("location", `/places/${made}`);
  return r;
}
async function details(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const d: Record<string, unknown> = { name: text(c, "name", 120), village_id: (c.form.village_id ?? "").trim(), phone: text(c, "phone", 16), hours: hoursFrom(c, L), prep_minutes: num(c, "prep_minutes", { min: 0, max: 180 }) };
  // FD2: the names customers use, when the form has the field (an older page without it changes nothing).
  if ("aliases" in c.form) d.aliases = text(c, "aliases", 400).split(/[,،]/).map((x) => x.trim()).filter(Boolean);
  return act(c, "place_details", { source: src }, async () => {
    await c.deps.db.rpc("set_place_details", { p_source: src, p_by: c.staff.partyId, p_details: d });
    return pick(L, "Saved.", "تم الحفظ.");
  }, `/places/${src}`);
}
async function visibility(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  const v = (c.form.visibility ?? "").trim(); const reason = text(c, "reason", 500);
  if (!["off", "testers", "public"].includes(v)) throw new UserError(pick(L, "Choose off, testers only or public.", "اختر متوقف أو للمختبرين فقط أو للجميع."));
  if (reason.length < 3) throw new UserError(pick(L, "Write the reason (at least 3 characters).", "اكتب السبب (٣ أحرف على الأقل)."));
  return act(c, "place_visibility", { source: src, visibility: v }, async () => {
    await c.deps.db.rpc("set_place_visibility", { p_source: src, p_by: c.staff.partyId, p_visibility: v, p_reason: reason });
    return pick(L, `Visibility: ${VIS[v as Place["visibility"]][0]}.`, `الرؤية: ${VIS[v as Place["visibility"]][1]}.`);
  }, `/places/${src}`);
}
async function approve(c: Ctx) {
  const L = c.lang; const src = id(c, "source");
  return act(c, "place_approve", { source: src }, async () => {
    const r = await c.deps.db.rpc<{ items: number; visibility: string }>("approve_merchant", { p_source: src, p_by: c.staff.partyId, p_commission_pct: null });
    return pick(L, `Approved: ${r.items} dish(es), orderable for its visibility (${r.visibility}).`, `تمت الموافقة: ${r.items} طبق، يمكن الطلب منه حسب رؤيته (${r.visibility}).`);
  }, `/places/${src}`);
}
async function testers(c: Ctx) {
  const L = c.lang; const phone = text(c, "phone", 16).replace(/[\s-]/g, ""); const on = c.form.on === "1";
  return act(c, on ? "tester_add" : "tester_remove", {}, async () => {
    await c.deps.db.rpc("set_tester", { p_by: c.staff.partyId, p_phone: phone, p_on: on });
    return on ? pick(L, "Added.", "أُضيف.") : pick(L, "Removed.", "أُزيل.");
  }, "/places?tab=testers");
}

export const placesSection: Section = {
  nav: { href: "/places", label: "Places", roles: LEADS },
  routes: [
    { method: "GET", path: "/places", roles: LEADS, handler: page },
    { method: "GET", path: "/places/:source", roles: LEADS, handler: one },
    { method: "POST", path: "/places/new", roles: LEADS, handler: create },
    { method: "POST", path: "/places/testers", roles: LEADS, handler: testers },
    { method: "POST", path: "/places/:source/details", roles: LEADS, handler: details },
    { method: "POST", path: "/places/:source/visibility", roles: LEADS, handler: visibility },
    { method: "POST", path: "/places/:source/approve", roles: LEADS, handler: approve },
  ],
};
