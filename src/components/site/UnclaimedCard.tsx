import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { WhatsAppIcon } from "@/design/icons";
import { fmt, pickName } from "@/lib/site";
import { askToJoinUrl } from "@/lib/join";
import { hoursSummary } from "@/lib/seed-hours";
import type { UnclaimedCard as Card } from "@/lib/site-data";
import { useSite } from "./context";

/**
 * "Ask them to join" (DECISIONS §39.3): a plain link to the counting edge function, which redirects to the customer's own
 * WhatsApp (src/lib/join.ts). nofollow: crawlers must not count taps.
 */
export function AskToJoinButton({
  slug,
  name,
  size = "sm",
}: {
  slug: string;
  name: string;
  size?: "sm" | "lg";
}) {
  const { t, lang } = useSite();
  return (
    <a
      className={`ak-btn ak-btn-gold ${size === "lg" ? "ak-btn-lg" : "ak-btn-sm"}`}
      href={askToJoinUrl(slug, lang)}
      rel="nofollow noopener"
      aria-label={fmt(t.unclaimed.askLabel, { name })}
      data-wa="ask"
    >
      <WhatsAppIcon className="size-5 shrink-0" />
      <span>{t.unclaimed.ask}</span>
    </a>
  );
}

/** A shop that is not on Alo King yet: what it is, where, when it opens and a taste of its menu. Never a price or rating. */
export function UnclaimedCardItem({ v }: { v: Card }) {
  const { lang, t } = useSite();
  const u = t.unclaimed;
  const name = pickName(v, "name", lang);
  const branch = v.branch_label?.trim();
  const type = pickName(v, "business_type", lang);
  const place = pickName(v, "place", lang);
  const hours = hoursSummary(v.hours_seed, {
    closed: t.vendor.closedToday,
    allDay: u.allDay,
    everyDay: u.everyDay,
    days: u.daysShort,
  });
  const items = v.menu_preview.map((i) => pickName(i, "name", lang)).filter(Boolean);
  const more = v.menu_items - items.length;
  return (
    <li className="ak-card flex flex-col gap-3 p-5">
      <div className="min-w-0">
        <Link
          to="/$lang/m/$slug"
          params={{ lang, slug: v.slug }}
          className="break-words text-lg font-extrabold underline-offset-4 hover:underline"
        >
          {name}
          {branch ? <span className="font-medium text-tone-mute"> · {branch}</span> : null}
        </Link>
        <p className="mt-1 text-sm text-tone-mute">
          {type}
          {place ? ` · ${place}` : ""}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="ak-chip">{u.badge}</span>
        {v.cuisines.map((c) => (
          <span key={c.tag} className="ak-chip">
            {pickName(c, "name", lang)}
          </span>
        ))}
      </p>
      {hours && (
        <p className="flex items-start gap-2 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">{u.hours}: </span>
          <bdi className="ak-num">{hours}</bdi>
        </p>
      )}
      {items.length > 0 && (
        <p className="text-sm text-tone-mute">
          {fmt(u.onMenu, {
            items:
              items.join(lang === "ar" ? "، " : ", ") +
              (more > 0 ? ` (${fmt(u.moreItems, { n: more })})` : ""),
          })}
        </p>
      )}
      <div className="mt-auto pt-1">
        <AskToJoinButton slug={v.slug} name={name} />
      </div>
    </li>
  );
}
