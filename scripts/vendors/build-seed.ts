// Builds the vendor import files from the raw vendor file (DECISIONS §15.2).
// Usage: node --experimental-strip-types scripts/vendors/build-seed.ts <raw.csv> <out dir>
// Writes vendors.csv (loaded by scripts/load-seed.sh), exclusions.csv and report.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeVendors, parseCsv, toCsv, vendorCsv } from "./normalize.ts";

const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error("usage: build-seed.ts <raw.csv> <out dir>");
  process.exit(2);
}
const rows = parseCsv(readFileSync(input, "utf8"));
const { vendors, exclusions, phoneIssues } = normalizeVendors(rows);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "vendors.csv"), vendorCsv(vendors));
writeFileSync(
  join(out, "exclusions.csv"),
  toCsv(
    ["place_id", "name", "reason"],
    exclusions.map((e) => [e.place_id, e.name, e.reason]),
  ),
);

const count = <T>(xs: T[], key: (x: T) => string) =>
  [...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())].sort(
    (a, b) => b[1] - a[1],
  );
const lines = [
  "# Vendor import report",
  "",
  `- rows in file: ${rows.length}`,
  `- imported: ${vendors.length}`,
  `- excluded: ${exclusions.length}`,
  `- without coordinates in Lebanon: ${vendors.filter((v) => v.lat === null).length}`,
  `- with a seed phone: ${vendors.filter((v) => v.phone_seed).length} (mobile: ${vendors.filter((v) => v.phone_seed_mobile).length})`,
  `- in a chain: ${vendors.filter((v) => v.brand_slug).length} vendors, ${new Set(vendors.map((v) => v.brand_slug).filter(Boolean)).size} brands`,
  `- links: ${vendors.flatMap((v) => v.links).length} (unsafe: ${vendors.flatMap((v) => v.links).filter((l) => l.status === "unsafe").length})`,
  "",
  "## Business types",
  ...count(vendors, (v) => v.business_type).map(([k, n]) => `- ${k}: ${n}`),
  "",
  "## Exclusions by reason",
  ...count(exclusions, (e) => e.reason).map(([k, n]) => `- ${k}: ${n}`),
  "",
  "## Repeated phone numbers",
  ...phoneIssues.map(
    (p) => `- ${p.phone.slice(0, 7)}…: ${p.place_ids.length} rows, ${p.resolution}`,
  ),
  "",
  "## Typed other_food (check the mapping)",
  ...vendors
    .filter((v) => v.business_type === "other_food")
    .slice(0, 200)
    .map(
      (v) =>
        `- ${v.name_en ?? v.name_ar} (${v.import_labels.google_primary_type ?? "-"} / ${v.import_labels.alo_king_category ?? "-"})`,
    ),
  "",
];
writeFileSync(join(out, "report.md"), lines.join("\n"));
console.log(`vendors: ${vendors.length} imported, ${exclusions.length} excluded`);
