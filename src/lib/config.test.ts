import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WHATSAPP_DISPLAY, WHATSAPP_LINK, WHATSAPP_NUMBER } from "./config";

const src = readFileSync(resolve(process.cwd(), "src/lib/config.ts"), "utf8");

describe("WhatsApp number constants", () => {
  it("the wa.me link, the digits and the display string are the same number", () => {
    expect(WHATSAPP_NUMBER).toMatch(/^\d{10,15}$/);
    expect(WHATSAPP_DISPLAY.replace(/\D/g, "")).toBe(WHATSAPP_NUMBER);
    expect(WHATSAPP_LINK.startsWith(`https://wa.me/${WHATSAPP_NUMBER}?text=`)).toBe(true);
  });
  it("is not labelled as a sandbox number: Kapso lists it as a production number (phone_number_id 1384772384720496)", () => {
    const line = src.split("\n").find((l) => l.includes("WHATSAPP_NUMBER ="))!;
    expect(line).not.toMatch(/sandbox/i);
    expect(line).toMatch(/production/i);
    expect(line).toContain("1384772384720496");
  });
});
