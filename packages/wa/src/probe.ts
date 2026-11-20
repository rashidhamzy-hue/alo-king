// The staging probe (task 4.10): a test customer and a test rider who answer what they are sent, as a person would,
// so an hourly test order walks the whole path. Pure functions; apps/gateway/src/index.ts stores and delivers the result.
// The inbound shape is the real Kapso v2 message shape (test/fixtures/kapso/), BSUID only, no phone: the way Meta is heading.
import type { Outbound } from "./kapso";

/** The buttons a person would tap, in the order an order moves: confirm the card; accept, pick up, deliver, cash exact. Before the card,
 *  "which one?" (B1c's picker, pick:<product>): a person taps one, so the probe taps the first offered (QA1: it stalled there from 16 Nov). */
const NEXT: RegExp[] = [/^order:confirm:/, /^job:accept:/, /^job:picked:/, /^stop:delivered:/, /^stop:exact:/, /^pick:/];

/** What the probe says when asked where exactly: a house, a floor and a landmark, in Lebanese Arabic. */
export const PROBE_ADDRESS = "بيت الاختبار، الطابق الأول، حد ساحة الضيعة";

export type ProbeReply = { kind: "tap"; id: string; title: string; list?: true } | { kind: "pin" } | null;

/** What the probe answers to a message it was sent. Anything it does not recognise gets no answer (the order then stalls, and that is alerted). */
export function probeReply(msg: Outbound | Record<string, unknown>): ProbeReply {
  const m = msg as { type?: string; text?: { body?: string }; interactive?: { type?: string; action?: {
    buttons?: { reply?: { id?: string; title?: string } }[]; sections?: { rows?: { id?: string; title?: string }[] }[] } } };
  // B4: a first delivery to a new place is asked for the house and the floor (pipeline.ts, FIXED.askAddress). The probe answers
  // in words, as a person would. It enters as a reply carrying the words (index.ts sends taps only); the turn reads a reply it
  // does not know as the customer's words, so it takes the real address path (reading, then the card).
  if (m.type === "text" && /كرمال السائق/.test(m.text?.body ?? "")) return { kind: "tap", id: "probe:address", title: PROBE_ADDRESS };
  if (m.type !== "interactive" || !m.interactive) return null;
  if (m.interactive.type === "location_request_message") return { kind: "pin" };
  // FIX2: since CX2 "which one?" is a list message (choices of products as a list); a person picks one, so the probe picks the first
  // product row (staging, 19 November: the probe answered nothing to the list and no test order was placed for most of the day).
  if (m.interactive.type === "list") {
    const rows = (m.interactive.action?.sections ?? []).flatMap((x) => x.rows ?? []).filter((r): r is { id: string; title?: string } => !!r?.id);
    for (const want of NEXT) {
      const r = rows.find((x) => want.test(x.id));
      if (r) return { kind: "tap", id: r.id, title: r.title ?? "", list: true };
    }
    return null;
  }
  const buttons = (m.interactive.action?.buttons ?? []).map((b) => b.reply).filter((r): r is { id: string; title?: string } => !!r?.id);
  for (const want of NEXT) {
    const b = buttons.find((x) => want.test(x.id));
    if (b) return { kind: "tap", id: b.id, title: b.title ?? "" };
  }
  return null;
}

export type ProbeMessage = { type: "text"; body: string } | { type: "tap"; id: string; title: string; list?: true } | { type: "location"; lat: number; lng: number };

/** A whatsapp.message.received body, shaped like Kapso's, from a probe party. */
export function probeInbound(o: { phoneNumberId: string; waUserId: string; name: string; msg: ProbeMessage; now?: number }): Record<string, unknown> {
  const ts = Math.floor((o.now ?? Date.now()) / 1000);
  const id = `wamid.PROBE${ts}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const content = o.msg.type === "text" ? o.msg.body : o.msg.type === "tap" ? `Selected: ${o.msg.title}` : `Lat: ${o.msg.lat}, Long: ${o.msg.lng}`;
  const message: Record<string, unknown> = {
    id, timestamp: String(ts), from_user_id: o.waUserId, from_parent_user_id: null, username: null, context: null,
    type: o.msg.type === "tap" ? "interactive" : o.msg.type,
    kapso: { direction: "inbound", status: "received", processing_status: "pending", origin: "cloud_api", has_media: false, content, probe: true },
  };
  if (o.msg.type === "text") message.text = { body: o.msg.body };
  if (o.msg.type === "tap") message.interactive = o.msg.list ? { type: "list_reply", list_reply: { id: o.msg.id, title: o.msg.title } }
                                                             : { type: "button_reply", button_reply: { id: o.msg.id, title: o.msg.title } };
  if (o.msg.type === "location") message.location = { latitude: o.msg.lat, longitude: o.msg.lng };
  return {
    message,
    conversation: { id: `probe-${o.waUserId}`, contact_name: o.name, phone_number: null, business_scoped_user_id: o.waUserId, status: "active", phone_number_id: o.phoneNumberId },
    is_new_conversation: false,
    phone_number_id: o.phoneNumberId,
  };
}
