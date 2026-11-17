// Food places (session LV1; docs/DECISIONS.md, "Listings before they sign, 17 November 2026"): the Chouf food places that are on the website before they
// sign. A listing is not a merchant and is never orderable. This page is the staff side of the three things a visitor or an owner can do: ask for the
// place (the demand count), claim it (the claims, each a case in the Inbox) and have it removed (the hidden places with their request).
//   Search   every place by name or village, with its demand and claims; a listed place can be hidden by staff, with a reason
//   Hidden   the places hidden at an owner's request (or left up by a limit), with who asked, why and when; restore with a reason, or close the request
//   Claims   who sent "Claim <listing_id>" on the customer line, their number (staff only; we never message a listed number), and the case
// Only an ops lead or an admin can act (restore_listing, hide_listing, keep_listing_hidden check the role again; every restore is logged, 0224).
// Functional, on the DS2 components. The console writes nothing itself: it calls those functions as the signed-in person.
import { act, html, render, text, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, dataTable, empty, tabs } from "@ak/ui/components";

type Row = { listing_id: string; name: string; kind: string; village: string | null; km_from_hub: number | string; maps_url: string; hidden_at: string | null;
  wants: number; claims: number; open_requests: number;
  request: { id: string; who: string; reason: string | null; status: string; hidden: boolean; requested_at: string; closed_note: string | null } | null };
type Claim = { id: string; listing_id: string; name: string; village: string | null; party_id: string; phone: string | null; case_id: string | null; state: string; created_at: string };

const KIND: Record<string, [string, string]> = { restaurant: ["Restaurant", "مطعم"], cafe: ["Café", "مقهى"], bakery: ["Bakery", "مخبز"], sweets: ["Sweets", "حلويات"],
  catering: ["Catering", "تموين وضيافة"], butcher: ["Butcher", "ملحمة"] };
const kindName = (k: string, L: Lang) => (KIND[k] ? pick(L, KIND[k]![0], KIND[k]![1]) : k.charAt(0).toUpperCase() + k.slice(1));
const WHO: Record<string, [string, string]> = { owner: ["the owner", "صاحب المكان"], manager: ["a manager", "مدير"], staff: ["staff", "موظف"], other: ["someone else", "شخص آخر"] };
const whoName = (w: string, L: Lang) => (WHO[w] ? pick(L, WHO[w]![0], WHO[w]![1]) : w);
const LISTING = /^[^\s]{1,120}$/;
const listingOf = (c: Ctx) => { const v = text(c, "listing", 120); if (!LISTING.test(v)) throw new UserError(pick(c.lang, "That place is not valid.", "هذا المكان غير صالح.")); return v; };
const reasonOf = (c: Ctx, field = "reason") => { const v = text(c, field, 500); if (v.length < 3) throw new UserError(pick(c.lang, "Write the reason (at least 3 characters).", "اكتب السبب (٣ أحرف على الأقل).")); return v; };

const km = (n: number | string) => Number(n).toFixed(1);
const place = (r: Row, L: Lang) => html`<strong>${r.name}</strong><br><small class="muted"><bdi>${r.listing_id}</bdi> · <a href="${r.maps_url}" rel="noopener">${pick(L, "map", "الخريطة")}</a></small>`;
const status = (r: Row, L: Lang) => (r.hidden_at ? badge(pick(L, "Hidden", "مخفي"), "warn") : badge(pick(L, "Listed", "ظاهر"), "ok"));

async function page(c: Ctx) {
  const L = c.lang; const { db } = c.deps;
  const tab = ["hidden", "claims"].includes(c.url.searchParams.get("tab") ?? "") ? c.url.searchParams.get("tab")! : "search";
  const q = (c.url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const [review, claims, found] = await Promise.all([
    db.rpc<Row[]>("listings_console", { p_q: "", p_state: "review", p_limit: 200 }),
    db.rpc<Claim[]>("listing_claims_console", { p_limit: 100 }),
    tab === "search" ? db.rpc<Row[]>("listings_console", { p_q: q, p_state: "all", p_limit: 50 }) : Promise.resolve([] as Row[]),
  ]);
  const waiting = review.filter((r) => r.open_requests > 0).length;
  const openClaims = claims.filter((x) => x.state !== "resolved").length;
  const nav = tabs([
    { label: pick(L, "Search", "بحث"), href: "/listings", current: tab === "search" },
    { label: pick(L, "Hidden and requests", "المخفي والطلبات"), href: "/listings?tab=hidden", current: tab === "hidden", count: waiting },
    { label: pick(L, "Claims", "المطالبات"), href: "/listings?tab=claims", current: tab === "claims", count: openClaims },
  ], pick(L, "Food places", "أماكن الطعام"));
  const intro = html`<p class="muted">${pick(L,
    "Chouf food places listed on the website before they sign. A listing is not a merchant: nothing can be ordered from it. A visitor can say they want it, an owner can claim it or have it removed.",
    "أماكن طعام في الشوف مدرجة على الموقع قبل أن توقّع. الإدراج ليس تاجرًا: لا يمكن الطلب منه. يستطيع الزائر أن يقول إنه يريده، ويستطيع صاحب المكان المطالبة به أو إزالته.")}</p>`;

  let body;
  if (tab === "claims") {
    body = dataTable({ caption: pick(L, "Claims", "المطالبات"),
      columns: [{ label: pick(L, "When", "متى") }, { label: pick(L, "Place", "المكان") }, { label: pick(L, "Sent from", "أُرسلت من") }, { label: pick(L, "Case", "الحالة") }],
      rows: claims.map((x) => ({ cells: [when(x.created_at), html`<strong>${x.name}</strong><br><small class="muted"><bdi>${x.listing_id}</bdi>${x.village ? ` · ${x.village}` : ""}</small>`,
        html`<bdi>${x.phone ?? pick(L, "no number", "بلا رقم")}</bdi>`,
        x.case_id ? html`<a href="/inbox/${x.case_id}">${x.state === "resolved" ? pick(L, "resolved", "مُغلقة") : pick(L, "open: Inbox", "مفتوحة: الوارد")}</a>` : ""] })),
      empty: empty({ title: pick(L, "No claims yet.", "لا مطالبات بعد."), text: pick(L, "An owner's claim arrives as \"Claim <place>\" on the customer line and opens a case in the Inbox.", "تصل مطالبة صاحب المكان كرسالة \"Claim <المكان>\" على خط الزبائن وتفتح حالة في الوارد."), icon: "inbox", ok: true }) });
  } else if (tab === "hidden") {
    body = dataTable({ caption: pick(L, "Hidden places and removal requests", "الأماكن المخفية وطلبات الإزالة"),
      columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Request", "الطلب"), wrap: true }, { label: pick(L, "Wants", "الطالبون"), num: true }, { label: pick(L, "Decide", "القرار"), wrap: true }],
      rows: review.map((r) => ({ cells: [html`${place(r, L)}<br>${status(r, L)}`,
        r.request ? html`${whoName(r.request.who, L)} · ${when(r.request.requested_at)}${r.request.status === "closed" ? html` · ${pick(L, "closed", "مغلق")}` : ""}<br>${r.request.reason ? html`“${r.request.reason}”` : html`<span class="muted">${pick(L, "no reason given", "بلا سبب")}</span>`}${r.request.hidden ? "" : html`<br><small class="warn">${pick(L, "Over a limit: the page was left up for you to decide.", "تجاوز الحد: تُركت الصفحة ظاهرة لتقرّر أنت.")}</small>`}` : html`<span class="muted">${pick(L, "hidden by staff", "أخفاها موظف")}</span>`,
        r.wants,
        html`${r.hidden_at ? form(c.f, "/listings/restore", html`<input type="hidden" name="listing" value="${r.listing_id}"><label class="ak-field"><span>${pick(L, "Reason to restore", "سبب الإعادة")}</span><input class="ak-input" name="reason" maxlength="500" required></label> <button class="ak-btn ak-btn--primary">${pick(L, "Restore the page", "أعد الصفحة")}</button>`)
          : form(c.f, "/listings/hide", html`<input type="hidden" name="listing" value="${r.listing_id}"><label class="ak-field"><span>${pick(L, "Reason to hide", "سبب الإخفاء")}</span><input class="ak-input" name="reason" maxlength="500" required></label> <button class="ak-btn ak-btn--primary">${pick(L, "Hide the page", "أخفِ الصفحة")}</button>`)}
${r.open_requests > 0 && r.request ? form(c.f, "/listings/keep", html`<input type="hidden" name="request" value="${r.request.id}"><label class="ak-field"><span>${pick(L, "Note", "ملاحظة")}</span><input class="ak-input" name="note" maxlength="500" required></label> <button class="ak-btn ak-btn--soft">${r.hidden_at ? pick(L, "Close: keep it hidden", "أغلق: أبقها مخفية") : pick(L, "Close: leave it up", "أغلق: أبقها ظاهرة")}</button>`) : ""}`] })),
      empty: empty({ title: pick(L, "Nothing hidden and no request waiting.", "لا شيء مخفي ولا طلب بانتظار."), icon: "check", ok: true }) });
  } else {
    body = html`<form method="get" action="/listings" class="ak-search"><input class="ak-input" type="search" name="q" value="${q}" placeholder="${pick(L, "Name or village", "الاسم أو القرية")}" aria-label="${pick(L, "Search places", "ابحث عن الأماكن")}" maxlength="80"> <button class="ak-btn ak-btn--primary">${pick(L, "Search", "بحث")}</button></form>
${dataTable({ caption: pick(L, "Places", "الأماكن"),
      columns: [{ label: pick(L, "Place", "المكان") }, { label: pick(L, "Kind", "النوع") }, { label: pick(L, "Village", "القرية") }, { label: pick(L, "km", "كم"), num: true }, { label: pick(L, "Wants", "الطالبون"), num: true },
        { label: pick(L, "Claims", "المطالبات"), num: true }, { label: pick(L, "Status", "الحالة") }, { label: pick(L, "Hide", "إخفاء"), wrap: true }],
      rows: found.map((r) => ({ cells: [place(r, L), kindName(r.kind, L), r.village ?? pick(L, "not listed", "غير مذكورة"), km(r.km_from_hub), r.wants, r.claims, status(r, L),
        r.hidden_at ? html`<a href="/listings?tab=hidden">${pick(L, "see Hidden", "انظر المخفي")}</a>`
          : form(c.f, "/listings/hide", html`<input type="hidden" name="listing" value="${r.listing_id}"><input class="ak-input" name="reason" maxlength="500" placeholder="${pick(L, "Reason", "السبب")}" aria-label="${pick(L, "Reason to hide", "سبب الإخفاء")}" required> <button class="ak-btn ak-btn--soft">${pick(L, "Hide", "أخفِ")}</button>`)] })),
      empty: empty({ title: pick(L, "No places match this.", "لا أماكن تطابق هذا."), icon: "search" }) })}
${found.length >= 50 ? html`<p class="muted">${pick(L, "The first 50 are shown: search by name or village to narrow it.", "تُعرض أول ٥٠: ابحث بالاسم أو القرية لتضييق النتائج.")}</p>` : ""}`;
  }
  return render(c, pick(L, "Food places", "أماكن الطعام"), html`<h1>${pick(L, "Food places", "أماكن الطعام")}</h1>${intro}${nav}${body}`, { translated: true });
}

async function restore(c: Ctx) {
  const listing = listingOf(c); const reason = reasonOf(c); const L = c.lang;
  return act(c, "listing_restore", { listing }, async () => {
    await c.deps.db.rpc("restore_listing", { p_listing: listing, p_by: c.staff.partyId, p_reason: reason });
    return pick(L, "Restored: the page is back, and the request is closed.", "أُعيدت الصفحة وأُغلق الطلب.");
  }, "/listings?tab=hidden");
}
async function hide(c: Ctx) {
  const listing = listingOf(c); const reason = reasonOf(c); const L = c.lang;
  return act(c, "listing_hide", { listing }, async () => {
    await c.deps.db.rpc("hide_listing", { p_listing: listing, p_by: c.staff.partyId, p_reason: reason });
    return pick(L, "Hidden: the page is gone from the website.", "أُخفيت الصفحة من الموقع.");
  }, "/listings?tab=hidden");
}
async function keep(c: Ctx) {
  const request = text(c, "request", 60); const note = reasonOf(c, "note"); const L = c.lang;
  if (!/^[0-9a-f-]{36}$/i.test(request)) throw new UserError(pick(L, "That request is not valid.", "هذا الطلب غير صالح."));
  return act(c, "listing_keep", { request }, async () => {
    const r = await c.deps.db.rpc<{ hidden: boolean }>("keep_listing_hidden", { p_request: request, p_by: c.staff.partyId, p_note: note });
    return r.hidden ? pick(L, "Kept hidden. The request is closed.", "أُبقيت مخفية وأُغلق الطلب.") : pick(L, "The request is closed and the page stays up.", "أُغلق الطلب وتبقى الصفحة ظاهرة.");
  }, "/listings?tab=hidden");
}

export const listingsSection: Section = {
  nav: { href: "/listings", label: "Food places", roles: LEADS },
  routes: [
    { method: "GET", path: "/listings", roles: LEADS, handler: page },
    { method: "POST", path: "/listings/restore", roles: LEADS, handler: restore },
    { method: "POST", path: "/listings/hide", roles: LEADS, handler: hide },
    { method: "POST", path: "/listings/keep", roles: LEADS, handler: keep },
  ],
};
