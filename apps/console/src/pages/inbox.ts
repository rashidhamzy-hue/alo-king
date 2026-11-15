// HO1 (docs/strategy/05 section D, "What staff experience"): the Inbox. Drawn again in DS1 (section A): the logic, the routes and
// what each form posts are HO1's, unchanged; only how the page looks and its two languages are new.
// A person is added to a conversation; the bot is never removed from it. The list is the open cases, the oldest timer first
// (cases_inbox, 0136). Opening one shows the chat, the order and a reply drafted from the case by code (support.draft, from the
// read-only case_context; no model, nothing sent by itself). The person edits it and sends it through the gateway in one tap
// (the customer number only; can_send and the outbox decide), which renews the bot's pause (staff_replied). Claim pauses the bot
// for settings.support.pause_min; "give back to the bot" ends the pause; resolve closes the case and sends one closing line.
// Below the list: the automatic credits of the last 30 days, for the spot check, counted per picker (0137).
import { act, html, id, render, text, UserError, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { pick, t, type Lang as UiLang } from "../i18n";
import { LEADS } from "../roles";
import { messages, type Lang } from "@ak/agents/messages";
import { badge, caseList, caseRow, dataTable, empty, icon, tabs, timerChip } from "@ak/ui/components";

type InboxRow = { case_id: string; kind: string; topic: string | null; state: string; order_code: string | null; customer: string; minutes: number;
  late: boolean; after_hours: boolean; callback_requested: boolean; rounds: number; claimed_by: string | null; pause_until: string | null;
  last_message: { direction: string; type: string; body: string | null; at: string } | null };
type CaseContext = { case_id: string; kind: Parameters<ReturnType<typeof messages>["support"]["draft"]>[0]; topic: string | null; state: string;
  party_id: string; customer: string | null; lang: Lang; late: boolean; rounds: number; claimed_by: string | null; pause_until: string | null;
  callback_requested: boolean; after_hours: boolean; window_open: boolean; opened_at: string;
  order: { id: string; short_code: string; status: string; total_usd: number; payment_method: string; created_at: string } | null;
  messages: { direction: string; type: string; body: string | null; at: string }[] };
type Credit = { order_id: string; customer_id: string; picker_id: string | null; amount_usd: number; decision: string; why: string | null; created_at: string };

const KIND: Record<string, [string, string]> = { person_requested: ["Asked for a person", "طلب شخصاً"], order_problem: ["Order problem", "مشكلة في الطلب"], complaint: ["Complaint", "شكوى"],
  refund: ["Refund", "استرداد"], payment: ["Payment", "دفع"], safety: ["Safety", "سلامة"], other: ["Other", "أخرى"] };
const kindName = (k: string, L: UiLang = "en") => (KIND[k] ? pick(L, KIND[k]![0], KIND[k]![1]) : k);
const said = (m: { type: string; body: string | null } | null, L: UiLang = "en") => (m ? (m.type === "audio" ? pick(L, "[voice note]", "[رسالة صوتية]") : m.type === "image" ? pick(L, "[picture]", "[صورة]") : m.body ?? `[${m.type}]`) : "");
export const inboxTabs = (L: UiLang, here: "cases" | "complaints", waiting = 0) =>
  tabs([{ label: t(L, "tab_cases"), href: "/inbox", current: here === "cases", count: waiting }, { label: t(L, "tab_complaints"), href: "/cases", current: here === "complaints" }], t(L, "nav_inbox"));

async function list(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const rows = await db.rpc<InboxRow[]>("cases_inbox", { p_staff: c.staff.partyId });
  const since = new Date(c.deps.now().getTime() - 30 * 86_400_000).toISOString();
  const credits = await db.rows<Credit>("auto_credits", { select: "order_id,customer_id,picker_id,amount_usd,decision,why,created_at",
    where: { created_at: { gte: since } }, order: [{ col: "created_at", desc: true }], limit: 200 }).catch(() => [] as Credit[]);
  const pickerIds = [...new Set(credits.map((x) => x.picker_id).filter((x): x is string => !!x))];
  const pickers = pickerIds.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: pickerIds } } }) : [];
  const name = (p: string | null) => (p ? pickers.find((x) => x.id === p)?.display_name ?? pick(L, "Picker", "مجهّز") : pick(L, "Not recorded", "غير مسجّل"));
  const perPicker = [...new Set(credits.map((x) => x.picker_id))].map((p) => ({ p, n: credits.filter((x) => x.picker_id === p && x.decision === "credited").length,
    usd: credits.filter((x) => x.picker_id === p && x.decision === "credited").reduce((s, x) => s + Number(x.amount_usd), 0),
    toPerson: credits.filter((x) => x.picker_id === p && x.decision === "to_person").length }));
  // The ladder's minutes are settings (settings.support), never numbers here: a claimed case is calm, an unclaimed one turns amber at the first alert.
  const ladder = await db.rpc<{ claim_alert_min?: number; late_min?: number } | null>("setting", { p_key: "support" }).catch(() => null);
  const claimAt = Number(ladder?.claim_alert_min ?? NaN);

  return render(c, t(L, "nav_inbox"), html`
${inboxTabs(L, "cases", rows.length)}
<p class="muted">${pick(L, "Customers waiting for a person, the longest wait first. The bot keeps answering them meanwhile; claim a case to step it back.", "الزبائن الذين ينتظرون شخصاً، الأطول انتظاراً أولاً. الروبوت يواصل الرد عليهم؛ استلم الحالة ليتراجع.")}</p>
${rows.length === 0 ? empty({ ok: true, title: pick(L, "Nobody is waiting for a person.", "لا أحد ينتظر شخصاً.") }) : caseList(rows.map((r) => caseRow({
    href: `/inbox/${r.case_id}`, openLabel: pick(L, "Open", "افتح"),
    state: r.late ? "late" : r.state === "claimed" ? "claimed" : "open",
    timer: timerChip({ minutes: r.minutes, promise: null, text: `${r.minutes} ${pick(L, "min", "د")}`, state: r.late ? "late" : r.state === "claimed" ? "idle" : r.minutes >= claimAt ? "warn" : "ok" }),
    title: `${kindName(r.kind, L)} · ${r.customer}`, order: r.order_code,
    last: r.last_message ? `${r.last_message.direction === "inbound" ? r.customer : pick(L, "us", "نحن")}: ${said(r.last_message, L).slice(0, 120)}` : undefined,
    tags: [
      r.state === "claimed" ? badge(r.claimed_by ?? pick(L, "someone", "أحدهم"), "ok", "user") : badge(pick(L, "nobody yet", "لا أحد بعد"), "warn"),
      ...(r.late ? [badge(pick(L, "late", "متأخرة"), "danger")] : []),
      ...(r.callback_requested ? [badge(pick(L, "call back", "طلب اتصالاً"), "gold", "phone")] : []),
      ...(r.after_hours ? [badge(pick(L, "after hours", "خارج الدوام"))] : []),
      ...(r.rounds ? [badge(pick(L, `came back ${r.rounds}×`, `عادت ${r.rounds}×`))] : []),
    ] })))}
<h2>${pick(L, "Automatic credits, last 30 days (spot check)", "الأرصدة التلقائية، آخر 30 يوماً (تدقيق)")}</h2>
${credits.length === 0 ? html`<p class="muted">${pick(L, "None.", "لا شيء.")}</p>` : html`
${dataTable({ caption: pick(L, "Automatic credits per picker", "الأرصدة التلقائية لكل مجهّز"),
    columns: [{ label: pick(L, "Picker", "المجهّز") }, { label: pick(L, "Credited", "أُضيف رصيد"), num: true }, { label: pick(L, "Amount", "المبلغ"), num: true }, { label: pick(L, "Sent to a person", "حُوّل إلى شخص"), num: true }],
    rows: perPicker.map((x) => ({ cells: [name(x.p), x.n, `$${x.usd.toFixed(2)}`, x.toPerson] })) })}
<p></p>
${dataTable({ caption: pick(L, "The latest automatic credits", "آخر الأرصدة التلقائية"),
    columns: [{ label: pick(L, "When", "متى") }, { label: pick(L, "Decision", "القرار") }, { label: pick(L, "Amount", "المبلغ"), num: true }, { label: pick(L, "Why", "السبب"), wrap: true }, { label: pick(L, "Picker", "المجهّز") }, { label: pick(L, "Order", "الطلب") }],
    rows: credits.slice(0, 50).map((x) => ({ cells: [when(x.created_at), x.decision === "credited" ? pick(L, "credited", "أُضيف رصيد") : pick(L, "to a person", "إلى شخص"), `$${Number(x.amount_usd).toFixed(2)}`,
      x.why ?? "", name(x.picker_id), html`<a href="/orders/${x.order_id}">${pick(L, "order", "الطلب")}</a>`] })) })}`}`, { translated: true });
}

async function one(c: Ctx) {
  const L = c.lang;
  const caseId = id(c, "case");
  const x = await c.deps.db.rpc<CaseContext>("case_context", { p_case: caseId, p_staff: c.staff.partyId });
  const draft = messages(x.lang).support.draft(x.kind, x.order?.short_code ?? null);
  const paused = x.pause_until && new Date(x.pause_until) > c.deps.now();
  const open = x.state !== "resolved";
  const stateWord = x.state === "claimed" ? pick(L, "claimed", "مستلمة") : x.state === "resolved" ? pick(L, "resolved", "محلولة") : pick(L, "open", "مفتوحة");
  return render(c, `${t(L, "nav_inbox")}: ${kindName(x.kind, L)}`, html`
<p><a href="/inbox">${icon("chevron", { back: true })} ${t(L, "nav_inbox")}</a></p>
<div class="card"><p><strong>${x.customer ?? pick(L, "Customer", "الزبون")}</strong> · ${kindName(x.kind, L)} · ${badge(`${stateWord}${x.claimed_by ? ` (${x.claimed_by})` : ""}`, x.state === "claimed" ? "ok" : "neutral")} · ${pick(L, "opened", "فُتحت")} ${when(x.opened_at)}
${x.late ? html` ${badge(pick(L, "late", "متأخرة"), "danger")}` : ""}${x.callback_requested ? html` ${badge(pick(L, "asked to be called back", "طلب أن نتصل به"), "gold", "phone")}` : ""}</p>
${x.topic ? html`<p class="muted">${pick(L, "About", "الموضوع")}: ${x.topic}</p>` : ""}
${x.order ? html`<p>${pick(L, "Order", "الطلب")} <a href="/orders/${x.order.short_code}">${x.order.short_code}</a>: ${x.order.status}, ${usd(x.order.total_usd)}, ${x.order.payment_method}</p>` : ""}
<p class="muted">${paused ? html`${pick(L, "The bot is stepped back until", "الروبوت متراجع حتى")} ${when(x.pause_until)}${pick(L, "; each reply you send renews it.", "؛ كل رد ترسله يجدّد ذلك.")}` : pick(L, "The bot is answering this customer.", "الروبوت يرد على هذا الزبون.")}</p></div>
<h2>${pick(L, "The chat", "المحادثة")}</h2>
<ol class="ak-chat">${x.messages.map((m) => html`<li class="${m.direction === "inbound" ? "" : "us"}"><time>${when(m.at)} · ${m.direction === "inbound" ? pick(L, "customer", "الزبون") : pick(L, "us", "نحن")}</time><span dir="auto">${said(m, L)}</span></li>`)}</ol>
${!open ? html`<p class="muted">${pick(L, "Resolved.", "حُلّت.")}</p>` : html`
${x.state === "open" ? form(c.f, `/inbox/${caseId}/claim`, html`<button>${pick(L, "Claim (the bot steps back)", "استلم (يتراجع الروبوت)")}</button>`) : ""}
${x.window_open ? form(c.f, `/inbox/${caseId}/reply`, html`<h2>${pick(L, "Reply", "الرد")}</h2><p class="muted">${pick(L, "A draft from the case; edit it before sending. It goes from the customer number.", "مسودة من الحالة؛ عدّلها قبل الإرسال. تُرسل من رقم الزبائن.")}</p>
<p><textarea name="text" rows="4" cols="60" maxlength="1500" required dir="auto">${draft}</textarea></p><p><button>${pick(L, "Send", "إرسال")}</button></p>`, { cls: "reply" })
                : html`<p><strong class="warn">${pick(L, "WhatsApp's 24-hour window is closed: a reply cannot be sent. Call the customer.", "نافذة واتساب (24 ساعة) مغلقة: لا يمكن إرسال رد. اتصل بالزبون.")}</strong></p>`}
<div class="actions-row">${paused ? form(c.f, `/inbox/${caseId}/release`, html`<button class="secondary">${pick(L, "Give back to the bot now", "أعِدها إلى الروبوت الآن")}</button>`) : ""}</div>
${form(c.f, `/inbox/${caseId}/resolve`, html`<h2>${pick(L, "Resolve", "إغلاق الحالة")}</h2><p><input name="outcome" maxlength="500" required placeholder="${pick(L, "What was done (for the record)", "ماذا فُعل (للسجل)")}" size="34"> <button>${pick(L, "Resolve", "حُلّت")}</button></p>`)}`}`, { translated: true });
}

async function claim(c: Ctx) {
  const caseId = id(c, "case");
  return act(c, "case_claim", { case: caseId }, async () => {
    const r = await c.deps.db.rpc<{ ok: boolean; why?: string; by?: string }>("claim_case", { p_case: caseId, p_by: c.staff.partyId });
    if (!r.ok) throw new UserError(r.why === "taken" ? `${r.by ?? "Someone"} already has this case.` : "This case is resolved.");
    return "Claimed. The bot steps back while you answer.";
  }, `/inbox/${caseId}`);
}

async function reply(c: Ctx) {
  const caseId = id(c, "case");
  const body = text(c, "text", 1500);
  const key = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (!body) throw new UserError("Write the reply first.");
  if (key.length < 8) throw new UserError("The form expired; reload the page.");
  return act(c, "case_reply", { case: caseId, characters: body.length }, async () => {
    const x = await c.deps.db.rpc<CaseContext>("case_context", { p_case: caseId, p_staff: c.staff.partyId });
    if (x.state === "resolved") throw new UserError("This case is resolved.");
    const to = await c.deps.db.rpc<string | null>("party_address", { p_party: x.party_id, p_line: "customer" });
    if (!to) throw new UserError("This customer has no address on the customer line.");
    const r = await c.deps.send({ line: "customer", partyId: x.party_id, to, category: "service", dedupeKey: `console:case:${caseId}:${key}`,
                                  msg: { type: "text", text: { body } } });
    if (!r.ok) throw new UserError(/window/.test(r.refused) ? "Not sent: the 24-hour window is closed." : `Not sent: ${r.refused}.`);
    await c.deps.db.rpc("staff_replied", { p_case: caseId, p_by: c.staff.partyId });
    return r.wamid === "already_sent" ? "Already sent." : "Sent. The bot stays back while you answer.";
  }, `/inbox/${caseId}`);
}

async function release(c: Ctx) {
  const caseId = id(c, "case");
  return act(c, "case_release", { case: caseId }, async () => {
    await c.deps.db.rpc("release_pause", { p_case: caseId, p_by: c.staff.partyId });
    return "The bot answers this customer again. The case stays yours.";
  }, `/inbox/${caseId}`);
}

async function resolve(c: Ctx) {
  const caseId = id(c, "case");
  const outcome = text(c, "outcome", 500);
  if (outcome.length < 3) throw new UserError("Say what was done (a few words).");
  return act(c, "case_resolve", { case: caseId }, async () => {
    const r = await c.deps.db.rpc<{ ok: boolean; already: boolean; party_id: string; lang?: Lang }>("resolve_case", { p_case: caseId, p_by: c.staff.partyId, p_outcome: outcome });
    if (r.already) return "Already resolved.";
    // One closing line (section D, 7). Inside the 24-hour window only; refused outside it, and the case is resolved either way.
    const to = await c.deps.db.rpc<string | null>("party_address", { p_party: r.party_id, p_line: "customer" });
    const closing = to ? await c.deps.send({ line: "customer", partyId: r.party_id, to, category: "service", dedupeKey: `case:${caseId}:resolved`,
                                             msg: { type: "text", text: { body: messages(r.lang).support.resolved } } }) : null;
    return closing?.ok ? "Resolved, and the customer was told." : "Resolved. The closing line could not be sent (the 24-hour window is closed).";
  }, "/inbox");
}

export const inboxSection: Section = {
  nav: { href: "/inbox", label: "Inbox", roles: LEADS },
  routes: [
    { method: "GET", path: "/inbox", roles: LEADS, handler: list },
    { method: "GET", path: "/inbox/:case", roles: LEADS, handler: one },
    { method: "POST", path: "/inbox/:case/claim", roles: LEADS, handler: claim },
    { method: "POST", path: "/inbox/:case/reply", roles: LEADS, handler: reply },
    { method: "POST", path: "/inbox/:case/release", roles: LEADS, handler: release },
    { method: "POST", path: "/inbox/:case/resolve", roles: LEADS, handler: resolve },
  ],
};
