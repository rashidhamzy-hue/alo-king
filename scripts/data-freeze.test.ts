import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// scripts/data-freeze.sh enforces DECISIONS §31 in CI.
const script = path.resolve("scripts/data-freeze.sh");
const run = (files: string[], title = "Phase 3a: customer bot", cwd = process.cwd()) =>
  spawnSync("bash", [script, "-"], {
    input: files.join("\n"),
    cwd,
    env: { ...process.env, PR_TITLE: title },
  }).status;

const withMigration = (sql: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "freeze-"));
  mkdirSync(path.join(dir, "supabase/migrations"), { recursive: true });
  const f = "supabase/migrations/20261012090000_x.sql";
  writeFileSync(path.join(dir, f), sql);
  return { dir, f };
};

describe("data-freeze", () => {
  it("passes ordinary changes", () => {
    expect(run(["supabase/functions/dispatch/handler.ts", "docs/decisions/LOG.md"])).toBe(0);
  });
  it("fails on every frozen path", () => {
    for (const f of [
      "supabase/seed/places/places.csv",
      "supabase/seed/vendors/source/vendors.csv",
      "supabase/seed/shouf/source/01_shouf_merchants_315.csv",
      "supabase/seed/nutrition/dishes.jsonl",
      "scripts/shouf/osm-fetch.mjs",
      "scripts/places/curated.csv",
      "scripts/vendors/normalize.ts",
      ".github/workflows/places-build.yml",
    ])
      expect(run([f]), f).toBe(1);
  });
  it("lets a Data: pull request through", () => {
    expect(run(["supabase/seed/places/places.csv"], "Data: final places list")).toBe(0);
  });
  it("fails a migration that renames, drops or retypes a frozen table or column", () => {
    for (const sql of [
      "alter table public.places rename column name_en to name_english;",
      "alter table public.vendors\n  drop column phone_seed;",
      "ALTER TABLE places ALTER COLUMN elevation_m TYPE numeric;",
      "alter table public.landmarks rename to landmarks_old;",
      "drop table if exists public.place_aliases;",
      "alter table app_private.seed_places drop column x;",
    ]) {
      const { dir, f } = withMigration(sql);
      expect(run([f], undefined, dir), sql).toBe(1);
    }
  });
  it("allows a new column with a default and tables that reference places", () => {
    const { dir, f } = withMigration(
      "-- alter table public.places drop column x (comment only)\n" +
        "alter table public.vendors add column if not exists bot_greeting text not null default '';\n" +
        "create table public.customer_profiles (place_id text references public.places(id));\n" +
        "alter table public.places_learned rename column a to b;",
    );
    expect(run([f], undefined, dir)).toBe(0);
  });
});
