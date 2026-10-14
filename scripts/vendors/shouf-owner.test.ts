import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeShouf, parseCsv } from "./shouf.ts";
import { choiceOf, ownerDrafts, ownerDuplicates } from "./shouf-menus.ts";

// DECISIONS §39.4 source 1: the owner's transcribed menu photos and the Nayeh w Meshwiyeh merge.
const SRC = "supabase/seed/shouf/source";
const owner = JSON.parse(readFileSync(`${SRC}/04_owner_menu_photos_2026-10-14.json`, "utf8"));

describe("A / B items (§39.4)", () => {
  it("are one item with a required choice", () => {
    expect(choiceOf("Soft Drinks / Iced Tea")).toEqual({
      name: "اختيار / Choice",
      min: 1,
      max: 1,
      choices: [{ name: "Soft Drinks" }, { name: "Iced Tea" }],
    });
  });
  it("share a trailing size", () => {
    expect(choiceOf("Kafta / Kabab 1 kg")?.choices).toEqual([
      { name: "Kafta 1 kg" },
      { name: "Kabab 1 kg" },
    ]);
    expect(choiceOf("Mixed Grills ½ kg / Tawook ½ kg")?.choices.map((c) => c.name)).toEqual([
      "Mixed Grills ½ kg",
      "Tawook ½ kg",
    ]);
  });
  it("leave a slash without spaces alone", () => {
    expect(choiceOf("1/2 Chicken")).toBeNull();
    expect(choiceOf("Classic")).toBeNull();
  });
});

describe("owner drafts (§39.4)", () => {
  const drafts = ownerDrafts(owner);
  it("keep each menu's sections, items and printed currency", () => {
    const seven = drafts.find((d) => d.vendor_name.startsWith("SEVEN"))!;
    const nayeh = drafts.find((d) => d.vendor_name.startsWith("Nayeh"))!;
    expect(seven.sections.map((s) => s.items.length).reduce((a, b) => a + b)).toBe(44);
    expect(nayeh.sections.map((s) => s.items.length).reduce((a, b) => a + b)).toBe(121);
    expect(seven.sections[0].items[0]).toMatchObject({
      name_en: "Classic",
      price: 850000,
      currency: "LBP",
    });
    expect(nayeh.sections[0].items[0]).toMatchObject({
      name_ar: "بطاطا مقلية",
      price: 4,
      currency: "USD",
    });
    expect(seven.source_url).toMatch(/04_owner_menu_photos_2026-10-14\.json$/);
    expect(seven.captured_at).toBe("2026-10-14");
  });
  it("never trust a price printed in the other currency", () => {
    const [d] = ownerDrafts({
      received: "2026-10-14",
      restaurant_menus: [
        {
          place_id: "x",
          vendor_name: "X",
          currency: "LBP",
          items: [{ section: "S", item_name: "Odd", price_raw: "$4" }],
        },
      ],
    });
    expect(d.sections[0].items[0]).toMatchObject({ price: null, currency: null });
  });
});

describe("one shop listed twice (§39.4)", () => {
  it("keeps one Nayeh w Meshwiyeh with both names; the other listing is an exclusion", () => {
    const rows = parseCsv(readFileSync(`${SRC}/01_shouf_merchants_315.csv`, "utf8"));
    const dups = ownerDuplicates(owner);
    expect([...dups]).toEqual([["ChIJR6VlRAAhHxURSemilwLScnE", "ChIJX_XVOO0hHxURJO_Dq1Kl-Lo"]]);
    const { vendors, exclusions } = normalizeShouf(rows, dups);
    expect(vendors).toHaveLength(314);
    const kept = vendors.find((v) => v.place_id === "ChIJX_XVOO0hHxURJO_Dq1Kl-Lo")!;
    expect(kept).toMatchObject({
      name_ar: "نية و مشوية",
      name_en: "Nayeh w Meshwiyeh",
      phone_seed_mobile: true,
    });
    expect(vendors.some((v) => v.place_id === "ChIJR6VlRAAhHxURSemilwLScnE")).toBe(false);
    expect(exclusions).toContainEqual({
      place_id: "ChIJR6VlRAAhHxURSemilwLScnE",
      name: "نية و مشوية",
      reason: "duplicate of ChIJX_XVOO0hHxURJO_Dq1Kl-Lo",
    });
  });
});
