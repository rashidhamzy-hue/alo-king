// SIM1: evals/sim/scenarios.json is makeScenarios()'s output, and a seed always regenerates the same script.
// To write the file again after changing the generator: SIM_WRITE_SCENARIOS=1 npx vitest run evals/sim/test/scenarios.test.ts
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COUNTS, FOOD_VARIANTS, LANG_COUNTS, makeFoodScenarios, makeScenarios, MAX_TURNS, oosPool, TOTAL, type Scenario } from "../scenarios";
import foodCommitted from "../food-scenarios.json";
import { loadCatalog } from "../catalog";
import committed from "../scenarios.json";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const generated = makeScenarios();
const food = makeFoodScenarios();
if (env.SIM_WRITE_SCENARIOS === "1") {
  writeFileSync(fileURLToPath(new URL("../scenarios.json", import.meta.url)), JSON.stringify(generated, null, 1) + "\n");
  writeFileSync(fileURLToPath(new URL("../food-scenarios.json", import.meta.url)), JSON.stringify(food, null, 1) + "\n");
}
const file = committed as Scenario[];

describe("SIM1 scenarios", () => {
  it("the committed file is the generator's output", () => {
    expect(file).toEqual(generated);
  });

  it("FD2: the food scenarios are their generator's output, apart from the 500, every variant twice, invented data only", () => {
    expect(foodCommitted).toEqual(food);
    expect(food.map((s) => s.variant).sort()).toEqual([...FOOD_VARIANTS, ...FOOD_VARIANTS].sort());
    expect(food.every((s) => s.category === "food" && s.id.startsWith("food-") && s.items.length === 0)).toBe(true);
    for (const s of food) expect(`${s.persona} ${s.goal}`).not.toMatch(/\+?\d{8,}/);
  });

  it("five seeds re-run give the same scripts", () => {
    for (const seed of [10_000, 10_123, 10_250, 10_377, 10_499]) {
      const again = makeScenarios().find((s) => s.seed === seed);
      expect(again).toEqual(file.find((s) => s.seed === seed));
      expect(again).toEqual(makeScenarios().find((s) => s.seed === seed));
    }
  });

  it("has the brief's mix: 500 in all, the categories, the languages, a quarter voice, a tenth bursts", () => {
    expect(file).toHaveLength(TOTAL);
    expect(new Set(file.map((s) => s.id)).size).toBe(TOTAL);
    for (const [cat, n] of Object.entries(COUNTS)) expect(file.filter((s) => s.category === cat), cat).toHaveLength(n);
    for (const [lang, n] of Object.entries(LANG_COUNTS)) expect(file.filter((s) => s.lang === lang), lang).toHaveLength(n);
    expect(file.filter((s) => s.voice)).toHaveLength(125);
    expect(file.filter((s) => s.burst)).toHaveLength(50);
    expect(file.filter((s) => s.category === "cancel").map((s) => s.variant).sort()).toEqual([...Array(15).fill("after_confirm"), ...Array(15).fill("before_confirm"), ...Array(15).fill("during_picking")]);
    expect(file.every((s) => s.max_turns === MAX_TURNS && s.max_turns <= 12)).toBe(true);
  });

  it("the out-of-stock products are zeroed for everyone, so no other scenario orders them", () => {
    const pool = new Set(oosPool(loadCatalog()));
    for (const s of file) {
      if (s.category === "out_of_stock") expect(pool.has(s.oos_sku!)).toBe(true);
      const skus = [...s.items, ...(s.history?.items ?? [])].map((i) => i.sku).filter((k) => k !== s.oos_sku);
      expect(skus.filter((k) => pool.has(k)), s.id).toEqual([]);
    }
  });

  it("invented data only: no names, no phone numbers, every product from the catalogue", () => {
    const skus = new Set(loadCatalog().map((c) => c.sku));
    for (const s of file) {
      for (const i of [...s.items, ...(s.history?.items ?? [])]) expect(skus.has(i.sku)).toBe(true);
      expect(`${s.persona} ${s.goal}`).not.toMatch(/\+?\d{8,}/);
      expect(s.style).toHaveLength(3);
    }
    expect(file.filter((s) => s.history).length).toBe(40);          // complaint 15 + refund 15 + same as last time 10
  });
});
