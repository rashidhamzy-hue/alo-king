import { Link } from "@tanstack/react-router";
import { LEBANON_MAP, PILOT_PLACES } from "@/design/lebanon-dots.generated";
import { PILOT_PLACES_NAMES } from "@/lib/site-config";
import { fmt, pickName } from "@/lib/site";
import { useSite } from "../context";

const { width: W, height: H, bounds, lonFactor, scale } = LEBANON_MAP;
const project = (lat: number, lon: number): [number, number] => [(lon - bounds.minLon) * lonFactor * scale, (bounds.maxLat - lat) * scale];

/**
 * Where we deliver (DECISIONS §37.3.4): every place on our list is a dot; places that are switched on are lit gold, read live
 * from the database. Before launch the pilot area is shown as "opening soon". Static SVG, no map library.
 */
export function LebanonMap() {
  const { t, lang, overview } = useSite();
  const m = t.home.map;
  const live = overview.places;
  const liveIds = new Set(live.map((p) => p.id));
  const pilot = Object.entries(PILOT_PLACES).filter(([id]) => !liveIds.has(id));
  const pilotNames = Object.keys(PILOT_PLACES).map((id) => PILOT_PLACES_NAMES[id]?.[lang] ?? id);
  const km = overview.fees.max_km;
  const sub = fmt(live.length > 0 ? m.subLive : m.subSoon, { n: live.length, km: km ?? "" });
  // The pilot villages sit within a few kilometres of each other: one ring on the map, the names in the list.
  const cx = pilot.length ? pilot.reduce((a, [, p]) => a + project(p.lat, p.lon)[0], 0) / pilot.length : 0;
  const cy = pilot.length ? pilot.reduce((a, [, p]) => a + project(p.lat, p.lon)[1], 0) / pilot.length : 0;

  return (
    <section id="map" className="tone-night ak-section bg-[var(--ink-deep)]" aria-labelledby="map-title">
      <div className="ak-container grid items-center gap-12 lg:grid-cols-[1fr_1fr]">
        <div className="lg:order-1">
          <p className="ak-eyebrow text-gold">{m.eyebrow}</p>
          <h2 id="map-title" className="ak-h2 mt-3">
            {m.title}
          </h2>
          <p className="ak-lead mt-4">{sub.replace(/ ?\.$/, ".")}</p>

          <div className="mt-8 space-y-5">
            {live.length > 0 && (
              <div>
                <p className="text-sm font-bold text-gold">{m.liveList}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {live.slice(0, 12).map((p) => (
                    <li key={p.id}>
                      <Link to="/$lang/places/$slug" params={{ lang, slug: p.slug }} className="ak-chip ak-chip-gold no-underline">
                        {pickName(p, "name", lang)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pilot.length > 0 && (
              <div>
                <p className="text-sm font-bold text-gold">{m.soonList}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {pilotNames.map((n) => (
                    <li key={n} className="ak-chip border-dashed">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Link to="/$lang/places" params={{ lang }} className="ak-btn ak-btn-line mt-8">
            {m.seePlaces}
          </Link>
          <ul className="mt-8 grid gap-2 text-sm text-tone-mute" aria-label="Legend">
            <li className="flex items-center gap-3">
              <span className="size-3 rounded-full bg-gold shadow-[0_0_14px_3px_rgb(244_182_60/0.6)]" aria-hidden="true" />
              {m.legendLive}
            </li>
            <li className="flex items-center gap-3">
              <span className="size-3 rounded-full border-2 border-dashed border-gold" aria-hidden="true" />
              {m.legendSoon}
            </li>
            <li className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-[rgb(248_241_231/0.5)]" aria-hidden="true" />
              {m.legendAll}
            </li>
          </ul>
        </div>

        <div className="mx-auto w-full max-w-[30rem] lg:order-2">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.a11y.map}. ${m.legendAll}: ${LEBANON_MAP.count}`} className="h-auto w-full">
            <defs>
              <radialGradient id="ak-halo">
                <stop offset="0" stopColor="#f4b63c" stopOpacity=".55" />
                <stop offset="1" stopColor="#f4b63c" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path d={LEBANON_MAP.dots} fill="none" stroke="rgb(248 241 231 / 0.5)" strokeWidth="4" strokeLinecap="round" />
            {live.map((p) => {
              const [x, y] = project(p.lat, p.lon);
              return (
                <g key={p.id}>
                  <circle cx={x} cy={y} r="34" fill="url(#ak-halo)" />
                  <circle cx={x} cy={y} r="8" fill="#f4b63c" />
                </g>
              );
            })}
            {pilot.length > 0 && (
              <g>
                <circle className="ak-ping" cx={cx} cy={cy} r="12" fill="none" stroke="#f4b63c" strokeWidth="2.5" />
                <circle cx={cx} cy={cy} r="13" fill="none" stroke="#f4b63c" strokeWidth="2.5" strokeDasharray="4 5" />
                <circle cx={cx} cy={cy} r="4" fill="#f4b63c" />
                <text x={cx + 22} y={cy + 6} fill="#f8f1e7" fontSize="26" fontWeight="700" style={{ fontFamily: "inherit" }}>
                  {m.region}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
