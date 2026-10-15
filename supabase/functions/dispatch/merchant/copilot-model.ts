// The merchant copilot's model (DECISIONS §39.7, §32.4): it reads a merchant message the rules did not and answers with
// one typed tool. The tool becomes the same MerchantCommand the rules produce, checked here, and every change still goes
// through a proposal card the merchant taps. Off until the merchant eval passes (config ai_merchant_text_enabled); the
// recorded answers in evals/merchant/fixtures are replayed by the unit tests.

import type { ModelRequest, ModelResponse } from "../customer/turn.ts";
import {
  beirutDate,
  clockOf,
  stationOf,
  type MerchantCommand,
  type Station,
} from "../../_shared/merchant-commands.ts";

export type CopilotModel = {
  call: (req: ModelRequest) => Promise<ModelResponse>;
  model: string;
};

const str = (max: number) => ({ type: "string", minLength: 1, maxLength: max });
const nul = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const STATIONS = ["fryer", "oven", "grill", "saj", "espresso", "cold", "bar"];

export const MERCHANT_TOOLS = [
  {
    name: "set_availability",
    description:
      "Switch a kitchen station (fryer, oven, grill, saj, espresso, cold, bar), a menu section or one item off for some minutes (null = until switched on), or a station back on.",
    input_schema: obj({
      target: str(60),
      on: { type: "boolean" },
      minutes: nul({ type: "integer", minimum: 1, maximum: 1440 }),
    }),
  },
  {
    name: "sold_out",
    description: "One item is sold out today.",
    input_schema: obj({ item: str(60) }),
  },
  {
    name: "back_in_stock",
    description: "One item is available again.",
    input_schema: obj({ item: str(60) }),
  },
  {
    name: "set_price",
    description: "Change one item's price in USD.",
    input_schema: obj({
      item: str(60),
      price_usd: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
    }),
  },
  {
    name: "set_stock",
    description: "Set how many of a counted (grocery) item are in stock.",
    input_schema: obj({ item: str(60), quantity: { type: "integer", minimum: 0, maximum: 10000 } }),
  },
  {
    name: "add_item",
    description: "Add a new item to the menu with its USD price and, if named, its section.",
    input_schema: obj({
      name: str(80),
      price_usd: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      section: nul(str(60)),
    }),
  },
  {
    name: "edit_item",
    description: "Rename an item, change its description, or say which station it comes from.",
    input_schema: obj({
      item: str(60),
      new_name: nul(str(80)),
      description: nul(str(500)),
      station: nul({ type: "string", enum: STATIONS }),
    }),
  },
  {
    name: "remove_item",
    description: "Remove an item from the menu.",
    input_schema: obj({ item: str(60) }),
  },
  {
    name: "create_offer",
    description:
      "A merchant-funded offer: percent off (an item, a section or everything), happy hour (percent off between two times), first order, or a free item with a minimum quantity of another.",
    input_schema: obj({
      type: { type: "string", enum: ["percent", "happy_hour", "first_order", "free_item"] },
      percent: nul({ type: "integer", minimum: 1, maximum: 50 }),
      target: nul(str(60)),
      from: nul({ type: "string", pattern: "^\\d{2}:\\d{2}$" }),
      to: nul({ type: "string", pattern: "^\\d{2}:\\d{2}$" }),
      free_item: nul(str(60)),
      min_quantity: nul({ type: "integer", minimum: 1, maximum: 50 }),
      days: nul({ type: "integer", minimum: 1, maximum: 30 }),
    }),
  },
  { name: "stop_offer", description: "Stop the running offer.", input_schema: obj({}) },
  {
    name: "close_day",
    description: "The shop is closed on one date (YYYY-MM-DD, Beirut).",
    input_schema: obj({ date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }),
  },
  {
    name: "set_hours",
    description:
      "Weekly opening hours for some weekdays (0 = Sunday … 6 = Saturday), 24-hour HH:MM; opens and closes null = closed those days.",
    input_schema: obj({
      weekdays: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 6 },
        minItems: 1,
        maxItems: 7,
      },
      opens: nul({ type: "string", pattern: "^\\d{2}:\\d{2}$" }),
      closes: nul({ type: "string", pattern: "^\\d{2}:\\d{2}$" }),
    }),
  },
  {
    name: "pause_orders",
    description: "Stop taking orders for some minutes (the whole shop).",
    input_schema: obj({ minutes: { type: "integer", minimum: 1, maximum: 1440 } }),
  },
  { name: "resume_orders", description: "Take orders again.", input_schema: obj({}) },
  {
    name: "set_min_order",
    description: "Minimum food order in USD, or null for none.",
    input_schema: obj({ usd: nul({ type: "number", minimum: 1, maximum: 500 }) }),
  },
  {
    name: "set_radius",
    description: "How far the shop delivers itself, in km.",
    input_schema: obj({ km: { type: "number", minimum: 0.5, maximum: 20 } }),
  },
  {
    name: "boost",
    description:
      "Start a Boost (sponsored placement) with a USD budget for people nearby or past customers.",
    input_schema: obj({
      budget_usd: { type: "number", minimum: 5, maximum: 500 },
      audience: { type: "string", enum: ["nearby", "past_customers"] },
    }),
  },
  { name: "stop_boost", description: "Stop the Boost.", input_schema: obj({}) },
  {
    name: "report",
    description: "Show the day's or the last 7 days' report.",
    input_schema: obj({ period: { type: "string", enum: ["day", "week"] } }),
  },
  { name: "staff_list", description: "List the shop's staff.", input_schema: obj({}) },
  {
    name: "show_memory",
    description: "What the copilot remembers about the shop.",
    input_schema: obj({}),
  },
  {
    name: "not_understood",
    description: "The message is not one of these tasks (or is a question for a person).",
    input_schema: obj({}),
  },
];

export const MERCHANT_SYSTEM = `You are the Alo King merchant copilot on WhatsApp for a restaurant or shop in Lebanon.
Merchants write in Arabic, Lebanese Arabizi, French or English. Read the one message and call exactly one tool.
Never invent an item: pass the item, section or station words as the merchant wrote them; the server finds them.
Prices are USD. Times are Beirut, 24-hour HH:MM. Weekdays: 0 Sunday … 6 Saturday.
You never apply anything: every change is shown to the merchant as a card to confirm.
If the message is not one of these tasks, call not_understood.`;

const s = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const int = (v: unknown, lo: number, hi: number): number | null =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null;
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/** A tool call as a MerchantCommand, or null when its input does not hold up. The server checks everything again. */
export function toolToCommand(name: string, input: any, now: Date): MerchantCommand | null {
  const i = input ?? {};
  switch (name) {
    case "set_availability": {
      const target = s(i.target, 60);
      if (!target || typeof i.on !== "boolean") return null;
      const station =
        stationOf(target.toLowerCase()) ?? (STATIONS.includes(target) ? (target as Station) : null);
      if (i.on)
        return station ? { kind: "avail_on", station } : { kind: "back_in_stock", item: target };
      const minutes = i.minutes === null ? null : int(i.minutes, 1, 1440);
      if (i.minutes !== null && minutes === null) return null;
      return { kind: "avail_off", target, station, minutes };
    }
    case "sold_out":
    case "back_in_stock":
    case "remove_item": {
      const item = s(i.item, 60);
      if (!item) return null;
      return name === "remove_item" ? { kind: "item_remove", item } : { kind: name, item };
    }
    case "set_price": {
      const item = s(i.item, 60);
      const p = num(i.price_usd, 0.01, 10000);
      return item && p ? { kind: "price", item, priceUsd: p } : null;
    }
    case "set_stock": {
      const item = s(i.item, 60);
      const q = int(i.quantity, 0, 10000);
      return item && q !== null ? { kind: "stock_set", item, quantity: q } : null;
    }
    case "add_item": {
      const n = s(i.name, 80);
      const p = num(i.price_usd, 0.01, 10000);
      return n && p ? { kind: "item_add", name: n, priceUsd: p, section: s(i.section, 60) } : null;
    }
    case "edit_item": {
      const item = s(i.item, 60);
      if (!item) return null;
      if (s(i.new_name, 80)) return { kind: "item_rename", item, name: s(i.new_name, 80)! };
      if (s(i.description, 500))
        return { kind: "item_describe", item, description: s(i.description, 500)! };
      if (typeof i.station === "string" && STATIONS.includes(i.station))
        return { kind: "item_station", item, station: i.station as Station };
      return null;
    }
    case "create_offer": {
      const days = i.days === null || i.days === undefined ? 7 : int(i.days, 1, 30);
      const pct = i.percent === null ? null : int(i.percent, 1, 50);
      if (days === null) return null;
      switch (i.type) {
        case "percent":
          return pct
            ? {
                kind: "offer",
                offer: { type: "percent", percent: pct, target: s(i.target, 60), days },
              }
            : null;
        case "happy_hour": {
          const from = typeof i.from === "string" ? clockOf(i.from) : null;
          const to = typeof i.to === "string" ? clockOf(i.to) : null;
          return pct && from && to && from !== to
            ? {
                kind: "offer",
                offer: {
                  type: "happy_hour",
                  percent: pct,
                  from,
                  to,
                  target: s(i.target, 60),
                  days,
                },
              }
            : null;
        }
        case "first_order":
          return pct
            ? {
                kind: "offer",
                offer: { type: "first_order", percent: pct, days: i.days ? days : 30 },
              }
            : null;
        case "free_item": {
          const free = s(i.free_item, 60);
          const target = s(i.target, 60);
          const q = int(i.min_quantity, 1, 50);
          return free && target && q
            ? { kind: "offer", offer: { type: "free_item", free, minQuantity: q, target, days } }
            : null;
        }
        default:
          return null;
      }
    }
    case "stop_offer":
      return { kind: "offer_stop" };
    case "close_day": {
      const d = typeof i.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? i.date : null;
      // The server refuses a past date or one more than 60 days ahead; refuse it here too.
      return d && d >= beirutDate(now) && d <= beirutDate(now, 60)
        ? { kind: "closure", day: d }
        : null;
    }
    case "set_hours": {
      const wd = Array.isArray(i.weekdays) ? i.weekdays.map((d: unknown) => int(d, 0, 6)) : [];
      if (!wd.length || wd.some((d: number | null) => d === null)) return null;
      const weekdays = [...new Set(wd as number[])].sort();
      if (i.opens === null && i.closes === null)
        return { kind: "hours", weekdays, opens: null, closes: null };
      const opens = typeof i.opens === "string" ? clockOf(i.opens) : null;
      const closes = typeof i.closes === "string" ? clockOf(i.closes) : null;
      return opens && closes && opens !== closes
        ? { kind: "hours", weekdays, opens, closes }
        : null;
    }
    case "pause_orders": {
      const m = int(i.minutes, 1, 1440);
      return m ? { kind: "pause", minutes: m } : null;
    }
    case "resume_orders":
      return { kind: "open" };
    case "set_min_order":
      if (i.usd === null) return { kind: "min_order", usd: null };
      return num(i.usd, 1, 500) ? { kind: "min_order", usd: i.usd } : null;
    case "set_radius":
      return num(i.km, 0.5, 20) ? { kind: "radius", km: i.km } : null;
    case "boost":
      return num(i.budget_usd, 5, 500) &&
        (i.audience === "nearby" || i.audience === "past_customers")
        ? { kind: "boost", budgetUsd: i.budget_usd, audience: i.audience }
        : null;
    case "stop_boost":
      return { kind: "boost_stop" };
    case "report":
      return i.period === "day" || i.period === "week"
        ? { kind: "report", period: i.period }
        : null;
    case "staff_list":
      return { kind: "staff_list" };
    case "show_memory":
      return { kind: "memory" };
    default:
      return null;
  }
}

/** One model call for one merchant message; the first tool call becomes the command (null: not understood). */
export async function copilotModelCommand(
  m: CopilotModel,
  text: string,
  now: Date,
): Promise<MerchantCommand | null> {
  const r = await m.call({
    model: m.model,
    system: `${MERCHANT_SYSTEM}\nToday in Beirut: ${beirutDate(now)}.`,
    messages: [{ role: "user", content: text.slice(0, 500) }],
    tools: MERCHANT_TOOLS,
    maxTokens: 300,
    timeoutMs: 8000,
  });
  const call = r.content.find((c) => c.type === "tool_use") as
    { type: "tool_use"; name: string; input: any } | undefined;
  return call ? toolToCommand(call.name, call.input, now) : null;
}
