// WEB4a: the frame of every page, from the founder's design reference (its components/ak/Shell.tsx TopBar, Footer and BottomNav, and
// VillagePicker.tsx), rendered on the server. What it shows comes from the page: the served villages with their fee and time
// (web_service_facts), the visitor's village (a cookie with its id only), the basket's count and items total (cart_view), the hours.
// The reference's demo store, localStorage and invented numbers are not here.
//
// Works with no script: the village chip is a <details> that opens the picker; each village is a button of one form (POST /village);
// the language and the basket are links. The site's one small script (public/site.js) adds what must react: the picker's search box,
// and "Use my location", which asks the phone for its position only when tapped (never on page load) and sends it once to /village/locate,
// which keeps the village only.
//
// `focus` (the checkout, and an order waiting for its WhatsApp tap): one primary action per screen. The basket, the WhatsApp order button,
// the village chip and the phone's bottom bar are not drawn, so the page's own action is the only one.
import { ChevronDown, House, LayoutGrid, LocateFixed, MapPin, Search, ShoppingBasket, User, UtensilsCrossed, X } from "lucide-react";
import { LANGS, LANG_NAMES, t, usd, type Lang } from "../../lib/i18n";
import { chatWith } from "../../lib/order";
import { Logo, Price, WaIcon, cx } from "./ui";

export interface PickerVillage { id: string; name: string; fee: number; eta: number }
export interface FrameData {
  lang: Lang; path: string; q?: string; live?: boolean;
  /** the chat's base address (settings.catalog.product_link without its query), or null: then no WhatsApp button anywhere */
  chat: string | null;
  villages: PickerVillage[]; village: PickerVillage | null;
  open: boolean | null; opens: string | null; hours: string | null;
  basket: { count: number; total: number | null } | null; min: number | null;
  focus: boolean;
}

const orderText = (f: FrameData) => f.village ? t(f.lang, "w4_msg_type_v", { village: f.village.name }) : t(f.lang, "wa_greeting");

/** The villages by zone: one group per fee and time (a zone is a fee and a time; its name is staff's word). Sorted by time, then name. */
export function zonesOf(villages: PickerVillage[]): { eta: number; fee: number; villages: PickerVillage[] }[] {
  const groups = new Map<string, { eta: number; fee: number; villages: PickerVillage[] }>();
  for (const v of villages) {
    const k = `${v.eta}|${v.fee}`;
    if (!groups.has(k)) groups.set(k, { eta: v.eta, fee: v.fee, villages: [] });
    groups.get(k)!.villages.push(v);
  }
  return [...groups.values()].sort((a, b) => a.eta - b.eta || a.fee - b.fee)
    .map((g) => ({ ...g, villages: g.villages.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** The picker's body: "Use my location", the search box, the villages grouped by zone. `idp` keeps two pickers on one page apart. */
export function PickerBody({ f, idp, back, dark = false }: { f: FrameData; idp: string; back: string; dark?: boolean }) {
  const l = f.lang;
  const ask = chatWith(f.chat, t(l, "wa_greeting"));
  return (
    <div className={cx("text-start", dark ? "text-paper" : "text-foreground")} data-picker>
      <form method="post" action="/village/locate" className="m-0 border-b border-border p-2" hidden data-locate-form>
        <input type="hidden" name="lat" value="" /><input type="hidden" name="lng" value="" /><input type="hidden" name="back" value={back} />
        <button type="submit" data-locate className="press flex min-h-12 w-full items-center gap-3 rounded-2xl bg-ink px-3.5 text-start text-sm font-bold text-paper">
          <LocateFixed className="size-5 shrink-0 text-gold" aria-hidden="true" />
          <span className="flex-1">
            <span data-locate-label data-busy={t(l, "w4_locating")}>{t(l, "w4_use_location")}</span>
            <span className="block text-xs font-medium text-paper/70">{t(l, "w4_use_location_note")}</span>
          </span>
        </button>
        <p className="m-0 mt-2 px-1 text-sm" role="status" data-locate-error hidden>{t(l, "w4_locate_failed")}</p>
      </form>
      <label className="flex min-h-12 items-center gap-2 border-b border-border px-4" hidden data-picker-search-row>
        <Search className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        <span className="sr-only">{t(l, "w4_picker_search")}</span>
        <input id={`${idp}-q`} type="search" autoComplete="off" maxLength={40} placeholder={t(l, "w4_picker_search")} data-picker-search
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none" />
      </label>
      <form method="post" action="/village" className="m-0">
        <input type="hidden" name="back" value={back} />
        <div className={cx("overflow-y-auto px-2 pb-2", dark ? "max-h-[28rem]" : "max-h-[min(60vh,22rem)]")}>
          {zonesOf(f.villages).map((z) => (
            <section key={`${z.eta}-${z.fee}`} className="pt-2" data-picker-group>
              <h3 className={cx("m-0 flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-bold uppercase tracking-widest rtl:tracking-normal", dark ? "text-paper/70" : "text-muted-foreground")}>
                <span>{t(l, "w4_eta", { n: z.eta })}</span>
                <span className="normal-case tracking-normal"><Price value={z.fee} /></span>
              </h3>
              <ul className="m-0 grid list-none grid-cols-2 gap-0.5 p-0">
                {z.villages.map((v) => (
                  <li key={v.id} data-picker-item data-name={v.name.toLowerCase()}>
                    <button type="submit" name="village" value={v.id} aria-pressed={f.village?.id === v.id}
                      className={cx("press flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-[15px]",
                        dark ? "hover:bg-white/10 aria-pressed:bg-white/15" : "hover:bg-muted aria-pressed:bg-muted", f.village?.id === v.id && "font-bold")}>
                      <MapPin className={cx("size-4 shrink-0", dark ? "text-gold" : "text-gold-deep")} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{v.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="px-3 py-3" hidden data-picker-none>
            <p className="m-0 text-sm">{t(l, "w4_picker_none")}</p>
            {ask && <a href={ask} target="_blank" rel="noopener" className="press mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-whatsapp px-3.5 text-sm font-bold text-whatsapp-ink no-underline">
              <WaIcon className="size-4" /> {t(l, "w4_ask_wa")}</a>}
          </div>
        </div>
      </form>
      <p className={cx("m-0 flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-xs", dark ? "text-paper/70" : "text-muted-foreground")}>
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" /> {t(l, "w4_picker_pin")}
      </p>
    </div>
  );
}

/** The header's "Deliver to" chip and its picker (a <details>: it opens with no script). */
export function VillageChip({ f, className = "" }: { f: FrameData; className?: string }) {
  const l = f.lang;
  const label = f.village ? f.village.name : t(l, "w4_choose_village");
  return (
    <details className={cx("group relative", className)} data-picker-root>
      <summary aria-label={f.village ? t(l, "w4_change_village", { village: f.village.name }) : t(l, "w4_choose_village")}
        className="press inline-flex min-h-11 max-w-[32vw] cursor-pointer list-none items-center gap-1.5 rounded-full bg-muted ps-3 pe-2.5 text-[13px] font-bold text-foreground sm:max-w-[40vw] [&::-webkit-details-marker]:hidden">
        <MapPin className="size-4 shrink-0 text-gold-deep" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 opacity-70 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-3xl border border-border bg-card shadow-float sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-[24rem]">
        <div className="flex items-center justify-between border-b border-border ps-4 pe-1 py-1">
          <p className="m-0 text-xs font-bold uppercase tracking-widest text-muted-foreground rtl:tracking-normal">{t(l, "w4_picker_title")}</p>
          <button type="button" data-picker-close className="grid size-11 place-items-center rounded-full text-foreground hover:bg-muted" hidden>
            <X className="size-5" aria-hidden="true" /><span className="sr-only">{t(l, "w4_picker_close")}</span>
          </button>
        </div>
        <PickerBody f={f} idp="hdr" back={f.path} />
      </div>
    </details>
  );
}

/** A product page's delivery note: the chosen village with its time and fee, or a link to choose one (no second picker on the page). */
export function DeliveryNote({ f }: { f: FrameData }) {
  const l = f.lang;
  return (
    <p className="m-0 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
      <MapPin className="size-4 shrink-0 text-gold-deep" aria-hidden="true" />
      {f.village
        ? <><span className="font-semibold text-foreground">{f.village.name}</span><span aria-hidden="true">·</span><span>{t(l, "w4_eta", { n: f.village.eta })}</span>
            <span aria-hidden="true">·</span><Price value={f.village.fee} />
            <a href={`/village?back=${encodeURIComponent(f.path)}`} className="font-semibold text-gold-deep underline underline-offset-4">{t(l, "w4_change")}</a></>
        : <a href={`/village?back=${encodeURIComponent(f.path)}`} className="font-semibold text-gold-deep underline underline-offset-4">{t(l, "w2_fee_pick")}</a>}
    </p>
  );
}

/** "Delivering to <village> · time · fee": the hero's chip line. With no village chosen, the chip asks for one. */
export function DeliveryLine({ f }: { f: FrameData }) {
  const l = f.lang;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
      <span className="font-semibold text-foreground/70">{t(l, "w4_delivering_to")}</span>
      <VillageChip f={f} className="[&>summary]:bg-card [&>summary]:shadow-card" />
      {f.open !== null && (
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground/80">
          <span className={cx("size-2 rounded-full", f.open === false ? "bg-destructive" : "bg-success")} aria-hidden="true" />
          {f.open === false ? (f.opens ? t(l, "w4_closed_opens", { time: f.opens }) : t(l, "closed_now")) : f.village ? t(l, "w4_eta", { n: f.village.eta }) : t(l, "open_now")}
          {f.village && <><span aria-hidden="true">·</span><Price value={f.village.fee} /></>}
        </span>
      )}
    </div>
  );
}

function Langs({ f }: { f: FrameData }) {
  return (
    <details className="group relative shrink-0">
      <summary className="press grid size-11 cursor-pointer list-none place-items-center rounded-full bg-muted text-[13px] font-bold text-foreground [&::-webkit-details-marker]:hidden"
        aria-label={t(f.lang, "language")}>
        <span lang={f.lang}>{f.lang === "ar" ? "ع" : f.lang.toUpperCase()}</span>
      </summary>
      <nav aria-label={t(f.lang, "language")} className="absolute end-0 top-full z-50 mt-2 grid min-w-36 gap-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-float">
        {LANGS.map((x) => (
          <a key={x} lang={x} href={`/lang?set=${x}&next=${encodeURIComponent(f.path)}`} aria-current={x === f.lang ? "true" : undefined}
            className="flex min-h-11 items-center rounded-xl px-3 text-[15px] font-semibold text-foreground no-underline hover:bg-muted aria-[current]:bg-muted">{LANG_NAMES[x]}</a>
        ))}
      </nav>
    </details>
  );
}

export function Header({ f }: { f: FrameData }) {
  const l = f.lang;
  const wa = chatWith(f.chat, orderText(f));
  const b = f.basket;
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:gap-3 lg:gap-5 lg:px-8 lg:py-3">
        <a href="/" className="shrink-0 no-underline" aria-label={t(l, "home")}><Logo name={t(l, "site")} /></a>
        <nav aria-label={t(l, "w4_nav")} className="hidden items-center gap-1 lg:flex">
          <a href="/food" className="whitespace-nowrap rounded-xl px-3 py-2 text-[15px] font-semibold text-muted-foreground no-underline hover:text-foreground" aria-current={f.path.startsWith("/food") ? "page" : undefined}>{t(l, "w4_food")}</a>
          <a href="/aisles" aria-current={/^\/(aisles|c\/|p\/)/.test(f.path) ? "page" : undefined} className="whitespace-nowrap rounded-xl px-3 py-2 text-[15px] font-semibold text-muted-foreground no-underline hover:text-foreground aria-[current]:text-foreground aria-[current]:underline aria-[current]:decoration-accent aria-[current]:decoration-[3px] aria-[current]:underline-offset-8">{t(l, "w4_groceries")}</a>
        </nav>
        <form action="/search" method="get" role="search" className="m-0 hidden min-w-[200px] flex-1 xl:block">
          <label className="flex min-h-11 items-center gap-2 rounded-2xl bg-muted ps-4 pe-1.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t(l, "search_label")}</span>
            <input type="search" name="q" defaultValue={f.q ?? ""} placeholder={t(l, "w4_search_placeholder")} maxLength={80} autoComplete="off" enterKeyHint="search"
              data-live-search={f.live ? "" : undefined} className="min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none" />
          </label>
        </form>
        <a href="/search" aria-label={t(l, "search")} className="press hidden size-11 shrink-0 place-items-center rounded-full bg-muted text-foreground lg:grid xl:hidden">
          <Search className="size-5" aria-hidden="true" />
        </a>
        <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
          {!f.focus && f.villages.length > 0 && <VillageChip f={f} />}
          <Langs f={f} />
          {!f.focus && wa && (
            <a href={wa} target="_blank" rel="noopener" className="press grid size-11 shrink-0 place-items-center rounded-full bg-whatsapp text-whatsapp-ink no-underline 2xl:hidden">
              <WaIcon className="size-5" /><span className="sr-only">{t(l, "order_whatsapp")} {t(l, "w4_opens_whatsapp")}</span>
            </a>
          )}
          {!f.focus && wa && (
            <a href={wa} target="_blank" rel="noopener" className="press hidden min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl bg-whatsapp px-4 font-bold text-whatsapp-ink no-underline 2xl:inline-flex">
              <WaIcon className="size-5" /> {t(l, "order_whatsapp")}
            </a>
          )}
          <a href="/account" aria-label={t(l, "w4_account_label")} className="press relative hidden size-11 shrink-0 place-items-center rounded-full bg-muted text-foreground lg:grid">
            <User className="size-5" aria-hidden="true" />
          </a>
          {!f.focus && (
            <a href="/cart" className="press hidden min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl bg-primary px-4 font-bold text-primary-foreground no-underline lg:inline-flex"
              aria-label={b && b.count ? t(l, "w4_basket_label", { n: b.count, total: b.total !== null ? usd(b.total) : "" }) : t(l, "w4_basket")} data-basket>
              <ShoppingBasket className="size-5" aria-hidden="true" />
              {b && b.count ? <><span className="tabular" data-basket-n>{b.count}</span>{b.total !== null && <><span className="opacity-60">·</span><Price value={b.total} /></>}</>
                : <span data-basket-n>{t(l, "w4_basket")}</span>}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer({ f }: { f: FrameData }) {
  const l = f.lang;
  const chat = chatWith(f.chat, t(l, "wa_greeting"));
  const col = (title: string, links: [string, string][]) => (
    <div>
      <h2 className="m-0 text-sm font-bold uppercase tracking-widest text-gold rtl:tracking-normal">{title}</h2>
      <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
        {links.map(([href, label]) => <li key={href}><a href={href} className="inline-flex min-h-8 items-center text-paper/80 no-underline hover:text-paper hover:underline">{label}</a></li>)}
      </ul>
    </div>
  );
  return (
    <footer className="mt-16 bg-ink text-paper">
      <div className={cx("mx-auto grid max-w-7xl gap-8 px-4 pt-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8 lg:pb-10", f.focus ? "pb-10" : "pb-40")}>
        <div>
          <Logo name={t(l, "site")} light />
          <p className="m-0 mt-3 max-w-xs text-sm text-paper/75">{t(l, "w4_footer_text")}</p>
          {chat && !f.focus && <a href={chat} target="_blank" rel="noopener" className="press mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-whatsapp px-4 font-bold text-whatsapp-ink no-underline">
            <WaIcon /> {t(l, "w4_chat")}</a>}
          <p className="m-0 mt-3 text-xs text-paper/60">{t(l, "footer_note")}</p>
        </div>
        {col(t(l, "w4_shop"), [["/aisles", t(l, "w4_all_aisles")], ["/search", t(l, "search")], ["/cart", t(l, "w4_basket")], ["/orders", t(l, "w2_orders")]])}
        {col(t(l, "w4_more"), [["/food", t(l, "w4_food_places")], ["/how", t(l, "w2_how")], ["/for-vendors", t(l, "w4_sell")], ["/join/rider", t(l, "w4_ride")],
          ["/signin", t(l, "w4_signin")], ["/privacy", t(l, "privacy")], ["/terms", t(l, "terms")]])}
        <div>
          <h2 className="m-0 text-sm font-bold uppercase tracking-widest text-gold rtl:tracking-normal">{t(l, "w4_good")}</h2>
          <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm text-paper/80">
            {f.hours && <li>{t(l, "w4_open_daily", { hours: "" })}<bdi dir="ltr">{f.hours}</bdi></li>}
            <li>{t(l, "w4_pay_ways")}</li>
            <li>{t(l, "trust_rider")}</li>
            <li>{t(l, "w4_not_sold")}</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

/** The phone's bottom bar (the reference's BottomNav): five doors, and above them the basket with its count, total and the minimum. */
export function BottomNav({ f }: { f: FrameData }) {
  if (f.focus) return null;
  const l = f.lang;
  const b = f.basket;
  const p = f.path;
  const nav: [string, string, typeof House, boolean][] = [
    ["/", t(l, "w4_home"), House, p === "/"],
    ["/food", t(l, "w4_food"), UtensilsCrossed, p.startsWith("/food")],
    ["/aisles", t(l, "w4_groceries"), LayoutGrid, p.startsWith("/aisles") || p.startsWith("/c/") || p.startsWith("/p/")],
    ["/search", t(l, "w4_search"), Search, p.startsWith("/search")],
    ["/account", t(l, "w4_you"), User, p.startsWith("/account") || p.startsWith("/orders")],
  ];
  // one primary action: no basket bar where the page has its own (the basket, checkout, an order, a product with its Add)
  const showBar = !!b && b.count > 0 && !["/cart", "/checkout", "/o/", "/p/"].some((x) => p.startsWith(x));
  const gap = b && b.total !== null && f.min !== null && b.total < f.min ? f.min - b.total : 0;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden" data-bottom>
      {showBar && (
        <a href="/cart" className="press animate-rise mx-3 mb-2 block overflow-hidden rounded-2xl bg-ink text-paper no-underline shadow-float">
          <span className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2.5">
              <span className="tabular grid size-8 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-foreground">{b!.count}</span>
              <span className="text-[15px] font-bold">{t(l, "w4_view_basket")}</span>
            </span>
            {b!.total !== null && <Price value={b!.total} className="text-lg font-bold" />}
          </span>
          {gap > 0 && <span className="block px-4 pb-2.5 text-xs text-paper/80">{t(l, "w4_min_more", { gap: usd(gap), min: usd(f.min!) })}</span>}
        </a>
      )}
      <nav aria-label={t(l, "w4_nav_main")} className="border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto m-0 flex max-w-xl list-none p-0">
          {nav.map(([href, label, I, active]) => (
            <li key={href} className="flex-1">
              <a href={href} aria-current={active ? "page" : undefined}
                className={cx("relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold no-underline", active ? "text-foreground" : "text-muted-foreground")}>
                <span className={cx("grid h-8 w-14 place-items-center rounded-full transition", active && "bg-secondary")}>
                  <I className="size-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                </span>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
