// PUB1: the pre-commit hook blocks a local commit that carries a planted example, and lets a clean one through.
// Run in a throwaway repository, with the real hook from .githooks and the real script.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs, no types
import { PLANTS } from "../../scripts/ci/personal-data-plants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
type Plant = { name: string; rule: string; path: string; text: string; secret: string };
const regexPlants = (PLANTS as Plant[]).filter((p) => p.rule !== "gitleaks");

// No network, no pinned-tool download, and no gitleaks picked up from the machine: the built-in rules are what is tested here.
const ENV = { ...process.env, ALO_NO_TOOL_INSTALL: "1", GITLEAKS_BIN: "/nonexistent/gitleaks", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
function git(cwd: string, args: string[]) { const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; }
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "pub1-hook-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]); git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.hooksPath", join(ROOT, ".githooks")]);
  return dir;
}
function stage(dir: string, path: string, text: string) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); git(dir, ["add", path]); }

describe("pre-commit hook", () => {
  it("is executable and calls the personal-data check on what is staged", () => {
    const p = join(ROOT, ".githooks/pre-commit");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).not.toBe(0);
    expect(readFileSync(p, "utf8")).toMatch(/no-personal-data\.mjs"? --staged/);
  });

  it.each(regexPlants.map((p) => [p.name, p] as const))("blocks a commit carrying %s", (_n, p) => {
    const dir = repo();
    try {
      stage(dir, p.path, p.text);
      const r = git(dir, ["commit", "-q", "-m", "plant"]);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain(p.rule);
      expect(r.out).not.toContain(p.secret);
      expect(git(dir, ["rev-parse", "--verify", "HEAD"]).code, "nothing was committed").not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  const gitleaksBin = [process.env.GITLEAKS_BIN, join(ROOT, ".tools/bin/gitleaks")].find((p) => p && existsSync(p));
  it.skipIf(!gitleaksBin)("blocks a commit carrying a planted secret when gitleaks is there (scripts/ci/install-tool.mjs gitleaks)", () => {
    const dir = repo();
    try {
      const secret = (PLANTS as Plant[]).find((p) => p.rule === "gitleaks")!;
      stage(dir, secret.path, secret.text);
      const r = spawnSync("git", ["commit", "-q", "-m", "plant"], { cwd: dir, encoding: "utf8", env: { ...ENV, GITLEAKS_BIN: gitleaksBin! } });
      expect(r.status, `${r.stdout}${r.stderr}`).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain("gitleaks");
      expect(`${r.stdout}${r.stderr}`).not.toContain(secret.secret);
      expect(git(dir, ["rev-parse", "--verify", "HEAD"]).code, "nothing was committed").not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("lets a clean commit through, and the same file once the example is removed", () => {
    const dir = repo();
    try {
      const p = regexPlants[0]!;
      stage(dir, p.path, p.text);
      expect(git(dir, ["commit", "-q", "-m", "plant"]).code).not.toBe(0);
      stage(dir, p.path, "Nothing personal here.\n");
      const r = git(dir, ["commit", "-q", "-m", "clean"]);
      expect(r.code, r.out).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("checks the staged content, not the working copy", () => {
    const dir = repo();
    try {
      const p = regexPlants[0]!;
      stage(dir, p.path, p.text);                              // the planted text is staged ...
      writeFileSync(join(dir, p.path), "Nothing personal here.\n"); // ... and then cleaned in the working copy only
      expect(git(dir, ["commit", "-q", "-m", "x"]).code).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("installing the hook through package.json", () => {
  it("package.json has a prepare script that runs scripts/ci/install-hooks.mjs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.prepare).toMatch(/install-hooks\.mjs/);
  });
  it("sets core.hooksPath to .githooks in a repository that has the hook, and never fails the install elsewhere", () => {
    const dir = repo();
    const plain = mkdtempSync(join(tmpdir(), "pub1-nogit-"));
    try {
      git(dir, ["config", "--unset", "core.hooksPath"]);
      mkdirSync(join(dir, ".githooks"));
      writeFileSync(join(dir, ".githooks/pre-commit"), "#!/bin/sh\nexit 0\n"); chmodSync(join(dir, ".githooks/pre-commit"), 0o755);
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci/install-hooks.mjs")], { cwd: dir, encoding: "utf8", env: ENV });
      expect(r.status, r.stderr).toBe(0);
      expect(git(dir, ["config", "--get", "core.hooksPath"]).out.trim()).toBe(".githooks");
      const r2 = spawnSync(process.execPath, [join(ROOT, "scripts/ci/install-hooks.mjs")], { cwd: plain, encoding: "utf8", env: ENV });
      expect(r2.status, r2.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true }); }
  });
});
