// Fetches the Shouf pilot landmarks and place names from OpenStreetMap (DECISIONS §38.2 items 4–5) through
// the Overpass API and writes the two files scripts/load-seed.sh loads:
//   <out>/landmarks.csv      osm_ref, kind, name_ar, name_en, aliases, lat, lon
//   <out>/place_aliases.csv  osm_ref, alias, lang, osm_key, lat, lon
// The area is the box around the 315 Shouf merchants plus a margin (no coordinates are written here).
// Build sessions cannot reach Overpass; the staging deploy job runs this when the files are not committed.
// Usage: node scripts/shouf/osm-fetch.mjs <out dir> [merchants.csv]
// © OpenStreetMap contributors, ODbL (attribution in the site footer, supabase/seed/README.md).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const MARGIN_DEG = 0.02; // about 2 km around the outermost merchant

/** Box (south, west, north, east) around the merchants' coordinates, plus the margin. */
export function pilotBox(csvText) {
  const [head, ...lines] = csvText.trim().split("\n");
  const cols = head.split(",");
  const iLat = cols.indexOf("latitude");
  const iLon = cols.indexOf("longitude");
  const lats = [];
  const lons = [];
  for (const line of lines) {
    // Latitude and longitude never contain commas or quotes; take them from the end-anchored split.
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, ""));
    const lat = Number(cells[iLat]);
    const lon = Number(cells[iLon]);
    if (lat > 33 && lat < 34.8 && lon > 35 && lon < 36.7) {
      lats.push(lat);
      lons.push(lon);
    }
  }
  if (!lats.length) throw new Error("no merchant coordinates");
  const r = (n) => Math.round(n * 1e4) / 1e4;
  return [
    r(Math.min(...lats) - MARGIN_DEG),
    r(Math.min(...lons) - MARGIN_DEG),
    r(Math.max(...lats) + MARGIN_DEG),
    r(Math.max(...lons) + MARGIN_DEG),
  ];
}

export function overpassQuery([s, w, n, e]) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];
(
  nwr["amenity"~"^(place_of_worship|pharmacy|hospital|clinic|school|college|townhall|fountain)$"](${b});
  nwr["office"="government"]["name"](${b});
  nwr["junction"="roundabout"]["name"](${b});
  node["highway"="mini_roundabout"]["name"](${b});
  nwr["place"="square"](${b});
  nwr["man_made"="water_tap"]["name"](${b});
  node["place"~"^(town|village|hamlet|suburb|neighbourhood|quarter|locality|isolated_dwelling)$"](${b});
);
out center tags;`;
}

/** The §38.2 landmark kind of an OSM object, or null when it is not one. */
export function landmarkKind(t) {
  if (t.amenity === "place_of_worship") {
    if (t.religion === "muslim") return "mosque";
    if (t.religion === "christian") return "church";
    if (t.religion === "druze") return "druze_majlis";
    return "place_of_worship";
  }
  if (t.amenity === "pharmacy") return "pharmacy";
  if (t.amenity === "hospital" || t.amenity === "clinic") return "hospital";
  if (t.amenity === "school" || t.amenity === "college") return "school";
  if (t.amenity === "townhall" || t.office === "government") return "municipality";
  if (t.amenity === "fountain" || t.man_made === "water_tap") return "fountain";
  if (t.junction === "roundabout" || t.highway === "mini_roundabout") return "roundabout";
  if (t.place === "square") return "square";
  return null;
}

const ARABIC = /[؀-ۿ]/;
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const csvCell = (v) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (header, rows) =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const pgArray = (xs) =>
  xs.length ? `{${xs.map((x) => `"${x.replace(/["\\]/g, "\\$&")}"`).join(",")}}` : "";

export function toRows(elements) {
  const landmarks = [];
  const aliases = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const ref = `${el.type}/${el.id}`;
    const name = clean(t.name);
    const ar = clean(t["name:ar"]) || (ARABIC.test(name) ? name : "");
    const en = clean(t["name:en"]) || (name && !ARABIC.test(name) ? name : "");
    const extra = [t["name:fr"], t.alt_name, t.loc_name, t.old_name, t.official_name, t.short_name]
      .flatMap((v) => (v ? String(v).split(";") : []))
      .map(clean)
      .filter((v) => v && v !== ar && v !== en);
    const kind = landmarkKind(t);
    if (kind && (ar || en)) {
      landmarks.push([ref, kind, ar, en, pgArray([...new Set(extra)]), lat, lon]);
    }
    if (t.place && t.place !== "square") {
      const seen = new Set();
      const add = (alias, lang, key) => {
        const a = clean(alias);
        if (a.length >= 2 && !seen.has(a)) {
          seen.add(a);
          aliases.push([ref, a, lang, key, lat, lon]);
        }
      };
      for (const [k, lang] of [
        ["name", ""],
        ["name:ar", "ar"],
        ["name:en", "en"],
        ["name:fr", "fr"],
      ])
        add(t[k], lang || (ARABIC.test(t[k] ?? "") ? "ar" : ""), "name");
      for (const key of ["alt_name", "loc_name", "old_name", "official_name", "short_name"]) {
        for (const v of String(t[key] ?? "").split(";")) add(v, ARABIC.test(v) ? "ar" : "", key);
        for (const lang of ["ar", "en", "fr"])
          for (const v of String(t[`${key}:${lang}`] ?? "").split(";")) add(v, lang, key);
      }
    }
  }
  landmarks.sort((a, b) => a[0].localeCompare(b[0]));
  aliases.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return { landmarks, aliases };
}

async function fetchOverpass(query) {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "alo-king-osm-fetch/1 (pilot seed)",
          },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(180_000),
        });
        if (res.ok) return (await res.json()).elements ?? [];
        last = new Error(`${url}: HTTP ${res.status}`);
      } catch (e) {
        last = e;
      }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw last;
}

if (process.argv[1]?.endsWith("osm-fetch.mjs")) {
  const out = process.argv[2];
  const merchants = process.argv[3] ?? "supabase/seed/shouf/source/01_shouf_merchants_315.csv";
  if (!out) {
    console.error("usage: osm-fetch.mjs <out dir> [merchants.csv]");
    process.exit(2);
  }
  const box = pilotBox(readFileSync(merchants, "utf8"));
  const elements = await fetchOverpass(overpassQuery(box));
  const { landmarks, aliases } = toRows(elements);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "landmarks.csv"),
    csv(["osm_ref", "kind", "name_ar", "name_en", "aliases", "lat", "lon"], landmarks),
  );
  writeFileSync(
    join(out, "place_aliases.csv"),
    csv(["osm_ref", "alias", "lang", "osm_key", "lat", "lon"], aliases),
  );
  const kinds = landmarks.reduce((m, l) => ((m[l[1]] = (m[l[1]] ?? 0) + 1), m), {});
  console.log(
    `osm: box ${box.join(",")}; ${elements.length} objects; ${landmarks.length} landmarks ${JSON.stringify(kinds)}; ${aliases.length} place names`,
  );
}
