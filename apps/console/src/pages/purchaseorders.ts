// WH1a: purchase orders and receiving against one (docs/strategy/02-journeys.md, section 4, "Suppliers and purchase orders", "Receiving").
// An ops lead writes an order: the supplier, the day the goods are expected, the items by code (a name typed in the field finds the code)
// with their quantities, and a unit cost when it is known. It prints in Arabic or English from one document (purchase_order_doc), on a
// page with no menu, for paper or a PDF to send. When the van comes, anyone who receives (a picker too) opens the order and counts each
// line: how many came, how many of those are damaged, the lot and the expiry date where the pack has one, the invoice's cost when the
// order had none. The database does the rest (receive_purchase_order, 0237): only the good units go on the shelf, as lots (0239), short
// and damaged are recorded, the ledger and the drawer rules are receive_goods's (0024, 0081). The order then shows what came and, for the
// label day, the received items that are packaged and not label-ready, with the door to the capture page (whose list now starts with them).
import { can, form, html, renderBare, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { usd, when } from "../html";
import { pick, type Lang } from "../i18n";
import { ALL, LEADS } from "../roles";
import { badge, button, empty, factList, factRow, input, select, tabs, type Tone } from "@ak/ui/components";
import { doAct, hubDay, hubId, qty, unitWord, zoneWord } from "./warehouse";

const LINES = 10;
type Supplier = { id: string; name: string };
type ListRow = { po_id: string; number: string; status: string; expected_date: string; supplier: string; lines: number; created_at: string };
type Received = { counted: number | string; damaged: number | string; received: number | string; short: number | string; lot: string | null; expiry_date: string | null; unit_cost_usd: number | string | null; note: string | null };
type DocLine = { n: number; line_id: string; product_id: string; sku: string | null; barcode: string | null; name_en: string; name_ar: string; qty: number | string; unit: string; storage: string; unit_cost_usd: number | string | null; received: Received | null };
type Doc = { po_id: string; number: string; status: string; expected_date: string; created_at: string; created_by: string | null; note: string | null; cancel_reason: string | null; hub: string;
  received_at: string | null; received_by: string | null; supplier_ref: string | null; supplier: { id: string; name: string; phone: string | null; terms: string | null }; lines: DocLine[];
  short?: { name_en: string; name_ar: string; ordered: number | string; counted: number | string; short: number | string }[];
  damaged?: { name_en: string; name_ar: string; damaged: number | string; note: string | null }[];
  label_capture?: { product_id: string; name_en: string; name_ar: string; photographed: boolean }[] };

const STATUS: Record<string, [string, string, Tone]> = { open: ["Open", "مفتوح", "warn"], received: ["Received", "مُستلم", "ok"], cancelled: ["Cancelled", "ملغى", "neutral"] };
const statusBadge = (L: Lang, s: string) => { const w = STATUS[s] ?? [s, s, "neutral" as Tone]; return badge(pick(L, w[0], w[1]), w[2]); };
const nameOf = (L: Lang, l: { name_en: string; name_ar: string }) => (L === "ar" ? l.name_ar : l.name_en);
const docOf = (c: Ctx, po: string) => c.deps.db.rpc<Doc | null>("purchase_order_doc", { p_po: po });

async function listPage(c: Ctx) {
  const L = c.lang;
  const src = await hubId(c);
  const view = c.url.searchParams.get("view") === "done" ? "done" : "open";
  const [rows, suppliers] = await Promise.all([
    c.deps.db.rpc<ListRow[]>("purchase_orders_list", { p_source: src, p_limit: 100 }),
    c.deps.db.rows<Supplier>("suppliers", { select: "id,name", where: { is_active: true }, order: [{ col: "name" }], limit: 200 }),
  ]);
  const open = rows.filter((x) => x.status === "open"), done = rows.filter((x) => x.status !== "open");
  const shown = view === "open" ? open : done;
  const leads = can(c, LEADS);
  let newForm = html``;
  if (leads) {
    const items = await c.deps.db.rows<{ sku: string | null; name_en: string; name_ar: string | null }>("products", { select: "sku,name_en,name_ar", where: { owner_source_id: null, is_active: true }, order: [{ col: "name_en" }], limit: 2000 });
    newForm = suppliers.length === 0
      ? html`<p class="note">${pick(L, "Add the supplier first, on the Receiving page.", "أضف المورّد أولاً من صفحة الاستلام.")} <a href="/receiving">${pick(L, "Receiving", "الاستلام")}</a></p>`
      : html`<details class="ak-more"${open.length === 0 ? html` open` : ""}><summary>${pick(L, "New purchase order", "طلب شراء جديد")}</summary>
${form(c.f, "/purchase-orders", html`<div class="ak-money-fields">
${select({ name: "supplier", label: pick(L, "Supplier", "المورّد"), options: suppliers.map((s) => ({ value: s.id, label: s.name })) })}
${input({ name: "expected_date", label: pick(L, "Expected on", "متوقّع في"), type: "date", value: hubDay(c.deps.now(), 1), required: true })}</div>
<datalist id="po-items">${items.filter((p) => p.sku).map((p) => html`<option value="${p.sku}">${L === "ar" ? p.name_ar || p.name_en : p.name_en}</option>`)}</datalist>
<p class="muted">${pick(L, "Item: type its name or SKU and pick it from the list (a barcode works too). The cost is optional: the invoice's cost is typed at receiving otherwise.", "الصنف: اكتب اسمه أو رمزه واختره من القائمة (الباركود يعمل أيضاً). السعر اختياري: يُكتب سعر الفاتورة عند الاستلام.")}</p>
<ol class="ak-rows">${Array.from({ length: LINES }, (_, i) => html`<li><div class="ak-money-fields">
${input({ name: `code_${i}`, label: pick(L, `Item ${i + 1}`, `الصنف ${i + 1}`), maxlength: 40, attrs: { list: "po-items", autocomplete: "off" } })}
${input({ name: `qty_${i}`, label: pick(L, "Quantity", "الكمية"), type: "number", attrs: { min: "0", step: "any", inputmode: "decimal" } })}
${input({ name: `cost_${i}`, label: pick(L, "Unit cost USD (optional)", "سعر الوحدة بالدولار (اختياري)"), type: "number", attrs: { min: "0", step: "0.0001", inputmode: "decimal" } })}</div></li>`)}</ol>
${input({ name: "note", label: pick(L, "Note for the supplier (optional)", "ملاحظة للمورّد (اختيارية)"), maxlength: 200 })}
<div class="actions-row">${button({ label: pick(L, "Write the purchase order", "اكتب طلب الشراء"), icon: "check", variant: "primary" })}</div>`)}</details>`;
  }
  const row = (x: ListRow) => html`<li><div class="head"><strong><a href="/purchase-orders/${x.po_id}"><bdi>${x.number}</bdi></a> · <bdi>${x.supplier}</bdi></strong>${statusBadge(L, x.status)}</div>
<p class="muted">${pick(L, `Expected ${x.expected_date} · ${x.lines} item(s)`, `متوقّع ${x.expected_date} · ${x.lines} صنف`)}</p></li>`;
  return render(c, pick(L, "Purchase orders", "طلبات الشراء"), html`
${tabs([{ label: pick(L, "Open", "مفتوحة"), href: "/purchase-orders", current: view === "open", count: open.length }, { label: pick(L, "Received and cancelled", "مُستلمة وملغاة"), href: "/purchase-orders?view=done", current: view === "done" }], pick(L, "Purchase orders", "طلبات الشراء"))}
${newForm}
${shown.length ? html`<ul class="ak-rows">${shown.map(row)}</ul>` : empty({ title: view === "open" ? pick(L, "No purchase order is open.", "لا طلب شراء مفتوح.") : pick(L, "None in the last 30 days.", "لا شيء في آخر 30 يوماً."), icon: "list" })}
<p class="muted">${pick(L, "Goods come in only by receiving a purchase order. A delivery with no order: the ops lead writes one here first, then it is received.", "تدخل البضاعة فقط باستلام طلب شراء. تسليم بلا طلب: يكتب مسؤول العمليات طلباً هنا أولاً ثم يُستلم.")}</p>`, { translated: true });
}

async function create(c: Ctx) {
  const L = c.lang;
  const supplier = (c.form.supplier ?? "").trim();
  if (!UUID.test(supplier)) throw new UserError(pick(L, "Choose the supplier.", "اختر المورّد."));
  const expected = (c.form.expected_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new UserError(pick(L, "Choose the day you expect the goods.", "اختر اليوم الذي تتوقّع فيه البضاعة."));
  const raw: { code: string; qty: number; cost: number | null }[] = [];
  for (let i = 0; i < LINES; i++) {
    const code = (c.form[`code_${i}`] ?? "").trim().slice(0, 40);
    if (!code) continue;
    const q = Number((c.form[`qty_${i}`] ?? "").trim());
    if (!Number.isFinite(q) || q <= 0 || q > 100000) throw new UserError(pick(L, `Item ${i + 1}: type a quantity above zero.`, `الصنف ${i + 1}: اكتب كمية أكبر من صفر.`));
    const cr = (c.form[`cost_${i}`] ?? "").trim();
    const cost = cr === "" ? null : Number(cr);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new UserError(pick(L, `Item ${i + 1}: the cost is not a number.`, `الصنف ${i + 1}: السعر ليس رقماً.`));
    raw.push({ code, qty: q, cost });
  }
  if (!raw.length) throw new UserError(pick(L, "Add at least one item.", "أضف صنفاً واحداً على الأقل."));
  const codes = raw.map((l) => l.code);
  const [bySku, byBarcode] = await Promise.all([
    c.deps.db.rows<{ id: string; sku: string | null; barcode: string | null }>("products", { select: "id,sku,barcode", where: { sku: { in: codes } } }),
    c.deps.db.rows<{ id: string; sku: string | null; barcode: string | null }>("products", { select: "id,sku,barcode", where: { barcode: { in: codes } } }),
  ]);
  const lines = raw.map((l) => {
    const p = bySku.find((x) => x.sku === l.code) ?? byBarcode.find((x) => x.barcode === l.code);
    if (!p) throw new UserError(pick(L, `No item with SKU or barcode ${l.code}.`, `لا صنف بالرمز أو الباركود ${l.code}.`));
    return { product_id: p.id, qty: l.qty, unit_cost_usd: l.cost };
  });
  const src = await hubId(c);
  const key = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return doAct(c, "purchase_order_create", { supplier, expected, lines: lines.length }, "/purchase-orders", async () => {
    const r = await c.deps.db.rpc<{ po_id: string; number: string; duplicate: boolean }>("create_purchase_order", { p_supplier: supplier, p_source: src, p_expected: expected,
      p_lines: lines, p_by: c.staff.partyId, p_note: text(c, "note", 200) || null, p_key: key.length >= 8 ? `console:${key}` : null });
    const name = (await c.deps.db.rows<{ name: string }>("suppliers", { select: "name", where: { id: supplier }, limit: 1 }))[0]?.name ?? "";
    return { msg: r.duplicate ? pick(L, `${r.number} was already written.`, `${r.number} مكتوب بالفعل.`) : pick(L, `Purchase order ${r.number} written for ${name}.`, `كُتب طلب الشراء ${r.number} لـ ${name}.`), to: `/purchase-orders/${r.po_id}` };
  });
}

async function onePage(c: Ctx) {
  const L = c.lang;
  const po = c.params.po ?? "";
  if (!UUID.test(po)) throw new UserError(pick(L, "That record is not valid.", "هذا السجل غير صالح."));
  const d = await docOf(c, po);
  if (!d) return render(c, pick(L, "Purchase order", "طلب شراء"), empty({ title: pick(L, "No such purchase order.", "لا يوجد طلب شراء كهذا."), icon: "list" }), { translated: true });
  const leads = can(c, LEADS);
  const facts = factList([
    factRow({ label: pick(L, "Supplier", "المورّد"), value: html`<bdi>${d.supplier.name}</bdi>${d.supplier.phone ? html` · <bdi>${d.supplier.phone}</bdi>` : ""}`, notConfirmed: "" }),
    factRow({ label: pick(L, "Expected on", "متوقّع في"), value: html`<bdi>${d.expected_date}</bdi>`, notConfirmed: "" }),
    factRow({ label: pick(L, "Status", "الحالة"), value: statusBadge(L, d.status), notConfirmed: "" }),
    factRow({ label: pick(L, "Written by", "كتبه"), value: html`${d.created_by ?? ""} · ${when(d.created_at)}`, notConfirmed: "" }),
    ...(d.note ? [factRow({ label: pick(L, "Note", "ملاحظة"), value: d.note, notConfirmed: "" })] : []),
    ...(d.status === "cancelled" ? [factRow({ label: pick(L, "Cancelled because", "أُلغي لأن"), value: d.cancel_reason ?? "", notConfirmed: "" })] : []),
    ...(d.status === "received" ? [factRow({ label: pick(L, "Received by", "استلمه"), value: html`${d.received_by ?? ""} · ${when(d.received_at)}${d.supplier_ref ? html` · <bdi>${d.supplier_ref}</bdi>` : ""}`, notConfirmed: "" })] : []),
  ]);
  const printLinks = html`<div class="actions-row">${button({ label: pick(L, "Print in English", "اطبع بالإنجليزية"), href: `/purchase-orders/${d.po_id}/print?lang=en`, icon: "download", variant: "soft" })}
${button({ label: pick(L, "Print in Arabic", "اطبع بالعربية"), href: `/purchase-orders/${d.po_id}/print?lang=ar`, icon: "download", variant: "soft" })}</div>`;

  let body: ReturnType<typeof html>;
  if (d.status === "open") {
    const lineForm = (l: DocLine) => html`<li><div class="head"><strong><span class="n">${l.n}</span><bdi>${nameOf(L, l)}</bdi></strong><span class="tags">${l.storage !== "ambient" ? badge(zoneWord(L, l.storage), "gold") : ""}</span></div>
<p class="muted"><bdi>${l.sku ?? ""}</bdi> · ${pick(L, `ordered ${qty(l.qty)} ${unitWord(L, l.unit)}`, `المطلوب ${qty(l.qty)} ${unitWord(L, l.unit)}`)}${l.unit_cost_usd !== null ? html` · ${usd(l.unit_cost_usd)}` : ""}</p>
<div class="ak-money-fields">${input({ name: `counted_${l.line_id}`, label: pick(L, "Came (count)", "وصل (العدد)"), type: "number", required: true, attrs: { min: "0", step: "any", inputmode: "decimal" } })}
${input({ name: `damaged_${l.line_id}`, label: pick(L, "Of those, damaged", "منها تالف"), type: "number", attrs: { min: "0", step: "any", inputmode: "decimal" } })}
${input({ name: `lot_${l.line_id}`, label: pick(L, "Lot (on the pack)", "رقم الدفعة (على العبوة)"), maxlength: 40 })}
${input({ name: `expiry_${l.line_id}`, label: l.storage === "ambient" ? pick(L, "Expiry (if the pack has one)", "انتهاء الصلاحية (إن وُجد على العبوة)") : pick(L, "Expiry (needed)", "انتهاء الصلاحية (مطلوب)"), type: "date", required: l.storage !== "ambient" })}
${l.unit_cost_usd === null ? input({ name: `cost_${l.line_id}`, label: pick(L, "Unit cost USD (invoice)", "سعر الوحدة بالدولار (الفاتورة)"), type: "number", attrs: { min: "0", step: "0.0001", inputmode: "decimal" } }) : ""}
${input({ name: `note_${l.line_id}`, label: pick(L, "Note (short or damaged)", "ملاحظة (ناقص أو تالف)"), maxlength: 200 })}</div></li>`;
    body = html`<h2>${pick(L, "Receive", "استلام")}</h2>
<p class="muted">${pick(L, "Count every line, even if none came (type 0). Damaged units do not go on the shelf. Chilled, frozen and fresh goods need their expiry date.", "عُدّ كل سطر، حتى لو لم يصل شيء (اكتب 0). الوحدات التالفة لا تدخل الرف. المبرّد والمجمّد والطازج يحتاج تاريخ انتهاء الصلاحية.")}</p>
${form(c.f, `/purchase-orders/${d.po_id}/receive`, html`<ol class="ak-rows">${d.lines.map(lineForm)}</ol>
<div class="ak-money-fields">${input({ name: "supplier_ref", label: pick(L, "Invoice or delivery-note number", "رقم الفاتورة أو إشعار التسليم"), maxlength: 60 })}
${select({ name: "paid_from", label: pick(L, "Paid", "الدفع"), options: [{ value: "credit", label: pick(L, "on credit (we owe the supplier)", "بالدَّين (ندين للمورّد)") }, ...(leads ? [{ value: "hub_cash", label: pick(L, "from the drawer, now", "من الصندوق، الآن") }] : [])] })}</div>
<div class="actions-row">${button({ label: pick(L, "Receive these goods", "استلم هذه البضاعة"), icon: "check", variant: "primary" })}</div>`)}
${leads ? html`<details class="ak-more"><summary>${pick(L, "Cancel this purchase order", "ألغِ طلب الشراء هذا")}</summary>${form(c.f, `/purchase-orders/${d.po_id}/cancel`, html`${input({ name: "reason", label: pick(L, "Why (required)", "السبب (مطلوب)"), maxlength: 200 })}
<div class="actions-row">${button({ label: pick(L, "Cancel the order", "ألغِ الطلب"), variant: "danger", icon: "close" })}</div>`)}</details>` : ""}`;
  } else {
    const got = (l: DocLine) => {
      const x = l.received;
      return html`<li data-state="${x && Number(x.short) > 0 ? "missing" : "done"}"><div class="head"><strong><span class="n">${l.n}</span><bdi>${nameOf(L, l)}</bdi></strong></div>
<p class="muted">${pick(L, `ordered ${qty(l.qty)}`, `المطلوب ${qty(l.qty)}`)}${x ? html` · ${pick(L, `came ${qty(x.counted)}, damaged ${qty(x.damaged)}, on the shelf ${qty(x.received)}`, `وصل ${qty(x.counted)}، تالف ${qty(x.damaged)}، على الرف ${qty(x.received)}`)}${Number(x.short) > 0 ? html` · <strong>${pick(L, `short ${qty(x.short)}`, `ناقص ${qty(x.short)}`)}</strong>` : ""}` : ""}</p>
${x && (x.lot || x.expiry_date) ? html`<p class="muted">${x.lot ? pick(L, `Lot ${x.lot}`, `الدفعة ${x.lot}`) : ""}${x.lot && x.expiry_date ? " · " : ""}${x.expiry_date ? pick(L, `use by ${x.expiry_date}`, `يُستهلك قبل ${x.expiry_date}`) : ""}</p>` : ""}
${x?.note ? html`<p class="muted">${x.note}</p>` : ""}</li>`;
    };
    const capture = d.label_capture ?? [];
    body = html`<h2>${d.status === "received" ? pick(L, "What came", "ما وصل") : pick(L, "Items", "الأصناف")}</h2><ol class="ak-rows">${d.lines.map(got)}</ol>
${d.short?.length ? html`<h3>${pick(L, "Short", "ناقص")}</h3><ul>${d.short.map((s) => html`<li><bdi>${nameOf(L, s)}</bdi>: ${pick(L, `${qty(s.short)} of ${qty(s.ordered)} did not come`, `${qty(s.short)} من ${qty(s.ordered)} لم يصل`)}</li>`)}</ul>` : ""}
${d.damaged?.length ? html`<h3>${pick(L, "Damaged", "تالف")}</h3><ul>${d.damaged.map((s) => html`<li><bdi>${nameOf(L, s)}</bdi>: ${qty(s.damaged)}${s.note ? html` (${s.note})` : ""}</li>`)}</ul>` : ""}
${d.short?.length || d.damaged?.length ? html`<p class="muted">${pick(L, "For short and damaged goods, agree a credit note with the supplier (Receiving page, the supplier's balance).", "للناقص والتالف: اتّفق مع المورّد على إشعار دائن (صفحة الاستلام، رصيد المورّد).")}</p>` : ""}
${d.status === "received" ? html`<h2>${pick(L, "Label day", "يوم الملصقات")}</h2>${capture.length ? html`<p>${pick(L, `${capture.length} item(s) from this delivery are packaged and not label-ready. Those not yet photographed are first on the label day's list.`, `${capture.length} صنف من هذا التسليم معبّأ وغير جاهز الملصق. غير المصوَّر منها في أول قائمة تصوير الملصقات.`)}</p>
<ul>${capture.map((x) => html`<li><bdi>${nameOf(L, x)}</bdi> · ${x.photographed ? badge(pick(L, "photographed, waiting to be read or approved", "مصوَّر، بانتظار القراءة أو الموافقة"), "neutral") : badge(pick(L, "to photograph", "للتصوير"), "warn", "camera")}</li>`)}</ul>
<div class="actions-row">${button({ label: pick(L, "Start photographing", "ابدأ التصوير"), href: "/capture", icon: "camera", variant: "primary" })}</div>`
      : html`<p class="muted">${pick(L, "Every item from this delivery is loose or label-ready.", "كل أصناف هذا التسليم سائبة أو جاهزة الملصق.")}</p>`}` : ""}`;
  }
  return render(c, pick(L, `Purchase order ${d.number}`, `طلب شراء ${d.number}`), html`${facts}${printLinks}${body}
<p><a href="/purchase-orders">${pick(L, "All purchase orders", "كل طلبات الشراء")}</a></p>`, { translated: true });
}

/** The paper: no menu, in the language asked for (?lang=ar or en), whatever the staff member reads. Printed with the browser's Print. */
async function printPage(c: Ctx) {
  const po = c.params.po ?? "";
  if (!UUID.test(po)) throw new UserError("That record is not valid.");
  const L: Lang = c.url.searchParams.get("lang") === "ar" ? "ar" : "en";
  const d = await docOf(c, po);
  if (!d) throw new UserError(pick(L, "No such purchase order.", "لا يوجد طلب شراء كهذا."));
  const costs = d.lines.some((l) => l.unit_cost_usd !== null);
  return renderBare(c, L, pick(L, `Purchase order ${d.number}`, `طلب شراء ${d.number}`), html`
<p class="muted no-print">${pick(L, "Use the browser's Print (or Share, then Print) to print this page or save it as a PDF.", "استعمل «طباعة» في المتصفح (أو «مشاركة» ثم «طباعة») لطباعة هذه الصفحة أو حفظها PDF.")} <a href="/purchase-orders/${d.po_id}">${pick(L, "Back", "رجوع")}</a></p>
${factList([
    factRow({ label: pick(L, "From", "من"), value: html`Alo King · <bdi>${d.hub}</bdi>`, notConfirmed: "" }),
    factRow({ label: pick(L, "Supplier", "المورّد"), value: html`<bdi>${d.supplier.name}</bdi>${d.supplier.phone ? html` · <bdi>${d.supplier.phone}</bdi>` : ""}${d.supplier.terms ? html` · ${d.supplier.terms}` : ""}`, notConfirmed: "" }),
    factRow({ label: pick(L, "Written on", "تاريخ الطلب"), value: html`<bdi>${new Date(d.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" })}</bdi>`, notConfirmed: "" }),
    factRow({ label: pick(L, "Expected on", "التسليم المتوقّع"), value: html`<bdi>${d.expected_date}</bdi>`, notConfirmed: "" }),
  ])}
<div class="ak-table-wrap"><table class="ak-table"><thead><tr><th>#</th><th>${pick(L, "Item and code", "الصنف والرمز")}</th><th>${pick(L, "Quantity", "الكمية")}</th>${costs ? html`<th>${pick(L, "Unit cost", "سعر الوحدة")}</th>` : ""}</tr></thead>
<tbody>${d.lines.map((l) => html`<tr><td>${l.n}</td><td class="wrap"><bdi>${nameOf(L, l)}</bdi><br><small class="muted"><bdi>${l.barcode ?? l.sku ?? ""}</bdi></small></td><td><bdi>${qty(l.qty)} ${unitWord(L, l.unit)}</bdi></td>${costs ? html`<td>${l.unit_cost_usd !== null ? usd(l.unit_cost_usd) : ""}</td>` : ""}</tr>`)}</tbody></table></div>
${d.note ? html`<p><strong>${pick(L, "Note", "ملاحظة")}:</strong> ${d.note}</p>` : ""}
<p>${pick(L, "Please write this order's number on the invoice or the delivery note.", "الرجاء كتابة رقم هذا الطلب على الفاتورة أو إشعار التسليم.")}</p>
<p>${pick(L, "Received by: ____________________   Date: ____________", "استلمه: ____________________   التاريخ: ____________")}</p>`);
}

async function receive(c: Ctx) {
  const L = c.lang;
  const po = c.params.po ?? "";
  if (!UUID.test(po)) throw new UserError(pick(L, "That record is not valid.", "هذا السجل غير صالح."));
  const d = await docOf(c, po);
  if (!d) throw new UserError(pick(L, "No such purchase order.", "لا يوجد طلب شراء كهذا."));
  const numOrNull = (v: string | undefined, what: string, i: number) => {
    const s = (v ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) throw new UserError(pick(L, `Line ${i}: ${what} is not a number.`, `السطر ${i}: ${what} ليس رقماً.`));
    return n;
  };
  const lines = d.lines.map((l) => {
    const exp = (c.form[`expiry_${l.line_id}`] ?? "").trim();
    if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new UserError(pick(L, `Line ${l.n}: the expiry date is not a date.`, `السطر ${l.n}: تاريخ انتهاء الصلاحية ليس تاريخاً.`));
    return { line_id: l.line_id, counted: numOrNull(c.form[`counted_${l.line_id}`], pick(L, "the count", "العدد"), l.n), damaged: numOrNull(c.form[`damaged_${l.line_id}`], pick(L, "damaged", "التالف"), l.n) ?? 0,
      lot: (c.form[`lot_${l.line_id}`] ?? "").trim().slice(0, 40) || null, expiry_date: exp || null,
      unit_cost_usd: numOrNull(c.form[`cost_${l.line_id}`], pick(L, "the cost", "السعر"), l.n), note: (c.form[`note_${l.line_id}`] ?? "").trim().slice(0, 200) || null };
  });
  const paidFrom = c.form.paid_from === "hub_cash" ? "hub_cash" : "credit";
  const back = `/purchase-orders/${po}`;
  return doAct(c, "purchase_order_receive", { po, number: d.number, paid_from: paidFrom, lines: lines.length }, back, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; total_usd: number | string; short: unknown[]; damaged: unknown[]; label_capture: unknown[];
      margins?: { name: string; margin_pct: number | string | null }[] }>("receive_purchase_order", {
      p_po: po, p_lines: lines, p_by: c.staff.partyId, p_paid_from: paidFrom, p_supplier_ref: text(c, "supplier_ref", 60) || null, p_note: null });
    if (r.duplicate) return { msg: pick(L, `${d.number} was already received; nothing changed.`, `استُلم ${d.number} من قبل؛ لم يتغيّر شيء.`) };
    const units = lines.reduce((a, l) => a + Math.max(0, (l.counted ?? 0) - l.damaged), 0);
    const parts = [pick(L, `Received ${d.number}: ${qty(units)} unit(s) on the shelf, ${usd(r.total_usd)} at cost.`, `استُلم ${d.number}: ${qty(units)} وحدة على الرف، بكلفة ${usd(r.total_usd)}.`)];
    if (r.margins?.length) parts.push(pick(L, `Margin at today's price: ${r.margins.map((m) => `${m.name} ${m.margin_pct == null ? "no price" : `${Number(m.margin_pct)}%`}`).join("; ")}.`,
      `الهامش بسعر اليوم: ${r.margins.map((m) => `${m.name} ${m.margin_pct == null ? "بلا سعر" : `${Number(m.margin_pct)}%`}`).join("؛ ")}.`));
    if (r.short.length) parts.push(pick(L, `${r.short.length} line(s) short.`, `${r.short.length} سطر ناقص.`));
    if (r.damaged.length) parts.push(pick(L, `${r.damaged.length} line(s) with damaged units.`, `${r.damaged.length} سطر فيه تالف.`));
    if (r.label_capture.length) parts.push(pick(L, `${r.label_capture.length} item(s) go to the label day's list.`, `${r.label_capture.length} صنف إلى قائمة تصوير الملصقات.`));
    return { msg: parts.join(" ") };
  });
}

async function cancel(c: Ctx) {
  const L = c.lang;
  const po = c.params.po ?? "";
  if (!UUID.test(po)) throw new UserError(pick(L, "That record is not valid.", "هذا السجل غير صالح."));
  const reason = text(c, "reason", 200);
  const number = (await c.deps.db.rows<{ number: string }>("purchase_orders", { select: "number", where: { id: po }, limit: 1 }))[0]?.number ?? "";
  return doAct(c, "purchase_order_cancel", { po, number, reason }, `/purchase-orders/${po}`, async () => {
    await c.deps.db.rpc("cancel_purchase_order", { p_po: po, p_by: c.staff.partyId, p_reason: reason });
    return { msg: pick(L, `${number} cancelled.`, `أُلغي ${number}.`) };
  });
}

export const purchaseOrdersSection: Section = {
  nav: { href: "/purchase-orders", label: "Purchase orders", roles: ALL },
  routes: [
    { method: "GET", path: "/purchase-orders", roles: ALL, handler: listPage },
    { method: "POST", path: "/purchase-orders", roles: LEADS, handler: create },
    { method: "GET", path: "/purchase-orders/:po", roles: ALL, handler: onePage },
    { method: "GET", path: "/purchase-orders/:po/print", roles: ALL, handler: printPage },
    { method: "POST", path: "/purchase-orders/:po/receive", roles: ALL, handler: receive },
    { method: "POST", path: "/purchase-orders/:po/cancel", roles: LEADS, handler: cancel },
  ],
};
