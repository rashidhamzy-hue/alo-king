// Builds the Shouf pilot load files (DECISIONS §38.1–38.2) from supabase/seed/shouf/source/.
// Usage: node --experimental-strip-types scripts/vendors/build-shouf.ts <source dir> <out dir>
// Writes vendors.csv and exclusions.csv (the vendor loader's format plus town_id), menus.csv (draft menus)
// and report.md. scripts/load-seed.sh loads them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv, VENDOR_COLUMNS, vendorCells } from "./normalize.ts";
import { normalizeShouf, parseCsv, whatsappDisagreements } from "./shouf.ts";
import { ownerDrafts, ownerDuplicates, shoufDrafts } from "./shouf-menus.ts";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: build-shouf.ts <source dir> <out dir>");
  process.exit(2);
}
const rows = parseCsv(readFileSync(join(src, "01_shouf_merchants_315.csv"), "utf8"));
// The owner's transcribed menu photos (§39.4 source 1), when present.
const ownerFile = join(src, "04_owner_menu_photos_2026-10-14.json");
const owner = existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, "utf8")) : null;
const { vendors, exclusions, phoneIssues } = normalizeShouf(
  rows,
  owner ? ownerDuplicates(owner) : new Map(),
);
const drafts = [
  ...shoufDrafts(JSON.parse(readFileSync(join(src, "03_shouf_digital_menus.json"), "utf8"))),
  ...(owner ? ownerDrafts(owner) : []),
];
const twice = drafts.filter((d, k) => drafts.findIndex((x) => x.place_id === d.place_id) !== k);
if (twice.length) {
  console.error(`two draft menus for: ${twice.map((d) => d.vendor_name).join(", ")}`);
  process.exit(1);
}
const known = new Set(vendors.map((v) => v.place_id));
const missing = drafts.filter((d) => !known.has(d.place_id));
if (missing.length) {
  console.error(`menus for unknown place_ids: ${missing.map((d) => d.vendor_name).join(", ")}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
// The vendor loader's columns, then town_id.
writeFileSync(
  join(out, "vendors.csv"),
  toCsv(
    [...VENDOR_COLUMNS, "town_id"],
    vendors.map((v) => [...vendorCells(v), v.town_id]),
  ),
);
writeFileSync(
  join(out, "exclusions.csv"),
  toCsv(
    ["place_id", "name", "reason"],
    exclusions.map((e) => [e.place_id, e.name, e.reason]),
  ),
);
writeFileSync(
  join(out, "menus.csv"),
  toCsv(
    ["place_id", "kind", "sections", "source_url", "captured_at"],
    drafts.map((d) => [
      d.place_id,
      d.kind,
      JSON.stringify(d.sections),
      d.source_url,
      d.captured_at,
    ]),
  ),
);

const count = <T>(xs: T[], key: (x: T) => string) =>
  [...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())].sort(
    (a, b) => b[1] - a[1],
  );
const items = drafts.flatMap((d) => d.sections.flatMap((s) => s.items));
writeFileSync(
  join(out, "report.md"),
  [
    "# Shouf load report",
    "",
    `- rows in file: ${rows.length}; imported: ${vendors.length}; excluded: ${exclusions.length}`,
    `- names in both scripts: ${vendors.filter((v) => v.name_ar && v.name_en).length}; Arabic only: ${vendors.filter((v) => v.name_ar && !v.name_en).length}`,
    `- seed phones: ${vendors.filter((v) => v.phone_seed).length}; WhatsApp candidates (mobile): ${vendors.filter((v) => v.phone_seed_mobile).length}; rows where the file's flag disagrees with the number: ${whatsappDisagreements(rows)}`,
    `- localities backfilled from the address: ${vendors.filter((v) => v.import_labels.locality_backfilled_from !== undefined).length}; no village in the file (nearest village at load): ${vendors.filter((v) => !v.village).length}`,
    `- draft menus: ${drafts.length} (${drafts.filter((d) => d.kind === "supermarket").length} supermarket catalogues), ${items.length} items, ${items.filter((i) => i.price === null).length} without a price (hidden)`,
    "",
    "## Villages",
    ...count(vendors, (v) => v.village ?? "(nearest at load)").map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Business types",
    ...count(vendors, (v) => v.business_type).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Repeated phone numbers",
    ...phoneIssues.map(
      (p) => `- ${p.phone.slice(0, 7)}…: ${p.place_ids.length} rows, ${p.resolution}`,
    ),
    "",
  ].join("\n"),
);
console.log(
  `shouf: ${vendors.length} vendors, ${exclusions.length} excluded, ${drafts.length} draft menus`,
);
