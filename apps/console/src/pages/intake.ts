// 5.15 Label scan at intake, and the review of proposed food facts against the pack, field by field.
//   Scan     a picker photographs the barcode and the label; the photos become evidence; the label reader (src/label.ts), when the
//            console has a model key, proposes name, brand, size, ingredients, allergens and the nutrition panel (record_label_scan).
//   Review   every proposed field waits for the ops lead or an admin, with the pack photo beside it: Open Food Facts' proposals
//            (N1, 5.18: the second opinion, never approvable as they are), the label reading, and pickers' entries. Confirm
//            (as printed, corrected where the pack differs) or reject, one field at a time (review_proposed_fact, 0049).
// Nothing is published until a person confirms it; nothing is inferred from a name or a kind of product (invariant 15).
import { act, can, html, render, text, upload, UserError, UUID, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { ALL, LEADS } from "../roles";
import { readingFacts, type LabelImage, type LabelReading } from "../label";
import { basisWords } from "../basis";
import { conflictsOf, conflictWords, factsOf, factText, NUTRIENTS, type Fact } from "./foodfacts";

type Product = { id: string; sku: string | null; name_en: string; name_ar: string | null; brand: string | null; barcode: string | null };
const PRODUCT_COLS = "id,sku,name_en,name_ar,brand,barcode";

async function queue(c: Ctx) {
  const q = await c.deps.db.rpc<{ product_id: string; name_en: string; sku: string | null; barcode: string | null; fields: number; from_open_food_facts: number; from_label_reading: number; from_staff: number }[]>(
    "food_fact_review_queue", { p_limit: 200 });
  return render(c, "Label intake", html`
<h2>Scan a pack</h2>
${form(c.f, "/intake/scan", html`<p><label>Barcode or SKU <input name="code" maxlength="40" required></label></p>
<p><label>Label <input type="file" name="photo_1" accept="image/*" required></label> <label>Ingredients and allergens <input type="file" name="photo_2" accept="image/*"></label>
<label>Nutrition panel <input type="file" name="photo_3" accept="image/*"></label></p>
<p><button>Save the photos${c.deps.readLabel ? " and read the label" : ""}</button></p>`, { files: true })}
${c.deps.readLabel ? html`<p class="muted">The label is read by a model to save typing. What it reads is only a proposal: a person checks every field against the pack.</p>`
  : html`<p class="note">No label reader is set up on this console (no model key): the photos are saved, and the fields are typed from the pack on the item's page.</p>`}
<h2>Waiting to be checked against the pack (${q.length} items)</h2>
${q.length === 0 ? html`<p class="muted">Nothing waits.</p>` : html`<table><tr><th>Item</th><th>SKU</th><th>Barcode</th><th>Fields</th><th>Open Food Facts</th><th>Label reading</th><th>Staff</th></tr>
${q.map((x) => html`<tr><td><a href="/intake/${x.product_id}">${x.name_en}</a></td><td>${x.sku ?? ""}</td><td>${x.barcode ?? ""}</td><td>${Number(x.fields)}</td>
<td>${Number(x.from_open_food_facts)}</td><td>${Number(x.from_label_reading)}</td><td>${Number(x.from_staff)}</td></tr>`)}</table>`}`);
}

async function findProduct(c: Ctx, code: string): Promise<Product | null> {
  const digits = code.replace(/[^0-9]/g, "");
  const bySku = await c.deps.db.rows<Product>("products", { select: PRODUCT_COLS, where: { sku: code }, limit: 1 });
  if (bySku[0]) return bySku[0];
  if (digits.length >= 6) return (await c.deps.db.rows<Product>("products", { select: PRODUCT_COLS, where: { barcode: digits }, limit: 1 }))[0] ?? null;
  return null;
}

async function scan(c: Ctx) {
  const code = text(c, "code", 40);
  if (!code) throw new UserError("Type the barcode or the SKU.");
  const p = await findProduct(c, code);
  if (!p) throw new UserError(`No item with barcode or SKU ${code}. A new item is added to the catalog first.`);
  const fields = ["photo_1", "photo_2", "photo_3"].filter((f) => c.files[f]);
  if (!fields.length) throw new UserError("Attach at least the label photo.");
  for (const f of fields) if (!c.files[f]!.type.startsWith("image/")) throw new UserError("Attach photos (JPEG, PNG or WebP).");
  const photos: string[] = [];
  for (const f of fields) photos.push((await upload(c, f, `labels/${p.id}`))!);
  return act(c, "label_scan", { product: p.id, photos: photos.length, reader: !!c.deps.readLabel }, async () => {
    let reading: LabelReading | null = null;
    if (c.deps.readLabel) {
      const images: LabelImage[] = await Promise.all(fields.map(async (f) => ({ bytes: new Uint8Array(await c.files[f]!.arrayBuffer()), mime: c.files[f]!.type })));
      reading = await c.deps.readLabel(images);
    }
    const r = await c.deps.db.rpc<{ proposed: Record<string, string>; dropped: unknown[] }>("record_label_scan", {
      p_product: p.id, p_photos: photos, p_reading: reading ? { ...reading, facts: readingFacts(reading) } : null,
      p_model: reading ? c.deps.labelModel ?? null : null, p_by: c.staff.partyId,
    });
    const n = Object.keys(r.proposed ?? {}).length;
    if (!c.deps.readLabel) return `Photos saved for ${p.name_en}. Type the fields from the pack.`;
    if (!reading) return `Photos saved for ${p.name_en}. The label could not be read: type the fields from the pack.`;
    return `Photos saved for ${p.name_en}; ${n} field${n === 1 ? "" : "s"} read from the label, each waiting to be checked against the pack.`;
  }, `/intake/${p.id}`);
}

async function review(c: Ctx) {
  const product = c.params.product ?? "";
  if (!UUID.test(product)) throw new UserError("That record is not valid.");
  const p = (await c.deps.db.rows<Product>("products", { select: PRODUCT_COLS, where: { id: product }, limit: 1 }))[0];
  if (!p) throw new UserError("No such item.");
  const [{ attrs, facts }, conflicts, scans, evidence] = await Promise.all([
    factsOf(c, product),
    conflictsOf(c, product),
    c.deps.db.rows<{ reading: LabelReading | null; read_by: string; created_at: string }>("label_scans", { select: "reading,read_by,created_at", where: { product_id: product }, order: [{ col: "created_at", desc: true }], limit: 1 }),
    c.deps.db.rows<{ id: string; kind: string; media_path: string | null; reference: string | null; created_at: string }>("evidence_documents", {
      select: "id,kind,media_path,reference,created_at", where: { product_id: product }, order: [{ col: "created_at", desc: true }], limit: 20 }),
  ]);
  const photos = evidence.filter((e) => e.kind === "label_photo" && e.media_path).slice(0, 3);
  const photoLinks = await Promise.all(photos.map((e) => c.deps.media.sign(e.media_path!, 600)));
  // The label's reading comes first; a web or Open Food Facts proposal that disagrees with it can only be set aside (audit G1, point 4).
  const pending = facts.filter((f) => !f.approved_at && !f.superseded_at).sort((a, b) => Number(b.source === "label") - Number(a.source === "label") || a.attribute.localeCompare(b.attribute));
  const lost = (f: Fact) => conflicts.find((x) => x.other.fact_id === f.id);
  const wins = (f: Fact) => conflicts.find((x) => x.label.fact_id === f.id);
  const current = (attr: string) => facts.find((f) => f.attribute === attr && f.approved_at && !f.superseded_at);
  const attr = (code: string) => attrs.find((a) => a.code === code);
  const r = scans[0]?.reading ?? null;
  const leads = can(c, LEADS);

  const row = (f: Fact) => {
    const a = attr(f.attribute); const now = current(f.attribute);
    const evSelect = html`<label>Evidence <select name="evidence">${f.evidence_id ? "" : html`<option value="">(choose the pack photo)</option>`}
${evidence.map((e, i) => html`<option value="${e.id}"${(f.evidence_id ? e.id === f.evidence_id : i === 0 && e.kind === "label_photo") ? " selected" : ""}>${e.kind} ${when(e.created_at)}${e.reference ? ` ${e.reference}` : ""}</option>`)}</select></label>`;
    const edit = a?.kind === "allergen" ? html`<label>The pack says <select name="value">${["contains", "may_contain", "free"].map((v) => html`<option${v === f.value ? " selected" : ""}>${v}</option>`)}</select></label>`
      : a?.kind === "diet" ? html`<label>The pack says <select name="value">${["yes", "no"].map((v) => html`<option${v === f.value ? " selected" : ""}>${v}</option>`)}</select></label>`
      : a?.kind === "ingredients" ? html`<label>As printed<br><textarea name="ingredients" rows="3" cols="70" maxlength="3000">${f.detail?.text ?? ""}</textarea></label>`
      : html`${NUTRIENTS.map((n) => html`<label>${n.replace(/_/g, " ")} <input type="number" step="0.01" min="0" name="n_${n}" value="${f.detail?.values?.[n] ?? ""}"></label> `)}`;
    const against = lost(f);
    return html`<tr><td><strong>${a?.name_en ?? f.attribute}</strong><br><span class="muted">${basisWords(f)}, ${when(f.proposed_at)}</span>
${against ? html`<br><strong class="warn">Disagrees with the label: the label wins.</strong>` : ""}${wins(f) ? html`<br><strong>This is the label's reading: it wins over the web source.</strong>` : ""}</td>
<td>${factText(f)}${f.detail?.ar ? html`<br><span class="muted">Arabic: ${f.detail.ar}</span>` : ""}
${f.detail?.quote ? html`<br><span class="muted">printed words: “${f.detail.quote}”</span>` : ""}
${f.detail?.source_text && f.detail.source_text !== f.detail.text ? html`<br><span class="muted">source text: ${String(f.detail.source_text).slice(0, 400)}</span>` : ""}</td>
<td>${now ? html`${factText(now)} (${now.status}, ${now.source})` : html`<span class="muted">nothing approved</span>`}</td>
<td>${against && leads ? html`<p class="warn">Not confirmed from here: the label says otherwise. Confirm the label's field, then set this one aside.</p>
${form(c.f, `/intake/fact/${f.id}/reject`, html`<input name="note" placeholder="why (e.g. the label says otherwise)" maxlength="200" value="the label says otherwise"> <button>Set aside</button>`)}`
  : leads ? html`${form(c.f, `/intake/fact/${f.id}/confirm`, html`<p>${edit}</p><p><label>Status <select name="status"><option>declared</option><option>certified</option><option value="unknown">unknown (the pack does not say)</option></select></label>
${evSelect}</p><p><button>Confirm against the pack</button></p>`)}
${form(c.f, `/intake/fact/${f.id}/reject`, html`<input name="note" placeholder="why (e.g. not on the pack)" maxlength="200"> <button>Reject</button>`)}`
  : html`<span class="muted">The ops lead checks this.</span>`}</td></tr>`;
  };

  return render(c, `Intake: ${p.name_en}`, html`
<p><a href="/intake">← Label intake</a> · <a href="/food-facts/${product}">Food facts</a></p>
<div class="pair"><div>${photoLinks.length ? photoLinks.map((l) => (l ? html`<img class="proof" src="${l}" alt="pack photo">` : "")) : html`<p class="warn">No photo of the pack yet: scan it first.</p>`}</div>
<div><table><tr><th></th><th>Catalog</th><th>Read from the label</th></tr>
<tr><td>Name</td><td>${p.name_en}${p.name_ar ? html`<br>${p.name_ar}` : ""}</td><td>${r?.name_en ?? ""}${r?.name_ar ? html`<br>${r.name_ar}` : ""}</td></tr>
<tr><td>Brand</td><td>${p.brand ?? ""}</td><td>${r?.brand ?? ""}</td></tr>
<tr><td>Size</td><td></td><td>${r?.size ?? ""}</td></tr>
<tr><td>Barcode</td><td>${p.barcode ?? ""}</td><td>${r?.barcode ?? ""}${r?.barcode && p.barcode && r.barcode.replace(/\D/g, "") !== p.barcode.replace(/\D/g, "") ? html` <strong class="warn">differs: is this the right item?</strong>` : ""}</td></tr></table>
<p class="muted">Name, brand and size are shown to check it is the right item; they are not changed here.</p></div></div>
${conflicts.map((x) => html`<p class="note"><strong>Label and web disagree.</strong> ${conflictWords(x, attr(x.attribute)?.name_en ?? x.attribute)}</p>`)}
<h2>Proposed fields (${pending.length})</h2>
${pending.length === 0 ? html`<p class="muted">Nothing waits for this item.</p>` : html`<table><tr><th>Field</th><th>Proposed</th><th>Approved now</th><th>Check against the pack</th></tr>${pending.map(row)}</table>`}`);
}

async function decide(c: Ctx) {
  const fact = c.params.fact ?? "";
  if (!UUID.test(fact)) throw new UserError("That record is not valid.");
  const decision = c.params.decision === "confirm" ? "confirm" : c.params.decision === "reject" ? "reject" : null;
  if (!decision) throw new UserError("Unknown decision.");
  const f = (await c.deps.db.rows<Fact>("product_facts", { where: { id: fact }, limit: 1 }))[0];
  if (!f) throw new UserError("That field was not found.");
  const kind = (await c.deps.db.rows<{ kind: string }>("food_attributes", { select: "kind", where: { code: f.attribute }, limit: 1 }))[0]?.kind;
  const back = `/intake/${f.product_id}`;
  if (decision === "reject") {
    const note = text(c, "note", 200) || null;
    return act(c, "food_fact_reject", { fact, attribute: f.attribute }, async () => {
      await c.deps.db.rpc("review_proposed_fact", { p_fact: fact, p_by: c.staff.partyId, p_decision: "reject", p_note: note });
      return "Rejected: nothing is published from it.";
    }, back);
  }
  const status = c.form.status ?? "";
  if (!["declared", "certified", "unknown"].includes(status)) throw new UserError("Pick a status.");
  let value: string | null = null; let detail: Record<string, unknown> | null = null;
  if (kind === "allergen" || kind === "diet") value = (c.form.value ?? "").trim() || null;
  else if (kind === "ingredients") {
    const t = text(c, "ingredients", 3000);
    if (!t && status !== "unknown") throw new UserError("Type the ingredients as printed.");
    if (t !== String(f.detail?.text ?? "").trim()) detail = t ? { text: t } : {};
  } else {
    const values: Record<string, number> = {};
    for (const n of NUTRIENTS) { const raw = (c.form[`n_${n}`] ?? "").trim(); if (raw === "") continue; const v = Number(raw); if (!Number.isFinite(v) || v < 0) throw new UserError(`${n} is not a valid number.`); values[n] = v; }
    const before = (f.detail?.values ?? {}) as Record<string, number>;
    const same = Object.keys(values).length === Object.keys(before).filter((k) => (NUTRIENTS as readonly string[]).includes(k)).length && Object.entries(values).every(([k, v]) => Number(before[k]) === v);
    if (!same) detail = Object.keys(values).length ? { per: "100g", values } : {};
  }
  const evidence = (c.form.evidence ?? "").trim() || null;
  if (evidence && !UUID.test(evidence)) throw new UserError("That evidence is not valid.");
  return act(c, "food_fact_confirm", { fact, attribute: f.attribute, status, changed: detail !== null || (value !== null && value !== f.value) }, async () => {
    const r = await c.deps.db.rpc<{ changed: boolean }>("review_proposed_fact", { p_fact: fact, p_by: c.staff.partyId, p_decision: "confirm", p_value: value, p_status: status,
      p_detail: detail, p_evidence: evidence, p_note: null, p_expires_at: null });
    return r.changed ? "Confirmed as the pack prints it (corrected) and published." : "Confirmed against the pack and published.";
  }, back);
}

export const intakeSection: Section = {
  nav: { href: "/intake", label: "Label intake", roles: ALL },
  routes: [
    { method: "GET", path: "/intake", roles: ALL, handler: queue },
    { method: "POST", path: "/intake/scan", roles: ALL, handler: scan },
    { method: "GET", path: "/intake/:product", roles: ALL, handler: review },
    { method: "POST", path: "/intake/fact/:fact/:decision", roles: LEADS, handler: decide },
  ],
};
