// Session LV1: the file the listings are loaded from (supabase/seed/chouf_listings.csv) and the seed migration built from it.
// The repository is public (docs/RUNBOOK.md, "What may never be committed"): the file must hold no phone number, and migration 0225
// must be exactly what scripts/listings/make-seed-migration.mjs writes from it, so the two cannot drift.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error a plain .mjs script
import { build } from "../../scripts/listings/make-seed-migration.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const csv = join(repo, "supabase/seed/chouf_listings.csv");

describe("the listings file and its seed migration", () => {
  it("passes the personal-data guard on its own: no phone number, no pin, no plus code, no e-mail", () => {
    const dir = mkdtempSync(join(tmpdir(), "lv1-"));
    try {
      copyFileSync(csv, join(dir, "chouf_listings.csv"));
      const r = spawnSync("node", [join(repo, "scripts/ci/no-personal-data.mjs"), "--root", dir, "--no-gitleaks"], { encoding: "utf8" });
      expect(r.stdout + r.stderr).toContain("nothing found");
      expect(r.status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("migration 0225 is exactly the file, written by the script", () => {
    expect(readFileSync(join(repo, "supabase/migrations/0225_listings_seed.sql"), "utf8")).toBe(build(readFileSync(csv, "utf8")));
  });

  it("the script refuses a file with other columns (a phone or a rating column would be one)", () => {
    expect(() => build("listing_id,name,category,village,km_from_hub,google_maps_url,phone\nx,y,Cafe,Z,1.0,https://www.google.com/maps/x,0\n")).toThrow(/unexpected columns/);
    expect(() => build("listing_id,name,category,village,km_from_hub,google_maps_url,rating\nx,y,Cafe,Z,1.0,https://www.google.com/maps/x,4.5\n")).toThrow(/unexpected columns/);
  });
});
