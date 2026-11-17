// The one label table for order statuses (docs/DECISIONS.md, "Design reference, 17 November 2026", decision 2).
// The ids are the database's (order_transitions; packages/core/src/order-machine.ts): none is renamed. Staff and customers read
// different words for the same id, in Arabic and English. A pill built from this table always carries its words: the colour is
// never the only signal. test/ui/ds2.test.ts holds the table to the order machine, id for id.
import { Raw, html } from "./h";
import type { IconName } from "./icons";
import { ICONS } from "./icons";

export type OrderStatusId =
  | "draft" | "awaiting_confirmation" | "awaiting_payment" | "confirmed" | "preparing" | "ready"
  | "out_for_delivery" | "arrived" | "delivered" | "closed" | "cancelled" | "failed_delivery" | "returned";
export type StatusAudience = "staff" | "customer";
export type StatusLang = "en" | "ar";
export type StatusTone = "neutral" | "warn" | "ink" | "gold" | "info" | "transit" | "ok" | "danger";
type Words = Record<StatusLang, string>;
export interface StatusLabel { staff: Words; customer: Words; /** What a customer who collects at the hub reads, where it differs. */ customerPickup?: Words; tone: StatusTone; icon: IconName }

export const STATUS_LABELS: Record<OrderStatusId, StatusLabel> = {
  draft: { staff: { en: "Draft", ar: "مسودة" }, customer: { en: "Not sent yet", ar: "لم يُرسل بعد" }, tone: "neutral", icon: "list" },
  awaiting_confirmation: { staff: { en: "Awaiting confirm", ar: "بانتظار التأكيد" }, customer: { en: "Waiting for your Confirm", ar: "بانتظار تأكيدك" }, tone: "neutral", icon: "clock" },
  awaiting_payment: { staff: { en: "Awaiting payment", ar: "بانتظار الدفع" }, customer: { en: "Waiting for payment", ar: "بانتظار الدفع" }, tone: "warn", icon: "wallet" },
  confirmed: { staff: { en: "To pick", ar: "للتجهيز" }, customer: { en: "Confirmed", ar: "مؤكد" }, tone: "ink", icon: "list" },
  preparing: { staff: { en: "Picking", ar: "قيد التجهيز" }, customer: { en: "Packing at the hub", ar: "نجهّز طلبك في المستودع" }, tone: "gold", icon: "orders" },
  ready: { staff: { en: "Packed", ar: "جُهّز" }, customer: { en: "Packed", ar: "جاهز" }, customerPickup: { en: "Ready for pickup", ar: "جاهز للاستلام" }, tone: "info", icon: "orders" },
  out_for_delivery: { staff: { en: "On the way", ar: "في الطريق" }, customer: { en: "On the way", ar: "في الطريق" }, tone: "transit", icon: "bike" },
  arrived: { staff: { en: "Rider at the door", ar: "الدليفري عند الباب" }, customer: { en: "At your door", ar: "عند الباب" }, tone: "transit", icon: "pin" },
  // Delivered is not paid (invariant 12): staff read that the order still waits for its payment to be recorded.
  delivered: { staff: { en: "Delivered, not paid yet", ar: "سُلّم ولم يُدفع بعد" }, customer: { en: "Delivered", ar: "سُلّم" }, customerPickup: { en: "Collected", ar: "استُلم" }, tone: "warn", icon: "check" },
  failed_delivery: { staff: { en: "Failed delivery", ar: "فشل التوصيل" }, customer: { en: "Not delivered", ar: "لم يُسلَّم" }, tone: "danger", icon: "warn" },
  returned: { staff: { en: "Returned", ar: "أُعيد" }, customer: { en: "Returned", ar: "أُعيد" }, tone: "neutral", icon: "refresh" },
  closed: { staff: { en: "Closed", ar: "مُغلق" }, customer: { en: "Delivered", ar: "سُلّم" }, customerPickup: { en: "Collected", ar: "استُلم" }, tone: "ok", icon: "check" },
  cancelled: { staff: { en: "Cancelled", ar: "مُلغى" }, customer: { en: "Cancelled", ar: "مُلغى" }, tone: "danger", icon: "close" },
};
export const ORDER_STATUS_IDS = Object.keys(STATUS_LABELS) as OrderStatusId[];

export interface StatusOpts { audience?: StatusAudience; lang?: StatusLang; pickup?: boolean; /** A cancelled order's reason, already in words (the database holds it). */ reason?: string | null }
/** The words for a status. An id this table does not know is shown as it is, never guessed. */
export function statusLabel(id: string, o: StatusOpts = {}): string {
  const row = STATUS_LABELS[id as OrderStatusId];
  if (!row) return id;
  const lang = o.lang ?? "en", who = o.audience ?? "staff";
  const words = who === "customer" ? (o.pickup && row.customerPickup ? row.customerPickup : row.customer) : row.staff;
  return id === "cancelled" && o.reason ? `${words[lang]}: ${o.reason}` : words[lang];
}
/** The status pill: an icon and the words, on the status's own tone. */
export function statusPill(id: string, o: StatusOpts = {}): Raw {
  const row = STATUS_LABELS[id as OrderStatusId];
  const tone = row?.tone ?? "neutral";
  return html`<span class="ak-status${tone === "neutral" ? "" : ` ak-status--${tone}`}" data-status="${id}"><svg class="ak-icon" viewBox="0 0 24 24" aria-hidden="true">${new Raw(ICONS[row?.icon ?? "list"])}</svg>${statusLabel(id, o)}</span>`;
}
