// FD1: the menu reader's form and instructions. A narrow vision function, not an agent (invariant 21): the menu-read workflow
// (scripts/menus/batch.mjs) sends each menu photo with this prompt and tool through the Message Batches API; record_menu_reading() (0246)
// keeps only names, sections, prices, sizes, options and add-ons, as PROPOSALS that a person approves dish by dish on the console's Menus
// page. It reads only what is printed. It never reads or guesses a food fact (allergens, diet, halal, sugar, spice: those are "declared by
// the vendor" or "not confirmed yet", invariant 15), never writes a description of its own (MENU2: it copies the one printed, kept for the
// person checking and never read as a food fact), and never rates or praises (invariant 14).
// Prices are copied as printed, with their currency: USD or LBP. Where the menu does not show which, the currency is left empty and the
// person checking decides (a dish with no price or no currency cannot be approved without one, 0246).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const Currency = z.enum(["USD", "LBP"]).nullable().describe("USD for $, USD or a dollar note on the menu; LBP for L.L., LBP, ل.ل. or lira prices in the thousands; null if you cannot tell");
const Name = { name_ar: z.string().nullable().describe("The name in Arabic, as printed (or your Arabic rendering if only English is printed; then set translated to 'ar')"),
               name_en: z.string().nullable().describe("The name in English or Latin letters, as printed (or your English rendering if only Arabic is printed; then set translated to 'en')") };

// AUTO1: the place's own details, when the source shows them (proposed; a person applies them with one tap).
const PlaceDetails = z.object({
  hours_text: z.string().nullable().optional().describe("The opening hours exactly as printed (for example 'Daily 10am-11pm, closed Monday'), or null"),
  open: z.string().nullable().optional().describe("The opening time as HH:MM (24 h) when the hours are the same every day, or null"),
  close: z.string().nullable().optional().describe("The closing time as HH:MM (24 h), or null"),
  days_off: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional().describe("Days the place says it is closed; empty if none"),
  phone_text: z.string().nullable().optional().describe("The place's own phone number exactly as printed (for orders or delivery), or null. Never a person's private number"),
}).nullable().optional().describe("Only what the source prints about the place itself: its opening hours and its phone. Null when it shows neither");

export const MenuReading = z.object({
  place: PlaceDetails,
  sections: z.array(z.object({
    name_ar: z.string().nullable().describe("The section heading in Arabic, as printed, or null"),
    name_en: z.string().nullable().describe("The section heading in English, as printed, or null"),
    dishes: z.array(z.object({
      ...Name,
      translated: z.enum(["ar", "en"]).nullable().describe("Which of the two names was NOT printed and was written by you; null when both are printed"),
      price: z.number().nullable().describe("The base price as a number, exactly as printed (450,000 is 450000; $5.5 is 5.5); null if no price is printed"),
      currency: Currency,
      price_text: z.string().describe("The price exactly as printed, characters and all ('450,000', '$5'); empty if none"),
      sizes: z.array(z.object({ ...Name, price: z.number().nullable(), currency: Currency })).describe("Sizes printed with their own prices (small, large, sandwich, plate, half, whole); empty if none"),
      options: z.array(z.object({
        group_ar: z.string().nullable(), group_en: z.string().nullable(),
        required: z.boolean().describe("True only if the menu says a choice must be made (choose your bread)"),
        min: z.number().int().min(0), max: z.number().int().min(1),
        choices: z.array(z.object({ ...Name, price_delta: z.number().nullable().describe("The extra price printed for this choice, in the dish's currency; 0 or null if none") })),
      })).describe("Printed choices (bread, sauce, spice level as a CHOICE the menu offers); empty if none"),
      addons: z.array(z.object({ ...Name, price: z.number().nullable(), currency: Currency })).describe("Printed extras with their prices (extra cheese, extra garlic); empty if none"),
      // MENU2 (0260): the description as printed, the source line, the reader's own doubts. All optional, so FD1's readings still fit.
      description: z.string().nullable().optional().describe("The dish's description exactly as printed under its name (the place's own words), or null. Never write one yourself"),
      price_clear: z.boolean().optional().describe("False when the price is not printed clearly (blurred, cut off, hand-corrected, a range you could not turn into sizes, or you are not sure which price belongs to this dish)"),
      flags: z.array(z.enum(["cut_off", "unclear_name", "unclear_price", "price_range", "unclear_section", "other"])).optional()
        .describe("Your doubts about this row: cut_off (the name, description or price is cut off), unclear_name, unclear_price, price_range (a range printed as the price), unclear_section, other. Empty when the row is clear"),
      flag_note: z.string().nullable().optional().describe("One short sentence saying what is unclear, when flags is not empty"),
      source_text: z.string().nullable().optional().describe("The line(s) of the source this dish was read from, copied exactly (name and price), at most 300 characters"),
      page: z.number().int().nullable().optional().describe("For a PDF: the page number the dish is on"),
    })),
  })),
});
export type MenuReading = z.infer<typeof MenuReading>;

const TOOL: Anthropic.Tool = {
  name: "record_menu",
  description: "Record the sections and dishes printed on this menu photo. Copy names and prices exactly; use null or an empty list for anything not printed. Never guess a price.",
  input_schema: (() => { const { $schema: _d, ...s } = z.toJSONSchema(MenuReading, { io: "input" }) as Record<string, unknown>; return s as Anthropic.Tool["input_schema"]; })(),
};
const PROMPT = "You read a photo of a Lebanese restaurant's printed menu for the person who checks every dish against the menu before anything is sold. " +
  "Report only what is printed: section headings, dish names, prices with their currency, sizes, choices and extras with their prices. " +
  "Give each dish's name in Arabic and in English: copy what is printed, and where only one language is printed, write the other yourself and say which in 'translated'. " +
  "Every name_ar (dishes, sizes, choices, extras, sections) is in Arabic letters and every name_en in Latin letters: never copy an English word into name_ar. " +
  "Never write a description of your own, an ingredient list, an allergen, a diet, halal, sugar or spice fact, a health claim, a rating or praise: none of that is read from a menu. " +
  "Never invent or estimate a price: a dish with no printed price has price null. Keep the menu's order. " +
  // MENU2: sources other than a photo, sizes, and doubts
  "The source may be a photo, a PDF, a web page's text, pasted text, or a Word or Excel file's text: read it the same way. " +
  "A dish printed in sizes (small/large, صغير/كبير, sandwich/plate, half/whole, 1 kg) is ONE dish with sizes, each with its own printed price: " +
  "where the same dish is printed on separate lines that differ only by a size word, give it once with those sizes. A price range (5-7) is never one price: " +
  "turn it into sizes only when the source names the sizes; otherwise set price null, price_clear false and flag price_range. " +
  "Copy the description printed under a dish exactly into description (the place's words; never add one). " +
  "Flag anything cut off, blurred or unclear and say what in flag_note; never fill a gap with a guess. Copy the source line(s) of each dish into source_text. " +
  // AUTO1
  "If the source prints the place's own opening hours or phone number, give them in place (as printed, and the hours as HH:MM when they are the same every day); otherwise place is null.";

export const menuTool = (): Anthropic.Tool => TOOL;

// AUTO1: the second, independent reading of a photo, a PDF or a screenshot: dish names and the prices printed beside them, nothing else, and
// no sight of the first reading. The database compares the two (record_menu_second_reading); a dish is approved by the rule only when they agree.
export const PriceReading = z.object({
  items: z.array(z.object({
    ...Name,
    prices: z.array(z.number()).describe("Every price printed for this dish, as numbers exactly as printed (one per size); empty if none"),
  })),
});
export type PriceReading = z.infer<typeof PriceReading>;
const PRICE_TOOL: Anthropic.Tool = {
  name: "record_prices",
  description: "Record every dish on this menu with the price(s) printed for it. Copy names and prices exactly; never guess a price.",
  input_schema: (() => { const { $schema: _d, ...s } = z.toJSONSchema(PriceReading, { io: "input" }) as Record<string, unknown>; return s as Anthropic.Tool["input_schema"]; })(),
};
const PRICE_PROMPT = "You list the dishes and their printed prices on a restaurant menu, for a second check of another reading you do not see. " +
  "For every dish give its name as printed (Arabic in name_ar, Latin letters in name_en; null for a language not printed) and every price printed for it, " +
  "as numbers exactly as printed (450,000 is 450000; $5.5 is 5.5; one price per size). A range (5-7) is two prices. Never estimate or round a price, never add a dish that is not printed.";
export const priceTool = (): Anthropic.Tool => PRICE_TOOL;
export const pricePrompt = (): string => PRICE_PROMPT;

/** A phone number as printed on a Lebanese menu, in E.164 (+961...), or null when it is not one. */
export function lebanesePhone(printed: string | null | undefined): string | null {
  const d = String(printed ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, "");
  if (/^(00)?961\d{7,8}$/.test(d)) return "+" + d.replace(/^00/, "");
  if (/^0[1-9]\d{6}$/.test(d)) return "+961" + d.slice(1);
  if (/^(3\d{6}|(70|71|76|78|79|81)\d{6})$/.test(d)) return "+961" + d;
  return null;
}
export const menuPrompt = (): string => PROMPT;
