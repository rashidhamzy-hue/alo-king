// SIM1: the workflow's promises, read from the file: manual only, this repository only, read-only contents, the simulation key
// only (stops when it is missing, never another Anthropic key), the key never echoed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wf = readFileSync(fileURLToPath(new URL("../../../.github/workflows/sim-test.yml", import.meta.url)), "utf8");
const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("sim-test.yml", () => {
  it("runs on workflow_dispatch only, in this repository only, with contents: read", () => {
    expect(code).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(code).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run|repository_dispatch):/m);
    expect(code).toContain("if: github.repository == 'rashidhamzy-hue/alo-king'");
    expect(code).toContain("permissions: { contents: read }");
  });
  it("uses secrets.ANTHROPIC_API_KEY_SIM only, stops when it is missing, and never prints it", () => {
    expect(code.match(/secrets\.ANTHROPIC_[A-Z_]+/g)!.every((s) => s === "secrets.ANTHROPIC_API_KEY_SIM")).toBe(true);
    expect(code).not.toMatch(/ANTHROPIC_API_KEY:/);
    expect(code).toMatch(/if \[ -z "\$ANTHROPIC_API_KEY_SIM" \]; then[\s\S]*?exit 1/);
    expect(code).not.toMatch(/echo[^\n]*\$\{?ANTHROPIC_API_KEY_SIM/);
    expect(code).not.toMatch(/set -x/);
  });
  it("reads staging with the secrets product-data.yml uses, and runs the simulator's own tests first", () => {
    expect(code).toContain("SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}");
    expect(code.indexOf("npx vitest run evals/sim/test")).toBeLessThan(code.indexOf("npx vitest run evals/sim/sim.live.test.ts"));
  });
});
