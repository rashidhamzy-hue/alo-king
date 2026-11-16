// LB1: the label reader also reads the directions and the warnings, exactly as printed (migration 0210). No model, no network.
import { describe, expect, it } from "vitest";
import { LabelReading, labelTool, labelPrompt, readingFields } from "../src/label";

const base = { name_en: null, name_ar: null, brand: null, size: null, barcode: null, ingredients_text: null, allergens: [], diet: [], nutrition_per_100g: null };

describe("the label reader and the printed text", () => {
  it("takes the directions and the warnings as printed text, and nothing else of the kind", () => {
    const r = LabelReading.parse({ ...base, fields: { directions_as_printed: "Shake well before use.", warnings_as_printed: ["Contains caffeine.", "Not recommended for children."] } });
    expect(readingFields(r)).toEqual({ directions_as_printed: "Shake well before use.", warnings_as_printed: ["Contains caffeine.", "Not recommended for children."] });
    expect(readingFields(LabelReading.parse({ ...base, fields: { directions_as_printed: "  ", warnings_as_printed: [] } }))).toEqual({});
    expect(readingFields(LabelReading.parse({ ...base, fields: { directions_as_printed: null, warnings_as_printed: null } }))).toEqual({});
  });
  it("the tool the model fills has both fields, described as exact copies", () => {
    const f = ((labelTool().input_schema as { properties: Record<string, any> }).properties.fields.anyOf?.[0] ?? (labelTool().input_schema as any).properties.fields).properties;
    expect(Object.keys(f)).toEqual(expect.arrayContaining(["directions_as_printed", "warnings_as_printed"]));
    expect(JSON.stringify(f.directions_as_printed)).toMatch(/exactly as printed/i);
    expect(JSON.stringify(f.warnings_as_printed)).toMatch(/exactly as printed/i);
  });
  it("the prompt says to copy them and never to reword or advise", () => {
    expect(labelPrompt()).toMatch(/directions and warnings.*(copy|exactly).*never (reword|rewrite|summari[sz]e|give advice)/i);
  });
});
