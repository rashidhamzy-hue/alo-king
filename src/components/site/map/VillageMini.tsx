import { Link } from "@tanstack/react-router";
import { MAP_H, MAP_W, ZONE } from "@/design/chouf-map.generated";
import { fmt } from "@/lib/site";
import { useSite } from "../context";

/** The village's light in the delivery zone (the still picture of the map), opening the interactive map on it. */
export function VillageMini({ slug, name }: { slug: string; name: string }) {
  const { t, lang } = useSite();
  const p = ZONE.find((z) => z.slug === slug);
  if (!p) return null;
  return (
    <Link
      to="/$lang/places"
      params={{ lang }}
      search={{ v: slug }}
      className="ak-mini"
      aria-label={fmt(t.places.mini, { place: name })}
    >
      <img src="/chouf-zone.svg" width={MAP_W} height={MAP_H} alt="" decoding="async" />
      <span
        className="ak-mini-pin"
        style={{ left: `${(p.x / MAP_W) * 100}%`, top: `${(p.y / MAP_H) * 100}%` }}
        aria-hidden="true"
      />
      <span className="ak-mini-label">{fmt(t.places.mini, { place: name })}</span>
    </Link>
  );
}
