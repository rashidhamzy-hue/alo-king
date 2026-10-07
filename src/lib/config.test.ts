import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WHATSAPP_DISPLAY, WHATSAPP_LINK, WHATSAPP_NUMBER } from "./config";

const src = readFileSync(resolve(process.cwd(), "src/lib/config.ts"), "utf8");

describe("WhatsApp number constants", () => {
  it("the wa.me link, the digits and the display string are the same number", () => {
    expect(WHATSAPP_NUMBER).toMatch(/^(\d{10,15})?$/);
    expect(WHATSAPP_DISPLAY.replace(/\D/g, "")).toBe(WHATSAPP_NUMBER);
    expect(WHATSAPP_LINK.startsWith(`https://wa.me/${WHATSAPP_NUMBER}?text=`)).toBe(true);
  });
  it("never uses Kabsi's +1 201 number (a separate business, DECISIONS §2)", () => {
    expect(src).not.toContain("12014835474");
    expect(WHATSAPP_NUMBER).not.toBe("12014835474");
  });
});
