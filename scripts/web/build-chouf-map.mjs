#!/usr/bin/env node
// Builds src/design/chouf-map.generated.ts (names, search words, positions: small, in the page's JavaScript) and
// public/chouf-map.svg (the polygons: a static, cacheable file the page loads after first paint) for the "Where we deliver" map of the DECISIONS §39.2 zone (session W, §39.11).
// READ-ONLY on supabase/seed/ (data freeze, §31): the places list (names, aliases, elevation, polygons), the boundary and
// the deny-list, and the OSM place names (search in Arabic, English, French and Arabizi). Which places are switched on and
// how many shops each has come live from the database; this file only draws them.
// Run again whenever the boundary file or the places list changes:  node scripts/web/build-chouf-map.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { format, resolveConfig } from "prettier";

const read = (p) => readFileSync(p, "utf8");

// Minimal CSV reader (quoted fields, doubled quotes, embedded newlines).
function parse(text) {
  const rows = [];
  let row = [],
    cell = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""])));
}

const places = new Map(parse(read("supabase/seed/places/places.csv")).map((p) => [p.id, p]));
const boundary = parse(read("supabase/seed/places/shouf_delivery_boundary.csv"));
const deny = new Set(
  parse(read("supabase/seed/places/shouf_delivery_denylist.csv")).map((d) => d.place_id),
);
const osm = parse(read("supabase/seed/shouf/osm/place_aliases.csv"));

// The frame: the boundary places' centres plus a margin, so the neighbours show where the zone stops.
const pts = boundary.map((b) => {
  const p = places.get(b.place_id);
  if (!p) throw new Error(`boundary place ${b.place_id} is not in places.csv`);
  return { lat: Number(p.lat), lon: Number(p.lon) };
});
const M = 0.03; // about 3 km
const S = Math.min(...pts.map((p) => p.lat)) - M;
const N = Math.max(...pts.map((p) => p.lat)) + M;
const Wd = Math.min(...pts.map((p) => p.lon)) - M * 1.2;
const E = Math.max(...pts.map((p) => p.lon)) + M * 1.2;
const K = Math.cos((((S + N) / 2) * Math.PI) / 180);
const WIDTH = 1000;
const scale = WIDTH / ((E - Wd) * K);
const HEIGHT = Math.round((N - S) * scale);
const px = (lon, lat) => [(lon - Wd) * K * scale, (N - lat) * scale];

// Douglas-Peucker on projected points.
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy) || 1;
    let best = -1,
      far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (far > tol && best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** MULTIPOLYGON WKT -> SVG path data (outer rings and holes), projected, simplified, one decimal. */
function pathOf(wkt, tol = 1.4) {
  if (!wkt) return "";
  const rings = [...wkt.matchAll(/\(([^()]+)\)/g)].map((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+/).map(Number))
      .map(([lon, lat]) => px(lon, lat)),
  );
  // A ring is closed (first point = last): split it at the point farthest from the start, simplify both halves.
  const ring = (r) => {
    const open = r.slice(0, -1);
    if (open.length < 4) return open;
    let far = 0,
      fd = -1;
    open.forEach(([x, y], i) => {
      const d = Math.hypot(x - open[0][0], y - open[0][1]);
      if (d > fd) {
        fd = d;
        far = i;
      }
    });
    const a = simplify(open.slice(0, far + 1), tol);
    const b = simplify(open.slice(far).concat([open[0]]), tol);
    return a.concat(b.slice(1, -1));
  };
  return rings
    .map(ring)
    .filter((r) => r.length >= 3)
    .map(
      (r) =>
        "M" +
        r
          .map(([x, y], i) => `${i ? "L" : ""}${x.toFixed(1)} ${y.toFixed(1)}`)
          .join("")
          .replace(/ -/g, "-") +
        "Z",
    )
    .join("");
}

const inFrame = (p) => {
  const lat = Number(p.lat),
    lon = Number(p.lon);
  return lat > S - 0.02 && lat < N + 0.02 && lon > Wd - 0.03 && lon < E + 0.03;
};

// Search words per place: its names, the places list's aliases and the OSM names near its centre.
const osmByPlace = new Map();
for (const a of osm) {
  const lat = Number(a.lat),
    lon = Number(a.lon);
  let best = null,
    bestD = Infinity;
  for (const b of boundary) {
    const p = places.get(b.place_id);
    const d = Math.hypot(Number(p.lat) - lat, (Number(p.lon) - lon) * K);
    if (d < bestD) {
      bestD = d;
      best = b.place_id;
    }
  }
  if (best && bestD < 0.006) {
    if (!osmByPlace.has(best)) osmByPlace.set(best, new Set());
    osmByPlace.get(best).add(a.alias);
  }
}

const seen = new Map(); // identical polygons (a hamlet drawn with its village's zone) are drawn once
const out = boundary
  .map((b) => {
    const p = places.get(b.place_id);
    const [x, y] = px(Number(p.lon), Number(p.lat));
    let d = pathOf(p.boundary_wkt);
    if (d && seen.has(d)) d = "";
    else if (d) seen.set(d, b.place_id);
    const words = new Set(
      [p.name_ar, p.name_en, p.name_fr, b.name_ar, b.name_en, ...p.aliases.split(";")]
        .concat([...(osmByPlace.get(b.place_id) ?? [])])
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return {
      id: b.place_id,
      hasShape: !!d,
      slug: b.place_id.replace(/^LB-/, "").toLowerCase(),
      ar: p.name_ar || b.name_ar,
      en: p.name_en || b.name_en,
      fr: p.name_fr || p.name_en || b.name_en,
      role: b.role,
      elev: Math.round(Number(p.elevation_m) || 0),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      d,
      words: [...words],
    };
  })
  .sort((a, b) => a.en.localeCompare(b.en));

const inZone = new Set(boundary.map((b) => b.place_id));
// Neighbours: one path for the places around the zone that we do not deliver to (deny-listed or outside), drawn faint.
const ctx = [...places.values()]
  .filter((p) => !inZone.has(p.id) && p.boundary_wkt && inFrame(p))
  .map((p) => pathOf(p.boundary_wkt, 3))
  .filter((d) => d && !seen.has(d));
const denyNames = [...places.values()]
  .filter((p) => deny.has(p.id) && inFrame(p) && p.kind !== "hamlet")
  .map((p) => {
    const [x, y] = px(Number(p.lon), Number(p.lat));
    return {
      ar: p.name_ar,
      en: p.name_en || p.name_ar,
      x: Math.round(x),
      y: Math.round(y),
      words: [p.name_ar, p.name_en, p.name_fr, ...p.aliases.split(";")]
        .map((s) => s.trim())
        .filter(Boolean),
    };
  })
  .filter((p) => p.en);

const ts = `// GENERATED by scripts/web/build-chouf-map.mjs from supabase/seed/places (read-only, DECISIONS §31). Do not edit.
// The DECISIONS §39.2 delivery zone: ${out.length} boundary places, projected to a ${WIDTH}×${HEIGHT} frame.
export type ZonePlace = {
  id: string;
  hasShape: boolean;
  slug: string;
  ar: string;
  en: string;
  fr: string;
  role: "shop_village" | "named_by_rasheed" | "between";
  elev: number;
  x: number;
  y: number;
  words: string[];
};
export type NearPlace = { ar: string; en: string; x: number; y: number; words: string[] };
export const MAP_W = ${WIDTH};
export const MAP_H = ${HEIGHT};
export const ZONE: ZonePlace[] = ${JSON.stringify(out.map(({ d, ...p }) => p))};
/** Deny-listed places in the frame: searchable, so "Damour" answers "we don't deliver there" instead of nothing. */
export const NOT_DELIVERED: NearPlace[] = ${JSON.stringify(denyNames)};
`;
const tsPath = "src/design/chouf-map.generated.ts";
writeFileSync(tsPath, await format(ts, { ...(await resolveConfig(tsPath)), filepath: tsPath }));
// The polygons. Every zone place is one <path data-slug> (classes set by the page from live data); the neighbours are one
// faint path. No colours here: the page's CSS paints it, so it follows the design tokens.
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">` +
  `<path class="zm-near" d="${ctx.join("")}"/>` +
  out
    .filter((p) => p.d)
    .map(
      (p) =>
        `<path class="zm-v" data-slug="${p.slug}" data-elev="${Math.min(9, Math.floor(p.elev / 200))}" d="${p.d}"/>`,
    )
    .join("") +
  `</svg>\n`;
writeFileSync("public/chouf-map.svg", svg);
// The home page's preview: the same zone, painted in the site's night colours, as an <img> (no JavaScript). The shop
// villages are gold; the live state (which shops are on) is the map page's job.
const preview =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
  `<defs><radialGradient id="g"><stop offset="0" stop-color="#f4b63c" stop-opacity=".5"/><stop offset="1" stop-color="#f4b63c" stop-opacity="0"/></radialGradient></defs>` +
  `<path d="${ctx.join("")}" fill="#f8f1e7" fill-opacity=".02" stroke="#f8f1e7" stroke-opacity=".07" stroke-width=".8"/>` +
  `<g fill="#241c29" stroke="#f4b63c" stroke-opacity=".32" stroke-width=".9">` +
  out
    .filter((p) => p.d)
    .map((p) => `<path d="${p.d}"${p.elev >= 1000 ? ' fill="#2c2333"' : ""}/>`)
    .join("") +
  `</g>` +
  out
    .filter((p) => p.role === "shop_village")
    .map(
      (p) =>
        `<circle cx="${p.x}" cy="${p.y}" r="26" fill="url(#g)"/><circle cx="${p.x}" cy="${p.y}" r="6" fill="#f4b63c"/>`,
    )
    .join("") +
  out
    .filter((p) => p.role !== "shop_village")
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#f8f1e7" fill-opacity=".75"/>`)
    .join("") +
  `</svg>\n`;
writeFileSync("public/chouf-zone.svg", preview);
console.log(
  `chouf map: ${out.length} places (${out.filter((p) => p.d).length} polygons), ${ctx.length} neighbours, ${denyNames.length} deny-listed names, ${WIDTH}x${HEIGHT}, ${Math.round(ts.length / 1024)} KB + svg ${Math.round(svg.length / 1024)} KB`,
);
