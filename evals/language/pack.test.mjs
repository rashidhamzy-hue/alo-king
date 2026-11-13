// Build plan 1.22: the pack builder drops what must not ship, and folds text exactly as SQL does.
import { describe, expect, it } from "vitest";
import { buildPack, foodWord, tokens, toSql } from "./build-pack.mjs";
import { openTestDb } from "../../test/db/harness";

const catalog = [
  { sku: "A1", name: "Najjar Cafe Classic Normal 180G" }, { sku: "A2", name: "Najjar Cafe Cardamom 180G" },
  { sku: "B1", name: "Pepsi Soft Drink Diet 1.25L" }, { sku: "C1", name: "Tanmia Fresh Chicken Filet 500G" },
];
const t = (s, lang = "ar") => ({ t: s, lang });

describe("language pack build (1.22)", () => {
  it("drops food-fact terms unless the word is printed in the product's name (invariant 15)", () => {
    expect(foodWord("دجاج حلال", catalog[3].name)).toBe("halal");
    expect(foodWord("gluten free coffee", catalog[0].name)).toBe("gluten");
    expect(foodWord("بيبسي دايت", catalog[2].name)).toBeNull();            // "Diet" is in the name
    expect(foodWord("قهوة نجار", catalog[0].name)).toBeNull();
  });

  it("an exact term that points at two products is dropped from both; a brand is never a kind", () => {
    const built = buildPack({ products: [
      { sku: "A1", kind: [t("قهوة"), t("نجار")], brand: [t("نجار")], exact: [t("نجار كلاسيك"), t("قهوة نجار")] },
      { sku: "A2", kind: [t("قهوة")], brand: [t("نجار")], exact: [t("نجار هال"), t("قهوه نجار")] },
      { sku: "C1", kind: [t("صدر دجاج حلال")], brand: [], exact: [] },
    ], filler: ["بدي", "قهوة", "عطيني"] }, catalog);
    const terms = (sku, level) => built.rows.filter((r) => r.sku === sku && r.level === level).map((r) => r.term);
    expect(terms("A1", "exact")).toEqual(["نجار كلاسيك"]);                 // «قهوة نجار» = «قهوه نجار» once folded: shared
    expect(terms("A2", "exact")).toEqual(["نجار هال"]);
    expect(terms("A1", "kind")).toEqual(["قهوة"]);                         // «نجار» is the brand
    expect(built.dropped.food).toEqual([{ sku: "C1", term: "صدر دجاج حلال", food: "halal" }]);
    expect(built.filler).toEqual(["بدي", "عطيني"]);                        // a kind word is never filler
  });

  it("the SQL it writes loads, and JS folds exactly as catalog_tokens()", async () => {
    const built = buildPack({ products: [{ sku: "ZZ-0001", kind: [t("قهوة")], brand: [t("نجار")], exact: [t("نجار بالهيل")] }], filler: ["يسلمو"] },
      [{ sku: "ZZ-0001", name: "Najjar Cafe Cardamom 180G" }]);
    const db = await openTestDb({ seeds: false });
    await db.pg.exec(toSql(built, { version: "t", model: "m", generated_at: "now" }));
    expect((await db.one(`select count(*)::int as n from language_pack where version = 't'`)).n).toBe(3);
    for (const s of ["بدي ٢ كرتونة مي تنورين، 500ml وقهوة!", "Café Grand Lait Demi-Écrémé 1L", "علبتين لبنة ليبان ليه", "ﻻ ـهلا ًأإآىةؤئ",
                     "2 7alib Candia x6 el 1.25L, a7mar 3adas", "pepsi 330ml x12 2L", "tannourine 6L xl"]) {
      expect(tokens(s), s).toEqual(await db.rpc("catalog_tokens", { p: s }));
    }
  }, 60_000);
});
