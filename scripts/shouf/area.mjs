// The delivery area's data from outside (DECISIONS §39.2), for the `area-data` workflow (build sessions cannot reach
// Overpass or OpenRouteService):
//   * boundaryBox(): the box around the boundary places' centres, for the OSM fetch (scripts/shouf/osm-fetch.mjs
//     --boundary), so landmarks and place names cover every delivered-to place and nothing toward Damour or the Iqlim.
//   * roads: the road distance from the nearest pilot merchant to each boundary place, from OpenRouteService (the
//     public OSRM server once the ORS free quota is spent), written to supabase/seed/places/shouf_delivery_road_km.csv
//     (place_id, road_km, nearest_vendor_place_id, provider, computed_on). Rows already in the file are kept; only
//     places without one are asked. delivery_area_proposal() reads it; a place without a row falls back to the
//     straight line.
//   * roads --recompute <id,id>: asks those places again even though they have a row (a route worth a second look,
//     DATA-ISSUES), from the 25 straight-line-nearest merchants, by ORS and OSRM both; the shorter road wins.
// Usage: [ORS_API_KEY=...] node scripts/shouf/area.mjs roads <out.csv> [--recompute <place_id,place_id>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

/** The same request for the OSRM table service: merchants are sources, the place is the destination. */
export function osrmTableUrl(place, merchants, base = "https://router.project-osrm.org") {
  const coords = [...merchants, place]
    .map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(";");
  const sources = merchants.map((_, i) => i).join(";");
  return `${base}/table/v1/driving/${coords}?sources=${sources}&destinations=${merchants.length}&annotations=distance`;
}

/** Rows already in the road file (kept: a place is asked again only when it has no row). */
export function existingRoads(csv) {
  return new Map(parseCsv(csv).map((r) => [r.place_id, r]));
}

/** The shorter of two answers ({ nearest, roadKm } or null/{ none }), with the provider that gave it. */
export function shorterRoad(a, b) {
  const ok = (x) => x && !x.none && !x.limited && typeof x.roadKm === "number";
  if (ok(a.hit) && ok(b.hit)) return a.hit.roadKm <= b.hit.roadKm ? a : b;
  if (ok(a.hit)) return a;
  if (ok(b.hit)) return b;
  return { hit: a.hit?.none || b.hit?.none ? { none: true } : null, provider: a.provider };
}

/** `--recompute a,b` → Set of place ids (empty without the flag). */
export function recomputeIds(argv) {
  const i = argv.indexOf("--recompute");
  if (i < 0) return new Set();
  return new Set(
    (argv[i + 1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One place by ORS: the nearest merchant, { none } when no merchant reaches it, { limited } on the quota, or null. */
async function orsNearest(place, near, key, misses) {
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (res.ok) return nearestByRoad(near, (await res.json()).distances) ?? { none: true };
      const body = (await res.text()).slice(0, 120);
      // The free plan's quota answers 429 or 403 "Quota exceeded": once per minute, or for the rest of the day.
      if (res.status === 429 || (res.status === 403 && /quota/i.test(body))) {
        if (attempt === 0) {
          await wait(65_000);
          continue;
        }
        return { limited: true };
      }
      misses.push(`${place.id}: ORS HTTP ${res.status} ${body}`);
      if (res.status < 500) return null;
    } catch (e) {
      misses.push(`${place.id}: ORS ${String(e).slice(0, 120)}`);
    }
    await wait(2500);
  }
  return null;
}

/** One place by the public OSRM server (fair use: one request a second, a named User-Agent). */
async function osrmNearest(place, near, misses) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(1100);
    try {
      const res = await fetch(osrmTableUrl(place, near), {
        headers: {
          "user-agent": "alo-king area-data (https://github.com/rashidhamzy-hue/alo-king)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const j = res.ok ? await res.json() : null;
      if (j?.code === "Ok") return nearestByRoad(near, j.distances) ?? { none: true };
      misses.push(`${place.id}: OSRM HTTP ${res.status} ${j?.code ?? ""}`);
      if (res.status < 500 && res.status !== 429) return null;
    } catch (e) {
      misses.push(`${place.id}: OSRM ${String(e).slice(0, 120)}`);
    }
    await wait(5000);
  }
  return null;
}

async function roads(out, recompute = new Set()) {
  const key = process.env.ORS_API_KEY;
  const places = boundaryPlaces(
    readFileSync("supabase/seed/places/places.csv", "utf8"),
    readFileSync("supabase/seed/places/shouf_delivery_boundary.csv", "utf8"),
  );
  const merchants = merchantPoints(
    readFileSync("supabase/seed/shouf/source/01_shouf_merchants_315.csv", "utf8"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const kept = existsSync(out) ? existingRoads(readFileSync(out, "utf8")) : new Map();
  const ids = new Set(places.map((p) => p.id));
  for (const id of recompute) {
    if (!ids.has(id)) throw new Error(`--recompute ${id}: not a boundary place`);
    const old = kept.get(id);
    if (old)
      console.log(
        `${id}\trecompute (was ${old.road_km} km by ${old.provider} from ${old.nearest_vendor_place_id})`,
      );
    kept.delete(id);
  }
  const rows = [...kept.values()]
    .filter((r) => ids.has(r.place_id))
    .map((r) => [r.place_id, r.road_km, r.nearest_vendor_place_id, r.provider, r.computed_on]);
  const misses = [];
  // ORS first (the provider session E chose); once its quota is spent, the public OSRM server for the rest.
  let orsOk = !!key;
  for (const place of places) {
    if (kept.has(place.id)) continue;
    if (recompute.has(place.id)) {
      // A second look: more candidate merchants, both providers, the shorter road.
      const near = nearestMerchants(place, merchants, 25);
      const ors = {
        provider: "ors",
        hit: orsOk ? await orsNearest(place, near, key, misses) : null,
      };
      const osrm = { provider: "osrm", hit: await osrmNearest(place, near, misses) };
      const best = shorterRoad(ors, osrm);
      const fmt = (x) =>
        x.hit && typeof x.hit.roadKm === "number" ? `${x.hit.roadKm.toFixed(2)} km` : "-";
      if (best.hit && !best.hit.none)
        rows.push([place.id, best.hit.roadKm.toFixed(2), best.hit.nearest, best.provider, today]);
      else misses.push(`${place.id}: recompute found no road`);
      console.log(
        `${place.id}\t${place.name}\tstraight ${near[0].km.toFixed(2)} km\tors ${fmt(ors)}\tosrm ${fmt(osrm)}\tkept ${best.provider}`,
      );
      continue;
    }
    const near = nearestMerchants(place, merchants);
    let hit = null;
    let provider = "ors";
    if (orsOk) {
      hit = await orsNearest(place, near, key, misses);
      if (hit?.limited) {
        console.log("ORS quota spent: OSRM for the remaining places");
        orsOk = false;
        hit = null;
      }
      await wait(2500);
    }
    if (!hit) {
      provider = "osrm";
      hit = await osrmNearest(place, near, misses);
    }
    if (hit && !hit.none)
      rows.push([place.id, hit.roadKm.toFixed(2), hit.nearest, provider, today]);
    else if (hit?.none) misses.push(`${place.id}: no merchant reaches it by road`);
    console.log(
      `${place.id}\t${place.name}\tstraight ${near[0].km.toFixed(2)} km\troad ${hit && !hit.none ? `${hit.roadKm.toFixed(2)} km (${provider})` : "-"}`,
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
  console.log(
    `roads: ${rows.length} of ${places.length} places (${kept.size} kept from the file); misses: ${misses.length}`,
  );
  for (const m of misses) console.log(`  miss ${m}`);
}

if (process.argv[1]?.endsWith("area.mjs")) {
  const [cmd, out] = process.argv.slice(2);
  if (cmd === "roads" && out) await roads(out, recomputeIds(process.argv));
  else {
    console.error("usage: area.mjs roads <out.csv> [--recompute <place_id,place_id>]");
    process.exit(2);
  }
}
