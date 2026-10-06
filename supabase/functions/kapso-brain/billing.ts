// Billing log: Meta's per-message pricing as it arrives in Kapso's message status webhooks (whatsapp.message.sent / delivered / read / failed).
// Pure parsing only. We store the pricing flags (billable, type, category, model), the status, the error code and who the message went to: never its content.
// Kapso's payload: { message: { id, type, to, template?, kapso: { direction, statuses: [{ id, status, timestamp, recipient_id, pricing?, errors? }] } }, conversation, phone_number_id }.

export type BillingRow = {
  wamid: string; status: string; phone_number_id: string | null; to_phone: string | null; message_type: string | null; template_name: string | null;
  billable: boolean | null; pricing_type: string | null; pricing_category: string | null; pricing_model: string | null; error_code: number | null; status_at: string | null;
};

const STATUS_EVENTS = new Set(["whatsapp.message.sent", "whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.message.failed"]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const digits = (v: unknown): string | null => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 8 && d.length <= 15 ? d : null; };

/** A delivery/read/failure status for a message WE sent (as opposed to a message received from a customer). */
export function isStatusEvent(eventName: string | null | undefined, body: any): boolean {
  if (eventName) return STATUS_EVENTS.has(eventName);
  const m = body?.message;
  return !!m && m.kapso?.direction === "outbound" && !m.from && Array.isArray(m.kapso?.statuses) && m.kapso.statuses.length > 0;
}

/** Anything we sent (never a customer message): such an event must never start a conversation turn, whatever header it arrives with. */
export function isOutboundEvent(evt: any): boolean { return evt?.message?.kapso?.direction === "outbound"; }

export function statusRows(body: any): BillingRow[] {
  const m = body?.message;
  if (!m || typeof m !== "object" || m.from || m.kapso?.direction !== "outbound" || !Array.isArray(m.kapso?.statuses)) return [];
  const wamid = str(m.id);
  const to = digits(m.to) ?? digits(body?.conversation?.phone_number);
  const pnid = str(body?.phone_number_id) ?? str(body?.conversation?.phone_number_id);
  const type = str(m.type), template = m.type === "template" ? str(m.template?.name) : null;
  const rows: BillingRow[] = [];
  for (const s of m.kapso.statuses) {
    if (!s || typeof s !== "object") continue;
    const id = str(s.id) ?? wamid, status = str(s.status);
    if (!id || !status) continue;
    const p = s.pricing && typeof s.pricing === "object" ? s.pricing : null;
    const ts = Number(s.timestamp);
    const err = Array.isArray(s.errors) && s.errors.length ? Number(s.errors[0]?.code) : NaN;
    rows.push({ wamid: id, status, phone_number_id: pnid, to_phone: digits(s.recipient_id) ?? to, message_type: type, template_name: template,
      billable: typeof p?.billable === "boolean" ? p.billable : null, pricing_type: str(p?.type), pricing_category: str(p?.category), pricing_model: str(p?.pricing_model),
      error_code: Number.isFinite(err) ? err : null, status_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null });
  }
  return rows;
}
