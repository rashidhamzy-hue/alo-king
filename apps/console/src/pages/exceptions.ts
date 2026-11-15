// 3.5 Exceptions and handoffs: the ops_exceptions queue, and the chats a person has taken over. A reply goes through the
// gateway's send() on the customer line (preflight, can_send: open 24-hour window, opt-out, outbox claim). Handing a chat
// back to the Concierge is release_handoff() (0045).
import { act, html, id, render, text, UserError, type Ctx, type Section } from "../app";
import { form, minutesSince, when } from "../html";
import { LEADS } from "../roles";

type Exc = { id: string; kind: string; ref: string; detail: Record<string, unknown>; status: string; created_at: string; last_alert_at: string | null };
type Conv = { id: string; party_id: string; last_inbound_at: string | null; active_order_id: string | null; updated_at: string };
type Msg = { direction: string; type: string; body: string | null; created_at: string; status: string | null };

const detailText = (d: Record<string, unknown>) => Object.entries(d ?? {}).slice(0, 8).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 400);

async function page(c: Ctx) {
  const { db } = c.deps;
  const now = c.deps.now();
  const excs = await db.rows<Exc>("ops_exceptions", { select: "id,kind,ref,detail,status,created_at,last_alert_at", where: { status: { in: ["open", "acknowledged"] } }, order: [{ col: "created_at" }], limit: 200 });
  const convs = await db.rows<Conv>("conversations", { select: "id,party_id,last_inbound_at,active_order_id,updated_at", where: { line: "customer", human_handoff: true }, order: [{ col: "updated_at" }], limit: 50 });
  const parties = convs.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: convs.map((x) => x.party_id) } } }) : [];
  const handoffs = convs.length ? await db.rows<{ conversation_id: string; reason: string; created_at: string }>("handoffs", { select: "conversation_id,reason,created_at", where: { conversation_id: { in: convs.map((x) => x.id) }, status: { not: "resolved" } } }) : [];
  const msgs = await Promise.all(convs.map((x) => db.rows<Msg>("wa_messages", { select: "direction,type,body,created_at,status", where: { party_id: x.party_id, line: "customer" }, order: [{ col: "created_at", desc: true }], limit: 12 })));
  const canRelease = await db.hasFunction("release_handoff");

  return render(c, "Exceptions and chats", html`
<h2>Exceptions (${excs.length})</h2>
${excs.length === 0 ? html`<p class="muted">Nothing open.</p>` : html`<table><tr><th>Since</th><th>Kind</th><th>About</th><th>Detail</th><th>Status</th><th></th></tr>
${excs.map((e) => html`<tr><td>${when(e.created_at)}<br><span class="muted">${minutesSince(e.created_at, now)} min</span></td><td>${e.kind}</td><td>${e.ref}</td>
<td>${detailText(e.detail)}</td><td>${e.status}</td>
<td>${e.status === "open" ? form(c.f, `/exceptions/${e.id}/acknowledged`, html`<button>I'm on it</button>`, { cls: "inline" }) : ""}
${form(c.f, `/exceptions/${e.id}/resolved`, html`<button>Resolved</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<h2>Chats with a person (${convs.length})</h2>
<p class="muted">The Concierge stays out of these chats until you hand them back. Replies go out from the customer number, only inside WhatsApp's 24-hour window.</p>
${convs.map((x, i) => {
  const open = x.last_inbound_at && now.getTime() - new Date(x.last_inbound_at).getTime() < 24 * 3600_000;
  const h = handoffs.find((y) => y.conversation_id === x.id);
  return html`<div class="pair"><div>
<p><strong>${parties.find((p) => p.id === x.party_id)?.display_name ?? "Customer"}</strong>${h ? html` · handed over: ${h.reason} (${when(h.created_at)})` : ""}
${open ? "" : html` · <strong class="warn">24-hour window closed: a reply cannot be sent</strong>`}</p>
<table>${[...msgs[i]!].reverse().map((m) => html`<tr><td class="muted">${when(m.created_at)}</td><td>${m.direction === "inbound" ? "customer" : "us"}</td><td>${m.body ?? `[${m.type}]`}</td></tr>`)}</table>
${form(c.f, `/chats/${x.id}/reply`, html`<p><textarea name="text" rows="3" cols="60" maxlength="1500" required></textarea></p><p><button>Send reply</button></p>`)}
${canRelease ? form(c.f, `/chats/${x.id}/release`, html`<button>Hand back to the Concierge</button>`) : html`<p class="note">Handing back needs release_handoff(), not in the database yet (see docs/HANDOFF.md, Console).</p>`}
</div></div>`;
})}`);
}

async function resolve(c: Ctx) {
  const exc = id(c, "exc");
  const status = c.params.status === "resolved" ? "resolved" : c.params.status === "acknowledged" ? "acknowledged" : null;
  if (!status) throw new UserError("Unknown status.");
  // Today's inbox posts the same form and asks to come back to Today ("/"); anything else comes back here.
  const back = c.form.back === "/" ? "/" : "/exceptions";
  return act(c, `exception_${status}`, { exception: exc }, async () => {
    await c.deps.db.rpc("resolve_ops_exception", { p_id: exc, p_by: c.staff.partyId, p_status: status });
    return status === "resolved" ? "Marked resolved." : "Marked as being handled.";
  }, back);
}

async function reply(c: Ctx) {
  const conv = id(c, "conv");
  const body = text(c, "text", 1500);
  const key = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (!body) throw new UserError("Write the reply first.");
  if (key.length < 8) throw new UserError("The form expired; reload the page.");
  return act(c, "chat_reply", { conversation: conv, characters: body.length }, async () => {
    const x = (await c.deps.db.rows<Conv & { line: string }>("conversations", { select: "id,party_id,line,human_handoff", where: { id: conv, line: "customer" }, limit: 1 }))[0];
    if (!x) throw new UserError("That chat was not found.");
    const to = await c.deps.db.rpc<string | null>("party_address", { p_party: x.party_id, p_line: "customer" });
    if (!to) throw new UserError("This customer has no address on the customer line.");
    // The form's one-time key: a double click sends one message.
    const r = await c.deps.send({ line: "customer", partyId: x.party_id, to, category: "service", dedupeKey: `console:reply:${conv}:${key}`, msg: { type: "text", text: { body } } });
    if (!r.ok) throw new UserError(r.refused === "window_closed" || /window/.test(r.refused) ? "Not sent: the 24-hour window is closed." : `Not sent: ${r.refused}.`);
    return r.wamid === "already_sent" ? "Already sent." : "Reply sent.";
  }, "/exceptions");
}

async function release(c: Ctx) {
  const conv = id(c, "conv");
  return act(c, "chat_release", { conversation: conv }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean }>("release_handoff", { p_conversation: conv, p_by: c.staff.partyId });
    return r?.already ? "This chat was already with the Concierge." : "Handed back to the Concierge.";
  }, "/exceptions");
}

export const exceptionsSection: Section = {
  nav: { href: "/exceptions", label: "Exceptions and chats", roles: LEADS },
  routes: [
    { method: "GET", path: "/exceptions", roles: LEADS, handler: page },
    { method: "POST", path: "/exceptions/:exc/:status", roles: LEADS, handler: resolve },
    { method: "POST", path: "/chats/:conv/reply", roles: LEADS, handler: reply },
    { method: "POST", path: "/chats/:conv/release", roles: LEADS, handler: release },
  ],
};
