// How a confirmed order reaches a restaurant. One interface, three ways, chosen per merchant in source_integrations:
//   whatsapp     the default: an order card with Accept / Ready buttons on the ops line. Works for every kitchen with a phone.
//   pos_webhook  we POST the order as JSON, signed, to the merchant's POS or to a small relay their POS vendor provides.
//   deliverect   for merchants already on Deliverect (it fronts Omega, BIM and others): we act as an ordering channel.
// A POS connection changes how the kitchen hears about the order. It never changes who owns the order state: that stays in our database.
export interface MerchantOrder {
  orderId: string; shortCode: string; sourceId: string; placedAt: string; pickupEtaMinutes: number; note: string | null;
  items: { name: string; qty: number; unitPriceUsd: number; modifiers: string[]; note: string | null; externalId?: string | null }[];
  subtotalUsd: number; payment: "paid_online" | "courier_pays_merchant" | "settled_weekly";
}
export interface MerchantChannel { kind: "whatsapp" | "pos_webhook" | "deliverect"; push(order: MerchantOrder): Promise<{ ok: boolean; externalRef?: string; error?: string }> }

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function posWebhookChannel(cfg: { url: string; secret: string }, doFetch: typeof fetch = fetch): MerchantChannel {
  return { kind: "pos_webhook", async push(order) {
    const body = JSON.stringify({ event: "order.created", order });
    const res = await doFetch(cfg.url, { method: "POST", body, headers: { "content-type": "application/json",
      "x-aloking-signature": await hmacHex(cfg.secret, body), "x-idempotency-key": order.orderId } });
    return res.ok ? { ok: true, externalRef: res.headers.get("x-order-ref") ?? undefined } : { ok: false, error: `http_${res.status}` };
  } };
}

/** Deliverect channel API: POST {base}/{channelName}/order/{channelLinkId}. Needs a signed partner agreement before it can be switched on. */
export function deliverectChannel(cfg: { baseUrl: string; channelName: string; channelLinkId: string; token: () => Promise<string> }, doFetch: typeof fetch = fetch): MerchantChannel {
  return { kind: "deliverect", async push(order) {
    const body = JSON.stringify({
      channelOrderId: order.orderId, channelOrderDisplayId: order.shortCode, orderType: 2 /* delivery by channel */, pickupTime: new Date(Date.now() + order.pickupEtaMinutes * 60_000).toISOString(),
      note: order.note ?? "", decimalDigits: 2, orderIsAlreadyPaid: order.payment !== "courier_pays_merchant",
      items: order.items.map((i) => ({ plu: i.externalId ?? "", name: i.name, quantity: i.qty, price: Math.round(i.unitPriceUsd * 100), comment: [...i.modifiers, i.note ?? ""].filter(Boolean).join(", ") })),
      payment: { amount: Math.round(order.subtotalUsd * 100), type: 0 },
    });
    const res = await doFetch(`${cfg.baseUrl}/${cfg.channelName}/order/${cfg.channelLinkId}`, { method: "POST", body,
      headers: { "content-type": "application/json", authorization: `Bearer ${await cfg.token()}` } });
    return res.ok ? { ok: true } : { ok: false, error: `http_${res.status}` };
  } };
}

/** If the POS is down or refuses, the order still reaches the kitchen: the WhatsApp card is always the fallback. */
export async function pushWithFallback(primary: MerchantChannel | null, whatsapp: MerchantChannel, order: MerchantOrder) {
  if (primary) {
    const r = await primary.push(order).catch((e) => ({ ok: false as const, error: String(e) }));
    if (r.ok) return { via: primary.kind, ...r };
  }
  return { via: whatsapp.kind, ...(await whatsapp.push(order)) };
}
