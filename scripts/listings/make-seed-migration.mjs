#!/usr/bin/env node
// LV1: builds supabase/migrations/0225_listings_seed.sql from supabase/seed/chouf_listings.csv (the founder's file, 17 November 2026).
// A migration cannot read a file, so the rows are written into it; test/db/lv1-listings.test.ts holds the table equal to the file, and
// test/ci/listings-lv1.test.ts holds this migration equal to what this script writes. Run it after the file changes ONLY for a new migration
// number: an applied migration is never edited (invariant 8). Usage: node scripts/listings/make-seed-migration.mjs [out]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function build(csvText) {
  const [head, ...rows] = parseCsv(csvText);
  const want = ["listing_id", "name", "category", "village", "km_from_hub", "google_maps_url"];
  if (JSON.stringify(head) !== JSON.stringify(want)) throw new Error(`unexpected columns: ${head}`);
  const lines = rows.map((r) => `  (${q(r[0])}, ${q(r[1])}, ${q(r[2].toLowerCase())}, ${r[3] === "" ? "null" : q(r[3])}, ${Number(r[4]).toFixed(1)}, ${q(r[5])})`);
  return `-- Alo King Chouf, session LV1: the Chouf places listed before they sign (founder decision of 17 November 2026; docs/DECISIONS.md,
-- "Listings before they sign, 17 November 2026"). ${rows.length} rows, loaded from supabase/seed/chouf_listings.csv by
-- scripts/listings/make-seed-migration.mjs. The file has a name, a kind, a village, a distance and a map link for each place, and no phone,
-- rating, review count, menu, hours or photo, by design. A listing is not a merchant and is never orderable (0224). Safe to run twice.
insert into listings(listing_id, name, kind, village, km_from_hub, maps_url) values
${lines.join(",\n")}
on conflict (listing_id) do nothing;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? join(repo, "supabase/migrations/0225_listings_seed.sql");
  writeFileSync(out, build(readFileSync(join(repo, "supabase/seed/chouf_listings.csv"), "utf8")));
  console.log(`wrote ${out}`);
}
