// The contracts between language and logic. Models produce these; code validates them; SQL enforces the rest.
import { z } from "zod";

export const OrderLine = z.object({
  raw: z.string().describe("The customer's own words for this one item, verbatim, in their language and script, with the brand, size or flavour they said"),
  query: z.string().describe("The item as the customer named it, in the customer's language and script, without quantity or politeness, " +
                             "e.g. 'لبنة ليبان ليه', 'خبز', 'قهوة نجار', 'kleenex kbir'. Never translate it, never replace a brand with one you know"),
  qty: z.number().positive().default(1),
  unit: z.enum(["each", "kg", "half_kg", "pack", "bundle", "plate", "piece", "dozen"]).default("each"),
  brand_hint: z.string().nullable().default(null).describe("The brand if the customer named one, as they wrote it (e.g. 'تنورين', 'الفورنو', 'najjar')"),
  modifiers: z.array(z.string()).default([]).describe("e.g. 'no pickles', 'extra garlic', 'cut in half', 'french bread'"),
  source_hint: z.string().nullable().default(null).describe("Restaurant or shop the customer named ('من عند ...'), if any. Never a product brand: a brand goes in brand_hint"),
  confidence: z.number().min(0).max(1),
});

export const OrderIntent = z.object({
  intent: z.enum(["order", "add_to_order", "change_order", "cancel", "status", "hours", "delivery_area", "question", "complaint", "greeting", "off_topic",
                  "memory_show", "memory_forget", "memory_stop", "memory_start"])
    .describe("status: where is my order. hours: when are you open. delivery_area: do you deliver to a place (put it in address.village). " +
              "memory_show: what do you know about me. memory_forget: forget what you know about me. memory_stop: stop remembering. memory_start: remember again"),
  repeat_last: z.boolean().default(false)
    .describe("'same as last time' / 'نفس المرة الماضية': the customer wants their previous order again. Use intent 'order'; put only added items in lines"),
  language: z.enum(["ar_lb", "arabizi", "en", "fr", "mixed"]),
  lines: z.array(OrderLine).default([]),
  fulfilment: z.enum(["delivery", "pickup", "unknown"]).default("unknown"),
  address: z.object({
    village: z.string().nullable().default(null),
    landmark: z.string().nullable().default(null),
    building: z.string().nullable().default(null),
    floor: z.string().nullable().default(null),
    recipient_name: z.string().nullable().default(null),
    verbatim: z.string().nullable().default(null),
  }).prefault({}),
  payment_hint: z.enum(["cod", "whish", "omt"]).nullable().default(null),
  change_for_usd: z.number().nullable().default(null).describe("'send change for 100 dollars' -> 100"),
  urgency: z.enum(["normal", "rush"]).default("normal"),
  promised_followup: z.enum(["photo", "address", "none"]).default("none").describe("'I will send you its picture now'"),
  needs_clarification: z.array(z.string()).default([]),
  restrictions: z.array(z.string()).default([])
    .describe("Allergies and things the customer says they cannot or will not eat, in their own words ('حساسية سمسم', 'no meat'). Only what they said; never inferred"),
  transcript_quality: z.enum(["good", "partial", "unusable"]).default("good"),
});
export type OrderIntent = z.infer<typeof OrderIntent>;

// Drivers, merchants and staff write to the ops number in free text and voice. This is what comes out.
export const OpsEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fuel"), amount_usd: z.number().nullable(), litres: z.number().nullable(), odometer_km: z.number().nullable() }),
  z.object({ kind: z.literal("vehicle_issue"), severity: z.enum(["rideable", "stop_now"]), description: z.string() }),
  z.object({ kind: z.literal("maintenance_done"), description: z.string(), amount_usd: z.number().nullable(), odometer_km: z.number().nullable() }),
  z.object({ kind: z.literal("customer_unreachable"), order_code: z.string().nullable() }),
  z.object({ kind: z.literal("address_problem"), order_code: z.string().nullable(), description: z.string() }),
  z.object({ kind: z.literal("cash_collected"), order_code: z.string().nullable(), usd: z.number(), lbp: z.number(), change_usd: z.number(), change_lbp: z.number() }),
  z.object({ kind: z.literal("item_unavailable"), item: z.string(), until: z.string().nullable() }),
  z.object({ kind: z.literal("price_change"), item: z.string(), new_price_usd: z.number() }),
  z.object({ kind: z.literal("store_status"), open: z.boolean(), until: z.string().nullable() }),
  z.object({ kind: z.literal("other"), summary: z.string() }),
]);
export type OpsEvent = z.infer<typeof OpsEvent>;

export const PaymentProof = z.object({
  provider: z.enum(["whish", "omt", "unknown"]),
  amount: z.number().nullable(),
  currency: z.enum(["USD", "LBP"]).nullable(),
  reference: z.string().nullable(),
  datetime_iso: z.string().nullable(),
  recipient_last4: z.string().nullable(),
  looks_edited: z.boolean().describe("Font, alignment or compression artefacts that suggest tampering"),
  confidence: z.number().min(0).max(1),
});
export type PaymentProof = z.infer<typeof PaymentProof>;

export const MenuExtraction = z.object({
  items: z.array(z.object({
    name_ar: z.string().nullable(), name_en: z.string().nullable(), section: z.string().nullable(),
    price: z.number().nullable(), currency: z.enum(["USD", "LBP"]).nullable(),
    options: z.array(z.string()).default([]), confidence: z.number().min(0).max(1),
  })),
  unreadable_regions: z.number().int().default(0),
});
export type MenuExtraction = z.infer<typeof MenuExtraction>;
