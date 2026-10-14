// The delivery area's data from outside (DECISIONS §39.2), for the `area-data` workflow (build sessions cannot reach
// Overpass or OpenRouteService):
//   * boundaryBox(): the box around the boundary places' centres, for the OSM fetch (scripts/shouf/osm-fetch.mjs
//     --boundary), so landmarks and place names cover every delivered-to place and nothing toward Damour or the Iqlim.
//   * roads: the road distance from the nearest pilot merchant to each boundary place, from OpenRouteService, written
//     to supabase/seed/places/shouf_delivery_road_km.csv (place_id, road_km, nearest_vendor_place_id, provider,
//     computed_on). delivery_area_proposal() reads it; a place without a row falls back to the straight line.
// Usage: ORS_API_KEY=... node scripts/shouf/area.mjs roads <out.csv>
import { readFileSync, writeFileSync } from "node:fs";

const KM_PER_DEG_LAT = 111.32;

/** RFC 4180 CSV into objects keyed by the header (quoted cells, doubled quotes, newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""])));
}

export function straightKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The boundary places with their centres from places.csv; an id missing from places.csv is an error. */
export function boundaryPlaces(placesCsv, boundaryCsv) {
  const places = new Map(parseCsv(placesCsv).map((p) => [p.id, p]));
  return parseCsv(boundaryCsv).map((b) => {
    const p = places.get(b.place_id);
    if (!p) throw new Error(`boundary place ${b.place_id} is not in places.csv`);
    return { id: b.place_id, name: b.name_en || p.name_en, lat: Number(p.lat), lon: Number(p.lon) };
  });
}

/** Box (south, west, north, east) around the boundary places' centres, plus `marginKm` on every side. */
export function boundaryBox(placesCsv, boundaryCsv, marginKm = 3) {
  const pts = boundaryPlaces(placesCsv, boundaryCsv);
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const r = (n) => Math.round(n * 1e4) / 1e4;
  const dLat = marginKm / KM_PER_DEG_LAT;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLon = marginKm / (KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
  return [
    r(Math.min(...lats) - dLat),
    r(Math.min(...lons) - dLon),
    r(Math.max(...lats) + dLat),
    r(Math.max(...lons) + dLon),
  ];
}

/** The merchants' points from the Shouf file (operational rows with coordinates in Lebanon). */
export function merchantPoints(merchantsCsv) {
  return parseCsv(merchantsCsv)
    .map((m) => ({ id: m.place_id, lat: Number(m.latitude), lon: Number(m.longitude) }))
    .filter((m) => m.lat > 33 && m.lat < 34.8 && m.lon > 35 && m.lon < 36.7);
}

/** The `k` merchants nearest a place in a straight line: the road-nearest is among them in this terrain. */
export function nearestMerchants(place, merchants, k = 10) {
  return merchants
    .map((m) => ({ ...m, km: straightKm(place, m) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, k);
}

/** One ORS matrix request: the merchants are sources, the place is the one destination (merchant → customer). */
export function matrixBody(place, merchants) {
  return {
    locations: [...merchants, place].map((p) => [p.lon, p.lat]),
    sources: merchants.map((_, i) => i),
    destinations: [merchants.length],
    metrics: ["distance"],
    units: "m",
  };
}

/** The nearest merchant by road from an ORS matrix answer, or null when no merchant reaches the place. */
export function nearestByRoad(merchants, distances) {
  let best = null;
  merchants.forEach((m, i) => {
    const d = distances?.[i]?.[0];
    if (typeof d === "number" && (!best || d < best.m)) best = { id: m.id, m: d };
  });
  return best && { nearest: best.id, roadKm: Math.round(best.m / 10) / 100 };
}

async function roads(out) {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY is not set");
  const places = boundaryPlaces(
    readFileSync("supabase/seed/places/places.csv", "utf8"),
    readFileSync("supabase/seed/places/shouf_delivery_boundary.csv", "utf8"),
  );
  const merchants = merchantPoints(
    readFileSync("supabase/seed/shouf/source/01_shouf_merchants_315.csv", "utf8"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  const misses = [];
  for (const place of places) {
    const near = nearestMerchants(place, merchants);
    let hit = null;
    for (let attempt = 0; attempt < 4 && !hit; attempt++) {
      try {
        const res = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
          method: "POST",
          headers: {
            authorization: key,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(matrixBody(place, near)),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          hit = nearestByRoad(near, (await res.json()).distances) ?? { none: true };
        } else {
          const body = (await res.text()).slice(0, 120);
          // The free plan's per-minute matrix quota answers 429 or 403 "Quota exceeded": wait out the minute and retry.
          const limited = res.status === 429 || (res.status === 403 && /quota/i.test(body));
          if (!limited || attempt === 3) misses.push(`${place.id}: HTTP ${res.status} ${body}`);
          if (limited) {
            await new Promise((r) => setTimeout(r, 65_000));
            continue;
          }
          if (res.status < 500) break;
        }
      } catch (e) {
        misses.push(`${place.id}: ${String(e).slice(0, 120)}`);
      }
      // Free plan: 40 matrix requests a minute; 2.5 s keeps it at 24 with room for retries.
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (hit && !hit.none) rows.push([place.id, hit.roadKm.toFixed(2), hit.nearest, "ors", today]);
    else if (hit?.none) misses.push(`${place.id}: no merchant reaches it by road`);
    const s = near[0].km.toFixed(2);
    console.log(
      `${place.id}\t${place.name}\tstraight ${s} km\troad ${hit && !hit.none ? hit.roadKm.toFixed(2) : "-"} km`,
    );
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  writeFileSync(
    out,
    [
      "place_id,road_km,nearest_vendor_place_id,provider,computed_on",
      ...rows.map((r) => r.join(",")),
    ].join("\n") + "\n",
  );
  console.log(`roads: ${rows.length} of ${places.length} places; misses: ${misses.length}`);
  for (const m of misses) console.log(`  miss ${m}`);
}

if (process.argv[1]?.endsWith("area.mjs")) {
  const [cmd, out] = process.argv.slice(2);
  if (cmd === "roads" && out) await roads(out);
  else {
    console.error("usage: area.mjs roads <out.csv>");
    process.exit(2);
  }
}
