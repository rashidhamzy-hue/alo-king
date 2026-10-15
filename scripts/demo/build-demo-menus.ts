// Builds the menu overrides of the staging demo shops (DECISIONS §39.12) for supabase/test-fixtures/demo-shops.sql: the
// full harvested menu of each shop supabase/test-fixtures/demo-shops.json lists. Every other demo shop uses its seed draft
// on staging, so this list is never the list of demo shops (the fixture finds those: every shop with a priced menu).
// Usage: node --experimental-strip-types scripts/demo/build-demo-menus.ts <out.csv>
import { readFileSync, writeFileSync } from "node:fs";
import { toCsv } from "../vendors/normalize.ts";
import { HARVEST_MENUS, harvestedDrafts, type ShoufDraft } from "../vendors/shouf-menus.ts";

export type HarvestOverride = { place_id: string; name: string };

export const DEMO_SHOPS = "supabase/test-fixtures/demo-shops.json";

export function demoRows(overrides: HarvestOverride[], harvested: ShoufDraft[]): string[][] {
  return overrides.map((s) => {
    const h = harvested.find((d) => d.place_id === s.place_id);
    if (!h) throw new Error(`no harvested menu for ${s.name} (${s.place_id})`);
    return [s.place_id, s.name, "harvest", JSON.stringify(h.sections), h.source_url];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: build-demo-menus.ts <out.csv>");
    process.exit(2);
  }
  const overrides: HarvestOverride[] = JSON.parse(
    readFileSync(DEMO_SHOPS, "utf8"),
  ).full_harvested_menu;
  const harvested = harvestedDrafts(JSON.parse(readFileSync(HARVEST_MENUS, "utf8")), HARVEST_MENUS);
  const rows = demoRows(overrides, harvested);
  writeFileSync(out, toCsv(["place_id", "name", "menu", "sections", "source_url"], rows));
  console.log(`demo shops: ${rows.length} with the full harvested menu`);
}
