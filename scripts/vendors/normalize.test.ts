import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classify,
  classifyLink,
  normalizePhone,
  normalizeVendors,
  parseCsv,
  splitName,
  vendorCsv,
} from "./normalize.ts";

const sample = parseCsv(
  readFileSync(join(process.cwd(), "scripts/vendors/fixtures/vendors-sample.csv"), "utf8"),
);
const result = normalizeVendors(sample);
const byId = new Map(result.vendors.map((v) => [v.place_id, v]));

describe("splitName", () => {
  it("splits Arabic and English", () => {
    expect(splitName("مطعم مزيان - Mezyan")).toEqual({
      name_ar: "مطعم مزيان",
      name_en: "Mezyan",
      branch_label: null,
    });
  });
  it("moves a branch suffix to branch_label", () => {
    expect(splitName("Wooden Bakery - Hazmieh")).toEqual({
      name_ar: null,
      name_en: "Wooden Bakery",
      branch_label: "Hazmieh",
    });
    expect(splitName("Sea Sweet - سي سويت - Jounieh")).toEqual({
      name_ar: "سي سويت",
      name_en: "Sea Sweet",
      branch_label: "Jounieh",
    });
    expect(splitName("Kaak Beirut (Achrafieh)")).toEqual({
      name_ar: null,
      name_en: "Kaak Beirut",
      branch_label: "Achrafieh",
    });
  });
  it("keeps a single-script name whole", () => {
    expect(splitName("فرن أبو علي")).toEqual({
      name_ar: "فرن أبو علي",
      name_en: null,
      branch_label: null,
    });
  });
});

describe("classify", () => {
  it("maps Google types to §17 business types and tags", () => {
    expect(classify("lebanese_restaurant", "", "Mezyan")).toEqual({
      business_type: "restaurant",
      cuisine_tags: ["lebanese"],
    });
    expect(classify("ice_cream_shop", "", "Hanna Mitri")).toEqual({
      business_type: "ice_cream",
      cuisine_tags: ["booza_ice_cream"],
    });
    expect(classify("butcher_shop", "", "Boucherie Chouf")).toEqual({
      business_type: "butcher",
      cuisine_tags: [],
    });
  });
  it("lets a specific name keyword beat a generic Google type", () => {
    expect(classify("restaurant", "", "Furn Abou Ali")).toMatchObject({
      business_type: "bakery_manakish",
    });
    expect(classify("restaurant", "", "Broasted Al Jabal")).toMatchObject({
      business_type: "fast_food",
      cuisine_tags: ["broasted_chicken"],
    });
    expect(classify("", "sweets", "حلويات الشوف")).toMatchObject({
      business_type: "sweets_pastry",
    });
  });
  it("keeps water and gas delivery as home essentials (§15.2)", () => {
    expect(classify("", "water", "Shouf Water Delivery")).toEqual({
      business_type: "home_essentials",
      cuisine_tags: [],
    });
    expect(classify("", "", "غاز الجبل")).toMatchObject({ business_type: "home_essentials" });
  });
  it("excludes fuel stations, hotels, coworking spaces, NGOs and industry", () => {
    expect(classify("gas_station", "", "TotalEnergies Baakline")).toEqual({
      exclude: "fuel station",
    });
    expect(classify("lodging", "", "Grand Hotel")).toEqual({ exclude: "hotel or guesthouse" });
    expect(classify("coworking_space", "", "Hub")).toEqual({ exclude: "coworking space" });
    expect(classify("", "", "Sofregaz")).toEqual({ exclude: "industrial or engineering firm" });
    expect(classify("", "", "جمعية الخير")).toEqual({ exclude: "NGO" });
  });
  it("keeps a food business whose name mentions a hotel", () => {
    expect(classify("bakery", "", "Hotel Dieu Bakery")).toMatchObject({
      business_type: "bakery_manakish",
    });
  });
  it("falls back to other_food", () => {
    expect(classify("", "", "Something")).toEqual({
      business_type: "other_food",
      cuisine_tags: [],
    });
  });
});

describe("normalizePhone", () => {
  it("normalises Lebanese numbers and recognises mobile prefixes", () => {
    expect(normalizePhone("03 781 234")).toEqual({ e164: "+9613781234", mobile: true });
    expect(normalizePhone("70 111 111")).toEqual({ e164: "+96170111111", mobile: true });
    expect(normalizePhone("+961 81 555 666")).toEqual({ e164: "+96181555666", mobile: true });
    expect(normalizePhone("05 111 222")).toEqual({ e164: "+9615111222", mobile: false });
    expect(normalizePhone("01-345678")).toEqual({ e164: "+9611345678", mobile: false });
    expect(normalizePhone("0096176222444")).toEqual({ e164: "+96176222444", mobile: true });
  });
  it("rejects junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("classifyLink", () => {
  it("classifies links and marks hijacked domains unsafe (§15.3)", () => {
    expect(classifyLink("https://instagram.com/x")?.kind).toBe("instagram");
    expect(classifyLink("www.facebook.com/x")?.kind).toBe("facebook");
    expect(classifyLink("https://menu.example.com/a")?.kind).toBe("menu");
    expect(classifyLink("example.com")).toEqual({
      kind: "website",
      url: "https://example.com/",
      status: "unchecked",
    });
    expect(classifyLink("http://gialacucinadamore.com")?.status).toBe("unsafe");
    expect(classifyLink("not a link")).toBeNull();
  });
});

describe("normalizeVendors on the sample file", () => {
  it("imports food vendors and excludes the rest with reasons", () => {
    expect(result.exclusions.map((e) => [e.place_id, e.reason])).toEqual([
      ["ChIJsample004", "fuel station"],
      ["ChIJsample010", "hotel or guesthouse"],
      ["ChIJsample013", "coworking space"],
      ["ChIJsample001", "duplicate place_id"],
    ]);
    expect(result.vendors).toHaveLength(12);
  });
  it("drops ratings, reviews and phone_raw", () => {
    const csv = vendorCsv(result.vendors);
    expect(csv).not.toMatch(/rating|reviews|phone_raw|is_whatsapp_candidate/);
    expect(csv).not.toContain("1200");
  });
  it("groups chains into one brand by name or website domain", () => {
    const a = byId.get("ChIJsample002")!;
    const b = byId.get("ChIJsample003")!;
    expect(a.brand_slug).toBe("wooden-bakery");
    expect(b.brand_slug).toBe("wooden-bakery");
    expect([a.slug, b.slug]).toEqual(["wooden-bakery-hazmieh", "wooden-bakery-jounieh"]);
    expect(byId.get("ChIJsample001")!.brand_slug).toBeNull();
  });
  it("keeps a phone shared by branches and drops one shared by unrelated businesses", () => {
    expect(byId.get("ChIJsample002")!.phone_seed).toBe("+96170111111");
    expect(byId.get("ChIJsample008")!.phone_seed).toBeNull();
    expect(byId.get("ChIJsample011")!.phone_seed).toBeNull();
    expect(result.phoneIssues.map((p) => p.resolution).sort()).toEqual([
      "chain branches",
      "data error: phone dropped",
    ]);
  });
  it("keeps the unsafe link flagged, never usable", () => {
    expect(byId.get("ChIJsample007")!.links).toEqual([
      { kind: "website", url: "https://gialacucinadamore.com/", status: "unsafe" },
    ]);
  });
  it("drops coordinates outside Lebanon", () => {
    expect(byId.get("ChIJsample015")!.lat).toBeNull();
    expect(byId.get("ChIJsample005")!.lat).toBe(33.6738);
  });
  it("gives Arabic-only names a stable slug", () => {
    expect(byId.get("ChIJsample005")!.slug).toMatch(/^v-[a-z0-9-]+$/);
  });
  it("keeps the import labels", () => {
    expect(byId.get("ChIJsample001")!.import_labels).toEqual({
      alo_king_category: "restaurant",
      google_primary_type: "lebanese_restaurant",
      region_code: "BEY",
    });
  });
});
