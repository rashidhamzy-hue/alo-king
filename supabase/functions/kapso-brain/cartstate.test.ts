import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cartRevival } from "./cartstate.ts";

const NOW = Date.parse("2026-10-05T17:09:00Z");
const cart = (over: Record<string, unknown> = {}) => ({ id: "c1", status: "pending", expires_at: "2026-10-05T16:30:00Z", created_at: "2026-10-05T16:10:00Z", items: [{ item_id: "a", quantity: 1, choices: [] }], ...over });

describe("cartRevival: what to do when someone taps Confirm on a summary that is no longer live", () => {
  it("an expired but never confirmed summary is rebuilt (prices come from the database again)", () => expect(cartRevival(cart(), NOW)).toBe("revive"));
  it("one that was already confirmed is reported as placed, never rebuilt", () => expect(cartRevival(cart({ status: "confirmed" }), NOW)).toBe("placed"));
  it("one replaced by a newer summary (status expired) is not resurrected", () => expect(cartRevival(cart({ status: "expired" }), NOW)).toBe("gone"));
  it("a summary older than a day is not rebuilt (the customer must start again)", () => expect(cartRevival(cart({ created_at: "2026-10-04T16:00:00Z" }), NOW)).toBe("gone"));
  it("no cart, no items, or a cart that has not expired yet (nothing to revive) are handled", () => {
    expect(cartRevival(null, NOW)).toBe("gone");
    expect(cartRevival(cart({ items: [] }), NOW)).toBe("gone");
    expect(cartRevival(cart({ items: null }), NOW)).toBe("gone");
    expect(cartRevival(cart({ expires_at: "2026-10-05T18:00:00Z" }), NOW)).toBe("gone"); // live carts are confirmed by the normal path
  });
});

describe("wiring", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const i = src.indexOf("async function confirmCart");
  const body = src.slice(i, i + 3500);
  it("an expired summary is rebuilt through the same server-side pricing path, with one short explanation, and 'already placed' is said plainly", () => {
    expect(body).toMatch(/cartRevival\(/);
    expect(body).toMatch(/prepareOrder\(/);
  });
  it("revival: the old summary is claimed atomically first, checked with buildOrder BEFORE any explanation is sent, keeps the basket link, and does not overwrite a newer address", () => {
    const seg = body.slice(body.indexOf("k === \"revive\""));
    expect(seg).toMatch(/update\(\{ status: "expired" \}\)\.eq\("id", old\.id\)\.eq\("status", "pending"\)/);
    expect(seg.indexOf("buildOrder(")).toBeGreaterThan(0);
    expect(seg.indexOf("buildOrder(")).toBeLessThan(seg.indexOf("That summary had expired"));
    expect(seg).toMatch(/basket_id: old\.basket_id/);
    expect(seg).toMatch(/cu\?\.village/); // the customer's current village / landmark win over the old cart's
  });
  it("a second tap on a replaced summary points to the newer one instead of 'expired or already placed'", () => {
    expect(body).toMatch(/newer summary/);
  });
});

describe("empty basket shown by the model", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  it("the model's basket_show on an empty basket sends nothing (the old text was glued to unrelated answers); the Basket button still says it", () => {
    const i = src.indexOf('if (name === "basket_show")');
    const seg = src.slice(i, i + 900);
    expect(seg).toMatch(/explicit/);
    expect(seg).toMatch(/if \(!bs\.length\)[\s\S]{0,300}if \(input\?\.explicit\)/);
    expect(src).toMatch(/basketTool\(c, phone, "basket_show", \{ explicit: true \}\)/);
  });
});
