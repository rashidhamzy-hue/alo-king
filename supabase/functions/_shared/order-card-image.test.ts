import { readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_MAX_LINES, orderCardImageMessage, orderCardSvg, type OrderCardImage } from "./order-card-image";

// DECISIONS §32.5 "visual order card": the SVG renders to a PNG with the bundled Noto fonts (the same
// renderer the dispatch function uses), shows the locked-rate totals, and never lets item text inject markup.
const FONTS = ["NotoNaskhArabic-Regular", "NotoNaskhArabic-Bold", "NotoSans-Regular", "NotoSans-Bold"].map((f) =>
  new Uint8Array(readFileSync(`supabase/functions/_shared/fonts/${f}.ttf`)),
);
const ORDER: OrderCardImage = {
  code: "K7M2QX",
  vendor_ar: "مشاوي أبو كليم",
  vendor_en: "Abu Claim Grill",
  lines: [
    { name_ar: "شاورما دجاج", name_en: "Chicken shawarma", quantity: 2, line_usd: 9 },
    { name_ar: "بطاطا", name_en: "Fries", quantity: 1, line_usd: 2.5 },
  ],
  delivery_fee_usd: 2,
  total_usd: 13.5,
  total_lbp: 1208250,
  usd_lbp_rate: 89500,
  same_price: true,
};

beforeAll(async () => {
  await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
});
const render = (svg: string) =>
  new Resvg(svg, { font: { fontBuffers: FONTS, loadSystemFonts: false, defaultFontFamily: "Noto Sans" } }).render();

describe("visual order card", () => {
  it("renders to a PNG in Arabic and English", () => {
    for (const lang of ["ar", "en"] as const) {
      const img = render(orderCardSvg(ORDER, lang));
      expect(img.width).toBe(1080);
      const png = img.asPng();
      expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
      if (process.env.CARD_PREVIEW) writeFileSync(`${process.env.CARD_PREVIEW}/card-${lang}.png`, png);
    }
  });
  it("shows the server's totals and the locked rate, and the badge only when confirmed", () => {
    const svg = orderCardSvg(ORDER, "en");
    expect(svg).toContain("$13.50");
    expect(svg).toContain("1,208,250 LBP");
    expect(svg).toContain("Rate 89,500 LBP/USD · locked at order");
    expect(svg).toContain("Same price as in the shop");
    expect(orderCardSvg({ ...ORDER, same_price: false }, "en")).not.toContain("Same price");
  });
  it("escapes item names and caps the number of lines", () => {
    const svg = orderCardSvg(
      {
        ...ORDER,
        lines: Array.from({ length: 20 }, (_, k) => ({ name_ar: `<script>x${k}</script> & "y"`, quantity: 1, line_usd: 1 })),
      },
      "ar",
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg.match(/× /g)?.length).toBe(CARD_MAX_LINES);
    expect(svg).toContain(`+ ${20 - CARD_MAX_LINES} أصناف كمان`);
    expect(() => render(svg)).not.toThrow();
  });
  it("the image message carries the uploaded media id and the order code", () => {
    expect(orderCardImageMessage("+96170000001", "123", "K7M2QX")).toMatchObject({
      to: "96170000001",
      type: "image",
      image: { id: "123", caption: "#K7M2QX" },
    });
  });
});
