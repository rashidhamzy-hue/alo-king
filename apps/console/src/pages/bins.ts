// WH1a: bins, each item's shelf place (docs/strategy/02-journeys.md, section 4, "Shelf locations"; migration 0238). An ops lead makes the
// bins (a short code written on the shelf, its zone, its place in the walk); anyone who picks puts an item in a bin of its own zone (the
// database refuses another zone) or moves it, which is how "an item in the wrong bin" is put right at a count. The pick list walks the
// zones in UX2a's order (ambient, fresh, chilled, frozen) and, in each, the bins in their walk order; this page shows them in that order.
import { can, form, html, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { pick } from "../i18n";
import { ALL, LEADS } from "../roles";
import { badge, button, empty, input, select } from "@ak/ui/components";
import { doAct, hubId, ZONES, zoneWord } from "./warehouse";

type Bin = { bin_id: string; code: string; zone: string; walk_order: number; items: { product_id: string; sku: string | null; name_en: string; name_ar: string }[] };
type Overview = { bins: Bin[]; unplaced: Record<string, number> };

async function page(c: Ctx) {
  const L = c.lang;
  const src = await hubId(c);
  const ov = await c.deps.db.rpc<Overview>("bins_overview", { p_source: src });
  const leads = can(c, LEADS);
  const binOptions = ov.bins.map((b) => ({ value: b.bin_id, label: `${b.code} · ${zoneWord(L, b.zone)}` }));
  const byZone = ZONES.map((z) => ({ z, bins: ov.bins.filter((b) => b.zone === z), unplaced: Number(ov.unplaced[z] ?? 0) })).filter((x) => x.bins.length || x.unplaced);
  const binCard = (b: Bin) => html`<li><div class="head"><strong><bdi>${b.code}</bdi></strong><span class="tags">${badge(pick(L, `walk ${b.walk_order}`, `الترتيب ${b.walk_order}`), "neutral")}</span></div>
${b.items.length ? html`<p class="muted">${b.items.map((i) => (L === "ar" ? i.name_ar : i.name_en)).join(" · ")}</p>` : html`<p class="muted">${pick(L, "Empty.", "فارغ.")}</p>`}</li>`;
  return render(c, pick(L, "Bins", "الرفوف"), html`
<p class="muted">${pick(L, "Each item has one shelf place, in its own zone. The pick list walks ambient, fresh, chilled, then frozen, and in each zone the bins in their walk order.", "لكل صنف مكان واحد على الرف في منطقته. قائمة التجهيز تمشي: عادي، طازج، مبرّد، ثم مجمّد، وفي كل منطقة الرفوف بترتيب المشي.")}</p>
${ov.bins.length ? html`<h2>${pick(L, "Put an item in a bin", "ضع صنفاً في رف")}</h2>
${form(c.f, "/bins/place", html`<div class="ak-money-fields">${input({ name: "code", label: pick(L, "Item SKU or barcode", "رمز الصنف أو الباركود"), required: true, maxlength: 40 })}
${select({ name: "bin", label: pick(L, "Bin", "الرف"), options: binOptions })}</div>
<div class="actions-row">${button({ label: pick(L, "Save the place", "احفظ المكان"), icon: "check", variant: "primary" })}</div>`)}` : ""}
${byZone.length ? byZone.map((x) => html`<h2>${zoneWord(L, x.z)} (${x.bins.length})</h2>${x.bins.length ? html`<ul class="ak-rows">${x.bins.map(binCard)}</ul>` : ""}
${x.unplaced ? html`<p class="muted">${pick(L, `${x.unplaced} item(s) of this zone have no bin yet: they come at the end of the zone on the pick list.`, `${x.unplaced} صنف من هذه المنطقة بلا رف بعد: تأتي في آخر المنطقة في قائمة التجهيز.`)}</p>` : ""}`)
    : empty({ title: pick(L, "No bins yet.", "لا رفوف بعد."), text: leads ? pick(L, "Make the first one below.", "أنشئ الأول أدناه.") : pick(L, "An ops lead makes them.", "ينشئها مسؤول العمليات."), icon: "stock" })}
${leads ? html`<details class="ak-more"${ov.bins.length ? "" : html` open`}><summary>${pick(L, "New bin", "رف جديد")}</summary>${form(c.f, "/bins", html`<div class="ak-money-fields">
${input({ name: "code", label: pick(L, "Code on the shelf (A1, C-02)", "الرمز على الرف (A1، C-02)"), required: true, maxlength: 12 })}
${select({ name: "zone", label: pick(L, "Zone", "المنطقة"), options: ZONES.map((z) => ({ value: z, label: zoneWord(L, z) })) })}
${input({ name: "walk_order", label: pick(L, "Place in the walk (optional: after the last)", "ترتيبه في المشي (اختياري: بعد الأخير)"), type: "number", attrs: { min: "1", step: "1", inputmode: "numeric" } })}</div>
<div class="actions-row">${button({ label: pick(L, "Make the bin", "أنشئ الرف"), icon: "plus" })}</div>`)}</details>` : ""}`, { translated: true });
}

async function create(c: Ctx) {
  const L = c.lang;
  const code = text(c, "code", 12).toUpperCase();
  const zone = c.form.zone ?? "";
  if (!(ZONES as readonly string[]).includes(zone)) throw new UserError(pick(L, "Choose the zone.", "اختر المنطقة."));
  const w = (c.form.walk_order ?? "").trim();
  const walk = w === "" ? null : Number(w);
  if (walk !== null && (!Number.isInteger(walk) || walk < 1)) throw new UserError(pick(L, "The place in the walk is a whole number from 1.", "الترتيب رقم صحيح من 1."));
  const src = await hubId(c);
  return doAct(c, "bin_create", { code, zone, walk }, "/bins", async () => {
    await c.deps.db.rpc("create_bin", { p_source: src, p_code: code, p_zone: zone, p_by: c.staff.partyId, p_walk_order: walk });
    return { msg: pick(L, `Bin ${code} made (${zoneWord("en", zone).toLowerCase()}).`, `أُنشئ الرف ${code} (${zoneWord("ar", zone)}).`) };
  });
}

async function place(c: Ctx) {
  const L = c.lang;
  const code = text(c, "code", 40);
  const bin = (c.form.bin ?? "").trim();
  if (!code) throw new UserError(pick(L, "Type the item's SKU or barcode.", "اكتب رمز الصنف أو الباركود."));
  if (!UUID.test(bin)) throw new UserError(pick(L, "Choose the bin.", "اختر الرف."));
  const p = (await c.deps.db.rows<{ id: string; name_en: string; name_ar: string | null }>("products", { select: "id,name_en,name_ar", where: { sku: code }, limit: 1 }))[0]
    ?? (await c.deps.db.rows<{ id: string; name_en: string; name_ar: string | null }>("products", { select: "id,name_en,name_ar", where: { barcode: code }, limit: 1 }))[0];
  if (!p) throw new UserError(pick(L, `No item with SKU or barcode ${code}.`, `لا صنف بالرمز أو الباركود ${code}.`));
  const src = await hubId(c);
  const binCode = (await c.deps.db.rows<{ code: string }>("bins", { select: "code", where: { id: bin }, limit: 1 }))[0]?.code ?? "";
  return doAct(c, "bin_place", { product: p.id, bin }, "/bins", async () => {
    await c.deps.db.rpc("set_product_bin", { p_source: src, p_product: p.id, p_bin: bin, p_by: c.staff.partyId });
    return { msg: pick(L, `${p.name_en} is now in bin ${binCode}.`, `${p.name_ar || p.name_en} الآن في الرف ${binCode}.`) };
  });
}

export const binsSection: Section = {
  nav: { href: "/bins", label: "Bins", roles: ALL },
  routes: [
    { method: "GET", path: "/bins", roles: ALL, handler: page },
    { method: "POST", path: "/bins", roles: LEADS, handler: create },
    { method: "POST", path: "/bins/place", roles: ALL, handler: place },
  ],
};
