// PUB1 item 2: gitleaks and osv-scanner are pinned to exact versions and every download is checked against a recorded SHA-256 before it runs.
// A tool that moves under us (osv-scanner used to be fetched from ".../releases/latest") could pass or fail a build for reasons nobody reviewed.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";   // already in the lockfile (a dependency of wrangler and vitest)
// @ts-expect-error plain .mjs, no types
import { pickFile, verifySha256, TOOLS } from "../../scripts/ci/install-tool.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("tools.json", () => {
  const manifest = JSON.parse(read("scripts/ci/tools.json")) as Record<string, { version: string; files: Record<string, { url: string; sha256: string }> }>;
  it("pins exactly gitleaks and osv-scanner, each to an exact version", () => {
    expect(Object.keys(manifest).sort()).toEqual(["gitleaks", "osv-scanner"]);
    for (const [name, t] of Object.entries(manifest)) expect(t.version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("every file has a release URL of that exact version and a 64-hex SHA-256", () => {
    for (const [name, t] of Object.entries(manifest)) {
      expect(Object.keys(t.files).length, name).toBeGreaterThanOrEqual(3);
      for (const [key, f] of Object.entries(t.files)) {
        expect(f.url.startsWith("https://github.com/"), `${name} ${key}`).toBe(true);
        expect(f.url.split("/").slice(5, 8), `${name} ${key}`).toEqual(["releases", "download", `v${t.version}`]);
        expect(f.url).not.toMatch(/latest/);
        expect(f.sha256, `${name} ${key}`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
  it("the installer reads the same manifest, and picks a file for linux x64 (the CI runner)", () => {
    expect(TOOLS).toEqual(manifest);
    expect(pickFile("gitleaks", "linux", "x64").url).toContain("gitleaks_" + manifest.gitleaks!.version + "_linux_x64.tar.gz");
    expect(pickFile("osv-scanner", "linux", "x64").url).toContain("osv-scanner_linux_amd64");
    expect(() => pickFile("gitleaks", "plan9", "x64")).toThrow(/no pinned/i);
  });
});

describe("the checksum is verified before anything runs", () => {
  const bytes = Buffer.from("not a real binary");
  const good = createHash("sha256").update(bytes).digest("hex");
  it("accepts the recorded hash", () => { expect(() => verifySha256(bytes, good, "x")).not.toThrow(); });
  it("refuses a different hash and a changed file", () => {
    expect(() => verifySha256(bytes, "0".repeat(64), "x")).toThrow(/checksum/i);
    expect(() => verifySha256(Buffer.from("changed"), good, "x")).toThrow(/checksum/i);
  });
});

describe("the workflows", () => {
  // A colon inside an unquoted step name made ci.yml invalid once: the run failed with no jobs at all, and nothing said why.
  it("every workflow file is valid YAML with jobs", () => {
    for (const f of readdirSync(join(ROOT, ".github/workflows")).filter((x) => /\.ya?ml$/.test(x))) {
      const doc = parseYaml(read(`.github/workflows/${f}`)) as { jobs?: Record<string, unknown> };
      expect(Object.keys(doc.jobs ?? {}).length, f).toBeGreaterThan(0);
    }
  });
});

describe("the workflows use the pinned installer and nothing else", () => {
  const ci = read(".github/workflows/ci.yml");
  it("ci.yml installs both tools through scripts/ci/install-tool.mjs", () => {
    expect(ci).toMatch(/install-tool\.mjs gitleaks/);
    expect(ci).toMatch(/install-tool\.mjs osv-scanner/);
  });
  it("no workflow downloads either tool by URL, and none fetches a release called latest", () => {
    for (const f of readdirSync(join(ROOT, ".github/workflows")).filter((x) => /\.ya?ml$/.test(x))) {
      const text = read(`.github/workflows/${f}`);
      expect(text, f).not.toMatch(/releases\/latest/);
      expect(text, f).not.toMatch(/releases\/download\/[^\n]*(gitleaks|osv-scanner)/);
    }
  });
  it("ci.yml runs the personal-data check inside a required job, over the whole tree, with gitleaks required", () => {
    const job = ci.slice(ci.indexOf("  secrets-and-dependencies:"), ci.indexOf("  pilot-locks:"));
    expect(job).toMatch(/no-personal-data\.mjs/);
    expect(job).toMatch(/REQUIRE_GITLEAKS/);
    expect(job).toMatch(/no-personal-data\.mjs --self-test/);
  });
});
