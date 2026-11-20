// PERF1: the cards draw the 400 px copy with a 400/800 srcset; the product page the 800 px copy; before the copies are made, the
// original as before. Only the first visible row of a grid is eager; everything else is lazy, with its width and height.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { pictureSet } from "../src/lib/db";
import { ProductGrid, ProductRail, type CardData } from "../src/components/ref/Product";

const env = { SUPABASE_URL: "https://p.supabase.test" };
const pub = (k: string) => `https://p.supabase.test/storage/v1/object/public/catalog/${k}`;
const pic = { path: "AK-1-abc.webp", w400: "AK-1-abc-w400-0123456789ab.webp", w800: "AK-1-abc-w800-ba9876543210.webp", width_px: 1000, height_px: 1000 };

describe("which picture a page draws", () => {
  it("cards: the 400 px copy with both in the srcset; the product page: the 800 px copy", () => {
    expect(pictureSet(env, pic, 400)).toEqual({ src: pub(pic.w400), srcSet: `${pub(pic.w400)} 400w, ${pub(pic.w800)} 800w`, width: 400, height: 400 });
    expect(pictureSet(env, pic, 800)).toMatchObject({ src: pub(pic.w800), width: 800, height: 800 });
  });
  it("before the copies are made: the original, with its own size", () => {
    expect(pictureSet(env, { path: pic.path, width_px: 1000, height_px: 1000 }, 400)).toEqual({ src: pub(pic.path), srcSet: null, width: 1000, height: 1000 });
  });
});

describe("eager and lazy", () => {
  const card = (i: number): CardData => ({ sku: `AK-${i}`, name: `n${i}`, unit: "", price: 1, inStock: true, comingSoon: false, img: pub(pic.w400),
    imgSet: `${pub(pic.w400)} 400w, ${pub(pic.w800)} 800w`, imgW: 400, imgH: 400, imgAlt: `n${i}`, tone: "clay", code: "dairy_eggs", per: null });
  const imgs = (html: string) => [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  it("a grid's first row (two cards on a phone) loads at once; the rest is lazy; every card has a size, a srcset and sizes", () => {
    const html = renderToStaticMarkup(createElement(ProductGrid, { items: [1, 2, 3, 4, 5].map(card), lang: "ar", eager: 2 }));
    const all = imgs(html);
    expect(all.map((t) => /loading="eager"/.test(t))).toEqual([true, true, false, false, false]);
    for (const t of all) { expect(t).toMatch(/width="400"/); expect(t).toMatch(/height="400"/); expect(t).toMatch(/srcSet=|srcset=/i); expect(t).toMatch(/sizes="[^"]*50vw"/); }
  });
  it("a rail below the fold is lazy throughout", () => {
    const html = renderToStaticMarkup(createElement(ProductRail, { items: [1, 2, 3].map(card), lang: "en" }));
    expect(imgs(html).every((t) => /loading="lazy"/.test(t))).toBe(true);
  });
});
