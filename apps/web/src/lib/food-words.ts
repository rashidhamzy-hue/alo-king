// WEB4b: the food pages' sentences built from what the database said (place_open_now and quote_order's issues, 0249). No time, name or
// amount is decided here; each comes from the database and is only worded.
import { nameIn, t, usd, type Lang } from "./i18n";

export interface PlaceOpen { open: boolean; reason?: string | null; opens?: string | null; closes?: string | null }
const hhmm = (x: string | null | undefined) => (x ? String(x).slice(0, 5) : "");

/** "Taking orders now", "Closed, opens 09:00" or "Closed today", from place_open_now. */
export function openWords(l: Lang, o: PlaceOpen | null | undefined): { open: boolean; text: string } {
  if (o?.open) return { open: true, text: t(l, "w4b_open") };
  if (!o || o.reason === "closed_today" || o.reason === "day_off" || !o.opens) return { open: false, text: t(l, "w4b_closed_today") };
  return { open: false, text: t(l, "w4b_closed_opens", { time: hhmm(o.opens) }) };
}

/** The issues a basket's quote raised that stop it, in words. Where the food is going is the checkout's question, not the basket's. */
export const NOT_THE_BASKETS = new Set(["no_delivery_village", "village_not_served", "empty_order"]);
export function issueWords(l: Lang, i: any, dishName: (productId: string) => string | null): string {
  const dish = (i.product_id && dishName(String(i.product_id))) || nameIn(l, i.name, i.name_ar) || "";
  switch (i.code) {
    case "choice_required": {
      const groups = (i.groups ?? []).map((g: any) => nameIn(l, g.name_en, g.name_ar)).filter(Boolean);
      return t(l, "w4b_issue_choice", { dish, group: groups.join(l === "ar" ? "، " : ", ") });
    }
    case "option_invalid": return `${dish}: ${t(l, "w4b_bad_choice")}`;
    case "unknown_product": case "coming_soon": case "out_of_stock": case "insufficient_stock": return t(l, "w4b_issue_gone", { dish });
    case "place_closed": return i.reason === "closed_today" || i.reason === "day_off" || !i.opens
      ? t(l, "w4b_issue_closed_today", { place: i.name ?? "" }) : t(l, "w4b_issue_closed", { place: i.name ?? "", time: hhmm(i.opens) });
    case "below_minimum": return t(l, "w4b_issue_min", { gap: usd(Math.max(0, Number(i.minimum_usd) - Number(i.subtotal_usd))), min: usd(i.minimum_usd) });
    case "closed": return t(l, "w4b_issue_shop_closed", { time: hhmm(i.opens) });
    default: return t(l, "w4b_issue_other");
  }
}
