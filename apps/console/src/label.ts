// 5.15 The label reader: a narrow vision function, not an agent (invariant 21). It turns photos of a pack into proposed
// fields for the person doing intake, who confirms every one against the pack before anything is published (review_proposed_fact).
// It reports only what is printed: an allergen that is not printed is not listed (unknown is never safe, invariant 15), and
// "free" only where the pack prints a free-from claim. Its reading is a proposal (status partial), never a fact.
// The photos and the reading are never logged. Any failure returns null: intake then goes on by hand.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"] as const;
const DIETS = ["halal", "vegetarian", "vegan"] as const;      // fasting is never read off a pack by a model

export const LabelReading = z.object({
  name_en: z.string().nullable().describe("Product name exactly as printed in English or Latin letters, or null"),
  name_ar: z.string().nullable().describe("Product name exactly as printed in Arabic, or null"),
  brand: z.string().nullable(),
  size: z.string().nullable().describe("Net quantity as printed, e.g. '500 g', or null"),
  barcode: z.string().nullable().describe("The digits under the barcode, if readable, or null"),
  ingredients_text: z.string().nullable().describe("The ingredients list exactly as printed, in the language printed, or null"),
  allergens: z.array(z.object({
    code: z.enum(ALLERGENS),
    value: z.enum(["contains", "may_contain", "free"]).describe("contains: listed or in bold in the ingredients; may_contain: a 'may contain' or 'traces' line; free: only a printed free-from claim"),
    quote: z.string().describe("The printed words this rests on, copied exactly"),
  })),
  diet: z.array(z.object({ code: z.enum(DIETS), value: z.enum(["yes", "no"]), quote: z.string().describe("The printed claim or logo text, copied exactly") })),
  nutrition_per_100g: z.object({
    energy_kcal: z.number().nullable(), fat: z.number().nullable(), saturated_fat: z.number().nullable(), carbohydrates: z.number().nullable(),
    sugars: z.number().nullable(), fiber: z.number().nullable(), proteins: z.number().nullable(), salt: z.number().nullable(),
  }).nullable().describe("The per-100 g column of the printed panel only; null if there is no panel or no per-100 g column"),
});
export type LabelReading = z.infer<typeof LabelReading>;

const TOOL: Anthropic.Tool = {
  name: "record_label",
  description: "Record what the label photos show. Use null or an empty list for anything not clearly printed. Never guess, never fill in what such a product usually contains.",
  input_schema: (() => { const { $schema: _d, ...s } = z.toJSONSchema(LabelReading, { io: "input" }) as Record<string, unknown>; return s as Anthropic.Tool["input_schema"]; })(),
};
const PROMPT = "You read food packaging photos for the person who checks each field against the pack at intake. Report only what is printed on the photos. " +
  "Do not infer anything from the product's name, kind or brand. An allergen that is not printed is not listed. Use 'free' only for a printed free-from claim. " +
  "A halal, vegetarian or vegan entry needs a printed claim or logo. You never decide what is published; a person does.";

export interface LabelImage { bytes: Uint8Array; mime: string }

/** Facts in the shape record_label_scan() takes, from a reading. Quotes travel with allergen and diet values. */
export function readingFacts(r: LabelReading): { attribute: string; value?: string; text?: string; values?: Record<string, number>; quote?: string }[] {
  const out: { attribute: string; value?: string; text?: string; values?: Record<string, number>; quote?: string }[] = [];
  if (r.ingredients_text?.trim()) out.push({ attribute: "ingredients", text: r.ingredients_text.trim() });
  for (const a of r.allergens) if (a.quote.trim()) out.push({ attribute: a.code, value: a.value, quote: a.quote.trim() });
  for (const d of r.diet) if (d.quote.trim()) out.push({ attribute: d.code, value: d.value, quote: d.quote.trim() });
  if (r.nutrition_per_100g) {
    const values = Object.fromEntries(Object.entries(r.nutrition_per_100g).filter(([, v]) => typeof v === "number" && v >= 0)) as Record<string, number>;
    if (Object.keys(values).length) out.push({ attribute: "nutrition", values });
  }
  return out;
}

export function labelReader(opts: { apiKey: string; model: string; baseURL?: string }) {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
  return async (images: LabelImage[]): Promise<LabelReading | null> => {
    try {
      const content: Anthropic.ContentBlockParam[] = images.filter((i) => i.mime.startsWith("image/") && i.bytes.byteLength <= 5 * 1024 * 1024).slice(0, 3).map((i) => {
        let bin = "";
        for (let k = 0; k < i.bytes.length; k += 0x8000) bin += String.fromCharCode(...i.bytes.subarray(k, k + 0x8000));
        return { type: "image", source: { type: "base64", media_type: i.mime as "image/jpeg", data: btoa(bin) } };
      });
      if (!content.length) return null;
      content.push({ type: "text", text: "Read these label photos." });
      const res = await client.messages.create({ model: opts.model, max_tokens: 2000, system: PROMPT, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }] });
      const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const parsed = LabelReading.safeParse(call?.input);
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  };
}
