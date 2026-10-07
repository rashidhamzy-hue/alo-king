import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural guards for the fewer-messages work (docs/legacy/message-audit.md): which paths may send the optional "Add a drink?" card.
const SRC = readFileSync(resolve(__dirname, "index.ts"), "utf8");
const lineWith = (needle: string) => SRC.split("\n").filter((l) => l.includes(needle));

describe("optional add-on card", () => {
  it("is not sent after a numbered quick order (the customer typed what they want)", () => {
    const l = lineWith(`basketTool(c, phone, "add_items", { vendor_id: qm.vendor_id`);
    expect(l.length).toBe(1); expect(l[0]).not.toContain("maybeOfferAddon");
  });
  it("is not sent after a parsed multi-item order either", () => {
    const i = SRC.indexOf(`basketTool(c, phone, "add_items", { vendor_id: d.vendorId`);
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i, i + 400)).not.toContain("maybeOfferAddon");
  });
  it("is still offered after a tap on Add / Order Now and after a model turn", () => {
    expect(SRC.match(/maybeOfferAddon\(c\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
