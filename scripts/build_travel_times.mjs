// Step 2 of 2. Reads the reviewed coordinates and asks OSRM for the full village-to-village matrix:
//   node scripts/build_travel_times.mjs > supabase/seed/travel_times_osrm.sql
// OSRM_URL defaults to the public demo server (fine for a one-off 42 x 42 table; self-host for anything regular).
// TIME_FACTOR scales car time to motorcycle time on these roads. Start at 1.0 and correct it from observed trips.
import { readFileSync } from "node:fs";
import { parseCoordsSql, travelTimesSql } from "./geo_lib.mjs";
const villages = parseCoordsSql(readFileSync("supabase/seed/village_coords.sql", "utf8"));
if (villages.length < 2) { console.error("No coordinates found. Run fetch_village_coords.mjs first and review its output."); process.exit(1); }
const base = process.env.OSRM_URL ?? "https://router.project-osrm.org";
const coords = villages.map((v) => `${v.lng},${v.lat}`).join(";");
const res = await fetch(`${base}/table/v1/driving/${coords}?annotations=duration,distance`);
if (!res.ok) { console.error(`OSRM answered ${res.status}`); process.exit(1); }
const { durations, distances } = await res.json();
console.log(travelTimesSql(villages, durations, distances, Number(process.env.TIME_FACTOR ?? "1.0")));
