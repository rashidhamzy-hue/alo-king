// WEB4b: the food basket's cookie and the choice check (apps/web/src/lib/food-basket.ts). Ids and counts only; never a price.
import { describe, expect, it } from "vitest";
import { addLine, basketCookie, basketOf, checkChoices, decodeBasket, dishCount, encodeBasket, MAX_LINES, setQty, type FoodBasket } from "../../apps/web/src/lib/food-basket";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = id(1), P2 = id(2), D1 = id(11), D2 = id(12), O1 = id(21), O2 = id(22), O3 = id(23);

describe("the food basket's cookie", () => {
  it("round-trips a place, its lines, counts and options; holds nothing else", () => {
    const b: FoodBasket = { place: P1, lines: [{ product_id: D1, qty: 2, options: [O1, O2] }, { product_id: D2, qty: 1, options: [] }] };
    const v = encodeBasket(b);
    expect(v).toMatch(/^1~[A-Za-z0-9_-]{22}~[A-Za-z0-9_.~-]+$/);
    expect(decodeBasket(v)).toEqual(b);
    expect(basketOf(`lang=en; ak_food=${v}; ak_session=x`)).toEqual(b);
    expect(basketCookie(b)).toMatch(/^ak_food=1~.*; Path=\/; Max-Age=172800; SameSite=Lax; Secure; HttpOnly$/);
    expect(basketCookie(null)).toMatch(/^ak_food=; Path=\/; Max-Age=0;/);
  });
  it("anything that is not a basket is no basket, never an error", () => {
    for (const bad of ["", "2~x", "1~short~x", "1~" + "A".repeat(22), `1~${encodeBasket({ place: P1, lines: [{ product_id: D1, qty: 1, options: [] }] }).split("~")[1]}~xx.1`,
      encodeBasket({ place: P1, lines: [{ product_id: D1, qty: 1, options: [] }] }).replace(/\.1$/, ".0"), encodeBasket({ place: P1, lines: [{ product_id: D1, qty: 1, options: [] }] }).replace(/\.1$/, ".51"),
      "1~<script>~x", "x".repeat(5000)]) {
      expect(decodeBasket(bad), bad.slice(0, 40)).toBeNull();
    }
  });
  it("the same dish with the same choices adds to its count (any order of choices); other choices are another line", () => {
    let b = addLine(null, P1, { product_id: D1, qty: 1, options: [O1, O2] })!;
    b = addLine(b, P1, { product_id: D1, qty: 2, options: [O2, O1] })!;
    b = addLine(b, P1, { product_id: D1, qty: 1, options: [O3] })!;
    expect(b.lines.map((l) => [l.qty, l.options.length])).toEqual([[3, 2], [1, 1]]);
    expect(dishCount(b)).toBe(4);
    expect(addLine(b, P1, { product_id: D1, qty: 50, options: [O3] })!.lines[1]!.qty).toBe(50);   // the database's cap
  });
  it("a dish of another place starts that place's basket (the page asks first)", () => {
    const b = addLine(addLine(null, P1, { product_id: D1, qty: 1, options: [] }), P2, { product_id: D2, qty: 1, options: [] })!;
    expect(b).toEqual({ place: P2, lines: [{ product_id: D2, qty: 1, options: [] }] });
  });
  it("fits in one cookie: thirty lines with choices, never a thirty-first", () => {
    let b: FoodBasket | null = null;
    for (let i = 0; i < MAX_LINES; i++) b = addLine(b, P1, { product_id: id(100 + i), qty: 1, options: [O1, O2, O3] });
    expect(b!.lines.length).toBe(30);
    expect(basketCookie(b).length).toBeLessThan(4096);
    expect(addLine(b, P1, { product_id: id(999), qty: 1, options: [] })).toBeNull();
  });
  it("one less, one more, 0 takes the line out; a wrong index changes nothing", () => {
    const b: FoodBasket = { place: P1, lines: [{ product_id: D1, qty: 2, options: [] }, { product_id: D2, qty: 1, options: [] }] };
    expect(setQty(b, 0, 1).lines[0]!.qty).toBe(1);
    expect(setQty(b, 1, 0).lines.map((l) => l.product_id)).toEqual([D1]);
    expect(setQty(b, 7, 3)).toEqual(b);
    expect(setQty(b, 0, 999).lines[0]!.qty).toBe(50);
  });
});

describe("the choices of a dish", () => {
  const dish = { groups: [
    { group_id: "size", name_en: "Size", name_ar: null, required: true, min: 1, max: 1, options: [{ id: O1, name_en: "Regular", name_ar: null, price_delta_usd: 0 }, { id: O2, name_en: "Large", name_ar: null, price_delta_usd: 2 }] },
    { group_id: "extra", name_en: "Add-ons", name_ar: null, required: false, min: 0, max: 2, options: [{ id: O3, name_en: "Garlic", name_ar: null, price_delta_usd: 0.5 }] },
  ] };
  it("a required choice must be made; the group is named", () => {
    expect(checkChoices(dish, [])).toEqual({ ok: false, why: "need", group: "size" });
    expect(checkChoices(dish, [O3])).toEqual({ ok: false, why: "need", group: "size" });
    expect(checkChoices(dish, [O2])).toEqual({ ok: true });
    expect(checkChoices(dish, [O2, O3])).toEqual({ ok: true });
  });
  it("an option of another dish, a repeat or two of a one-choice group is refused", () => {
    expect(checkChoices(dish, [O2, id(99)])).toMatchObject({ ok: false, why: "bad" });
    expect(checkChoices(dish, [O2, O2])).toMatchObject({ ok: false, why: "bad" });
    expect(checkChoices(dish, [O1, O2])).toMatchObject({ ok: false, why: "bad" });
  });
});
