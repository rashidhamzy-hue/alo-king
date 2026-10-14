import { Link } from "@tanstack/react-router";
import { Clock, MapPin, Store } from "lucide-react";
import { pickName } from "@/lib/site";
import { dayHoursText, parseSeedHours, WEEK_ORDER } from "@/lib/seed-hours";
import type { UnclaimedVendorPage } from "@/lib/site-data";
import { useSite } from "./context";
import { PageHero } from "./PageHero";
import { AskToJoinButton } from "./UnclaimedCard";

/**
 * The page of a shop that is not on Alo King yet (DECISIONS §39.3): served with noindex until it is claimed. What it is,
 * where, its unconfirmed hours and the draft menu's item names and descriptions, never a price, rating or photo. The
 * customer can ask it to join; the owner can claim it.
 */
export function UnclaimedVendor({ d }: { d: UnclaimedVendorPage }) {
  const { t, lang } = useSite();
  const u = t.unclaimed;
  const v = d.vendor;
  const name = pickName(v, "name", lang);
  const place = pickName(v, "place", lang);
  const hours = parseSeedHours(v.hours_seed);
  return (
    <>
      <PageHero
        eyebrow={`${pickName(v, "business_type", lang)}${place ? ` · ${place}` : ""}`}
        title={name + (v.branch_label ? ` · ${v.branch_label}` : "")}
        lead={u.askHelp}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.common.places, to: "/$lang/places" },
          { label: name },
        ]}
      >
        <AskToJoinButton slug={v.slug} name={name} size="lg" />
        <span className="ak-chip">{u.badge}</span>
        {v.cuisines.map((c) => (
          <span key={c.tag} className="ak-chip">
            {pickName(c, "name", lang)}
          </span>
        ))}
      </PageHero>

      <section className="tone-cream ak-section !pt-12" aria-labelledby="menu-title">
        <div className="ak-container grid items-start gap-10 lg:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0">
            <h2 id="menu-title" className="ak-h2">
              {u.menuTitle}
            </h2>
            {d.sections.length > 0 ? (
              <>
                <p className="mt-2 text-sm text-tone-mute">{u.noPrices}</p>
                <div className="mt-8 space-y-10">
                  {d.sections.map((s, k) => {
                    const title = pickName(s, "name", lang);
                    return (
                      <div key={k}>
                        {title && <h3 className="ak-h3">{title}</h3>}
                        <ul className="mt-4 space-y-3">
                          {s.items.map((i, j) => (
                            <li key={j} className="ak-card p-4">
                              <p dir="auto" className="break-words font-bold">
                                {pickName(i, "name", lang)}
                              </p>
                              {i.description && (
                                <p dir="auto" className="mt-1 break-words text-sm text-tone-mute">
                                  {i.description}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="mt-4 text-tone-mute">{u.noMenu}</p>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24" aria-label={u.hours}>
            <div className="ak-card p-5">
              <h3 className="ak-h3 flex items-center gap-2">
                <Clock className="size-5" aria-hidden="true" />
                {u.hours}
              </h3>
              {hours ? (
                <dl className="mt-3 space-y-1.5">
                  {WEEK_ORDER.map((wd) => (
                    <div key={wd} className="flex justify-between gap-4">
                      <dt className="text-tone-mute">{t.vendor.days[wd]}</dt>
                      <dd className="ak-num text-end font-semibold">
                        <bdi>
                          {dayHoursText(hours.get(wd), {
                            closed: t.vendor.closedToday,
                            allDay: u.allDay,
                          })}
                        </bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : v.hours_seed ? (
                <p className="mt-3 break-words" dir="ltr">
                  {v.hours_seed}
                </p>
              ) : (
                <p className="mt-3 text-tone-mute">{t.vendor.hoursUnknown}</p>
              )}
              {v.hours_seed && <p className="mt-3 text-sm text-tone-mute">{u.hoursNote}</p>}
              {place && (
                <p className="mt-4 flex items-center gap-2 text-sm">
                  <MapPin className="size-4" aria-hidden="true" />
                  {v.place_slug ? (
                    <Link
                      to="/$lang/places/$slug"
                      params={{ lang, slug: v.place_slug }}
                      className="underline underline-offset-4"
                    >
                      {place}
                    </Link>
                  ) : (
                    place
                  )}
                </p>
              )}
            </div>
            <div className="ak-card p-5">
              <h3 className="ak-h3 flex items-center gap-2">
                <Store className="size-5" aria-hidden="true" />
                {u.claimTitle}
              </h3>
              <p className="mt-3 text-tone-mute">{u.claimText}</p>
              <Link
                to="/$lang/business/claim"
                params={{ lang }}
                search={{ v: v.vendor_id }}
                rel="nofollow"
                className="ak-btn ak-btn-ink ak-btn-sm mt-4"
              >
                {u.claimLink}
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
