// Step 1 of 2. Looks up every village in supabase/seed/villages.sql on OpenStreetMap (Nominatim)
// and prints SQL to review before running:
//   node scripts/fetch_village_coords.mjs > supabase/seed/village_coords.sql
// Nominatim allows one request per second and requires a real User-Agent. Check every result on a map:
// several Lebanese villages share a name (Jbaa, Niha, Khraibeh), so the search is pinned to the Chouf.
import { readFileSync } from "node:fs";
import { villageNamesFromSeed } from "./geo_lib.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOX = "35.45,33.80,35.80,33.55";   // lon_min, lat_max, lon_max, lat_min: the Chouf, generously
const CONTACT = process.env.OSM_CONTACT ?? "set OSM_CONTACT to an email address";
for (const name of villageNamesFromSeed(readFileSync("supabase/seed/villages.sql", "utf8"))) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lb&bounded=1&viewbox=${BOX}&q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "User-Agent": `alo-king-setup/1.0 (${CONTACT})` } });
  const hit = res.ok ? (await res.json())[0] : null;
  if (hit) console.log(`update villages set lat = ${Number(hit.lat).toFixed(5)}, lng = ${Number(hit.lon).toFixed(5)} where name_en = '${name.replace(/'/g, "''")}'; -- ${hit.display_name}`);
  else console.log(`-- NOT FOUND: ${name} (drop a pin by hand)`);
  await sleep(1100);
}
