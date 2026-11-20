// WEB4a stage 2: the aisles, an aisle, the product page and search, from the founder's design reference (its routes aisles.tsx, c.$slug.tsx,
// product.$sku.tsx, search.tsx), rendered on the server. Only the look comes from the reference. Names, counts, prices, stock, "coming soon"
// (SELL1), the facts with their status and source (LD1), the search's matches (SR1) are the database's, passed in by the Astro pages, which
// also keep the JSON-LD. What the reference shows and these pages do not: "most ordered" sorting and "everyday staples" (no popularity before
// 30 days of orders), favourites, "tell me when it's back", "goes well with it", recently viewed, recent searches (the reference's browser
// store), the storage badge (not on the card read), the phone's buy bar (one primary action: the Add button is the page's one).
//
// Works with no script: the filters are a GET form with a Show button (site.js submits on change and hides the button), the aisle chips and
// the search's aisle chips are links, Add is a form button.
import type { ReactNode } from "react";
import { ArrowLeft, ChevronDown, PackageCheck, Search, X } from "lucide-react";
import { t, type Lang } from "../../lib/i18n";
import type { Tone } from "../../lib/category-photos";
import type { ProductView } from "../../lib/product";
import { DeliveryNote, type FrameData } from "./Frame";
import { CategoryVisual } from "./Home";
import { AisleIcon, ProductGrid, ProductRail, ProductVisual, type CardData } from "./Product";
import { Forward, Price, SectionHead, btn, cx } from "./ui";

export interface AisleLink { code: string; name: string; count: number; tone: Tone; fresh: boolean }

/** A pill link (a chip): the current one is ink. */
function Chip({ href, current, children }: { href: string; current?: boolean; children: ReactNode }) {
  return (
    <a href={href} aria-current={current ? "true" : undefined}
      className={cx("press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold no-underline",
        current ? "bg-ink text-paper" : "bg-card text-foreground shadow-card")}>{children}</a>
  );
}

// ---------------------------------------------------------------- /aisles
export function Aisles({ f, aisles, total }: { f: FrameData; aisles: AisleLink[]; total: number }) {
  const l = f.lang;
  const groups: [string, AisleLink[]][] = [[t(l, "w4_fresh"), aisles.filter((a) => a.fresh)], [t(l, "w4_pantry"), aisles.filter((a) => !a.fresh)]]
    .filter(([, list]) => (list as AisleLink[]).length > 0) as [string, AisleLink[]][];
  const collage = aisles.filter((a) => a.fresh).slice(0, 4);
  return (
    <>
      <section className="relative overflow-hidden bg-ink text-paper lg:mx-4 lg:mt-4 lg:rounded-4xl">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-7 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-center lg:px-12 lg:py-12">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-gold rtl:tracking-normal">{t(l, "w4_aisles_kicker")}</p>
            <h1 className="m-0 mt-2 text-[2.4rem] font-bold leading-[1.02] text-paper sm:text-5xl lg:text-6xl rtl:leading-[1.2]">{t(l, "w4_aisles_title")}</h1>
            <p className="m-0 mt-3 max-w-md text-[16px] text-paper/75">{t(l, "w4_aisles_text", { n: total })}</p>
            <form action="/search" method="get" role="search" className="m-0 mt-5 max-w-lg">
              <label className="flex min-h-14 items-center gap-3 rounded-2xl bg-paper ps-4 pe-2 text-ink focus-within:ring-2 focus-within:ring-gold">
                <Search className="size-5 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t(l, "w4_search_label")}</span>
                <input type="search" name="q" placeholder={t(l, "w4_search_placeholder")} maxLength={80} autoComplete="off" enterKeyHint="search"
                  className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none" />
              </label>
            </form>
            <ul className="m-0 mt-5 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm text-paper/80">
              <li className="inline-flex items-center gap-1.5"><PackageCheck className="size-4 text-gold" aria-hidden="true" /> {t(l, "w4_aisles_out")}</li>
            </ul>
          </div>
          <div className="hidden grid-cols-2 gap-3 lg:grid" aria-hidden="true">
            {collage.map((a, i) => <CategoryVisual key={a.code} code={a.code} tone={a.tone} className={cx("aspect-[4/5] rounded-3xl", i % 2 === 1 && "mt-8")} />)}
          </div>
        </div>
      </section>
      <nav aria-label={t(l, "w4_jump")} className="no-scrollbar sticky top-[61px] z-20 flex gap-2 overflow-x-auto bg-background/95 px-4 py-2.5 backdrop-blur lg:top-[69px] lg:px-8">
        {groups.map(([title], i) => <Chip key={title} href={`#group-${i}`}>{title}</Chip>)}
        {aisles.map((a) => <Chip key={a.code} href={`/c/${a.code}`}>{a.name}</Chip>)}
      </nav>
      <div className="px-4 lg:px-8">
        {groups.map(([title, list], i) => (
          <section key={title} id={`group-${i}`} className="scroll-mt-32 pt-8" aria-labelledby={`group-${i}-h`}>
            <h2 id={`group-${i}-h`} className="m-0 mb-3 text-2xl font-bold">{title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((a) => (
                <a key={a.code} href={`/c/${a.code}`} className="press group relative overflow-hidden rounded-xl bg-ink text-paper no-underline shadow-card">
                  <CategoryVisual code={a.code} tone={a.tone} className="aspect-[4/3] transition duration-500 group-hover:scale-[1.04]" />
                  <span className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/20 to-transparent" aria-hidden="true" />
                  <span className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-[17px] font-bold leading-tight lg:text-xl">{a.name}</span>
                      <span className="tabular block text-xs font-semibold text-paper/80">{t(l, "items", { n: a.count })}</span>
                    </span>
                    <Forward className="size-5 opacity-0 transition group-hover:opacity-100" />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- /c/<code>
export interface AisleView {
  lang: Lang; code: string; name: string; tone: Tone; total: number; countText: string;
  aisles: AisleLink[];
  subs: { label: string; href: string; current: boolean }[];
  form: { action: string; brands: string[]; brand: string; units: { value: string; label: string }[]; unit: string; sort: string; stock: boolean; filtered: boolean };
  sections: { title: string | null; items: CardData[] }[];
  empty: boolean; pager: { label: string; prev: string | null; next: string | null } | null; credit: string | null;
}
export function Aisle({ v }: { v: AisleView }) {
  const l = v.lang;
  const sel = "min-h-11 rounded-full border-0 bg-card px-3 text-sm font-semibold text-foreground shadow-card";
  return (
    <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8 lg:px-4 lg:pt-6">
      <aside className="hidden lg:block" aria-label={t(l, "w4_back_aisles")}>
        <nav className="sticky top-24 space-y-0.5">
          {v.aisles.map((x) => (
            <a key={x.code} href={`/c/${x.code}`} aria-current={x.code === v.code ? "page" : undefined}
              className={cx("flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-semibold no-underline",
                x.code === v.code ? "bg-ink text-paper" : "text-foreground hover:bg-muted")}>
              {x.name}<span className="tabular text-xs opacity-60">{x.count}</span>
            </a>
          ))}
        </nav>
      </aside>
      <div>
        <div className="relative overflow-hidden lg:rounded-3xl">
          <CategoryVisual code={v.code} tone={v.tone} eager className="h-44 sm:h-56" />
          <div className="absolute inset-0 flex flex-col justify-end p-4 lg:p-6">
            <a href="/aisles" className="press mb-auto inline-flex min-h-11 w-fit items-center gap-1 rounded-full bg-card/90 px-3 text-sm font-bold text-foreground no-underline lg:hidden">
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {t(l, "w4_back_aisles")}
            </a>
            <div className="w-fit max-w-[75%] rounded-2xl bg-card/95 px-4 py-3 backdrop-blur">
              <h1 className="m-0 text-3xl font-bold leading-none text-foreground lg:text-5xl rtl:leading-tight">{v.name}</h1>
              <p className="tabular m-0 mt-1.5 text-sm font-semibold text-foreground/70">{v.countText}</p>
            </div>
          </div>
        </div>
        <form method="get" action={v.form.action} data-autosubmit
          className="filters sticky top-[61px] z-20 m-0 flex flex-wrap items-center gap-2 bg-background/95 px-4 py-2.5 backdrop-blur lg:top-[69px] lg:px-0">
          {v.subs.length > 1 && (
            <div className="no-scrollbar flex w-full gap-2 overflow-x-auto sm:w-auto sm:flex-1" role="toolbar" aria-label={t(l, "w4_filter")}>
              {v.subs.map((s) => <Chip key={s.href} href={s.href} current={s.current}>{s.label}</Chip>)}
            </div>
          )}
          {v.form.brands.length > 1 && (
            <label className="shrink-0"><span className="sr-only">{t(l, "filter_brand")}</span>
              <select name="brand" defaultValue={v.form.brand} className={sel}>
                <option value="">{t(l, "w4_all_brands")}</option>
                {v.form.brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select></label>
          )}
          {v.form.units.length > 1 && (
            <label className="shrink-0"><span className="sr-only">{t(l, "filter_unit")}</span>
              <select name="unit" defaultValue={v.form.unit} className={sel}>
                <option value="">{t(l, "filter_unit")}: {t(l, "filter_all")}</option>
                {v.form.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select></label>
          )}
          <label className="shrink-0"><span className="sr-only">{t(l, "sort")}</span>
            <select name="sort" defaultValue={v.form.sort} className={sel}>
              <option value="">{t(l, "sort_default")}</option>
              <option value="price_asc">{t(l, "sort_price_asc")}</option>
              <option value="price_desc">{t(l, "sort_price_desc")}</option>
            </select></label>
          <label className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-card px-3 text-sm font-semibold shadow-card">
            <input type="checkbox" name="stock" value="1" defaultChecked={v.form.stock} className="size-5 accent-ink" /> {t(l, "filter_stock")}
          </label>
          <button type="submit" data-autosubmit-button className={btn("primary", "sm")}>{t(l, "filter_show")}</button>
          {v.form.filtered && <a href={v.form.action} className={btn("ghost", "sm")}>{t(l, "filter_clear")}</a>}
        </form>
        <div className="px-4 pt-3 lg:px-0">
          {v.empty && <p className="rounded-2xl bg-muted p-4 text-sm">{t(l, "filter_none")}</p>}
          {v.sections.map((s, i) => (
            <section key={i} className={i ? "pt-6" : ""}>
              {s.title && <h2 className="m-0 mb-3 text-xl font-bold">{s.title}</h2>}
              <ProductGrid items={s.items} lang={l} eager={i === 0 ? 2 : 0} />
            </section>
          ))}
          {v.pager && (
            <nav className="mt-6 flex items-center justify-between gap-3" aria-label={v.pager.label}>
              {v.pager.prev ? <a className={btn("ghost", "md")} href={v.pager.prev} rel="prev">{t(l, "w2_page_prev")}</a> : <span />}
              <span className="text-sm text-muted-foreground">{v.pager.label}</span>
              {v.pager.next ? <a className={btn("soft", "md")} href={v.pager.next} rel="next">{t(l, "w2_page_next")}</a> : <span />}
            </nav>
          )}
          {v.credit && <p className="m-0 mt-4 text-xs text-muted-foreground">{v.credit}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- /p/<sku>
export interface ProductPageView {
  f: FrameData; sku: string; name: string; altName: { text: string; lang: string } | null; brand: string | null;
  aisle: { code: string; name: string }; card: CardData; picture: { src: string; srcSet?: string | null; width: number; height: number; credit: ReactNode } | null;
  chips: string[]; priced: boolean; price: number; per: string | null; status: "in" | "out" | "soon";
  canAdd: boolean; addBack: string; ask: string | null; view: ProductView; creditOff: boolean; more: CardData[];
}
export function ProductPage({ v }: { v: ProductPageView }) {
  const l = v.f.lang;
  return (
    <>
      <div className="px-4 pt-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:pt-8">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <a href={`/c/${v.aisle.code}`} className="press inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-3 font-bold text-foreground no-underline shadow-card">
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {v.aisle.name}
            </a>
          </div>
          <div className="lg:sticky lg:top-24">
            {v.picture
              ? <span className="relative block aspect-square overflow-hidden rounded-3xl bg-white">
                  <img className="pic size-full object-contain p-6" src={v.picture.src} srcSet={v.picture.srcSet ?? undefined} sizes={v.picture.srcSet ? "(min-width: 1024px) 50vw, 100vw" : undefined}
                    alt={v.name} width={v.picture.width} height={v.picture.height} decoding="async" fetchPriority="high" />
                </span>
              : <span role="img" aria-label={t(l, "no_picture")} className="block"><ProductVisual p={v.card} big /></span>}
            {v.picture?.credit && <p className="m-0 mt-2 text-xs text-muted-foreground">{v.picture.credit}</p>}
          </div>
        </div>
        <div className="pt-5 lg:pt-14">
          {v.brand && <p className="m-0 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground rtl:tracking-normal">{v.brand}</p>}
          <h1 className="m-0 mt-1 text-3xl font-bold leading-tight lg:text-[2.6rem]">{v.name}</h1>
          {v.altName && <p className="m-0 mt-1 text-muted-foreground" lang={v.altName.lang} dir={v.altName.lang === "ar" ? "rtl" : "ltr"}>{v.altName.text}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {v.chips.map((c) => <span key={c} className="rounded-full bg-muted px-3 py-1 font-semibold"><bdi>{c}</bdi></span>)}
            {v.status !== "in" && <span className="rounded-full bg-ink px-3 py-1 font-semibold text-paper">{t(l, v.status === "soon" ? "coming_soon" : "out_of_stock")}</span>}
            {v.status === "in" && <span className="rounded-full bg-success/10 px-3 py-1 font-semibold text-success">{t(l, "in_stock")}</span>}
          </div>
          <div className="mt-5 rounded-3xl bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-2">
              {v.priced
                ? <span><Price value={v.price} className="text-4xl font-bold" />{v.per && <span className="block text-sm font-semibold text-muted-foreground" data-per>{v.per}</span>}</span>
                : <span className="text-muted-foreground">{t(l, "no_price")}</span>}
            </div>
            {v.canAdd && (
              <form method="post" action="/cart/line" className="m-0 mt-3">
                <input type="hidden" name="sku" value={v.sku} /><input type="hidden" name="add" value="1" />
                <input type="hidden" name="back" value={v.addBack} /><input type="hidden" name="price" value={String(v.price)} />
                <button type="submit" data-primary className={btn("primary", "lg", true)}>{t(l, "w2_add")}</button>
              </form>
            )}
            {v.f.villages.length > 0 && <DeliveryNote f={v.f} />}
            {v.ask && <p className="m-0 mt-3 text-sm"><a href={v.ask} target="_blank" rel="noopener" className="font-semibold text-gold-deep underline underline-offset-4">{t(l, "w4_ask_item")}</a></p>}
          </div>
          <div className="mt-5"><ProductFacts view={v.view} lang={l} creditOff={v.creditOff} /></div>
        </div>
      </div>
      {v.more.length > 0 && (
        <section className="px-4 pt-12 lg:px-8">
          <SectionHead title={t(l, "w4_more_in", { aisle: v.aisle.name })} action={<a href={`/c/${v.aisle.code}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-foreground no-underline">{t(l, "w4_see_all")} <Forward /></a>} />
          <ProductRail items={v.more} lang={l} />
        </section>
      )}
    </>
  );
}

/** A folded section of facts (the reference's ProductFacts): open when it has something confirmed. */
export function FactSection({ title, open, badge, children }: { title: string; open: boolean; badge?: string | null; children: ReactNode }) {
  return (
    <details open={open} className="group border-b border-border last:border-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 font-bold">
        <span className="flex-1">{title}</span>
        {badge && <span className="rounded-full border border-dashed border-warn/50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-warn rtl:tracking-normal">{badge}</span>}
        <ChevronDown className="size-5 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="pb-4 text-[15px] leading-relaxed">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------- /search
export interface SearchView {
  lang: Lang; q: string; state: "empty" | "short" | "found" | "none";
  results: CardData[]; resultsText: string; facets: { label: string; href: string; current: boolean }[];
  none: string | null; ask: string | null; aisles: AisleLink[]; credit: string | null;
}
/** The search box, sticky under the header. It carries data-live-search: site.js follows the typing (SR1, WEB1). */
export function SearchBar({ lang, q }: { lang: Lang; q: string }) {
  return (
    <div className="sticky top-[61px] z-20 bg-background/95 px-4 py-3 backdrop-blur lg:top-[69px] lg:px-8">
      <form action="/search" method="get" role="search" className="m-0">
        <label className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-input bg-card ps-4 pe-1.5 focus-within:border-foreground">
          <Search className="size-5 shrink-0 text-foreground" aria-hidden="true" />
          <span className="sr-only">{t(lang, "search_label")}</span>
          <input type="search" name="q" defaultValue={q} placeholder={t(lang, "w4_search_placeholder")} maxLength={80} autoComplete="off" enterKeyHint="search"
            data-live-search="" className="min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none" />
          {q && <a href="/search" aria-label={t(lang, "w4_clear")} className="press grid size-11 place-items-center rounded-full text-foreground hover:bg-muted"><X className="size-5" aria-hidden="true" /></a>}
        </label>
      </form>
    </div>
  );
}
/** What the live search swaps in (the page's own [data-live] block). */
export function SearchResults({ v }: { v: SearchView }) {
  const l = v.lang;
  return (
    <div className="px-4 pt-2 lg:px-8">
      <h1 className="m-0 mb-2 text-2xl font-bold">{v.q ? t(l, "search_results", { q: v.q }) : t(l, "search")}</h1>
      {v.state === "empty" && <p className="m-0 text-muted-foreground">{t(l, "live_hint")}</p>}
      {v.state === "short" && <p className="m-0 text-muted-foreground">{t(l, "search_short")}</p>}
      {v.state === "found" && <>
        <p className="m-0 mb-4 text-sm text-muted-foreground">{v.resultsText}</p>
        {v.facets.length > 1 && (
          <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="toolbar" aria-label={t(l, "w4_by_aisle")}>
            {v.facets.map((x) => <Chip key={x.href} href={x.href} current={x.current}>{x.label}</Chip>)}
          </div>
        )}
        <ProductGrid items={v.results} lang={l} eager={2} />
        {v.credit && <p className="m-0 mt-4 text-xs text-muted-foreground">{v.credit}</p>}
      </>}
      {v.state === "none" && v.none && <div className="rounded-3xl bg-card p-5 shadow-card">
        <p className="m-0">{v.none}</p>
        {v.ask && <a href={v.ask} target="_blank" rel="noopener" className="mt-3 inline-block font-semibold text-gold-deep underline underline-offset-4">{t(l, "try_whatsapp")}</a>}
      </div>}
      {v.state !== "found" && v.aisles.length > 0 && <>
        <h2 className="m-0 mt-8 text-sm font-bold uppercase tracking-widest text-muted-foreground rtl:tracking-normal">{t(l, "w4_browse_or")}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {v.aisles.map((a) => (
            <a key={a.code} href={`/c/${a.code}`} className="press overflow-hidden rounded-xl bg-card text-foreground no-underline shadow-card">
              <CategoryVisual code={a.code} tone={a.tone} small className="aspect-[4/3]" />
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold leading-tight"><AisleIcon code={a.code} className="size-3.5 shrink-0" />{a.name}</span>
            </a>
          ))}
        </div>
      </>}
    </div>
  );
}

// ---------------------------------------------------------------- the product page's facts (LD1's view, the reference's folded sections)
/** The facts block: exactly what LD1's view holds (only the item's own template; a field not approved reads "not confirmed yet"; an approved
 *  one shows where it came from). Sections with something confirmed are open; the rest are folded with the "not confirmed yet" mark. */
export function ProductFacts({ view, lang, creditOff }: { view: ProductView; lang: Lang; creditOff: boolean }) {
  const nc = t(lang, "not_confirmed_yet");
  const nothing = view.food.groups.every((g) => g.empty) && !view.nutrition;
  const sep = lang === "ar" ? "، " : ", ";
  return (
    <div className="space-y-5">
      {view.food.show && <section aria-labelledby="facts-h">
        <h2 id="facts-h" className="m-0 text-xl font-bold">{t(lang, "facts_title")}</h2>
        <p className="m-0 mt-2 rounded-2xl bg-warn/10 p-3 text-sm text-warn">{t(lang, "facts_intro")}</p>
        <div className="mt-3 rounded-3xl bg-card px-4 shadow-card">
          {nothing && <p className="m-0 py-3">{t(lang, "nothing_verified")}</p>}
          {view.food.groups.map((g) => (
            <FactSection key={g.title} title={g.title} open={g.lines.length > 0} badge={g.lines.length === 0 ? nc : null}>
              {g.lines.length > 0 && <ul className="m-0 ps-5">{g.lines.map((x) => <li key={x.text}>{`${x.text} `}<span className="text-sm text-muted-foreground">{`(${x.how})`}</span></li>)}</ul>}
              {g.notVerified.length > 0 && (g.kind === "allergen" || g.kind === "diet"
                ? <p className="m-0 text-sm text-muted-foreground">{t(lang, "not_verified_list", { list: g.notVerified.join(sep) })}</p>
                : <p className="m-0 text-muted-foreground">{nc}</p>)}
            </FactSection>
          ))}
          {(view.nutrition || view.nutritionNotConfirmed) && (
            <FactSection title={t(lang, "nutrition")} open={!!view.nutrition} badge={view.nutrition ? null : nc}>
              {view.nutrition ? <>
                <p className="m-0 pb-2 text-sm text-muted-foreground">{t(lang, "per_amount", { amount: view.nutrition.per })}</p>
                <table className="w-full text-[15px]"><tbody>{view.nutrition.rows.map((r) => (
                  <tr key={r.key} className="border-t border-border"><th scope="row" className="py-2 text-start font-medium">{r.label}</th><td className="tabular py-2 text-end font-semibold"><bdi>{r.value}</bdi></td></tr>
                ))}</tbody></table>
                {view.nutrition.how && <p className="m-0 mt-1 text-sm text-muted-foreground">{`(${view.nutrition.how})`}</p>}
              </> : <p className="m-0 text-muted-foreground">{nc}</p>}
            </FactSection>
          )}
        </div>
      </section>}
      {(view.details.length > 0 || view.claims.length > 0) && <section aria-labelledby="details-h">
        <h2 id="details-h" className="m-0 text-xl font-bold">{t(lang, "details_title")}</h2>
        <p className="m-0 mt-2 rounded-2xl bg-muted p-3 text-sm text-muted-foreground">{t(lang, "details_intro")}</p>
        <dl className="m-0 mt-3 rounded-3xl bg-card px-4 shadow-card">
          {view.details.map((d) => (
            <div key={d.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border py-3 last:border-0">
              <dt className="font-semibold">{d.label}</dt>
              <dd className="m-0 text-end">{d.value !== null
                ? <><bdi>{d.value}</bdi>{d.how && <small className="block text-xs text-muted-foreground">{`(${d.how})`}</small>}</>
                : <span className="rounded-full border border-dashed border-warn/50 px-2 py-0.5 text-[11px] font-bold uppercase text-warn rtl:normal-case">{nc}</span>}</dd>
            </div>
          ))}
          {view.claims.length > 0 && <div className="py-3">
            <dt className="font-semibold">{t(lang, "claims_title")}</dt>
            <dd className="m-0"><ul className="m-0 ps-5">{view.claims.map((c) => <li key={c.quote}>{`“${c.quote}” `}{c.how && <span className="text-sm text-muted-foreground">{`(${c.how})`}</span>}</li>)}</ul></dd>
          </div>}
        </dl>
      </section>}
      {creditOff && <p className="m-0 text-xs text-muted-foreground">{t(lang, "credit_off")}</p>}
    </div>
  );
}
