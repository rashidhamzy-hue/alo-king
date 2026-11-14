// 3.14 Food-facts editor with evidence upload, and the "expires within three days" stock list.
// A person records what the pack (or a supplier's sheet, a certificate, a lab report) says, attaching it as evidence; the
// SQL decides who may approve (record_food_fact, 0049: the ops lead or an admin approves at once, a picker proposes).
// Nothing here infers a fact from a product's name, brand or category (invariant 15). Unknown stays unknown.
import { act, can, html, render, text, upload, UserError, UUID, type Ctx, type Section } from "../app";
import { basisWords, confirmedFrom, sourceName } from "../basis";
import { isMissingFunction } from "../db";
import { form, when } from "../html";
import { ALL, LEADS } from "../roles";

type Attr = { code: string; kind: string; name_en: string; name_ar: string | null };
export type Fact = { id: string; product_id: string; attribute: string; value: string | null; detail: Record<string, any>; status: string; source: string;
  evidence_id: string | null; proposed_by: string | null; proposed_at: string; approved_at: string | null; superseded_at: string | null; expires_at: string | null };
export const NUTRIENTS = ["energy_kcal", "fat", "saturated_fat", "carbohydrates", "sugars", "fiber", "proteins", "salt"] as const;
const STATUSES = ["declared", "certified", "partial", "unknown"] as const;
const EVIDENCE = ["label_photo", "supplier_spec", "certificate", "lab_report", "manufacturer", "other"] as const;

async function hub(c: Ctx) {
  return (await c.deps.db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, order: [{ col: "id" }], limit: 1 }))[0]?.id ?? null;
}

/** A fact as a person reads it: the value, or the text, or the panel; with its status and where it came from. */
export function factText(f: { value: string | null; detail: Record<string, any>; status: string }): string {
  if (f.detail?.text) return String(f.detail.text);
  if (f.detail?.values) {
    const v = f.detail.values as Record<string, unknown>;
    const keys = [...NUTRIENTS.filter((k) => k in v), ...Object.keys(v).filter((k) => !(NUTRIENTS as readonly string[]).includes(k))];   // the panel's order, not the database's
    return keys.map((k) => `${k.replace(/_/g, " ")} ${v[k]}`).join(", ") + " per 100 g";
  }
  return f.value ?? "(not stated)";
}

/** Where the label photo's reading and a web source disagree about one field of one item (0114). */
export type Conflict = { attribute: string; label: { fact_id: string; approved: boolean; value: string | null; detail: Record<string, any>; status: string };
  other: { fact_id: string; source: string; value: string | null; detail: Record<string, any> } };
export async function conflictsOf(c: Ctx, product: string): Promise<Conflict[]> {
  try { return (await c.deps.db.rpc<Conflict[]>("fact_basis_conflicts", { p_product: product })) ?? []; }
  catch (e) { if (isMissingFunction(e)) return []; throw e; }      // a database without 0114 (staging can lag): nothing is flagged, nothing else changes
}
/** "The label photo says: contains. A web page says: free. The label wins." for a person to read. */
export function conflictWords(x: Conflict, name: string): string {
  const label = factText({ value: x.label.value, detail: x.label.detail, status: x.label.status });
  const other = factText({ value: x.other.value, detail: x.other.detail, status: "partial" });
  return `${name}: the label ${x.label.approved ? "(checked by a person)" : "reading"} says “${label}”, ${sourceName(x.other.source)} says “${other}”. They disagree, so the label wins.`;
}

async function list(c: Ctx) {
  const { db } = c.deps;
  const src = await hub(c);
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const [expiring, products, waiting] = await Promise.all([
    src ? db.rpc<{ product_id: string; product: string; expiry_date: string; lot: string | null; on_hand: number | string }[]>("expiring_stock", { p_source: src, p_days: 3 }) : [],
    q ? db.rows<{ id: string; sku: string | null; name_en: string; brand: string | null; barcode: string | null }>("products", { select: "id,sku,name_en,brand,barcode", where: { owner_source_id: null }, order: [{ col: "sku" }], limit: 5000 }) : [],
    db.rows<{ id: string }>("product_facts", { select: "id", where: { approved_at: null, superseded_at: null }, limit: 5000 }),
  ]);
  const hits = products.filter((p) => [p.sku, p.name_en, p.brand, p.barcode].some((v) => (v ?? "").toLowerCase().includes(q))).slice(0, 50);
  return render(c, "Food facts", html`
<p class="muted">Allergens, diet, ingredients and nutrition are said to customers only from approved records, with their status. Record what the pack says, and attach the pack.</p>
<p>${waiting.length} proposed facts wait for a person to check them against the pack: <a href="/intake">Label intake</a>.</p>
<form method="get" action="/food-facts"><input name="q" value="${q}" placeholder="name, brand, SKU or barcode"> <button>Find</button></form>
${q ? html`<table><tr><th>SKU</th><th>Item</th><th>Brand</th><th>Barcode</th></tr>${hits.map((p) => html`<tr><td>${p.sku ?? ""}</td><td><a href="/food-facts/${p.id}">${p.name_en}</a></td><td>${p.brand ?? ""}</td><td>${p.barcode ?? ""}</td></tr>`)}</table>` : ""}
<h2>Expiring within three days (${expiring.length})</h2>
${expiring.length === 0 ? html`<p class="muted">Nothing on the shelf expires in the next three days.</p>` : html`<table><tr><th>Item</th><th>Expires</th><th>Lot</th><th>On hand</th></tr>
${expiring.map((x) => html`<tr class="${x.expiry_date <= new Date(c.deps.now().getTime() + 86400_000).toISOString().slice(0, 10) ? "late" : ""}"><td><a href="/catalog/${x.product_id}">${x.product}</a></td><td>${x.expiry_date}</td><td>${x.lot ?? ""}</td><td>${Number(x.on_hand)}</td></tr>`)}</table>`}`);
}

export async function factsOf(c: Ctx, product: string) {
  const { db } = c.deps;
  const [attrs, facts] = await Promise.all([
    db.rows<Attr>("food_attributes", { select: "code,kind,name_en,name_ar", order: [{ col: "kind" }, { col: "code" }] }),
    db.rows<Fact>("product_facts", { where: { product_id: product }, order: [{ col: "proposed_at", desc: true }], limit: 300 }),
  ]);
  const ev = [...new Set(facts.map((f) => f.evidence_id).filter(Boolean) as string[])];
  const docs = ev.length ? await db.rows<{ id: string; kind: string; media_path: string | null; reference: string | null }>("evidence_documents", { select: "id,kind,media_path,reference", where: { id: { in: ev } } }) : [];
  const links = new Map(await Promise.all(docs.map(async (d) => [d.id, d.media_path ? await c.deps.media.sign(d.media_path, 300) : null] as const)));
  return { attrs, facts, docs, links };
}

export function factForm(c: Ctx, product: string, attrs: Attr[], action = `/food-facts/${product}`) {
  return form(c.f, action, html`
<p><label>What <select name="attribute">${attrs.map((a) => html`<option value="${a.code}">${a.kind}: ${a.name_en}</option>`)}</select></label>
<label>Allergen <select name="allergen_value"><option value="">(not an allergen)</option><option value="contains">contains</option><option value="may_contain">may contain</option><option value="free">free of it (the pack says so)</option></select></label>
<label>Diet <select name="diet_value"><option value="">(not a diet label)</option><option value="yes">yes (the pack or certificate says so)</option><option value="no">no</option></select></label></p>
<p><label>Ingredients as printed <textarea name="ingredients" rows="2" cols="70" maxlength="3000"></textarea></label></p>
<p>Per 100 g: ${NUTRIENTS.map((n) => html`<label>${n.replace(/_/g, " ")} <input type="number" name="n_${n}" step="0.01" min="0"></label> `)}</p>
<p><label>Status <select name="status">${STATUSES.map((s) => html`<option>${s}</option>`)}</select></label>
<label>Valid until <input type="date" name="expires"></label></p>
<p><label>Evidence <select name="evidence_kind">${EVIDENCE.map((e) => html`<option>${e}</option>`)}</select></label>
<label>Photo or PDF <input type="file" name="evidence" accept="image/*,application/pdf"></label>
<label>or its reference <input name="evidence_ref" maxlength="100"></label> <button>Record</button></p>`, { files: true });
}

async function item(c: Ctx) {
  const product = c.params.product ?? "";
  if (!UUID.test(product)) throw new UserError("That record is not valid.");
  const p = (await c.deps.db.rows<{ id: string; name_en: string; name_ar: string | null; brand: string | null; barcode: string | null }>("products", { select: "id,name_en,name_ar,brand,barcode", where: { id: product }, limit: 1 }))[0];
  if (!p) throw new UserError("No such item.");
  const [{ attrs, facts, docs, links }, conflicts] = await Promise.all([factsOf(c, product), conflictsOf(c, product)]);
  const name = (code: string) => attrs.find((a) => a.code === code)?.name_en ?? code;
  const current = facts.filter((f) => f.approved_at && !f.superseded_at);
  const waiting = facts.filter((f) => !f.approved_at && !f.superseded_at);
  const proof = (f: Fact) => { const d = docs.find((x) => x.id === f.evidence_id); const l = d ? links.get(d.id) : null; return d ? html`${d.kind}${d.reference ? ` ${d.reference}` : ""}${l ? html` <a href="${l}" target="_blank" rel="noopener">open</a>` : ""}` : ""; };
  return render(c, `Food facts: ${p.name_en}`, html`
<p><a href="/food-facts">← Food facts</a> · ${p.brand ?? ""} · barcode ${p.barcode ?? "none"}${p.name_ar ? html` · ${p.name_ar}` : ""}</p>
<h2>Approved (what may be said)</h2>
${current.length === 0 ? html`<p class="warn">None. Every question about this item is answered "not known".</p>` : html`<table><tr><th>What</th><th>Says</th><th>Status</th><th>From</th><th>Basis</th><th>Evidence</th><th>Checked</th></tr>
${current.map((f) => html`<tr><td>${name(f.attribute)}</td><td>${factText(f)}</td><td>${f.status}</td><td>${f.source}</td><td>${basisWords(f)}${confirmedFrom(f) ? html`<br><span class="muted">${confirmedFrom(f)}</span>` : ""}</td><td>${proof(f)}</td><td>${when(f.approved_at)}${f.expires_at ? html`<br>until ${when(f.expires_at)}` : ""}</td></tr>`)}</table>`}
${conflicts.map((x) => html`<p class="note"><strong>Label and web disagree.</strong> ${conflictWords(x, name(x.attribute))}</p>`)}
${waiting.length ? html`<h2>Waiting for a person (${waiting.length})</h2><p><a href="/intake/${product}">Check them against the pack</a></p>
<table><tr><th>What</th><th>Proposed</th><th>What it rests on</th></tr>
${[...waiting].sort((a, b) => Number(b.source === "label") - Number(a.source === "label") || a.attribute.localeCompare(b.attribute)).map((f) => html`<tr><td>${name(f.attribute)}</td><td>${factText(f)}</td><td>${basisWords(f)}${conflicts.some((x) => x.other.fact_id === f.id) ? html`<br><strong class="warn">Disagrees with the label: the label wins.</strong>` : ""}</td></tr>`)}</table>` : ""}
<h2>Record from the pack</h2>
${factForm(c, product, attrs)}
<p class="muted">${can(c, LEADS) ? "You approve what you record." : "What you record waits for the ops lead to approve it."} A fact that is not on the pack is not recorded: leave it unknown.</p>`);
}

/** Reads the fact form into value, status and detail. Shared with intake (5.15). */
export interface FactInput { attribute: string; value: string | null; status: string; detail: Record<string, unknown>; expires: string | null;
  evidence: { kind: string; path: string | null; ref: string | null } }
export async function readFactForm(c: Ctx, product: string, attrs?: Attr[]): Promise<FactInput> {
  const all = attrs ?? await c.deps.db.rows<Attr>("food_attributes", { select: "code,kind,name_en,name_ar" });
  const a = all.find((x) => x.code === (c.form.attribute ?? ""));
  if (!a) throw new UserError("Pick what the fact is about.");
  const status = c.form.status ?? "";
  if (!(STATUSES as readonly string[]).includes(status)) throw new UserError("Pick a status.");
  let value: string | null = null; const detail: Record<string, unknown> = {};
  if (a.kind === "allergen") { value = c.form.allergen_value || null; if (!value && status !== "unknown") throw new UserError("Pick what the pack says about this allergen."); }
  else if (a.kind === "diet") { value = c.form.diet_value || null; if (!value && status !== "unknown") throw new UserError("Pick yes or no."); }
  else if (a.kind === "ingredients") { const t = text(c, "ingredients", 3000); if (!t && status !== "unknown") throw new UserError("Type the ingredients as printed."); if (t) detail.text = t; }
  else {
    const values: Record<string, number> = {};
    for (const n of NUTRIENTS) { const raw = (c.form[`n_${n}`] ?? "").trim(); if (raw === "") continue; const v = Number(raw); if (!Number.isFinite(v) || v < 0) throw new UserError(`${n} is not a valid number.`); values[n] = v; }
    if (!Object.keys(values).length && status !== "unknown") throw new UserError("Type the nutrition panel as printed (per 100 g).");
    if (Object.keys(values).length) { detail.per = "100g"; detail.values = values; }
  }
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(c.form.expires ?? "") ? c.form.expires! : null;
  const kind = c.form.evidence_kind ?? "label_photo";
  if (!(EVIDENCE as readonly string[]).includes(kind)) throw new UserError("Pick what the evidence is.");
  const path = await upload(c, "evidence", `evidence/${product}`);     // the file only; the record of it is written inside the action
  return { attribute: a.code, value, status, detail, expires, evidence: { kind, path, ref: text(c, "evidence_ref", 100) || null } };
}

/** Records the evidence document (if the form had one) and returns its id. Call inside act(). */
export async function evidenceId(c: Ctx, product: string, e: FactInput["evidence"]): Promise<string | null> {
  if (!e.path && !e.ref) return null;
  return c.deps.db.rpc<string>("add_evidence_document", { p_product: product, p_kind: e.kind, p_media_path: e.path, p_by: c.staff.partyId, p_reference: e.ref });
}

async function record(c: Ctx) {
  const product = c.params.product ?? "";
  if (!UUID.test(product)) throw new UserError("That record is not valid.");
  const f = await readFactForm(c, product);
  return act(c, "food_fact_record", { product, attribute: f.attribute, status: f.status, evidence: f.evidence.kind }, async () => {
    const evidence = await evidenceId(c, product, f.evidence);
    const r = await c.deps.db.rpc<{ approved: boolean }>("record_food_fact", { p_product: product, p_attribute: f.attribute, p_value: f.value, p_status: f.status,
      p_detail: f.detail, p_evidence: evidence, p_by: c.staff.partyId, p_expires_at: f.expires });
    return r.approved ? "Recorded and approved." : "Recorded. It waits for the ops lead to approve it.";
  }, `/food-facts/${product}`);
}

export const foodFactsSection: Section = {
  nav: { href: "/food-facts", label: "Food facts", roles: ALL },
  routes: [
    { method: "GET", path: "/food-facts", roles: ALL, handler: list },
    { method: "GET", path: "/food-facts/:product", roles: ALL, handler: item },
    { method: "POST", path: "/food-facts/:product", roles: ALL, handler: record },
  ],
};
