import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RETRY_SAFE_READS, RETRY_SAFE_WRITES } from "../supabase/functions/_shared/rest-rpc";

// Contract test (DECISIONS §29.5, §29.8): every RPC and table the deployed edge functions call exists in
// supabase/migrations, and no model name is hard-coded in function code (models are config rows). It covers
// each function listed in supabase/functions-deploy.txt plus the shared code they import, so merchant-ai is
// checked the moment session 5 adds it to the list.
const deployed = readFileSync("supabase/functions-deploy.txt", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

// Files reachable from each deployed index.ts through relative imports (legacy shared code nobody imports is
// not deployed, so it is not checked).
const reachable = (entry: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of readFileSync(entry, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+\.ts)["']/g))
    reachable(path.normalize(path.join(path.dirname(entry), m[1])), seen);
  return seen;
};
const code = [
  ...new Set(deployed.flatMap((fn) => [...reachable(`supabase/functions/${fn}/index.ts`)])),
].map((f) => ({
  f,
  src: readFileSync(f, "utf8"),
}));
const sql = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort() // migrations apply in name order, so the last definition of a function is the live one
  .map((f) => readFileSync(path.join("supabase/migrations", f), "utf8"))
  .join("\n");

describe("edge function contract", () => {
  it("every RPC called by deployed functions exists in the migrations", () => {
    const missing: string[] = [];
    for (const { f, src } of code)
      for (const m of src.matchAll(/\brpc\(\s*["']([a-z_][a-z0-9_]*)["']/g))
        if (!new RegExp(`create (or replace )?function public\\.${m[1]}\\(`).test(sql))
          missing.push(`${f}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
  it("every table read through PostgREST exists", () => {
    const missing: string[] = [];
    for (const { f, src } of code)
      for (const m of src.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\)/g))
        if (!new RegExp(`create table public\\.${m[1]}\\b`).test(sql))
          missing.push(`${f}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
  it("no model id is hard-coded outside the config fallbacks in index files", () => {
    const hits: string[] = [];
    for (const { f, src } of code) {
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (
          /["'](claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|whisper-1)["']/.test(l) &&
          !/cfg\.|\?\?/.test(l)
        )
          hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("an RPC retried after a stall is read-only or idempotent (rest-rpc.ts, #139)", () => {
    // The latest definition of each function, from `create ... function public.<fn>(` to the start of its body.
    const header = (fn: string) => {
      const all = [
        ...sql.matchAll(
          new RegExp(
            `create (?:or replace )?function public\\.${fn}\\(([\\s\\S]*?)\\bas\\s+\\$`,
            "g",
          ),
        ),
      ];
      return all.length ? all[all.length - 1][1] : null;
    };
    const notRead: string[] = [];
    for (const fn of RETRY_SAFE_READS) {
      const h = header(fn);
      if (!h || !/\b(stable|immutable)\b/i.test(h)) notRead.push(fn);
    }
    expect(notRead).toEqual([]);
    for (const fn of RETRY_SAFE_WRITES) expect(header(fn), fn).not.toBeNull();
  });
});
