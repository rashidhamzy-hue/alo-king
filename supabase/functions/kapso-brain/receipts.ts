// Instant feedback: mark the customer's message read and show "typing…" the moment it arrives.
// Cloud API (verified in the Kapso/Meta docs): POST /{phone_number_id}/messages with {messaging_product, status:"read", message_id, typing_indicator:{type:"text"}}.
// No `to`. The indicator clears when we send a message, or after about 25 s. Meta asks to show it only when a reply is coming.

export function buildReadReceipt(messageId: string | undefined, typing: boolean): Record<string, unknown> | null {
  const id = String(messageId ?? "").trim();
  if (!/^wamid\./.test(id)) return null; // dry-run ids and junk never reach Meta
  return { messaging_product: "whatsapp", status: "read", message_id: id, ...(typing ? { typing_indicator: { type: "text" } } : {}) };
}

export function shouldAck(o: { id?: string; dry: boolean; fromAdmin: boolean }): { read: boolean; typing: boolean } {
  if (o.dry || !o.id) return { read: false, typing: false };
  return { read: true, typing: !o.fromAdmin };
}
