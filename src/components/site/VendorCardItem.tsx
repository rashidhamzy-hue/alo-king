import { Link } from "@tanstack/react-router";
import { Bike, ShoppingBag } from "lucide-react";
import { pickName } from "@/lib/site";
import type { VendorCard } from "@/lib/site-data";
import { useSite } from "./context";

/** A claimed shop in a list. Everything shown is data the merchant owns or declared. */
export function VendorCardItem({ v }: { v: VendorCard }) {
  const { lang, t } = useSite();
  const name = pickName(v, "name", lang);
  const branch = v.branch_label?.trim();
  const type = pickName(v, "business_type", lang);
  const place = pickName(v, "place", lang);
  return (
    <li className="ak-card relative p-5 transition-transform hover:-translate-y-0.5">
      <Link
        to="/$lang/m/$slug"
        params={{ lang, slug: v.slug }}
        className="text-lg font-extrabold no-underline after:absolute after:inset-0 after:content-['']"
      >
        {name}
        {branch ? <span className="font-medium text-tone-mute"> · {branch}</span> : null}
      </Link>
      <p className="mt-1 text-sm text-tone-mute">
        {type}
        {place ? ` · ${place}` : ""}
      </p>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {v.demo && <span className="ak-chip">{t.common.demo}</span>}
        {v.paused ? (
          <span className="ak-chip">{t.common.paused}</span>
        ) : (
          <span className={`ak-chip ${v.open_now ? "ak-chip-gold" : ""}`}>
            {v.open_now ? t.common.openNow : t.common.closed}
          </span>
        )}
        {v.delivery && (
          <span className="ak-chip">
            <Bike className="size-4" aria-hidden="true" />
            {t.common.delivery}
          </span>
        )}
        {v.pickup && (
          <span className="ak-chip">
            <ShoppingBag className="size-4" aria-hidden="true" />
            {t.common.pickup}
          </span>
        )}
      </p>
    </li>
  );
}
