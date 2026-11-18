// B1f: "Weights to record on label day". Every hub item whose price is for a pack of a weight nobody has approved yet, and every item with
// an open "price basis to confirm" check (migration 0253, weights_to_record): its aisle, what the pages say the price is for, the price and
// the question. Nothing here guesses a weight: the label day's photos give it (the size, approved on the Approve pages), and the customer
// reads "per pack, weight not confirmed yet" until then. An ops lead or admin answers a check: the price is for the pack, or per kg
// (resolve_price_basis; the price itself is never changed here). A check that blocks the sale (the eggs) keeps the item off sale until then.
import { attempt, flashRedirect, form, html, render, text, UserError, UUID, can, type Ctx, type Section } from "../app";
import { usd } from "../html";
import { pick, type Lang } from "../i18n";
import { ALL, LEADS } from "../roles";
import { badge, button, empty, input, select } from "@ak/ui/components";

type Row = {
  product_id: string; sku: string; name_en: string; name_ar: string | null; sell_unit: string | null;
  aisle_en: string | null; aisle_ar: string | null; price_usd: number | string | null;
  price_for: { per: "kg" | "pack"; about_g: number | null } | null; weight_missing: boolean;
  check: { id: string; question: string; blocks_sale: boolean; opened_at: string } | null;
};

/** What the customer reads the price is for, in the pages' own words (WEB4a 12, catalog_price_for). */
export function priceWording(L: Lang, pf: Row["price_for"]): string {
  if (!pf) return pick(L, "per piece (nothing said)", "بالحبة (لا يُذكر شيء)");
  if (pf.per === "kg") return pick(L, "per kg", "بالكيلو");
  if (pf.about_g) return pick(L, `per pack of about ${pf.about_g} g`, `للعلبة، حوالي ${pf.about_g} غ`);
  return pick(L, "per pack, weight not confirmed yet", "للعلبة، الوزن غير مؤكّد بعد");
}

async function page(c: Ctx) {
  const L = c.lang;
  const rows = (await c.deps.db.rpc<Row[]>("weights_to_record", {})) ?? [];
  const leads = can(c, LEADS);
  const weigh = rows.filter((r) => r.weight_missing).length;
  const asks = rows.filter((r) => r.check).length;
  const blocked = rows.filter((r) => r.check?.blocks_sale).length;
  const card = (r: Row) => html`<li${r.check?.blocks_sale ? html` data-state="late"` : ""}>
<div class="head"><strong><a href="/catalog/${r.product_id}"><bdi>${L === "ar" ? (r.name_ar ?? r.name_en) : r.name_en}</bdi></a></strong>
<span class="tags">${r.weight_missing ? badge(pick(L, "weigh one pack", "زِن علبة"), "warn", "stock") : ""}${r.check ? badge(r.check.blocks_sale ? pick(L, "not sold until answered", "لا يُباع قبل الجواب") : pick(L, "price basis to confirm", "أساس السعر للتأكيد"), r.check.blocks_sale ? "danger" : "warn", "alert") : ""}</span></div>
<p class="muted"><bdi>${r.sku}</bdi> · ${L === "ar" ? (r.aisle_ar ?? r.aisle_en ?? "—") : (r.aisle_en ?? "—")} · ${r.price_usd !== null ? usd(r.price_usd) : "—"} · ${pick(L, "the pages say:", "تقول الصفحات:")} <strong>${priceWording(L, r.price_for)}</strong>${r.sell_unit ? html` · <small>${pick(L, "sell unit", "وحدة البيع")} <bdi>${r.sell_unit}</bdi></small>` : ""}</p>
${r.check ? html`<p>${pick(L, "Question:", "السؤال:")} <bdi>${r.check.question}</bdi></p>
${leads ? html`<details class="ak-more"><summary>${pick(L, "Answer", "أجب")}</summary>${form(c.f, "/weights/answer", html`<input type="hidden" name="check" value="${r.check.id}">
<div class="ak-money-fields">${select({ name: "resolution", label: pick(L, "Our price is", "سعرنا هو"), options: [
  { value: "per_pack", label: pick(L, "for the pack", "للعلبة") }, { value: "per_kg", label: pick(L, "per kg", "للكيلو") }] })}
${input({ name: "note", label: pick(L, "How you know (invoice, scale, tray)", "كيف تعرف (فاتورة، ميزان، كرتونة)"), required: true, maxlength: 200 })}</div>
<div class="actions-row">${button({ label: pick(L, "Save the answer", "احفظ الجواب"), icon: "check" })}</div>`)}</details>` : ""}` : ""}</li>`;
  return render(c, pick(L, "Weights to record on label day", "أوزان للتسجيل يوم الملصقات"), html`
<p class="muted">${pick(L,
    "Each item below is sold by the pack, but no pack weight is approved yet, or the supplier's price may be per kg rather than per pack. On label day weigh one pack of each and photograph its label (the size is approved from the photo); check the invoice for the price basis. Nothing is guessed: until then customers read “per pack, weight not confirmed yet”.",
    "كل منتج أدناه يُباع بالعلبة، لكن لا وزن معتمداً للعلبة بعد، أو قد يكون سعر المورّد للكيلو لا للعلبة. يوم الملصقات زِن علبة من كل واحد وصوّر ملصقها (يُعتمد الحجم من الصورة)، وتحقّق من الفاتورة لأساس السعر. لا تخمين: حتى ذلك الحين يقرأ الزبائن «للعلبة، الوزن غير مؤكّد بعد».")}</p>
<p><strong>${weigh}</strong> ${pick(L, "to weigh", "للوزن")} · <strong>${asks}</strong> ${pick(L, "price bases to confirm", "أسس أسعار للتأكيد")}${blocked ? html` · <strong>${blocked}</strong> ${pick(L, "not sold until answered", "لا تُباع قبل الجواب")}` : ""}</p>
${rows.length === 0 ? empty({ title: pick(L, "Nothing to weigh.", "لا شيء للوزن."), icon: "check" }) : html`<ul class="ak-rows">${rows.map(card)}</ul>`}`, { translated: true });
}

async function answer(c: Ctx) {
  const L = c.lang;
  const id = text(c, "check", 40);
  const resolution = text(c, "resolution", 20);
  const note = text(c, "note", 200);
  if (!UUID.test(id)) throw new UserError(pick(L, "That check was not found.", "لم يُعثر على هذا السؤال."));
  if (resolution !== "per_pack" && resolution !== "per_kg") throw new UserError(pick(L, "Choose for the pack or per kg.", "اختر للعلبة أو للكيلو."));
  if (!note) throw new UserError(pick(L, "Say how you know: the invoice, the scale or the tray.", "قل كيف تعرف: الفاتورة أو الميزان أو الكرتونة."));
  const r = await attempt(c, "price_basis_answer", { check: id, resolution, note }, async () => {
    const x = await c.deps.db.rpc<{ ok: boolean; reason?: string }>("resolve_price_basis", { p_check: id, p_resolution: resolution, p_note: note, p_by: c.staff.partyId });
    if (!x.ok) return pick(L, "That question was already answered.", "أُجيب عن هذا السؤال من قبل.");
    return resolution === "per_kg" ? pick(L, "Saved: the price is per kg; the pages now say “per kg”.", "حُفظ: السعر للكيلو؛ تقول الصفحات الآن «بالكيلو».")
      : pick(L, "Saved: the price is for the pack.", "حُفظ: السعر للعلبة.");
  });
  return flashRedirect(c.deps, "/weights", r.logged ? r.msg : { err: pick(L, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") });
}

export const weightsSection: Section = {
  nav: { href: "/weights", label: "Weights to record on label day", roles: ALL },
  routes: [
    { method: "GET", path: "/weights", roles: ALL, handler: page },
    { method: "POST", path: "/weights/answer", roles: LEADS, handler: answer },
  ],
};
