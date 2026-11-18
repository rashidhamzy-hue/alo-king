// FD1: the menu reader's form and instructions. A narrow vision function, not an agent (invariant 21): the menu-read workflow
// (scripts/menus/batch.mjs) sends each menu photo with this prompt and tool through the Message Batches API; record_menu_reading() (0246)
// keeps only names, sections, prices, sizes, options and add-ons, as PROPOSALS that a person approves dish by dish on the console's Menus
// page. It reads only what is printed. It never reads or guesses a food fact (allergens, diet, halal, sugar, spice: those are "declared by
// the vendor" or "not confirmed yet", invariant 15), never writes a description, and never rates or praises (invariant 14).
// Prices are copied as printed, with their currency: USD or LBP. Where the menu does not show which, the currency is left empty and the
// person checking decides (a dish with no price or no currency cannot be approved without one, 0246).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const Currency = z.enum(["USD", "LBP"]).nullable().describe("USD for $, USD or a dollar note on the menu; LBP for L.L., LBP, ل.ل. or lira prices in the thousands; null if you cannot tell");
const Name = { name_ar: z.string().nullable().describe("The name in Arabic, as printed (or your Arabic rendering if only English is printed; then set translated to 'ar')"),
               name_en: z.string().nullable().describe("The name in English or Latin letters, as printed (or your English rendering if only Arabic is printed; then set translated to 'en')") };

export const MenuReading = z.object({
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
  "Never write a description, an ingredient, an allergen, a diet, halal, sugar or spice fact, a health claim, a rating or praise: none of that is read from a menu. " +
  "Never invent or estimate a price: a dish with no printed price has price null. Keep the menu's order.";

export const menuTool = (): Anthropic.Tool => TOOL;
export const menuPrompt = (): string => PROMPT;
