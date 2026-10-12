import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Live Google Places lookups are off (config google_places_enabled = false). Two guarantees:
//  1. Nothing but the guarded module and check-setup.sh can reach Google or read GOOGLE_PLACES_SERVER_KEY.
//  2. check-setup.sh reports "skipped" and sends no request to Google while the flag is off or unreadable.
const ALLOWED = new Set([
  "supabase/functions/_shared/google-places.ts",
  "supabase/functions/_shared/google-places.test.ts",
  "scripts/google-places-guard.test.ts",
  "scripts/check-setup.sh",
  ".github/workflows/check-setup.yml",
]);
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".output")
      continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|sh|yml|yaml|json|sql)$/.test(name)) out.push(p);
  }
  return out;
};

describe("google places stays off", () => {
  it("only the guarded module and check-setup reach Google or the key", () => {
    const hits = ["supabase", "src", "scripts", ".github"]
      .flatMap((d) => walk(d))
      .filter((f) => !ALLOWED.has(f) && !f.startsWith("supabase/migrations_legacy/"))
      .filter((f) =>
        /GOOGLE_PLACES_SERVER_KEY|places\.googleapis\.com/.test(readFileSync(f, "utf8")),
      );
    expect(hits).toEqual([]);
  });

  it("the migration seeds the flag as false", () => {
    const sql = readdirSync("supabase/migrations")
      .map((f) => readFileSync(path.join("supabase/migrations", f), "utf8"))
      .join("\n");
    expect(sql).toMatch(/\('google_places_enabled',\s*'false'/);
  });

  // check-setup.sh with a fake curl: it records every URL and answers the config query with `flag`.
  const runSetup = (flag: "true" | "false" | "error") => {
    const dir = mkdtempSync(path.join(tmpdir(), "check-setup-"));
    const log = path.join(dir, "urls.log");
    const fake = path.join(dir, "curl");
    writeFileSync(
      fake,
      `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2;; -w|--max-time|-H|-d|-X) shift 2;; -*) shift;; *) url="$1"; shift;; esac
done
echo "$url" >> "${log}"
case "$url" in
  *database/query) ${flag === "error" ? 'echo "{}" > "$out"; printf 500' : `echo '[{"v": "${flag}"}]' > "$out"; printf 201`};;
  *) echo "{}" > "$out"; printf 200;;
esac
`,
    );
    chmodSync(fake, 0o755);
    let stdout = "";
    try {
      stdout = execFileSync("bash", ["scripts/check-setup.sh"], {
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          SUPABASE_PROJECT_REF: "tzugbbatfbvrfzxuacqx",
          SUPABASE_ACCESS_TOKEN: "x",
          GOOGLE_PLACES_SERVER_KEY: "SECRET-GOOGLE-KEY",
        },
      }).toString();
    } catch (e: any) {
      stdout = String(e.stdout ?? ""); // other checks fail without their secrets; the exit code is not under test
    }
    return { stdout, urls: readFileSync(log, "utf8") };
  };

  it("check-setup skips Google while the flag is off", () => {
    const { stdout, urls } = runSetup("false");
    expect(urls).not.toContain("places.googleapis.com");
    expect(stdout).toMatch(/SKIP\s+GOOGLE_PLACES_SERVER_KEY\s+skipped/);
    expect(stdout).not.toContain("SECRET-GOOGLE-KEY");
  });
  it("and when the flag cannot be read", () => {
    const { stdout, urls } = runSetup("error");
    expect(urls).not.toContain("places.googleapis.com");
    expect(stdout).toMatch(/SKIP\s+GOOGLE_PLACES_SERVER_KEY\s+skipped/);
  });
  it("and calls Google only when the flag is true", () => {
    const { urls } = runSetup("true");
    expect(urls).toContain("places.googleapis.com");
  });
});
