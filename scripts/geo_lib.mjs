// Pure helpers for the geography scripts, kept separate so they can be unit-tested without the network.
export function villageNamesFromSeed(sql) {
  return [...sql.matchAll(/\('(?:core|mid|outer)','((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));
}
export function parseCoordsSql(sql) {
  return [...sql.matchAll(/set lat = (-?[\d.]+), lng = (-?[\d.]+) where name_en = '((?:[^']|'')+)'/g)]
    .map((m) => ({ name: m[3].replace(/''/g, "'"), lat: Number(m[1]), lng: Number(m[2]) }));
}
/** OSRM returns car seconds. factor scales them to motorcycle minutes on mountain roads; tune it against real trips. */
export function travelTimesSql(villages, durations, distances, factor = 1.0) {
  const q = (s) => s.replace(/'/g, "''");
  const rows = [];
  for (let i = 0; i < villages.length; i++) for (let j = 0; j < villages.length; j++) {
    if (i === j || durations[i]?.[j] == null) continue;
    const min = Math.max(1, Math.round((durations[i][j] / 60) * factor * 10) / 10);
    const km = distances?.[i]?.[j] != null ? Math.round(distances[i][j] / 100) / 10 : null;
    rows.push(`((select id from villages where name_en = '${q(villages[i].name)}'), (select id from villages where name_en = '${q(villages[j].name)}'), ${min}, ${km ?? "null"}, 'osrm', 0)`);
  }
  return `insert into travel_times(from_village, to_village, minutes, km, source, samples) values\n${rows.join(",\n")}\n` +
    `on conflict (from_village, to_village) do update set minutes = excluded.minutes, km = excluded.km, source = 'osrm', updated_at = now()\n` +
    `where travel_times.source <> 'observed';   -- never overwrite what real trips have taught\n`;
}
