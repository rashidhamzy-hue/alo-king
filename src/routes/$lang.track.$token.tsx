import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Clock, MapPin, Store } from "lucide-react";
import { fmt, lbpAt, pickName, privateHead, usd } from "@/lib/site";
import { getTrack, type PublicTrack } from "@/lib/site-data";
import { stepOf } from "@/lib/track";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { OrderButton } from "@/components/site/OrderButton";

const DONE = ["delivered", "cancelled", "rejected", "failed"];

export const Route = createFileRoute("/$lang/track/$token")({
  loader: async ({ params }) => ({ track: await getTrack(params.token) }),
  staleTime: 0,
  // A tracking link is a private page: never cached, never indexed (DECISIONS §3, §27).
  headers: () => ({
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
  }),
  head: ({ match }) => privateHead(match.context.copy.track.seoTitle),
  component: TrackPage,
});

function TrackPage() {
  const { token } = Route.useParams();
  const initial = Route.useLoaderData().track;
  const { t, lang } = useSite();
  const [track, setTrack] = useState<PublicTrack | null>(initial);
  const k = t.track;

  // The page updates itself every few seconds until the order is finished.
  useEffect(() => {
    if (!track || DONE.includes(track.status)) return;
    const timer = setInterval(async () => {
      const next = await getTrack(token);
      if (next) setTrack(next);
    }, 8000);
    return () => clearInterval(timer);
  }, [token, track]);

  if (!track) {
    return (
      <PageHero title={k.notFoundTitle} lead={k.notFoundText}>
        <OrderButton text={t.wa.track} label={k.helpCta} />
      </PageHero>
    );
  }

  const pickup = track.fulfilment === "pickup";
  const steps = pickup ? k.steps.pickup : k.steps.delivery;
  const idx = stepOf(track.status, pickup);
  const finished = ["cancelled", "rejected", "failed"].includes(track.status);
  const vendor = pickName(
    { name_ar: track.vendor_ar, name_en: track.vendor_en, name_fr: track.vendor_fr },
    "name",
    lang,
  );
  const area = pickName(
    { area_ar: track.area_ar, area_en: track.area_en, area_fr: track.area_fr },
    "area",
    lang,
  );
  const eta = track.eta?.min ? { min: track.eta.min, max: track.eta.max ?? track.eta.min } : null;
  const statusLabel = (t.status as Record<string, string>)[track.status] ?? track.status;

  return (
    <>
      <PageHero
        eyebrow={fmt(k.code, { code: track.code })}
        title={k.title}
        lead={fmt(k.from, { vendor })}
      />
      <section className="tone-cream ak-section !pt-10">
        <div className="ak-container max-w-3xl">
          <div className="ak-card p-6 sm:p-8">
            <p className="flex items-center gap-2 text-sm font-bold text-tone-mute">
              {pickup ? (
                <Store className="size-4" aria-hidden="true" />
              ) : (
                <MapPin className="size-4" aria-hidden="true" />
              )}
              {statusLabel}
            </p>
            {finished ? (
              <p className="mt-4 text-lg font-semibold">
                {track.status === "cancelled"
                  ? k.cancelled
                  : track.status === "rejected"
                    ? k.rejected
                    : k.failed}
              </p>
            ) : (
              <>
                <ol className="mt-6 space-y-0" aria-label={k.title}>
                  {steps.map((label, i) => {
                    const state = i < idx ? "done" : i === idx ? "now" : "next";
                    return (
                      <li
                        key={label}
                        className="relative flex gap-4 pb-6 last:pb-0"
                        aria-current={state === "now" ? "step" : undefined}
                      >
                        {i < steps.length - 1 && (
                          <span
                            aria-hidden="true"
                            className={`absolute start-[1.05rem] top-9 h-[calc(100%-2rem)] w-0.5 ${i < idx ? "bg-ink" : "bg-[var(--tone-line)]"}`}
                          />
                        )}
                        <span
                          className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-extrabold ${
                            state === "done"
                              ? "border-ink bg-ink text-gold"
                              : state === "now"
                                ? "border-ink bg-gold text-ink shadow-[0_0_0_6px_rgb(244_182_60/0.3)]"
                                : "border-[var(--tone-line)] text-tone-mute"
                          }`}
                        >
                          {state === "done" ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <span
                          className={`pt-1 ${state === "next" ? "text-tone-mute" : "font-bold"}`}
                        >
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {track.status === "delivered" ? (
                  <p className="mt-6 text-lg font-bold">
                    {pickup ? k.arrivedPickup : k.arrivedDelivery}
                  </p>
                ) : (
                  <div className="mt-6 space-y-2">
                    {eta && (
                      <p className="flex items-center gap-2 text-lg font-bold">
                        <Clock className="size-5" aria-hidden="true" />
                        {fmt(pickup ? k.etaPickup : k.etaDelivery, eta)}
                      </p>
                    )}
                    {pickup ? (
                      <p className="text-tone-mute">{k.pickupAt}</p>
                    ) : (
                      <>
                        {area && <p className="text-tone-mute">{fmt(k.area, { area })}</p>}
                        {track.driver_assigned && <p className="text-tone-mute">{k.driverOn}</p>}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="mt-8 flex items-baseline justify-between gap-4 border-t border-[var(--tone-line-soft)] pt-5">
              <span className="font-semibold">{k.total}</span>
              <span className="text-end">
                <bdi className="ak-num text-2xl font-extrabold">{usd(track.total_usd)}</bdi>
                <span className="ak-num block text-sm text-tone-mute">
                  <bdi>{lbpAt(track.total_usd, track.usd_lbp_rate, lang)}</bdi> {t.common.lbp}
                </span>
              </span>
            </div>
            {track.estimated && <p className="mt-2 text-sm text-tone-mute">{k.estimated}</p>}
            <p className="mt-4 text-xs text-tone-mute">
              {k.refreshed} {k.privacy}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="font-bold">{k.helpTitle}</p>
            <OrderButton text={t.wa.track} label={k.helpCta} variant="ink" size="md" />
          </div>
        </div>
      </section>
    </>
  );
}
