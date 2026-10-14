import { Link } from "@tanstack/react-router";
import { fmt, iso, pickName } from "@/lib/site";
import { useSite } from "../context";

/**
 * Where we deliver (DECISIONS §37.3.4, §39.2): the delivery zone in the Shouf as a still picture (an <img>, no JavaScript),
 * the villages with shops on Alo King read live from the database, and the way into the interactive map.
 */
export function ZoneTeaser() {
  const { t, lang, overview } = useSite();
  const m = t.home.map;
  const live = overview.places;
  const withShops = live.filter((p) => p.merchants > 0);
  const km = overview.fees.max_km;
  const sub = fmt(live.length > 0 ? m.subLive : m.subSoon, { n: live.length, km: iso(km ?? "") });
  return (
    <section id="map" className="tone-night ak-section ak-zone" aria-labelledby="map-title">
      <div className="ak-container grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <h2 id="map-title" className="ak-h2">
            {m.title}
          </h2>
          <p className="ak-lead mt-5">{sub}</p>
          {withShops.length > 0 && (
            <div className="mt-8">
              <p className="font-bold">{m.liveList}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {withShops.slice(0, 12).map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/$lang/places"
                      params={{ lang }}
                      search={{ v: p.slug }}
                      className="ak-chip ak-chip-lit no-underline"
                    >
                      <span className="ak-lantern" aria-hidden="true" />
                      {pickName(p, "name", lang)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link to="/$lang/places" params={{ lang }} className="ak-btn ak-btn-gold ak-btn-lg mt-9">
            {m.seePlaces}
          </Link>
        </div>
        <Link
          to="/$lang/places"
          params={{ lang }}
          className="ak-zone-pic"
          aria-label={m.seePlaces}
          tabIndex={-1}
        >
          <img
            src="/chouf-zone.svg"
            width={1000}
            height={927}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </Link>
      </div>
    </section>
  );
}
