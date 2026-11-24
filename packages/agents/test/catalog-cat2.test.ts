// CAT2: the catalogue message's thumbnail and the catalogue's link come from data (catalog_feed, settings.catalog), never code.
import { describe, expect, it } from "vitest";
import { catalogFallback, catalogLinkFrom, thumbnailFrom } from "../src/catalog-messages";

const feed = [
  { sku: "AK-0001", product_id: "1", in_stock: true, feed_jpeg_path: null, category_code: "dairy_eggs" },          // no JPEG: not in Meta's feed
  { sku: "AK-0002", product_id: "2", in_stock: false, feed_jpeg_path: "AK-0002-x.feed.jpg", category_code: "dairy_eggs" }, // cannot be ordered
  { sku: "AK-0003", product_id: "3", in_stock: true, feed_jpeg_path: "AK-0003-x.feed.jpg", category_code: "pantry" },
  { sku: "AK-0004", product_id: "4", in_stock: true, feed_jpeg_path: "AK-0004-x.feed.jpg", category_code: "dairy_eggs" },
];

describe("CAT2: the thumbnail is a SKU in Meta's catalogue that can be ordered", () => {
  it("the catalogue's first such item; never one without its feed JPEG or out of stock", () => {
    expect(thumbnailFrom(feed, { catalog_id: "c" })).toBe("AK-0003");
  });
  it("the setting's SKU while it qualifies, else the first", () => {
    expect(thumbnailFrom(feed, { catalog_id: "c", thumbnail_sku: "AK-0004" })).toBe("AK-0004");
    expect(thumbnailFrom(feed, { catalog_id: "c", thumbnail_sku: "AK-0002" })).toBe("AK-0003");
  });
  it("for a category, the category's first such item", () => {
    expect(thumbnailFrom(feed, { catalog_id: "c", thumbnail_sku: "AK-0003" }, "dairy_eggs")).toBe("AK-0004");
  });
  it("nothing qualifies: null (no catalogue message is built)", () => {
    expect(thumbnailFrom(feed.slice(0, 2), { catalog_id: "c" })).toBeNull();
    expect(thumbnailFrom([], { catalog_id: "c" })).toBeNull();
  });
});

describe("CAT2: the catalogue's link", () => {
  it("from the product link's number (0272), or the setting", () => {
    expect(catalogLinkFrom({ catalog_id: "c", product_link: "https://wa.me/12036602328?text={sku}" })).toBe("https://wa.me/c/12036602328");
    expect(catalogLinkFrom({ catalog_id: "c", catalog_link: "https://wa.me/c/9611234567", product_link: "https://wa.me/12036602328?text={sku}" })).toBe("https://wa.me/c/9611234567");
    expect(catalogLinkFrom({ catalog_id: "c", catalog_link: "https://evil.test/c/1" })).toBeNull();
    expect(catalogLinkFrom({ catalog_id: "c" })).toBeNull();
  });
  it("the fallback is in the customer's language; with no link, the words to type instead", () => {
    const s = { catalog_id: "c", product_link: "https://wa.me/12036602328?text={sku}" };
    expect(catalogFallback(s, "fr")).toMatchObject({ text: expect.stringContaining("Le catalogue Alo King"), link: { label: "Ouvrir le catalogue", url: "https://wa.me/c/12036602328" } });
    expect(catalogFallback(s, "ar").link?.label).toBe("افتح الكتالوج");
    expect(catalogFallback({ catalog_id: "c" }, "en").link).toBeUndefined();
  });
});
