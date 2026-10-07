// Checks OpenRouteService on the Shouf trip list before the first merchant goes live (DECISIONS §3).
// Run by .github/workflows/route-check.yml with ORS_API_KEY; prints a table and fails when a road
// distance is impossible (shorter than the straight line) or absurd (more than 3x it), or when a trip
// with a driven `expected_km` is more than 25% off.
// Usage: ORS_API_KEY=... node --experimental-strip-types scripts/routing/check-trips.ts
import { readFileSync } from "node:fs";
import { orsProvider, type LatLon } from "../../supabase/functions/_shared/routing.ts";

type TripFile = {
  places: Record<string, [number, number]>;
  trips: [string, string, number | null][];
};

function straightKm(a: LatLon, b: LatLon): number {
  const r = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const apiKey = process.env.ORS_API_KEY;
if (!apiKey) {
  console.log("ORS_API_KEY is not set (owner issue #76); nothing checked.");
  process.exit(0);
}
const file = JSON.parse(
  readFileSync(new URL("./shouf-trips.json", import.meta.url), "utf8"),
) as TripFile;
const pt = (name: string): LatLon => {
  const p = file.places[name];
  if (!p) throw new Error(`unknown place ${name}`);
  return { lat: p[0], lon: p[1] };
};
const ors = orsProvider({ apiKey, timeoutMs: 15000 });
let bad = 0;
console.log("| from | to | straight km | road km | ratio | driven km | verdict |");
console.log("|---|---|---|---|---|---|---|");
for (const [from, to, expected] of file.trips) {
  const a = pt(from);
  const b = pt(to);
  const [route] = await ors.matrix(a, [b]);
  const line = straightKm(a, b);
  const road = route ? route.distanceM / 1000 : null;
  const ratio = road != null ? road / line : null;
  let verdict = "ok";
  if (road == null) verdict = "NO ROUTE";
  else if (road < line * 0.98 || ratio! > 3) verdict = "IMPLAUSIBLE";
  else if (expected != null && Math.abs(road - expected) / expected > 0.25) verdict = "OFF BY >25%";
  if (verdict !== "ok") bad++;
  console.log(
    `| ${from} | ${to} | ${line.toFixed(2)} | ${road?.toFixed(2) ?? "-"} | ${ratio?.toFixed(2) ?? "-"} | ${expected ?? "-"} | ${verdict} |`,
  );
  await new Promise((r) => setTimeout(r, 1600)); // free plan: 40 matrix requests a minute
}
if (bad > 0) {
  console.error(`${bad} trip(s) failed the check`);
  process.exit(1);
}
