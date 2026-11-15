// HO1 (docs/strategy/05 section D, "What staff experience"): the Inbox. A plain page; DS1 restyles it later.
// A person is added to a conversation; the bot is never removed from it. The list is the open cases, the oldest timer first
// (cases_inbox, 0136). Opening one shows the chat, the order and a reply drafted from the case by code (support.draft, from the
// read-only case_context; no model, nothing sent by itself). The person edits it and sends it through the gateway in one tap
// (the customer number only; can_send and the outbox decide), which renews the bot's pause (staff_replied). Claim pauses the bot
// for settings.support.pause_min; "give back to the bot" ends the pause; resolve closes the case and sends one closing line.
// Below the list: the automatic credits of the last 30 days, for the spot check, counted per picker (0137).
import { act, html, id, render, text, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";
import { messages, type Lang } from "@ak/agents/messages";

type InboxRow = { case_id: string; kind: string; topic: string | null; state: string; order_code: string | null; customer: string; minutes: number;
  late: boolean; after_hours: boolean; callback_requested: boolean; rounds: number; claimed_by: string | null; pause_until: string | null;
  last_message: { direction: string; type: string; body: string | null; at: string } | null };
type CaseContext = { case_id: string; kind: Parameters<ReturnType<typeof messages>["support"]["draft"]>[0]; topic: string | null; state: string;
  party_id: string; customer: string | null; lang: Lang; late: boolean; rounds: number; claimed_by: string | null; pause_until: string | null;
  callback_requested: boolean; after_hours: boolean; window_open: boolean; opened_at: string;
  order: { id: string; short_code: string; status: string; total_usd: number; payment_method: string; created_at: string } | null;
  messages: { direction: string; type: string; body: string | null; at: string }[] };
type Credit = { order_id: string; customer_id: string; picker_id: string | null; amount_usd: number; decision: string; why: string | null; created_at: string };

const KIND: Record<string, string> = { person_requested: "Asked for a person", order_problem: "Order problem", complaint: "Complaint", refund: "Refund",
  payment: "Payment", safety: "Safety", other: "Other" };
const kindName = (k: string) => KIND[k] ?? k;
const said = (m: { type: string; body: string | null } | null) => (m ? (m.type === "audio" ? "[voice note]" : m.type === "image" ? "[picture]" : m.body ?? `[${m.type}]`) : "");

async function list(c: Ctx) {
  const { db } = c.deps;
  const rows = await db.rpc<InboxRow[]>("cases_inbox", { p_staff: c.staff.partyId });
  const since = new Date(c.deps.now().getTime() - 30 * 86_400_000).toISOString();
  const credits = await db.rows<Credit>("auto_credits", { select: "order_id,customer_id,picker_id,amount_usd,decision,why,created_at",
    where: { created_at: { gte: since } }, order: [{ col: "created_at", desc: true }], limit: 200 }).catch(() => [] as Credit[]);
  const pickerIds = [...new Set(credits.map((x) => x.picker_id).filter((x): x is string => !!x))];
  const pickers = pickerIds.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: pickerIds } } }) : [];
  const name = (p: string | null) => (p ? pickers.find((x) => x.id === p)?.display_name ?? "Picker" : "Not recorded");
  const perPicker = [...new Set(credits.map((x) => x.picker_id))].map((p) => ({ p, n: credits.filter((x) => x.picker_id === p && x.decision === "credited").length,
    usd: credits.filter((x) => x.picker_id === p && x.decision === "credited").reduce((s, x) => s + Number(x.amount_usd), 0),
    toPerson: credits.filter((x) => x.picker_id === p && x.decision === "to_person").length }));

  return render(c, "Inbox", html`
<p class="muted">Customers waiting for a person, the longest wait first. The bot keeps answering them meanwhile; claim a case to step it back.</p>
${rows.length === 0 ? html`<p class="muted">Nobody is waiting for a person.</p>` : html`<table>
<tr><th>Waiting</th><th>Kind</th><th>Order</th><th>Last message</th><th>Who has it</th><th></th></tr>
${rows.map((r) => html`<tr>
<td><strong class="${r.late ? "warn" : ""}">${r.minutes} min</strong>${r.late ? html`<br><span class="warn">late</span>` : ""}${r.after_hours ? html`<br><span class="muted">after hours</span>` : ""}</td>
<td>${kindName(r.kind)}${r.callback_requested ? html`<br><strong>call back</strong>` : ""}${r.rounds ? html`<br><span class="muted">came back ${r.rounds}×</span>` : ""}</td>
<td>${r.order_code ?? ""}</td>
<td>${r.last_message ? html`<span class="muted">${r.last_message.direction === "inbound" ? r.customer : "us"}:</span> ${said(r.last_message).slice(0, 120)}` : ""}</td>
<td>${r.state === "claimed" ? r.claimed_by ?? "someone" : html`<span class="warn">nobody yet</span>`}</td>
<td><a class="btn" href="/inbox/${r.case_id}">Open</a></td></tr>`)}</table>`}
<h2>Automatic credits, last 30 days (spot check)</h2>
${credits.length === 0 ? html`<p class="muted">None.</p>` : html`
<table><tr><th>Picker</th><th>Credited</th><th>Amount</th><th>Sent to a person</th></tr>
${perPicker.map((x) => html`<tr><td>${name(x.p)}</td><td>${x.n}</td><td>$${x.usd.toFixed(2)}</td><td>${x.toPerson}</td></tr>`)}</table>
<table><tr><th>When</th><th>Decision</th><th>Amount</th><th>Why</th><th>Picker</th><th></th></tr>
${credits.slice(0, 50).map((x) => html`<tr><td>${when(x.created_at)}</td><td>${x.decision === "credited" ? "credited" : "to a person"}</td><td>$${Number(x.amount_usd).toFixed(2)}</td>
<td>${x.why ?? ""}</td><td>${name(x.picker_id)}</td><td><a href="/orders/${x.order_id}">order</a></td></tr>`)}</table>`}`);
}

async function one(c: Ctx) {
  const caseId = id(c, "case");
  const x = await c.deps.db.rpc<CaseContext>("case_context", { p_case: caseId, p_staff: c.staff.partyId });
  const draft = messages(x.lang).support.draft(x.kind, x.order?.short_code ?? null);
  const paused = x.pause_until && new Date(x.pause_until) > c.deps.now();
  const open = x.state !== "resolved";
  return render(c, `Inbox: ${kindName(x.kind)}`, html`
<p><a href="/inbox">← Inbox</a></p>
<p><strong>${x.customer ?? "Customer"}</strong> · ${kindName(x.kind)} · ${x.state}${x.claimed_by ? html` (${x.claimed_by})` : ""} · opened ${when(x.opened_at)}
${x.late ? html` · <strong class="warn">late</strong>` : ""}${x.callback_requested ? html` · <strong>asked to be called back</strong>` : ""}</p>
${x.topic ? html`<p class="muted">About: ${x.topic}</p>` : ""}
${x.order ? html`<p>Order <a href="/orders/${x.order.short_code}">${x.order.short_code}</a>: ${x.order.status}, $${Number(x.order.total_usd).toFixed(2)}, ${x.order.payment_method}</p>` : ""}
<p>${paused ? html`The bot is stepped back until ${when(x.pause_until)}; each reply you send renews it.` : "The bot is answering this customer."}</p>
<table>${x.messages.map((m) => html`<tr><td class="muted">${when(m.at)}</td><td>${m.direction === "inbound" ? "customer" : "us"}</td><td>${said(m)}</td></tr>`)}</table>
${!open ? html`<p class="muted">Resolved.</p>` : html`
${x.state === "open" ? form(c.f, `/inbox/${caseId}/claim`, html`<button>Claim (the bot steps back)</button>`) : ""}
${x.window_open ? form(c.f, `/inbox/${caseId}/reply`, html`<p class="muted">A draft from the case; edit it before sending. It goes from the customer number.</p>
<p><textarea name="text" rows="4" cols="60" maxlength="1500" required>${draft}</textarea></p><p><button>Send</button></p>`)
                : html`<p><strong class="warn">WhatsApp's 24-hour window is closed: a reply cannot be sent. Call the customer.</strong></p>`}
${paused ? form(c.f, `/inbox/${caseId}/release`, html`<button>Give back to the bot now</button>`) : ""}
${form(c.f, `/inbox/${caseId}/resolve`, html`<p><input name="outcome" maxlength="500" required placeholder="What was done (for the record)"> <button>Resolve</button></p>`)}`}`);
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
