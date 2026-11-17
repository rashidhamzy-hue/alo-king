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

// ---- the words ----
import { DICTS } from "../../apps/web/src/lib/i18n";
import { ar as arMessages, en as enMessages, fr as frMessages } from "@ak/agents/messages";

describe("docs/ARABIC_REVIEW.md lists every word LV1 added, for a person to read", () => {
  const doc = readFileSync(join(repo, "docs/ARABIC_REVIEW.md"), "utf8");
  const start = doc.indexOf("## LV1, the Chouf food places listed before they sign");
  const section = doc.slice(start, doc.indexOf("\n## ", start + 10));            // this section only: later sessions' tables (UX3's) come after it
  const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

  it("the website: every food and kind key, in Arabic, English and French, word for word", () => {
    const listed = [...section.matchAll(/^\| `web\.(\w+)` \| (.*?) \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]!, fr: m[4]! }));
    const keys = Object.keys(DICTS.en).filter((k) => (k.startsWith("food") || k.startsWith("kind_")) && k !== "kind_shop");   // kind_shop is UX3's (docs/ARABIC_REVIEW.md, UX3)
    expect(listed.map((x) => x.key)).toEqual(keys);
    for (const row of listed) {
      expect(row.ar, row.key).toBe(cell(DICTS.ar[row.key]!)); expect(row.en, row.key).toBe(cell(DICTS.en[row.key]!)); expect(row.fr, row.key).toBe(cell(DICTS.fr[row.key]!));
      // every language has every word, and no praise, rating, health or diet word (invariants 14 and 15)
      for (const l of ["ar", "en", "fr"] as const) expect(DICTS[l][row.key], `${l} ${row.key}`).toBeTruthy();
      expect(row.ar + row.en + row.fr, row.key).not.toMatch(/الأفضل|صحي|مميز|best|healthy|top rated|meilleur|sain/i);
    }
  });

  it("the WhatsApp line", () => {
    for (const m of [arMessages, enMessages, frMessages]) expect(section).toContain(cell(m.fixed.listingClaimed("مخبز الشوف")));
  });

  it("no word in the website says a place can be ordered from, or is approved, verified or rated", () => {
    for (const l of ["ar", "en", "fr"] as const) {
      for (const k of Object.keys(DICTS.en).filter((x) => x.startsWith("food_") && x !== "food_want" && x !== "food_asked")) {
        expect(DICTS[l][k]!, `${l} ${k}`).not.toMatch(/approved|verified|rated|rating|موافق عليه|موثّق|معتمد|vérifié|approuvé|noté/i);
      }
    }
  });
});
