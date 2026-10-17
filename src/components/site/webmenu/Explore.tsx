import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bike, Clock, MapPin, Search, Store } from "lucide-react";
import { Crown } from "@/design/Crown";
import { WhatsAppIcon } from "@/design/icons";
import { WHATSAPP_NUMBER } from "@/lib/config";
import { fmt, iso, lbpAt, pickName, usd, waLink, type SiteLang } from "@/lib/site";
import type { Names } from "@/lib/site-data";
import { sitePhotoUrl } from "@/lib/web-menu";
import { getExplore, type ExplorePage, type ExploreShop } from "@/lib/web-explore";
import { useSite } from "../context";

type Ok = Extract<ExplorePage, { status: "ok" }>;

const chatLink = () => (WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : null);

/**
 * Explore (session 5g part B, §39.15.11): the shops that deliver to the customer's point, inside WhatsApp's browser. The
 * home shows the categories, popular dishes and new shops; a search or a category narrows the list; more shops load as the
 * customer scrolls; "Not on Alo King yet" comes last. Every shop opens its web menu with the same signed link.
 */
export function Explore({
  d,
  token,
  q,
  category,
}: {
  d: Ok;
  token: string;
  q?: string;
  category?: string;
}) {
  const { t, lang } = useSite();
  const x = t.exploreWeb;
  const place = pickName(d.place, "name", lang);
  const [shops, setShops] = useState<ExploreShop[]>(d.shops);
  const [next, setNext] = useState<number | null>(d.next_offset);
  const [tail, setTail] = useState(d.unclaimed ?? null);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [text, setText] = useState(q ?? "");

  // A new search or category is a new first page.
  useEffect(() => {
    setShops(d.shops);
    setNext(d.next_offset);
    setTail(d.unclaimed ?? null);
  }, [d]);

  async function more() {
    if (next == null || loading) return;
    setLoading(true);
    const r = await getExplore(token, { q, category, offset: next });
    setLoading(false);
    if (r?.status !== "ok") return setNext(null);
    setShops((s) => [...s, ...r.shops.filter((n) => !s.some((o) => o.vendor_id === n.vendor_id))]);
    setNext(r.next_offset);
    if (r.unclaimed) setTail(r.unclaimed);
  }
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next == null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), {
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loading, q, category]);

  const cat = category ? d.categories?.find((c) => c.key === category) : undefined;
  const heading = q
    ? fmt(x.results, { q })
    : category
      ? fmt(x.category, { name: cat ? pickName(cat, "name", lang) : category })
      : fmt(x.shops, { place });
  const change = waLink(t.wa.changeAddress);
  const home = !q && !category;

  return (
    <div className="wm ex" data-ex="explore">
      <div className="wm-top">
        {chatLink() ? (
          <a className="wm-top-back" href={chatLink()!} aria-label={t.webMenu.backToChat}>
            <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
          </a>
        ) : (
          <span className="wm-top-back" aria-hidden="true" />
        )}
        <h1 className="wm-top-title">{x.title}</h1>
        <Crown className="size-7 text-gold" title="Alo King" />
      </div>

      <div className="ex-head tone-night">
        <div className="ak-container">
          <p className="wm-place !mt-0">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span>{fmt(t.webMenu.deliveringTo, { place })}</span>
            {change && (
              <a href={change} className="wm-place-change">
                {t.webMenu.change}
              </a>
            )}
          </p>
          <form
            className="ex-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const v = text.trim().slice(0, 60);
              navigate({
                to: "/$lang/e",
                params: { lang },
                search: v ? { t: token, q: v } : { t: token },
              });
            }}
          >
            <Search className="size-5 shrink-0 opacity-70" aria-hidden="true" />
            <input
              type="search"
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              placeholder={x.search}
              aria-label={x.search}
              enterKeyHint="search"
            />
            <button type="submit" className="ex-search-go">
              {x.searchButton}
            </button>
          </form>
        </div>
      </div>

      {d.categories && d.categories.length > 0 && (
        <nav className="wm-tabs" aria-label={x.categories}>
          <div className="wm-tabs-row">
            {d.categories.map((c) => (
              <Link
                key={c.key}
                to="/$lang/e"
                params={{ lang }}
                search={{ t: token, c: c.key }}
                className="wm-tab ex-cat"
              >
                <span aria-hidden="true">{c.emoji}</span> {pickName(c, "name", lang)}
              </Link>
            ))}
          </div>
        </nav>
      )}
      {!home && (
        <nav className="wm-tabs" aria-label={x.categories}>
          <div className="wm-tabs-row">
            <Link to="/$lang/e" params={{ lang }} search={{ t: token }} className="wm-tab">
              ← {x.all}
            </Link>
          </div>
        </nav>
      )}

      <div className="ak-container wm-body">
        {home && d.popular && d.popular.items.length > 0 && (
          <section className="wm-sec" aria-labelledby="ex-pop">
            <h2 id="ex-pop" className="wm-sec-title">
              {d.popular.by_sales ? x.popular : x.dishes}
            </h2>
            <ul className="ex-rail">
              {d.popular.items.map((i) => (
                <li key={i.id}>
                  <Link
                    to="/$lang/m/$slug"
                    params={{ lang, slug: i.slug }}
                    search={{ t: token, i: i.id }}
                    className="ex-dish"
                  >
                    <img
                      src={sitePhotoUrl({ item: i.id })}
                      alt=""
                      width={160}
                      height={160}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="ex-dish-name">{pickName(i, "name", lang)}</span>
                    <span className="ex-dish-shop">{pickName(i, "vendor", lang)}</span>
                    <span className="ak-num font-extrabold">
                      <bdi>{usd(i.price_usd)}</bdi>
                    </span>
                    {d.rate ? (
                      <span className="ak-num text-xs text-tone-mute">
                        <bdi>{lbpAt(i.price_usd, d.rate, lang)}</bdi> {t.common.lbp}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {home && d.new && d.new.length > 0 && (
          <section className="wm-sec" aria-labelledby="ex-new">
            <h2 id="ex-new" className="wm-sec-title">
              {x.newShops}
            </h2>
            <ul className="ex-rail">
              {d.new.map((s) => (
                <li key={s.vendor_id} className="ex-rail-shop">
                  <ShopCard s={s} token={token} lang={lang} rate={d.rate} compact />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="wm-sec" aria-labelledby="ex-shops">
          <h2 id="ex-shops" className="wm-sec-title">
            {heading}
          </h2>
          {shops.length === 0 ? (
            <p className="mt-2 text-tone-mute">
              {q ? fmt(x.nothing, { q }) : fmt(x.noShops, { place })}
            </p>
          ) : (
            <ul className="ex-list">
              {shops.map((s) => (
                <li key={s.vendor_id}>
                  <ShopCard s={s} token={token} lang={lang} rate={d.rate} />
                </li>
              ))}
            </ul>
          )}
          <div ref={sentinel} aria-hidden="true" />
          {next != null && (
            <button
              type="button"
              className="ak-btn ak-btn-line ak-btn-sm mx-auto mt-4 flex"
              onClick={more}
              disabled={loading}
            >
              {loading ? x.loading : x.more}
            </button>
          )}
          {next == null && shops.length > 0 && <p className="wm-fine text-center">{x.end}</p>}
          {d.rate ? (
            <p className="wm-fine text-center">
              {fmt(t.common.lbpNote, { rate: Math.round(d.rate).toLocaleString("en-US") })}
            </p>
          ) : null}
        </section>

        {tail && tail.length > 0 && (
          <section className="wm-sec" aria-labelledby="ex-un">
            <h2 id="ex-un" className="wm-sec-title">
              {x.unclaimed}
            </h2>
            <p className="text-sm text-tone-mute">{x.unclaimedText}</p>
            <ul className="ex-unclaimed">
              {tail.map((u) => (
                <li key={u.slug}>
                  <Link to="/$lang/m/$slug" params={{ lang, slug: u.slug }} className="ex-un-row">
                    <Store className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{pickName(u, "name", lang)}</span>
                      <span className="block text-xs text-tone-mute">
                        {[pickName(u, "business_type", lang), pickName(u, "place", lang)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ShopCard({
  s,
  token,
  lang,
  rate,
  compact = false,
}: {
  s: ExploreShop;
  token: string;
  lang: SiteLang;
  rate: number | null;
  compact?: boolean;
}) {
  const { t } = useSite();
  const x = t.exploreWeb;
  return (
    <Link
      to="/$lang/m/$slug"
      params={{ lang, slug: s.slug }}
      search={{ t: token }}
      className={`ex-shop ${s.open_now ? "" : "is-closed"} ${compact ? "is-compact" : ""}`}
    >
      <span className="ex-shop-img">
        {s.cover ? (
          <img
            src={sitePhotoUrl({ shop: s.vendor_id })}
            alt=""
            width={640}
            height={320}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="wm-cover-fallback" aria-hidden="true">
            <Crown className="size-10 text-gold" />
          </span>
        )}
        {!s.open_now && <span className="ex-closed">{x.closed}</span>}
      </span>
      <span className="ex-shop-body">
        <span className="ex-shop-name">{pickName(s, "name", lang)}</span>
        <span className="ex-shop-line">
          {[pickName(s, "cuisine", lang), pickName(s, "village", lang)].filter(Boolean).join(" · ")}
        </span>
        <span className="ex-shop-facts ak-num">
          {s.fee_usd != null && (
            <span>
              <Bike className="size-3.5" aria-hidden="true" /> <bdi>{usd(s.fee_usd)}</bdi>
              {rate ? (
                <>
                  {" · "}
                  <bdi>{lbpAt(s.fee_usd, rate, lang)}</bdi> {t.common.lbp}
                </>
              ) : null}
            </span>
          )}
          <span>
            <Clock className="size-3.5" aria-hidden="true" />{" "}
            {fmt(t.webMenu.eta, { min: s.eta_min, max: s.eta_max })}
          </span>
          {s.road_km != null && <span>{fmt(x.km, { km: iso(s.road_km) })}</span>}
          {s.demo && <span className="ak-chip !px-2 !py-0">{t.common.demo}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Explore without a usable link: expired, or no location shared yet. */
export function ExploreGone({
  kind,
  place,
}: {
  kind: "expired" | "no_address" | "outside";
  place?: Names | null;
}) {
  const { t, lang } = useSite();
  const x = t.exploreWeb;
  const again = waLink(kind === "expired" ? t.wa.explore : t.wa.menu);
  const where = place ? pickName(place, "name", lang) : null;
  const title =
    kind === "expired"
      ? t.webMenu.expiredTitle
      : kind === "outside"
        ? where
          ? fmt(x.outsideTitle, { place: where })
          : x.outsideTitleNoPlace
        : x.noAddressTitle;
  const text =
    kind === "expired" ? x.expiredText : kind === "outside" ? x.outsideText : x.noAddressText;
  return (
    <div className="wm wm-gone ak-container">
      <MapPin className="size-10 text-gold" aria-hidden="true" />
      <h1 className="wm-name mt-4">{title}</h1>
      <p className="mt-2 text-tone-mute">{text}</p>
      {again && (
        <a className="wm-wa mt-6" href={again}>
          <WhatsAppIcon className="size-5 shrink-0" />
          {kind === "expired" ? t.webMenu.newLink : x.order}
        </a>
      )}
    </div>
  );
}
