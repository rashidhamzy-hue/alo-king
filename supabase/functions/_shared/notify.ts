// Sends the customer a WhatsApp message when their order's status changes (accepted, preparing, on the way, delivered, cancelled, rejected).
// Shared by the order-notify function (called by the merchant/driver apps) and the kapso-brain sweep. Free-form messages only, so only inside
// the customer's 24h window. Takes an injected Supabase client and sender so it never holds credentials itself.
import { buildDeliveredRatingList, etaMinutes, isNotifiable, isSilentStatus, lifecycleText, windowOpen, type Lang } from "./lifecycle.ts";

export type Send = (payload: Record<string, unknown>) => Promise<boolean>;
const envl = (to: string) => ({ messaging_product: "whatsapp", recipient_type: "individual", to });

export async function notifyOrderStatus(sb: any, send: Send, orderId: string, opts: { trackBase?: string; now?: number } = {}): Promise<{ sent: boolean; reason: string }> {
  const { data: o } = await sb.from("orders").select("id,short_code,vendor_id,customer_phone,status,customer_notified_status,customer_lat,customer_lng,driver_lat,driver_lng").eq("id", orderId).maybeSingle();
  if (!o) return { sent: false, reason: "order not found" };
  if (!isNotifiable(o.status)) return { sent: false, reason: "status not notifiable" };
  if (!/^\d{8,15}$/.test(String(o.customer_phone ?? ""))) return { sent: false, reason: "not a WhatsApp customer" }; // web demo orders
  if (o.customer_notified_status === o.status) return { sent: false, reason: "already notified" };

  // Claim this status atomically so the app call and the sweep can never both send it.
  const { data: claimed } = await sb.from("orders").update({ customer_notified_status: o.status }).eq("id", o.id).eq("status", o.status)
    .or(`customer_notified_status.is.null,customer_notified_status.neq.${o.status}`).select("id");
  if (!claimed?.length) return { sent: false, reason: "already notified" };
  const release = () => sb.from("orders").update({ customer_notified_status: o.customer_notified_status ?? null }).eq("id", o.id);
  if (isSilentStatus(o.status)) return { sent: false, reason: "silent status (recorded, not messaged)" }; // e.g. preparing: the next message is on the way

  const { data: cu } = await sb.from("customers").select("last_inbound_at").eq("phone_number", o.customer_phone).maybeSingle();
  const { data: last } = cu?.last_inbound_at ? { data: { created_at: cu.last_inbound_at } } : await sb.from("conversations").select("created_at").eq("phone", o.customer_phone).eq("role", "user").order("id", { ascending: false }).limit(1).maybeSingle();
  if (!windowOpen(last?.created_at, opts.now)) return { sent: false, reason: "24h window closed" }; // nothing free-form can be sent; stays claimed so it is not retried forever

  const [{ data: cust }, { data: v }, { data: prof }] = await Promise.all([
    sb.from("customers").select("language,last_lat,last_lng").eq("phone_number", o.customer_phone).maybeSingle(),
    sb.from("vendors").select("name_en,latitude,longitude").eq("vendor_id", o.vendor_id).maybeSingle(),
    sb.from("vendor_profiles").select("prep_time_min").eq("vendor_id", o.vendor_id).maybeSingle(),
  ]);
  const lang: Lang = cust?.language === "en" ? "en" : "ar";
  // delivered: the delivery text and the five-row rating list are ONE message
  const payload = o.status === "delivered"
    ? buildDeliveredRatingList(o.customer_phone, o.id, lang, { code: o.short_code, vendor: v?.name_en ?? "" })
    : { ...envl(o.customer_phone), type: "text", text: { body: lifecycleText(o.status, lang, { code: o.short_code, vendor: v?.name_en ?? "", prepMin: prof?.prep_time_min, trackUrl: o.status === "out_for_delivery" && opts.trackBase ? `${opts.trackBase}/${o.id}` : null, etaMin: o.status === "out_for_delivery" ? etaMinutes({ driverLat: o.driver_lat, driverLng: o.driver_lng, vendorLat: v?.latitude, vendorLng: v?.longitude, customerLat: o.customer_lat ?? cust?.last_lat, customerLng: o.customer_lng ?? cust?.last_lng }) : null }) } };
  const ok = await send(payload);
  if (!ok) { await release(); return { sent: false, reason: "send failed (will retry)" }; }
  return { sent: true, reason: "sent" };
}
