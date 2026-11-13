// 1.23 (session B4): the Worker writes new items' words with packages/agents/src/pack-rules.ts. It must apply exactly the rules
// evals/language/build-pack.mjs applied to the 1.22 pack: same tokens, same food-fact drops, on every term of pack.json.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: plain JS module of the 1.22 builder
import { buildPack, foodWord as foodMjs, tokens as tokensMjs } from "./build-pack.mjs";
// @ts-expect-error: plain JS module
import { loadCatalog } from "./catalog.mjs";
import { foodWord, productRows, tokens } from "../../packages/agents/src/pack-rules";

const pack = JSON.parse(readFileSync(fileURLToPath(new URL("./pack.json", import.meta.url)), "utf8"));
const catalog = loadCatalog() as { sku: string; name: string; category: string }[];
const bySku = new Map(catalog.map((p) => [p.sku, p]));

describe("pack rules: the Worker's copy agrees with the 1.22 builder", () => {
  it("tokens and food words, on every term of the pack", () => {
    let n = 0;
    for (const p of pack.products) for (const level of ["kind", "brand", "exact"]) for (const t of p[level] ?? []) {
      const prod = bySku.get(p.sku); if (!prod) continue;
      expect(tokens(t.t)).toEqual(tokensMjs(t.t));
      expect(foodWord(t.t, prod.name, prod.category)).toBe(foodMjs(t.t, prod.name, prod.category));
      n++;
    }
    expect(n).toBeGreaterThan(8000);
  });
  it("one product at a time drops what the whole build dropped for food", () => {
    const whole = buildPack(pack, catalog);
    const food = new Set(whole.dropped.food.map((d: { sku: string; term: string }) => `${d.sku}|${d.term}`));
    const mine = new Set<string>();
    for (const p of pack.products) {
      const prod = bySku.get(p.sku); if (!prod) continue;
      for (const d of productRows(p.sku, prod, p).dropped.food) mine.add(`${p.sku}|${d.term}`);
    }
    expect([...mine].sort()).toEqual([...food].sort());
  });
});
