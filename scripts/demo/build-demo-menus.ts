// Builds the staging demo list (DECISIONS §39.12) for supabase/test-fixtures/demo-shops.sql: one row per demo shop of
// supabase/test-fixtures/demo-shops.json, with the full harvested menu for a shop marked `harvest` (the fixture uses the
// shop's seed draft on staging for the others).
// Usage: node --experimental-strip-types scripts/demo/build-demo-menus.ts <out.csv>
import { readFileSync, writeFileSync } from "node:fs";
import { toCsv } from "../vendors/normalize.ts";
import { HARVEST_MENUS, harvestedDrafts, type ShoufDraft } from "../vendors/shouf-menus.ts";

export type DemoShop = { place_id: string; name: string; menu: "seed" | "harvest" };

export const DEMO_SHOPS = "supabase/test-fixtures/demo-shops.json";

export function demoRows(shops: DemoShop[], harvested: ShoufDraft[]): string[][] {
  return shops.map((s) => {
    if (s.menu !== "harvest") return [s.place_id, s.name, "seed", "", ""];
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
  const shops: DemoShop[] = JSON.parse(readFileSync(DEMO_SHOPS, "utf8")).shops;
  const harvested = harvestedDrafts(JSON.parse(readFileSync(HARVEST_MENUS, "utf8")), HARVEST_MENUS);
  const rows = demoRows(shops, harvested);
  writeFileSync(out, toCsv(["place_id", "name", "menu", "sections", "source_url"], rows));
  console.log(`demo shops: ${rows.length} (${rows.filter((r) => r[2] === "harvest").length} with the full harvested menu)`);
}
