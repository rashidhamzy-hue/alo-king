// The "Every village we deliver to" list (DECISIONS §39.15.5) groups the §39.2 boundary places by area. The places seed has
// a sub-region for only 23 of the 61, so the areas are named after six towns everyone in the Shouf knows, spread across the
// zone, and each place joins the nearest of them on the map (the generated positions, so no new data and no network).
import type { ZonePlace } from "@/design/chouf-map.generated";

/** The towns the areas are named after, in the order the list shows them (centre first, then around it). */
export const AREA_HUBS = [
  "chf-baakline",
  "chf-deir-al-qamar",
  "chf-moukhtara",
  "chf-barouk",
  "chf-niha",
  "chf-kfarhim",
] as const;

export type ZoneArea = { hub: ZonePlace; places: ZonePlace[] };

/** Every place exactly once, in the area of its nearest hub; hubs missing from the zone are skipped. */
export function zoneAreas(zone: readonly ZonePlace[]): ZoneArea[] {
  const hubs = AREA_HUBS.map((s) => zone.find((p) => p.slug === s)).filter(
    (p): p is ZonePlace => !!p,
  );
  const first = zone[0];
  if (!hubs.length) return first ? [{ hub: first, places: [...zone] }] : [];
  const areas = hubs.map((hub) => ({ hub, places: [] as ZonePlace[] }));
  for (const p of zone) {
    let best = 0;
    let bestD = Infinity;
    hubs.forEach((h, i) => {
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    areas[best]?.places.push(p);
  }
  return areas;
}
