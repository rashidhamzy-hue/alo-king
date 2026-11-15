// PUB1: the public repository must never again carry a real phone number, a real location pin, a plus code, a real e-mail address or a secret.
// scripts/ci/no-personal-data.mjs is the check (CI, over the whole tree, and the pre-commit hook, over what is staged).
// Every planted example is put together at run time from fragments (scripts/ci/personal-data-plants.mjs), so this file and the tree stay clean.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs, no types
import { scanText } from "../../scripts/ci/no-personal-data.mjs";
// @ts-expect-error plain .mjs, no types
import { PLANTS, NEAR_MISSES } from "../../scripts/ci/personal-data-plants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts/ci/no-personal-data.mjs");

type Plant = { name: string; rule: string; path: string; text: string; secret: string };
type Miss = { name: string; path: string; text: string };

function run(args: string[], cwd = ROOT, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
function withTree(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pub1-"));
  try {
    for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const regexPlants = (PLANTS as Plant[]).filter((p) => p.rule !== "gitleaks");

describe("planted examples: each one is refused", () => {
  it("there is at least one planted example for every rule", () => {
    expect(new Set((PLANTS as Plant[]).map((p) => p.rule))).toEqual(new Set(["phone", "pin", "pluscode", "email", "gitleaks"]));
    for (const n of [11, 12, 13]) expect((PLANTS as Plant[]).some((p) => p.name === `phone-${n}-digits`), `phone of ${n} digits`).toBe(true);
  });

  it.each(regexPlants.map((p) => [p.name, p] as const))("%s is found by its own rule and by no other", (_n, p) => {
    const found = scanText(p.path, p.text) as { rule: string }[];
    expect(found.map((f) => f.rule)).toEqual([p.rule]);
  });

  it.each(regexPlants.map((p) => [p.name, p] as const))("%s: the command exits 1, names the file and the rule, and does not print the value", (_n, p) => {
    withTree({ [p.path]: p.text }, (dir) => {
      const r = run(["--root", dir, "--no-gitleaks"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain(p.path);
      expect(r.out).toContain(p.rule);
      // CI logs of a public repository are public: the value itself is never printed.
      expect(r.out).not.toContain(p.secret);
    });
  });
});

describe("what is not a finding", () => {
  it.each((NEAR_MISSES as Miss[]).map((m) => [m.name, m] as const))("%s", (_n, m) => {
    expect(scanText(m.path, m.text)).toEqual([]);
  });

  it("a village centre is allowed in the seed villages file and nowhere else", () => {
    const pin = (PLANTS as Plant[]).find((p) => p.name === "pin-5-decimals-json")!;
    expect(scanText("supabase/seed/villages.sql", pin.text)).toEqual([]);
    expect((scanText("scripts/anything.sql", pin.text) as { rule: string }[]).map((f) => f.rule)).toEqual(["pin"]);
  });

  it("a clean tree exits 0", () => {
    withTree({ "a.md": "Nothing personal here. Call the ops lead on the ops line.\n" }, (dir) => {
      const r = run(["--root", dir, "--no-gitleaks"]);
      expect(r.code, r.out).toBe(0);
    });
  });
});

describe("main passes", () => {
  it("the whole tracked tree has no finding (the same check CI runs)", () => {
    const r = run(["--no-gitleaks"]);
    expect(r.out).not.toMatch(/\bphone\b|\bpin\b|\bpluscode\b|\bemail\b/);
    expect(r.code, r.out).toBe(0);
  });
});

describe("gitleaks is part of the check", () => {
  const bin = [process.env.GITLEAKS_BIN, join(ROOT, ".tools/bin/gitleaks"), "/usr/local/bin/gitleaks"].find((p) => p && existsSync(p));
  const gitleaks = PLANTS.find((p: Plant) => p.rule === "gitleaks") as Plant;
  it.skipIf(!bin)("a planted secret is flagged (needs the pinned gitleaks: scripts/ci/install-tool.mjs gitleaks)", () => {
    withTree({ [gitleaks.path]: gitleaks.text }, (dir) => {
      const r = run(["--root", dir], ROOT, { GITLEAKS_BIN: bin! });
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("gitleaks");
      expect(r.out).not.toContain(gitleaks.secret);
    });
  });
  it("when gitleaks is required and missing, the check fails closed", () => {
    withTree({ "a.md": "clean\n" }, (dir) => {
      const r = run(["--root", dir], ROOT, { GITLEAKS_BIN: join(dir, "no-such-binary"), REQUIRE_GITLEAKS: "1" });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/gitleaks/);
    });
  });
  it("when gitleaks is not required and missing, the built-in rules still run and it says so", () => {
    withTree({ "a.md": "clean\n" }, (dir) => {
      const r = run(["--root", dir], ROOT, { GITLEAKS_BIN: join(dir, "no-such-binary"), ALO_NO_TOOL_INSTALL: "1" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/gitleaks.*not run|not run.*gitleaks/i);
    });
  });
});
