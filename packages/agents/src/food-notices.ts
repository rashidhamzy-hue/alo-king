// FD2: what the customer hears when staff call the place ahead (0250), in their language. One builder, used by the console's Food page and by
// the simulated customers (evals/sim/driver.ts), so both send the same words. Built from the database's answer (food_call_json and the
// outcome), never from model text. The two questions carry the customer's buttons (food.ts parses them back: fcall:<answer>:<call>).
import { buttons } from "@ak/wa/kapso";
import { productName, type Messages } from "./messages";
import type { Built, TemplateEvent } from "./messages/notify";
import { callAnswerId } from "./food";

export interface CallItem { item_id: string; name: string; name_ar: string | null; status: string }
export interface CallPending { kind: "item_missing" | "price_up"; item_id: string; name: string; name_ar: string | null; qty: number | string;
  was_unit_usd?: number | string; now_unit_usd?: number | string; total_now?: number | string; asked_at?: string }
/** A staff outcome as the database returns it (food_call_accept, _item_missing, _closed, _price). */
export interface CallOutcome { call_id: string; order_id: string; short_code: string; customer_id: string; place: string; total_usd: number | string;
  notice: string; eta_minutes?: number; pending: CallPending | null; items: CallItem[]; item_id?: string }
export interface FoodNotice { event: TemplateEvent; key: string; build: (m: Messages) => Built }

const n = (x: unknown) => Number(x ?? 0);
const named = (x: { name: string; name_ar: string | null }, m: Messages) => productName({ name: x.name, name_ar: x.name_ar }, m.lang);

/** The message for an outcome; null when the outcome tells the customer nothing. Keys are stable per outcome, so sending again is safe. */
export function foodNotice(r: CallOutcome): FoodNotice | null {
  const code = r.short_code, place = r.place, call = r.call_id;
  switch (r.notice) {
    case "accepted":
      return { event: "food_accepted", key: `food:accepted:${call}`,
               build: (m) => ({ msg: { type: "text", text: { body: m.food.accepted(code, place, n(r.eta_minutes)) } }, params: [code] }) };
    case "closed":
      return { event: "food_closed", key: `food:closed:${call}`, build: (m) => ({ msg: { type: "text", text: { body: m.food.closedNow(code, place) } }, params: [code] }) };
    case "item_missing": {
      const p = r.pending!;
      const ids = [callAnswerId("drop", call), callAnswerId("cancel", call)];
      return { event: "food_item_missing", key: `food:missing:${call}:${p.asked_at ?? ""}`,
               build: (m) => ({ msg: buttons(m.food.itemMissing(code, place, named(p, m)), [{ id: ids[0]!, title: m.food.keepRest }, { id: ids[1]!, title: m.food.cancelOrder }]),
                                params: [code], payloads: ids }) };
    }
    case "price_up": {
      const p = r.pending!;
      const ids = [callAnswerId("accept", call), callAnswerId("cancel", call)];
      return { event: "food_price", key: `food:priceup:${call}:${p.asked_at ?? ""}`,
               build: (m) => ({ msg: buttons(m.food.priceUp(code, place, named(p, m), n(p.was_unit_usd) * n(p.qty), n(p.now_unit_usd) * n(p.qty), n(p.total_now)),
                                             [{ id: ids[0]!, title: m.food.acceptPrice }, { id: ids[1]!, title: m.food.cancelOrder }]), params: [code], payloads: ids }) };
    }
    case "price_lower": {
      const i = r.items.find((x) => x.item_id === r.item_id) ?? r.items.find((x) => x.status === "ok");
      return { event: "food_price", key: `food:pricelower:${call}:${n(r.total_usd).toFixed(2)}`,
               build: (m) => ({ msg: { type: "text", text: { body: m.food.priceLower(code, place, i ? named(i, m) : "", n(r.total_usd)) } }, params: [code] }) };
    }
    default: return null;
  }
}
