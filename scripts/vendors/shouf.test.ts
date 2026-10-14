import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeShouf,
  parseCsv,
  pilotVillage,
  PILOT_VILLAGES,
  shoufNames,
  whatsappDisagreements,
} from "./shouf.ts";
import { parsePrice, shoufDrafts } from "./shouf-menus.ts";

// The committed Shouf files (DECISIONS §38.1): the load must import all 315 the way §38.2 says.
const src = join(process.cwd(), "supabase/seed/shouf/source");
const rows = parseCsv(readFileSync(join(src, "01_shouf_merchants_315.csv"), "utf8"));
const { vendors, exclusions } = normalizeShouf(rows);

describe("Shouf merchants (§38.2 item 1)", () => {
  it("imports all 315 rows, none excluded", () => {
    expect(rows).toHaveLength(315);
    expect(vendors).toHaveLength(315);
    expect(exclusions).toEqual([]);
  });

  it("splits names that mix scripts into Arabic and English", () => {
    expect(shoufNames("Shawarma kareem شاورما كريم", "شاورما كريم")).toEqual({
      ar: "شاورما كريم",
      en: "Shawarma kareem",
    });
    expect(shoufNames("Ser Ldar Organic Cafe (سر الدار)", "سر الدار")).toEqual({
      ar: "سر الدار",
      en: "Ser Ldar Organic Cafe",
    });
    expect(shoufNames("‎فرن وكايترنغ الريحان RIHAN CATERING", "فرن وكايترنغ الريحان").en).toBe(
      "RIHAN CATERING",
    );
    expect(shoufNames("mr فروج", "فروج")).toEqual({ ar: "فروج", en: null });
    expect(shoufNames("صاج أيام زمان", "صاج أيام زمان")).toEqual({ ar: "صاج أيام زمان", en: null });
    expect(vendors.filter((v) => v.name_ar)).toHaveLength(57);
    for (const v of vendors) {
      expect(v.name_en ?? "").not.toMatch(/[؀-ۿ]/);
      expect(v.name_ar ?? "").not.toMatch(/[A-Za-z]/);
    }
  });

  it("puts every merchant in one of the 12 pilot villages, backfilling from the address", () => {
    expect(Object.keys(PILOT_VILLAGES)).toHaveLength(12);
    expect(pilotVillage("Jahliyeh", "Bakleen, Jahliyeh, Lebanon")).toBe("Baakleen");
    expect(pilotVillage("بقعاتا،", "Main road , bakaata ،، بقعاتا، Lebanon")).toBe("Boqaata");
    expect(
      pilotVillage("Choualiq Deir El Qamar", "Damour - Beit Ed Dine Rd, Choualiq Deir El Qamar"),
    ).toBe("Deir El Qamar");
    // "Barouk Rd" in Beit ed-Dine is a road: the loader gives the nearest village instead.
    expect(pilotVillage("Beit ed-Dine", "MHPJ+Q54, Barouk Rd, Beit ed-Dine, Lebanon")).toBeNull();
    expect(vendors.filter((v) => !v.village)).toHaveLength(1);
    expect(vendors.filter((v) => v.village && !PILOT_VILLAGES[v.village])).toEqual([]);
  });

  it("takes the WhatsApp candidate from the number: 218 Lebanese mobiles", () => {
    expect(vendors.filter((v) => v.phone_seed_mobile)).toHaveLength(218);
    expect(whatsappDisagreements(rows)).toBe(0);
    // A landline flagged True in the file would still not be a candidate.
    const forged = normalizeShouf([
      { ...rows.find((r) => r.contact_tier === "TIER_B_LANDLINE")!, is_whatsapp_candidate: "True" },
    ]);
    expect(forged.vendors[0].phone_seed_mobile).toBe(false);
  });

  it("keeps hours internal and never reads a rating or review", () => {
    expect(Object.keys(rows[0]).some((k) => /rating|review/i.test(k))).toBe(false);
    expect(vendors.some((v) => v.import_labels.hours_seed)).toBe(true);
  });
});

describe("Shouf draft menus (§38.2 items 2–3)", () => {
  const drafts = shoufDrafts(
    JSON.parse(readFileSync(join(src, "03_shouf_digital_menus.json"), "utf8")),
  );
  const items = (name: string) =>
    drafts.find((d) => d.vendor_name.startsWith(name))!.sections.flatMap((s) => s.items);

  it("parses prices as printed, with their currency, and nothing else", () => {
    expect(parsePrice("$9.00")).toEqual({ price: 9, currency: "USD" });
    expect(parsePrice("Mix\t\t\t\n\n0.16 $")).toEqual({ price: 0.16, currency: "USD" });
    expect(parsePrice("150,000 LL")).toEqual({ price: 150000, currency: "LBP" });
    expect(parsePrice("ask")).toEqual({ price: null, currency: null });
    expect(parsePrice("")).toEqual({ price: null, currency: null });
  });

  it("makes 19 restaurant menus and 2 supermarket catalogues", () => {
    expect(drafts.filter((d) => d.kind === "restaurant")).toHaveLength(19);
    expect(drafts.filter((d) => d.kind === "supermarket")).toHaveLength(2);
    expect(items("ROUTE 66")).toHaveLength(10);
    expect(items("Un basilico")).toHaveLength(12);
    expect(items("Fred's Food")).toHaveLength(63);
    expect(items("Coop Baakleen")).toHaveLength(45);
    expect(items("Coop Baakleen").every((i) => i.sku && i.currency === "USD")).toBe(true);
  });

  it("every draft fits menu_draft_check: names 1-120, prices numbers or null, USD/LBP/null", () => {
    for (const d of drafts) {
      expect(d.sections.length).toBeGreaterThan(0);
      expect(d.sections.length).toBeLessThanOrEqual(60);
      for (const i of d.sections.flatMap((s) => s.items)) {
        expect(i.name_en.length).toBeGreaterThan(0);
        expect(i.name_en.length).toBeLessThanOrEqual(120);
        expect(i.price === null || (typeof i.price === "number" && i.price > 0)).toBe(true);
        expect([null, "USD", "LBP"]).toContain(i.currency);
        expect(i.confidence).toBe(0.5);
      }
    }
  });

  it("every menu belongs to a merchant in the file", () => {
    const ids = new Set(vendors.map((v) => v.place_id));
    expect(drafts.filter((d) => !ids.has(d.place_id))).toEqual([]);
  });
});
