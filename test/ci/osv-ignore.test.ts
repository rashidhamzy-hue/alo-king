// The one advisory CI's osv-scanner is told to ignore (coordinator, 17 November 2026; docs/DECISIONS.md, "UX3"): GHSA-fc5q-39xc-vjpf, picomatch, a development
// dependency that is in no deployed bundle, with no fixed version. The entry must stay exactly that: one advisory by id (never a package or a severity), an expiry, a reason
// that says why and when to remove it, and the file next to the lockfile where osv-scanner reads it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const toml = readFileSync(join(repo, "osv-scanner.toml"), "utf8");

describe("osv-scanner.toml", () => {
  it("sits next to package-lock.json, where osv-scanner reads it", () => {
    expect(existsSync(join(repo, "package-lock.json"))).toBe(true);
  });
  it("ignores one advisory, by its id, and nothing else", () => {
    const entries = [...toml.matchAll(/^\[\[(\w+)\]\]/gm)].map((m) => m[1]);
    expect(entries).toEqual(["IgnoredVulns"]);
    expect([...toml.matchAll(/^id\s*=\s*"([^"]+)"/gm)].map((m) => m[1])).toEqual(["GHSA-fc5q-39xc-vjpf"]);
    expect(toml).not.toMatch(/^\s*\[\[?(PackageOverrides|IgnoredPackages)/m);           // no package-wide override
    expect(toml).not.toMatch(/^\s*(ignore|severity|name|ecosystem)\b/m);
  });
  it("expires on 2026-12-17, and says why and when to remove it", () => {
    expect(toml).toMatch(/^ignoreUntil\s*=\s*2026-12-17\s*$/m);
    const reason = /^reason\s*=\s*"([^"]+)"/m.exec(toml)![1]!;
    expect(reason).toMatch(/dev dependency/i); expect(reason).toMatch(/not in any deployed bundle/i);
    expect(reason).toMatch(/no fixed version/i); expect(reason).toMatch(/remove when a fixed picomatch ships/i);
  });
});
