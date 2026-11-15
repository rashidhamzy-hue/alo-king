// SIM1: the failing cases the run wrote (evals/cases/sim_<class>.json) are well formed and hold invented data only. They fail on
// purpose; the lane that fixes a class replays its cases. Nothing here runs a model.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../cases/", import.meta.url));
const files = readdirSync(dir).filter((f) => /^sim_[a-z_]+\.json$/.test(f));

describe("SIM1 failing cases", () => {
  it("there is a file per failure class", () => { expect(files.length).toBeGreaterThan(0); });
  it.each(files)("%s is well formed, with an owner, and no phone number", (f) => {
    const j = JSON.parse(readFileSync(dir + f, "utf8")) as { about: string; owner: string; severity: number; cases: { id: string; seed: number; customer: string[]; shop: string[][]; expect: string }[] };
    expect(j.about).toMatch(/^SIM1/);
    expect(["ordering lane", "hand-off", "message design"]).toContain(j.owner);
    expect(j.severity).toBeGreaterThanOrEqual(1);
    expect(j.cases.length).toBeGreaterThan(0);
    for (const c of j.cases) {
      expect(c.id).toMatch(/^sim-\d{3}/);
      expect(c.customer.length).toBe(c.shop.length);
      expect(c.expect).toMatch(/^no /);
    }
    expect(JSON.stringify(j)).not.toMatch(/\+961\s?\d|\b(?:70|71|76|78|79|81|03)\s?\d{3}\s?\d{3}\b/);
  });
});
