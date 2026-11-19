// FD2: Food (docs/DECISIONS.md, "FD2, 18 November 2026"). Two tabs, ops lead and admin:
//   Calls    every confirmed food order is a task: "Call <place> on <phone>", the order to read out (each dish, its options, the count, the
//            customer's notes, which hold any allergy they stated). Staff record one outcome (0250):
//              accepted, ready in N minutes   the customer hears the arrival estimate (N plus the ride); only then is a rider offered the job
//              an item missing                the customer is asked (go on without it, or cancel): never swapped silently
//              the place is closed            the order is cancelled; the place is closed for the rest of the day
//              a price changed                lower: applied and said; higher: the customer's own tap accepts it or cancels
//            Each customer message goes in their language, through the gateway (notices.ts; invariants 1, 9, 20).
//   Riders   the rider's float for buying at the counter: given, returned, and "paid the place" with the amount and the receipt's photo
//            (shrunk on the phone to 1600 px, JPEG 0.8, by /menus.js; private media bucket, food-receipts/<order>/). The end-of-shift balance
//            per rider: float given, paid to places, returned, held; cash collected and dropped; every food order owed against paid, and any
//            difference in red. A difference is shown, never deducted (invariant 10).
// The console writes nothing itself: every change is a SQL function called as the signed-in person, logged in the action log.
import { act, attempt, flashRedirect, html, id, num, render, upload, UserError, type Ctx, type Section } from "../app";
import { form, money, usd, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { badge, dataTable, empty, tabs } from "@ak/ui/components";
import { foodNotice, type CallOutcome } from "@ak/agents/food-notices";
import { tell, type NoticeResult } from "../notices";

type Item = { item_id: string; name: string; name_ar: string | null; qty: number | string; unit_price_usd: number | string; line_total_usd: number | string;
  options: { name_en: string; name_ar: string | null }[]; modifiers: string[]; note: string | null; status: string };
type Pending = { kind: "item_missing" | "price_up"; item_id: string; name: string; name_ar: string | null; qty: number; line_total_usd?: number;
  was_unit_usd?: number; now_unit_usd?: number; total_was?: number; total_now?: number; asked_at: string };
export type Call = { call_id: string; order_id: string; short_code: string; status: "to_call" | "waiting_customer" | "accepted" | "closed" | "cancelled";
  order_status: string; customer_id: string; place_id: string; place: string; phone: string | null; ready_in_min: number | null; ready_at: string | null;
  pending: Pending | null; created_at: string; subtotal_usd: number | string; total_usd: number | string; notes: string | null;
  village_en: string | null; village_ar: string | null; ride_min: number; items: Item[] };
type Balance = { rider_id: string; name: string; open: boolean; since: string;
  float: { given_usd: number; paid_to_places_usd: number; returned_usd: number; held_usd: number; expected_held_usd: number };
  cash: { collected_usd: number; dropped_usd: number; held_usd: number };
  orders: { order_id: string; short_code: string; status: string; place: string; owed_usd: number; paid_usd: number | null; receipt_path: string | null; difference_usd: number }[];
  differences: number };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STATUS: Record<Call["status"], [string, string, "neutral" | "warn" | "ok" | "danger"]> = {
  to_call: ["To call", "للاتصال", "warn"], waiting_customer: ["Waiting for the customer", "بانتظار الزبون", "neutral"],
  accepted: ["Accepted", "قُبل", "ok"], closed: ["Place closed", "المكان مغلق", "danger"], cancelled: ["Cancelled", "أُلغي", "neutral"] };
const n2 = (x: unknown) => Number(x ?? 0);
/** A difference: in red (the danger badge), never deducted. */
const red = (x: unknown) => badge(usd(x), "danger");
const dishLine = (i: Item, L: Lang) => {
  const opts = (i.options ?? []).map((o) => (L === "ar" ? o.name_ar ?? o.name_en : o.name_en));
  const extra = [...opts, ...(i.modifiers ?? []), ...(i.note ? [i.note] : [])];
  return html`${n2(i.qty)} × ${L === "ar" ? i.name_ar ?? i.name : i.name}${extra.length ? html` <span class="muted">(${extra.join(L === "ar" ? "، " : ", ")})</span>` : ""}`;
};

function callCard(c: Ctx, k: Call) {
  const L = c.lang; const s = STATUS[k.status];
  const ok = k.items.filter((i) => i.status === "ok");
  const actions = k.status !== "to_call" ? (k.status === "waiting_customer"
      ? html`<p class="muted">${pick(L, "The customer was asked; their tap decides. Then call the place again.", "سُئل الزبون؛ نقرته تقرر. ثم اتصل بالمكان من جديد.")}</p>` : "")
    : html`${form(c.f, `/food/${k.call_id}/accept`, html`<label class="ak-field"><span>${pick(L, "The place took it: ready in (minutes)", "قبل المكان الطلب: جاهز خلال (دقائق)")}</span>
<input class="ak-input" type="number" name="ready_in" min="0" max="180" value="20" required></label> <button class="ak-btn ak-btn--primary">${pick(L, "Accepted", "قُبل")}</button>`)}
${form(c.f, `/food/${k.call_id}/missing`, html`<label class="ak-field"><span>${pick(L, "An item is missing", "صنف غير متوفر")}</span><select class="ak-input" name="item" required>
${ok.map((i) => html`<option value="${i.item_id}">${dishLine(i, L)}</option>`)}</select></label> <button class="ak-btn">${pick(L, "Ask the customer", "اسأل الزبون")}</button>`)}
${form(c.f, `/food/${k.call_id}/price`, html`<label class="ak-field"><span>${pick(L, "A price changed", "تغيّر سعر")}</span><select class="ak-input" name="item" required>
${ok.map((i) => html`<option value="${i.item_id}">${dishLine(i, L)} · ${money(i.unit_price_usd)}</option>`)}</select></label>
<label class="ak-field"><span>${pick(L, "The new price of one (USD)", "السعر الجديد للواحد (دولار)")}</span><input class="ak-input" name="unit_usd" inputmode="decimal" required></label>
<button class="ak-btn">${pick(L, "Record the price", "سجّل السعر")}</button>`)}
${form(c.f, `/food/${k.call_id}/closed`, html`<button class="ak-btn ak-btn--danger">${pick(L, "The place is closed: cancel the order", "المكان مغلق: ألغِ الطلب")}</button>`)}`;
  return html`<article class="ak-card" id="call-${k.call_id}">
<h2>${pick(L, `Call ${k.place}`, `اتصل بـ ${k.place}`)} ${k.phone ? html`<a href="tel:${k.phone}"><bdi>${k.phone}</bdi></a>` : html`<span class="muted">${pick(L, "no phone on file (Places page)", "لا هاتف مسجّل (صفحة الأماكن)")}</span>`}</h2>
<p>${badge(pick(L, s[0], s[1]), s[2])} <strong><bdi>${k.short_code}</bdi></strong> · ${when(k.created_at)}${k.ready_at ? html` · ${pick(L, "ready at", "جاهز")} ${when(k.ready_at)}` : ""}</p>
<p class="muted">${pick(L, "Read out to the place:", "اقرأ للمكان:")}</p>
<ul>${ok.map((i) => html`<li>${dishLine(i, L)}</li>`)}</ul>
${k.notes ? html`<p><strong>${pick(L, "Customer's notes (ask about any allergy):", "ملاحظات الزبون (اسأل عن أي حساسية):")}</strong> ${k.notes}</p>` : ""}
<p>${pick(L, "Food", "الأكل")} ${money(k.subtotal_usd)} · ${pick(L, "the customer pays", "يدفع الزبون")} ${money(k.total_usd)} · ${(L === "ar" ? k.village_ar : k.village_en) ?? ""}</p>
${actions}</article>`;
}

function balanceCard(c: Ctx, b: Balance, signed: Map<string, string | null>) {
  const L = c.lang;
  const floatOff = Math.abs(n2(b.float.held_usd) - n2(b.float.expected_held_usd)) > 0.005;
  return html`<article class="ak-card"><h2>${b.name} ${b.open ? badge(pick(L, "On shift", "في الدوام"), "ok") : ""}</h2>
<p class="muted">${pick(L, "Since", "منذ")} ${when(b.since)}</p>
<dl class="ak-dl">
<dt>${pick(L, "Float given", "عهدة أُعطيت")}</dt><dd>${money(b.float.given_usd)}</dd>
<dt>${pick(L, "Paid to places", "دُفع للأماكن")}</dt><dd>${money(b.float.paid_to_places_usd)}</dd>
<dt>${pick(L, "Float returned", "عهدة أُعيدت")}</dt><dd>${money(b.float.returned_usd)}</dd>
<dt>${pick(L, "Float the rider holds", "العهدة مع المندوب")}</dt><dd>${floatOff ? red(b.float.held_usd) : money(b.float.held_usd)}</dd>
<dt>${pick(L, "Cash collected at the door", "كاش حُصّل على الباب")}</dt><dd>${money(b.cash.collected_usd)}</dd>
<dt>${pick(L, "Cash dropped", "كاش سُلّم")}</dt><dd>${money(b.cash.dropped_usd)}</dd>
<dt>${pick(L, "Cash the rider holds", "الكاش مع المندوب")}</dt><dd>${money(b.cash.held_usd)}</dd></dl>
${dataTable({ caption: pick(L, "Food orders: owed to the place against paid", "طلبات الأكل: المستحق للمكان مقابل المدفوع"),
  columns: [{ label: pick(L, "Order", "الطلب") }, { label: pick(L, "Place", "المكان") }, { label: pick(L, "Owed", "المستحق"), num: true }, { label: pick(L, "Paid", "المدفوع"), num: true },
    { label: pick(L, "Difference", "الفرق"), num: true }, { label: pick(L, "Receipt", "الإيصال") }],
  rows: b.orders.map((o) => ({ cells: [html`<bdi>${o.short_code}</bdi>`, o.place, money(o.owed_usd), o.paid_usd == null ? red(0) : money(o.paid_usd),
    o.paid_usd == null || Math.abs(n2(o.difference_usd)) > 0.005 ? red(o.paid_usd == null ? -n2(o.owed_usd) : o.difference_usd) : money(0),
    signed.get(o.order_id) ? html`<a href="${signed.get(o.order_id)}" target="_blank" rel="noopener">${pick(L, "photo", "صورة")}</a>` : html`<span class="muted">${pick(L, "none", "لا يوجد")}</span>`] })),
  empty: empty({ title: pick(L, "No food order in this shift.", "لا طلبات أكل في هذه الوردية."), icon: "check", ok: true }) })}
${b.differences ? html`<p>${badge(pick(L, `${b.differences} order(s) with a difference or no counter payment recorded. Shown, never deducted.`, `${b.differences} طلب فيه فرق أو بلا دفع مسجّل. يُعرض فقط ولا يُخصم أبداً.`), "danger")}</p>` : ""}
</article>`;
}

async function page(c: Ctx) {
  const L = c.lang; const { db } = c.deps;
  const tab = c.url.searchParams.get("tab") === "riders" ? "riders" : "calls";
  const calls = (await db.rpc<Call[]>("food_calls_console", {})) ?? [];
  const open = calls.filter((k) => k.status === "to_call" || k.status === "waiting_customer").length;
  const nav = tabs([
    { label: pick(L, "Calls", "الاتصالات"), href: "/food", current: tab === "calls", count: open },
    { label: pick(L, "Riders' cash", "كاش المناديب"), href: "/food?tab=riders", current: tab === "riders" },
  ], pick(L, "Food", "الأكل"));
  let body;
  if (tab === "calls") {
    body = calls.length ? calls.map((k) => callCard(c, k))
      : empty({ title: pick(L, "No food order to call about.", "لا طلب أكل للاتصال بشأنه."), text: pick(L, "A confirmed food order appears here.", "يظهر هنا كل طلب أكل مؤكَّد."), icon: "check", ok: true });
  } else {
    const balances = (await db.rpc<Balance[]>("riders_float_console", {})) ?? [];
    const riders = await db.rows<{ id: string; display_name: string }>("parties", { select: "id,display_name", where: { role: "driver", is_blocked: false }, order: [{ col: "display_name" }], limit: 100 });
    const signed = new Map<string, string | null>();
    for (const b of balances) for (const o of b.orders) if (o.receipt_path) signed.set(o.order_id, await c.deps.media.sign(o.receipt_path, 600).catch(() => null));
    const unpaid = calls.filter((k) => k.status === "accepted");
    const riderSelect = html`<label class="ak-field"><span>${pick(L, "Rider", "المندوب")}</span><select class="ak-input" name="rider" required>${riders.map((r) => html`<option value="${r.id}">${r.display_name}</option>`)}</select></label>`;
    body = html`<h2>${pick(L, "The float", "العهدة")}</h2>
${form(c.f, "/food/float", html`${riderSelect}<label class="ak-field"><span>${pick(L, "Amount (USD)", "المبلغ (دولار)")}</span><input class="ak-input" name="amount" inputmode="decimal" required></label>
<button class="ak-btn ak-btn--primary" name="kind" value="give">${pick(L, "Give the float", "أعطِ العهدة")}</button> <button class="ak-btn" name="kind" value="return">${pick(L, "Float returned", "أُعيدت العهدة")}</button>`)}
<h2>${pick(L, "The rider paid the place", "المندوب دفع للمكان")}</h2>
${unpaid.length ? html`<form method="post" action="/food/paid" enctype="multipart/form-data" data-menu-upload
 data-msg-working="${pick(L, "Shrinking and sending the receipt…", "جارٍ تصغير الإيصال وإرساله…")}" data-msg-failed="${pick(L, "The receipt was not saved: choose it again.", "لم يُحفظ الإيصال: اختره من جديد.")}">
<input type="hidden" name="_csrf" value="${c.f.csrf}"><input type="hidden" name="_key" value="${c.f.nonce()}">
<label class="ak-field"><span>${pick(L, "Order", "الطلب")}</span><select class="ak-input" name="order" required>${unpaid.map((k) => html`<option value="${k.order_id}">${k.short_code} · ${k.place} · ${money(k.subtotal_usd)}</option>`)}</select></label>
${riderSelect}
<label class="ak-field"><span>${pick(L, "Amount on the receipt (USD)", "المبلغ على الإيصال (دولار)")}</span><input class="ak-input" name="amount" inputmode="decimal" required></label>
<label class="ak-btn ak-btn--primary"><input type="file" name="photo" accept="image/*" capture="environment" required> ${pick(L, "Photograph the receipt and save", "صوّر الإيصال واحفظ")}</label>
<button class="ak-btn" data-nojs>${pick(L, "Save", "احفظ")}</button> <span data-status class="muted" aria-live="polite"></span></form>
<script src="/menus.js" defer></script>` : html`<p class="muted">${pick(L, "No accepted food order waiting for a counter payment.", "لا طلب أكل مقبول بانتظار دفع على الصندوق.")}</p>`}
<h2>${pick(L, "End-of-shift balance", "رصيد نهاية الوردية")}</h2>
${balances.length ? balances.map((b) => balanceCard(c, b, signed)) : empty({ title: pick(L, "No rider on shift or holding a float.", "لا مندوب في الدوام أو معه عهدة."), icon: "users" })}`;
  }
  const intro = html`<p class="muted">${pick(L,
    "Food orders: call the place, record what it said; the customer is told each step in their language. A rider is offered the job only once the place took it. We never message a place's number: staff call it.",
    "طلبات الأكل: اتصل بالمكان وسجّل ما قاله؛ يُخبَر الزبون بكل خطوة بلغته. لا يُعرض الطلب على مندوب إلا بعد أن يقبله المكان. لا نراسل رقم أي مكان: الموظفون يتصلون.")}</p>`;
  return render(c, pick(L, "Food", "الأكل"), html`${intro}${nav}${body}`, { translated: true });
}

// ---------- the customer's messages (packages/agents/src/food-notices.ts: the same words the simulated customers hear) ----------
function notice(c: Ctx, r: Call & { notice: string; eta_minutes?: number; item_id?: string }): Promise<NoticeResult> | null {
  const n = foodNotice(r as unknown as CallOutcome);
  return n ? tell(c.deps, r.customer_id, n.event, n.build, n.key, r.order_id) : null;
}
const told = (L: Lang, n: NoticeResult | null) => !n ? "" : n.sent ? pick(L, " The customer was told.", " أُخبر الزبون.")
  : pick(L, ` The customer could not be told (${n.why ?? "not sent"}): write to them from the Inbox.`, ` تعذّر إخبار الزبون (${n.why ?? "لم تُرسل"}): راسله من صندوق الوارد.`);

async function outcome(c: Ctx, action: string, fn: string, args: Record<string, unknown>, done: (L: Lang) => string, extra: Record<string, unknown> = {}) {
  const L = c.lang; const call = id(c, "call");
  return act(c, action, { call, ...args }, async () => {
    const r = await c.deps.db.rpc<Call & { notice: string; eta_minutes?: number }>(fn, { p_call: call, p_by: c.staff.partyId, ...args });
    const n = await notice(c, { ...r, ...extra } as Call & { notice: string });
    return done(L) + told(L, n);
  }, `/food#call-${call}`);
}
const accept = (c: Ctx) => { const m = num(c, "ready_in", { min: 0, max: 180 })!; return outcome(c, "food_call_accept", "food_call_accept", { p_ready_in_min: Math.round(m) }, (L) => pick(L, "Recorded: the place took it. A rider is offered the job now.", "سُجّل: قبل المكان الطلب. يُعرض الآن على مندوب.")); };
const missing = (c: Ctx) => outcome(c, "food_call_missing", "food_call_item_missing", { p_item: id(c, "item") }, (L) => pick(L, "Recorded. The customer is asked: go on without it, or cancel.", "سُجّل. سُئل الزبون: المتابعة بدونه أو الإلغاء."));
const closed = (c: Ctx) => outcome(c, "food_call_closed", "food_call_closed", {}, (L) => pick(L, "Recorded: the order is cancelled and the place is closed for today.", "سُجّل: أُلغي الطلب وأُغلق المكان لليوم."));
const price = (c: Ctx) => {
  const item = id(c, "item"); const u = num(c, "unit_usd", { min: 0.01, max: 1000 })!;
  return outcome(c, "food_call_price", "food_call_price", { p_item: item, p_unit_usd: u }, (L) => pick(L, "Recorded.", "سُجّل."), { item_id: item });
};

async function float(c: Ctx) {
  const L = c.lang; const rider = id(c, "rider"); const kind = c.form.kind === "return" ? "return" : "give";
  const amount = num(c, "amount", { min: 0.01, max: 1000 })!;
  return act(c, kind === "give" ? "rider_float_give" : "rider_float_return", { rider, amount }, async () => {
    const r = await c.deps.db.rpc<{ float_usd: number }>(kind === "give" ? "rider_float_give" : "rider_float_return", { p_rider: rider, p_by: c.staff.partyId, p_amount_usd: amount });
    return pick(L, `Recorded. The rider now holds $${Number(r.float_usd).toFixed(2)} of float.`, `سُجّل. مع المندوب الآن $${Number(r.float_usd).toFixed(2)} عهدة.`);
  }, "/food?tab=riders");
}

async function paid(c: Ctx) {
  const L = c.lang;
  const json = (c.req.headers.get("accept") ?? "").includes("application/json");
  const refuse = (en: string, ar: string) => { const m = pick(L, en, ar); if (json) return Response.json({ ok: false, error: m }, { status: 422 }); throw new UserError(m); };
  const order = id(c, "order"); const rider = id(c, "rider");
  const amount = Number((c.form.amount ?? "").trim().replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return refuse("Type the amount on the receipt, in dollars.", "اكتب المبلغ على الإيصال بالدولار.");
  const file = c.files.photo;
  if (!file) return refuse("Photograph the receipt first.", "صوّر الإيصال أولاً.");
  if (!IMAGE_TYPES.has(file.type)) return refuse("Attach a photo (JPEG, PNG or WebP).", "أرفق صورة (JPEG أو PNG أو WebP).");
  const r = await attempt(c, "rider_paid_place", { order, rider, amount }, async () => {
    const path = await upload(c, "photo", `food-receipts/${order}`);
    const out = await c.deps.db.rpc<{ difference_usd: number }>("rider_paid_place", { p_order: order, p_rider: rider, p_by: c.staff.partyId, p_amount_usd: amount, p_receipt_path: path });
    const d = Number(out.difference_usd);
    return Math.abs(d) > 0.005 ? pick(L, `Recorded. It differs from the food's price by $${d.toFixed(2)}: shown on the balance, never deducted.`, `سُجّل. يختلف عن سعر الأكل بـ $${d.toFixed(2)}: يظهر في الرصيد ولا يُخصم أبداً.`)
      : pick(L, "Recorded.", "سُجّل.");
  });
  const msg = r.logged ? r.msg : { err: pick(L, "Not done: the action log could not be written. Try again.", "لم يتم: تعذّر تسجيل الإجراء. حاول من جديد.") };
  if (json) return Response.json({ ok: r.logged && r.ok, message: msg.ok ?? msg.err }, { status: r.logged && r.ok ? 200 : 502 });
  return flashRedirect(c.deps, "/food?tab=riders", msg);
}

export const foodSection: Section = {
  nav: { href: "/food", label: "Food", roles: LEADS },
  routes: [
    { method: "GET", path: "/food", roles: LEADS, handler: page },
    { method: "POST", path: "/food/float", roles: LEADS, handler: float },
    { method: "POST", path: "/food/paid", roles: LEADS, handler: paid },
    { method: "POST", path: "/food/:call/accept", roles: LEADS, handler: accept },
    { method: "POST", path: "/food/:call/missing", roles: LEADS, handler: missing },
    { method: "POST", path: "/food/:call/closed", roles: LEADS, handler: closed },
    { method: "POST", path: "/food/:call/price", roles: LEADS, handler: price },
  ],
};
