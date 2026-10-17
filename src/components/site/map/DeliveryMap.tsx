import { Link } from "@tanstack/react-router";
import { Minus, Plus, Maximize2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAP_H, MAP_W, NOT_DELIVERED, ZONE, type ZonePlace } from "@/design/chouf-map.generated";
import { fmt, iso, usd, type SiteLang } from "@/lib/site";
import {
  getPlace,
  getVillageUnclaimed,
  type DeliveryMapData,
  type UnclaimedList,
  type VendorCard,
} from "@/lib/site-data";
import { searchPlaces } from "@/lib/zone-search";
import { zoneAreas } from "@/lib/zone-areas";
import { pickName } from "@/lib/site";
import { useSite } from "../context";
import { OrderButton } from "../OrderButton";

/**
 * "Where we deliver" (DECISIONS §39.11): the §39.2 zone as an interactive map. Villages are lit from live data: a lantern
 * for a village with shops on Alo King, a ring for one whose only shops are not on Alo King yet, a small light for a
 * village we deliver to from shops nearby. Search in Arabic, English, French or Arabizi; tap a village for its shops.
 *
 * The polygons are a static file (public/chouf-map.svg, built by scripts/web/build-chouf-map.mjs) loaded after first
 * paint, so the page's JavaScript stays small; names and positions are in the page. Pan with a drag, zoom with the
 * buttons, the wheel or a pinch. Keyboard and screen-reader users get the search and the village index below.
 */

type View = { x: number; y: number; w: number };
const FULL: View = { x: 0, y: 0, w: MAP_W };
const ASPECT = MAP_H / MAP_W;
const MIN_W = 150;

const nameOf = (p: { ar: string; en: string; fr?: string }, lang: SiteLang) =>
  lang === "ar" ? p.ar || p.en : lang === "fr" ? p.fr || p.en : p.en || p.ar;
const otherName = (p: { ar: string; en: string }, lang: SiteLang) => (lang === "ar" ? p.en : p.ar);

function clampView(v: View): View {
  const w = Math.min(MAP_W, Math.max(MIN_W, v.w));
  const h = w * ASPECT;
  return {
    w,
    x: Math.min(MAP_W - w, Math.max(0, v.x)),
    y: Math.min(MAP_H - h, Math.max(0, v.y)),
  };
}

type Panel = {
  slug: string;
  shops: VendorCard[] | null;
  unclaimed: UnclaimedList | null;
};

export function DeliveryMap({ counts, initial }: { counts: DeliveryMapData; initial?: string }) {
  const { t, lang, overview } = useSite();
  const m = t.places.map;
  const on = useMemo(() => new Set(overview.places.map((p) => p.slug)), [overview.places]);
  const countBy = useMemo(() => new Map(counts.places.map((c) => [c.slug, c])), [counts.places]);
  const bySlug = useMemo(() => new Map(ZONE.map((p) => [p.slug, p])), []);

  const [view, setView] = useState<View>(FULL);
  const [base, setBase] = useState("");
  const [sel, setSel] = useState<string | null>(initial && bySlug.has(initial) ? initial : null);
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [pxW, setPxW] = useState(800);
  const svgRef = useRef<SVGSVGElement>(null);
  const baseRef = useRef<SVGGElement>(null);
  const anim = useRef<number | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const listId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // The polygons, once, after first paint.
  useEffect(() => {
    let alive = true;
    fetch("/chouf-map.svg")
      .then((r) => (r.ok ? r.text() : ""))
      .then((s) => {
        const inner = s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
        // Our own static file, but only plain <path> elements are ever inserted.
        if (alive && /^(<path [^<>]*\/>)*$/.test(inner.trim())) setBase(inner);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Screen pixels per map unit, so dots and labels keep their size while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setPxW(e.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const u = view.w / pxW; // map units per screen pixel

  // Classes on the polygons follow the live data and the selection.
  useEffect(() => {
    const g = baseRef.current;
    if (!g) return;
    g.querySelectorAll<SVGPathElement>(".zm-v").forEach((p) => {
      const s = p.dataset.slug ?? "";
      const c = countBy.get(s);
      p.classList.toggle("is-on", on.has(s));
      p.classList.toggle("has-shops", !!c?.shops);
      p.classList.toggle("has-unclaimed", !c?.shops && !!c?.unclaimed);
      p.classList.toggle("is-sel", s === sel);
      p.classList.toggle("is-hover", s === hover);
    });
  }, [base, on, countBy, sel, hover]);

  const animateTo = useCallback((to: View) => {
    const from = viewRef.current;
    const target = clampView(to);
    if (anim.current) cancelAnimationFrame(anim.current);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setView(target);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      const e = 1 - Math.pow(1 - k, 3);
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
      });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const v = viewRef.current;
    const w = Math.min(MAP_W, Math.max(MIN_W, v.w * factor));
    const px = cx ?? v.x + v.w / 2;
    const py = cy ?? v.y + (v.w * ASPECT) / 2;
    return clampView({ w, x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * w) / v.w });
  }, []);

  const focus = useCallback(
    (p: ZonePlace) => animateTo({ w: 300, x: p.x - 150, y: p.y - 150 * ASPECT }),
    [animateTo],
  );

  const choose = useCallback(
    (slug: string | null, opts: { pan?: boolean } = {}) => {
      setSel(slug);
      const p = slug ? bySlug.get(slug) : null;
      if (p && opts.pan !== false) focus(p);
    },
    [bySlug, focus],
  );

  // Open the village from the address (?v=) once the page is interactive.
  useEffect(() => {
    if (sel) {
      const p = bySlug.get(sel);
      if (p) focus(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The panel's shops: orderable ones (site_place) and those not on Alo King yet (site_village_unclaimed).
  useEffect(() => {
    if (!sel) return setPanel(null);
    if (!on.has(sel)) return setPanel({ slug: sel, shops: [], unclaimed: null });
    let alive = true;
    setPanel({ slug: sel, shops: null, unclaimed: null });
    Promise.all([getPlace(sel), getVillageUnclaimed(sel)]).then(([pl, un]) => {
      if (alive) setPanel({ slug: sel, shops: pl?.vendors ?? [], unclaimed: un });
    });
    return () => {
      alive = false;
    };
  }, [sel, on]);

  // Wheel zoom (non-passive, so the page does not scroll while the pointer zooms the map).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const cx = v.x + ((e.clientX - r.left) / r.width) * v.w;
      const cy = v.y + ((e.clientY - r.top) / r.height) * v.w * ASPECT;
      setView(zoomAt(Math.exp(e.deltaY * 0.0022), cx, cy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Drag to pan, pinch to zoom; a tap that did not move selects the village under it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const pinch = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (anim.current) cancelAnimationFrame(anim.current);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
    }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      const slug =
        (e.target as Element).closest?.("[data-slug]")?.getAttribute("data-slug") ?? null;
      if (slug !== hover) setHover(slug);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const k = viewRef.current.w / r.width;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      const v = viewRef.current;
      setView(clampView({ w: v.w, x: v.x - dx * k, y: v.y - dy * k }));
    } else if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const v = viewRef.current;
      const cx = v.x + (((a.x + b.x) / 2 - r.left) / r.width) * v.w;
      const cy = v.y + (((a.y + b.y) / 2 - r.top) / r.height) * v.w * ASPECT;
      setView(zoomAt(pinch.current / d, cx, cy));
      pinch.current = d;
      moved.current += 10;
    }
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (moved.current < 6 && e.type === "pointerup") {
      const slug =
        (e.target as Element).closest?.("[data-slug]")?.getAttribute("data-slug") ?? null;
      if (slug && bySlug.has(slug)) {
        choose(slug);
        requestAnimationFrame(() => {
          if (window.matchMedia?.("(max-width: 63.99rem)").matches)
            panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    }
  };

  // Search.
  const hits = useMemo(() => (q.trim().length >= 2 ? searchPlaces(ZONE, q, 7) : []), [q]);
  const outside = useMemo(
    () =>
      q.trim().length >= 3 && hits.length === 0 ? searchPlaces(NOT_DELIVERED, q, 1)[0] : undefined,
    [q, hits.length],
  );
  const pick = (p: ZonePlace) => {
    choose(p.slug);
    setQ("");
    setActive(0);
  };

  const showAllLabels = view.w < 420;
  const statusOf = (slug: string) => {
    const c = countBy.get(slug);
    if (!on.has(slug)) return "off" as const;
    if (c?.shops) return "shops" as const;
    if (c?.unclaimed) return "unclaimed" as const;
    return "on" as const;
  };

  const zoneCount = ZONE.filter((p) => on.has(p.slug)).length || ZONE.length;
  const fees = overview.fees;
  const lead = fmt(fees.min_usd != null && fees.max_usd != null ? m.lead : m.leadSoon, {
    n: zoneCount,
    min: iso(usd(fees.min_usd)),
    max: iso(usd(fees.max_usd)),
  });
  const selPlace = sel ? bySlug.get(sel) : undefined;

  return (
    <div className="zm">
      <div className="zm-top">
        <h1 className="ak-display zm-title">{m.title}</h1>
        <p className="zm-lead">{lead}</p>

        <div className="zm-search" role="search">
          <label htmlFor={`${listId}-q`} className="zm-search-label">
            {m.label}
          </label>
          <div className="zm-search-box">
            <Search className="size-5 shrink-0 opacity-70" aria-hidden="true" />
            <input
              id={`${listId}-q`}
              type="search"
              value={q}
              autoComplete="off"
              spellCheck={false}
              placeholder={m.placeholder}
              aria-describedby={`${listId}-hint`}
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls={`${listId}-list`}
              aria-activedescendant={hits[active] ? `${listId}-o-${hits[active].slug}` : undefined}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, Math.max(0, hits.length - 1)));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && hits[active]) {
                  e.preventDefault();
                  pick(hits[active]);
                } else if (e.key === "Escape") setQ("");
              }}
            />
          </div>
          <p id={`${listId}-hint`} className="zm-hint">
            {m.hint}
          </p>
          <ul
            id={`${listId}-list`}
            role="listbox"
            aria-label={m.label}
            className="zm-results"
            hidden={!hits.length}
          >
            {hits.map((p, i) => {
              const st = statusOf(p.slug);
              return (
                <li
                  key={p.slug}
                  id={`${listId}-o-${p.slug}`}
                  role="option"
                  aria-selected={i === active}
                  className="zm-result"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  onPointerEnter={() => setActive(i)}
                >
                  <span className={`zm-key zm-key-${st}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{nameOf(p, lang)}</span>
                    <span
                      className="block text-sm text-tone-mute"
                      lang={lang === "ar" ? "en" : "ar"}
                    >
                      {otherName(p, lang)}
                    </span>
                  </span>
                  {countBy.get(p.slug)?.shops ? (
                    <span className="zm-count">
                      {fmt(m.countShops, { n: countBy.get(p.slug)?.shops ?? 0 })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="zm-noresult" role="status" aria-live="polite">
            {q.trim().length >= 3 && hits.length === 0
              ? outside
                ? fmt(m.notHere, { name: nameOf(outside, lang) })
                : fmt(m.noResult, { q: q.trim() })
              : hits.length
                ? fmt(m.results, { n: hits.length })
                : ""}
          </p>
        </div>
      </div>

      <div className="zm-bottom">
        <ul className="zm-legend" aria-label={m.legendOn}>
          <li>
            <span className="zm-key zm-key-shops" aria-hidden="true" />
            {m.legendShops}
          </li>
          <li>
            <span className="zm-key zm-key-unclaimed" aria-hidden="true" />
            {m.legendUnclaimed}
          </li>
          <li>
            <span className="zm-key zm-key-on" aria-hidden="true" />
            {m.legendOn}
          </li>
        </ul>

        <div ref={panelRef} className="zm-panel" aria-live="polite">
          {selPlace && (
            <VillagePanel
              place={selPlace}
              panel={panel?.slug === selPlace.slug ? panel : null}
              isOn={on.has(selPlace.slug)}
              onClose={() => choose(null, { pan: false })}
            />
          )}
        </div>
      </div>

      <div className="zm-stage">
        <svg
          ref={svgRef}
          className="zm-svg"
          viewBox={`${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${(view.w * ASPECT).toFixed(2)}`}
          role="img"
          aria-label={m.mapLabel}
          preserveAspectRatio="xMidYMid slice"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <radialGradient id="zm-glow">
              <stop offset="0" stopColor="var(--gold)" stopOpacity="0.55" />
              <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width={MAP_W} height={MAP_H} className="zm-sea" />
          <g ref={baseRef} className="zm-base" dangerouslySetInnerHTML={{ __html: base }} />
          <g className="zm-lights">
            {ZONE.map((p) => {
              const st = statusOf(p.slug);
              const isSel = p.slug === sel;
              const r = (st === "shops" ? 6 : st === "unclaimed" ? 4.5 : st === "on" ? 3 : 2.2) * u;
              return (
                <g
                  key={p.slug}
                  data-slug={p.slug}
                  className={`zm-pt zm-pt-${st}${isSel ? " is-sel" : ""}`}
                >
                  {st === "shops" && <circle cx={p.x} cy={p.y} r={r * 4.2} fill="url(#zm-glow)" />}
                  <circle cx={p.x} cy={p.y} r={Math.max(r, 9 * u)} className="zm-hit" />
                  <circle cx={p.x} cy={p.y} r={r} className="zm-dot" strokeWidth={1.6 * u} />
                  {isSel && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 7 * u}
                      className="zm-ring"
                      strokeWidth={2 * u}
                    />
                  )}
                </g>
              );
            })}
          </g>
          <g className="zm-labels" aria-hidden="true">
            {ZONE.map((p) => {
              const st = statusOf(p.slug);
              const show =
                p.slug === sel ||
                p.slug === hover ||
                st === "shops" ||
                (st !== "off" && p.role === "shop_village") ||
                (st !== "off" && p.role === "named_by_rasheed" && view.w < 700) ||
                (showAllLabels && st !== "off");
              if (!show) return null;
              return (
                <text
                  key={p.slug}
                  x={p.x}
                  y={p.y - 11 * u}
                  fontSize={(p.slug === sel ? 15 : 12.5) * u}
                  strokeWidth={3.5 * u}
                  className={`zm-label${p.slug === sel ? " is-sel" : st === "shops" ? "" : " is-quiet"}`}
                  textAnchor="middle"
                >
                  {nameOf(p, lang)}
                </text>
              );
            })}
          </g>
        </svg>
        <div className="zm-tools">
          <button
            type="button"
            className="zm-tool"
            aria-label={m.zoomIn}
            onClick={() => animateTo(zoomAt(0.6))}
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="zm-tool"
            aria-label={m.zoomOut}
            onClick={() => animateTo(zoomAt(1.6))}
          >
            <Minus className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="zm-tool"
            aria-label={m.reset}
            onClick={() => animateTo(FULL)}
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VillagePanel({
  place,
  panel,
  isOn,
  onClose,
}: {
  place: ZonePlace;
  panel: Panel | null;
  isOn: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useSite();
  const m = t.places.map;
  const name = nameOf(place, lang);
  const shops = panel?.shops;
  const un = panel?.unclaimed;
  const loading = isOn && (!panel || shops === null);
  const SHOW = 8;
  return (
    <section className="zm-card" aria-labelledby="zm-card-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="zm-card-title" className="ak-h3">
            {name}
          </h2>
          <p className="text-sm text-tone-mute" lang={lang === "ar" ? "en" : "ar"}>
            {otherName(place, lang)}
            {place.elev > 0 && (
              <>
                {" "}
                <span aria-hidden="true">·</span> <bdi>{fmt(m.elevation, { m: place.elev })}</bdi>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="zm-tool !size-9 shrink-0"
          aria-label={m.close}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-3 flex items-center gap-2 font-semibold">
        <span className={`zm-key ${isOn ? "zm-key-on" : "zm-key-off"}`} aria-hidden="true" />
        {fmt(isOn ? m.panelOn : m.panelOff, { place: name })}
      </p>

      {loading && <p className="mt-4 text-tone-mute">{fmt(m.loading, { place: name })}</p>}

      {isOn && shops && (
        <div className="mt-5">
          <h3 className="zm-subhead">{fmt(m.shopsHere, { place: name })}</h3>
          {shops.length ? (
            <ul className="zm-shops">
              {shops.map((v) => (
                <li key={v.slug}>
                  <Link to="/$lang/m/$slug" params={{ lang, slug: v.slug }} className="zm-shop">
                    <span
                      className={`zm-key ${v.open_now ? "zm-key-shops" : "zm-key-off"}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{pickName(v, "name", lang)}</span>
                      <span className="block truncate text-sm text-tone-mute">
                        {pickName(v, "business_type", lang)} ·{" "}
                        {v.open_now ? t.common.openNow : t.common.closed}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-tone-mute">{fmt(m.noShopsHere, { place: name })}</p>
          )}
        </div>
      )}

      {isOn && un && un.vendors.length > 0 && (
        <div className="mt-6">
          <h3 className="zm-subhead">{m.unclaimedHere}</h3>
          <p className="mt-1 text-sm text-tone-mute">{m.unclaimedNote}</p>
          <ul className="zm-shops">
            {un.vendors.slice(0, SHOW).map((v) => (
              <li key={v.slug}>
                <Link
                  to="/$lang/m/$slug"
                  params={{ lang, slug: v.slug }}
                  className="zm-shop is-unclaimed"
                >
                  <span className="zm-key zm-key-unclaimed" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {pickName(v, "name", lang)}
                    </span>
                    <span className="block truncate text-sm text-tone-mute">
                      {pickName(v, "business_type", lang)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {un.total > SHOW && (
            <p className="mt-2 text-sm text-tone-mute">
              {fmt(m.unclaimedMore, { n: un.total - SHOW })}
            </p>
          )}
        </div>
      )}

      {isOn && (
        <div className="mt-6 flex flex-wrap gap-3">
          <OrderButton
            size="md"
            label={fmt(m.order, { place: name })}
            text={fmt(t.wa.place, { place: name })}
          />
          <Link
            to="/$lang/places/$slug"
            params={{ lang, slug: place.slug }}
            className="ak-btn ak-btn-line"
          >
            {fmt(m.openPlace, { place: name })}
          </Link>
        </div>
      )}
    </section>
  );
}

/**
 * "Every village we deliver to" (DECISIONS §39.15.5): a plain, always-visible list of every boundary place under the map,
 * grouped by area, in the page's language with the name in the other script beside it. It is static (the generated zone),
 * so it never depends on places being switched on: a place that is on links to its page and shows its counts; the others
 * are plain names. Also the keyboard, screen-reader, crawler and no-JavaScript way into the map's villages.
 */
export function VillageIndex({ counts }: { counts: DeliveryMapData }) {
  const { t, lang, overview } = useSite();
  const m = t.places.map;
  const on = new Set(overview.places.map((p) => p.slug));
  const countBy = new Map(counts.places.map((c) => [c.slug, c]));
  const coll = new Intl.Collator(lang === "ar" ? "ar" : lang);
  const areas = zoneAreas(ZONE).map((a) => ({
    ...a,
    places: [...a.places].sort((x, y) => coll.compare(nameOf(x, lang), nameOf(y, lang))),
  }));
  if (!areas.length) return null;
  const Item = ({ p }: { p: ZonePlace }) => {
    const c = countBy.get(p.slug);
    const isOn = on.has(p.slug);
    const lit = isOn && !!c && c.shops > 0;
    const name = (
      <span className="min-w-0">
        <span className="font-semibold">{nameOf(p, lang)}</span>{" "}
        {otherName(p, lang) && otherName(p, lang) !== nameOf(p, lang) && (
          <span
            className="text-sm text-tone-mute"
            lang={lang === "ar" ? "en" : "ar"}
            dir={lang === "ar" ? "ltr" : "rtl"}
          >
            {otherName(p, lang)}
          </span>
        )}
      </span>
    );
    const meta =
      isOn && c && (c.shops > 0 || c.unclaimed > 0) ? (
        <span className="shrink-0 text-sm text-tone-mute">
          {[
            c.shops ? fmt(m.countShops, { n: c.shops }) : "",
            c.unclaimed ? fmt(m.countUnclaimed, { n: c.unclaimed }) : "",
          ]
            .filter(Boolean)
            .join(lang === "ar" ? "، " : ", ")}
        </span>
      ) : null;
    return (
      <li>
        {isOn ? (
          <Link
            to="/$lang/places/$slug"
            params={{ lang, slug: p.slug }}
            className="zm-index-link is-on"
          >
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span
                className={`zm-key ${lit ? "zm-key-shops" : "zm-key-dot"}`}
                aria-hidden="true"
              />
              {name}
            </span>
            {meta}
          </Link>
        ) : (
          <span className="zm-index-link">
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="zm-key zm-key-dot" aria-hidden="true" />
              {name}
            </span>
          </span>
        )}
      </li>
    );
  };
  return (
    <section className="tone-cream ak-section ak-ballat" aria-labelledby="zm-index-title">
      <div className="ak-container">
        <h2 id="zm-index-title" className="ak-h2">
          {m.allTitle}
        </h2>
        <p className="ak-lead mt-4">{fmt(m.allLead, { n: ZONE.length })}</p>
        <div className="zm-areas">
          {areas.map((a) => (
            <section key={a.hub.slug} className="zm-area" aria-labelledby={`zm-area-${a.hub.slug}`}>
              <h3 id={`zm-area-${a.hub.slug}`} className="ak-h3">
                {fmt(m.around, { place: nameOf(a.hub, lang) })}
              </h3>
              <ul className="zm-index">
                {a.places.map((p) => (
                  <Item key={p.slug} p={p} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
