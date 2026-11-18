// WEB4a: the home page, from the founder's design reference (its routes/index.tsx), rendered on the server. Only the look comes from the
// reference. Every name, price, count, fee and time here is the database's (web_catalog_home, web_home_extras, web_service_facts), passed in
// by the page. What the reference shows and we do not: the kitchens "open now" and food by cuisine (no restaurant is orderable before
// approve_merchant(), invariant 11: the Food door goes to the places listed before they sign), "your usuals" and "recently viewed" (the
// reference's browser store), Send home (SH1, off), "Snap it" (a photo of a list is not read yet: BK1), the ratings-free "most ordered"
// rail until the shop has 30 days of orders. The example chat is labelled as an example; its basket is three real items at their real prices.
import { Bike, Banknote, Clock, Mic, MessageCircle, Search, ShoppingBasket, Sparkles, Truck, UtensilsCrossed } from "lucide-react";
import { t, type Lang } from "../../lib/i18n";
import { chatWith } from "../../lib/order";
import { photoFile, type Tone } from "../../lib/category-photos";
import { DeliveryLine, PickerBody, type FrameData } from "./Frame";
import { Forward, Price, SectionHead, SeeAll, WaIcon, Crown, cx } from "./ui";

export interface CardData {
  sku: string; name: string; unit: string; price: number; inStock: boolean; comingSoon: boolean; img: string | null; imgAlt: string; tone: Tone;
}
export interface HomeData {
  f: FrameData;
  categories: { code: string; name: string; count: number; tone: Tone; fresh: boolean }[];
  rails: { code: string; name: string; items: CardData[] }[];
  most: CardData[] | null;
  ask: boolean;
  itemsTotal: number;
}

const TONE_BG: Record<Tone, string> = {
  clay: "bg-tone-clay text-tone-clay-ink", sky: "bg-tone-sky text-tone-sky-ink", wheat: "bg-tone-wheat text-tone-wheat-ink", rose: "bg-tone-rose text-tone-rose-ink",
  ice: "bg-tone-ice text-tone-ice-ink", saffron: "bg-tone-saffron text-tone-saffron-ink", olive: "bg-tone-olive text-tone-olive-ink",
};

/** A category's photo (this site's own WebP file), or its tone field when it has none. Lazy unless it is above the fold. */
function CategoryVisual({ code, tone, className = "", small = false, eager = false }: { code: string; tone: Tone; className?: string; small?: boolean; eager?: boolean }) {
  const src = photoFile(code, small);
  return (
    <div className={cx("relative overflow-hidden", TONE_BG[tone], className)} aria-hidden="true">
      {src ? <img src={src} alt="" width={small ? 160 : 480} height={small ? 160 : 480} loading={eager ? "eager" : "lazy"} decoding="async" className="absolute inset-0 size-full object-cover" />
           : <div className="paper-grain absolute inset-0 opacity-60" />}
    </div>
  );
}

/** A product card (the reference's ProductCard): picture or the type-led field, Add (a form: works with no script), price, name, unit. */
export function ProductCard({ p, lang, back }: { p: CardData; lang: Lang; back: string }) {
  const out = !p.inStock;
  return (
    <article className="group relative flex flex-col">
      <div className="relative">
        <a href={`/p/${encodeURIComponent(p.sku)}`} tabIndex={-1} aria-hidden="true" className="block rounded-xl no-underline transition group-hover:-translate-y-0.5">
          <span className={cx("block", out && "opacity-55 grayscale")}>
            {p.img
              ? <span className="relative block aspect-square overflow-hidden rounded-xl bg-white"><img src={p.img} alt={p.imgAlt} loading="lazy" decoding="async" className="size-full object-contain p-3" /></span>
              : <span className={cx("relative flex aspect-square flex-col overflow-hidden rounded-xl p-3", TONE_BG[p.tone])}>
                  <span className="paper-grain absolute inset-0 opacity-50" />
                  <span className="absolute -end-5 -top-5 size-[62%] rounded-full bg-card/50" />
                  <span className="relative mt-auto line-clamp-3 break-words pe-12 text-base font-bold uppercase leading-[0.95] tracking-tight text-ink/85 rtl:normal-case rtl:tracking-normal">{p.name}</span>
                  {p.unit && <span className="relative mt-1 line-clamp-1 pe-12 text-xs font-bold">{p.unit}</span>}
                </span>}
          </span>
        </a>
        {(out || p.comingSoon) && (
          <span className="absolute start-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-paper">{t(lang, p.comingSoon ? "coming_soon" : "w4_sold_out")}</span>
        )}
        {!out && !p.comingSoon && (
          <form method="post" action="/cart/line" className="absolute bottom-2 end-2 m-0">
            <input type="hidden" name="sku" value={`${p.sku}:${p.price}`} /><input type="hidden" name="add" value="1" /><input type="hidden" name="back" value={back} />
            <button type="submit" aria-label={t(lang, "w4_add", { name: p.name })} className="press grid size-11 place-items-center rounded-full bg-ink text-2xl font-bold leading-none text-gold shadow-lift">+</button>
          </form>
        )}
      </div>
      <a href={`/p/${encodeURIComponent(p.sku)}`} className="flex flex-1 flex-col rounded-xl px-0.5 pb-1 pt-1.5 text-foreground no-underline hover:[&_.nm]:underline">
        <Price value={p.price} className="text-[17px] font-bold" />
        <span className="nm line-clamp-2 text-[13.5px] font-medium leading-snug">{p.name}</span>
        {p.unit && <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.unit}</span>}
      </a>
    </article>
  );
}
export function ProductRail({ items, lang, back }: { items: CardData[]; lang: Lang; back: string }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
      {items.map((p) => <div key={p.sku} className="w-[42vw] max-w-44 shrink-0 snap-start sm:w-44"><ProductCard p={p} lang={lang} back={back} /></div>)}
    </div>
  );
}

/** A phone showing a WhatsApp conversation. An example: labelled as one, drawn in WhatsApp's own colours (tokens whatsapp-chat-*). */
type Msg = { me?: boolean; text?: string; voice?: boolean; card?: { title: string; lines: [string, number][]; total: number }; buttons?: string[] };
function ChatMock({ lang, title, sub, messages, className = "" }: { lang: Lang; title: string; sub: string; messages: Msg[]; className?: string }) {
  const waves = ["h-1", "h-2", "h-3.5", "h-2", "h-3", "h-4", "h-2", "h-1", "h-3", "h-4", "h-2", "h-3", "h-1.5", "h-2.5", "h-3.5", "h-2"];
  return (
    <div className={cx("mx-auto w-full max-w-[320px] rounded-5xl border-[10px] border-ink bg-ink shadow-float", className)} role="img" aria-label={t(lang, "w4_mock_label")}>
      <div className="overflow-hidden rounded-4xl bg-wa-bg">
        <div className="flex items-center gap-2.5 bg-wa-bar px-4 pb-3 pt-5 text-white">
          <span className="grid size-9 place-items-center rounded-full bg-accent text-ink"><Crown className="size-5" /></span>
          <span className="leading-tight"><span className="block text-[15px] font-bold">{title}</span><span className="block text-[11px] opacity-85">{sub}</span></span>
        </div>
        <div className="space-y-2 px-3 py-4 text-[13px] leading-snug text-wa-text">
          {messages.map((m, i) => (
            <div key={i} className={cx("flex", m.me ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[85%] rounded-xl px-2.5 py-1.5 shadow-card", m.me ? "rounded-se-sm bg-wa-mine" : "rounded-ss-sm bg-wa-theirs")}>
                {m.voice ? (
                  <span className="flex min-w-[170px] items-center gap-2 py-1">
                    <span className="size-0 border-y-[7px] border-s-[11px] border-y-transparent border-s-wa-muted rtl:-scale-x-100" aria-hidden="true" />
                    <span className="flex h-5 flex-1 items-center gap-[2px]" aria-hidden="true">{waves.map((h, k) => <span key={k} className={cx("w-[3px] rounded-full bg-wa-wave", h)} />)}</span>
                    <Mic className="size-4 text-wa-tick" aria-hidden="true" />
                  </span>
                ) : m.card ? (
                  <span className="block min-w-[200px]">
                    <span className="block font-bold">{m.card.title}</span>
                    {m.card.lines.map(([a, b]) => <span key={a} className="flex justify-between gap-3"><span>{a}</span><Price value={b} /></span>)}
                    <span className="mt-1 flex justify-between border-t border-black/10 pt-1 font-bold"><span>{t(lang, "w4_mock_total")}</span><Price value={m.card.total} /></span>
                  </span>
                ) : <span className="block whitespace-pre-line">{m.text}</span>}
                {m.buttons && <span className="-mx-2.5 mt-1.5 block border-t border-black/10">
                  {m.buttons.map((b) => <span key={b} className="block border-b border-black/5 py-1.5 text-center font-semibold text-wa-link last:border-0">{b}</span>)}
                </span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Hero({ d }: { d: HomeData }) {
  const { f } = d; const l = f.lang;
  const sample = d.rails.map((r) => r.items.find((i) => i.inStock && !i.comingSoon)).filter((x): x is CardData => !!x).slice(0, 3);
  const fee = f.village?.fee ?? (f.villages.length ? Math.min(...f.villages.map((v) => v.fee)) : null);
  const sum = Math.round(sample.reduce((a, s) => a + s.price, 0) * 100) / 100;
  const typeIt = chatWith(f.chat, f.village ? t(l, "w4_msg_type_v", { village: f.village.name }) : t(l, "wa_greeting"));
  const voice = chatWith(f.chat, f.village ? t(l, "w4_msg_voice_v", { village: f.village.name }) : t(l, "w4_msg_voice"));
  return (
    <section className="relative overflow-hidden bg-accent-soft lg:mx-4 lg:mt-4 lg:rounded-4xl">
      <div className="pointer-events-none absolute -end-24 -top-24 size-[420px] rounded-full bg-gold/25" aria-hidden="true" />
      <div className="relative grid grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-8 pt-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-12 lg:py-12">
        <div>
          {f.villages.length > 0 && <DeliveryLine f={f} />}
          <h1 className="m-0 mt-5 max-w-xl text-[2.6rem] font-bold leading-[0.98] text-foreground sm:text-6xl lg:text-[4.2rem] rtl:leading-[1.15]">
            {t(l, "w4_hero_a")} <span className="underline decoration-gold decoration-[0.12em] underline-offset-[0.12em] [text-decoration-skip-ink:none]">{t(l, "w4_hero_b")}</span>{t(l, "w4_hero_c")}
          </h1>
          <p className="m-0 mt-3 max-w-md text-[17px] leading-relaxed text-foreground/80">{t(l, "w4_hero_text")}</p>
          <form action="/search" method="get" role="search" className="m-0 mt-5 max-w-xl">
            <label className="flex min-h-14 items-center gap-3 rounded-2xl bg-card ps-4 pe-1.5 shadow-float ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-ink">
              <Search className="size-5 shrink-0 text-foreground" aria-hidden="true" />
              <span className="sr-only">{t(l, "w4_search_label")}</span>
              <input type="search" name="q" placeholder={t(l, "w4_search_placeholder")} maxLength={80} autoComplete="off" enterKeyHint="search"
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none" />
              <button type="submit" className="press grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-gold" aria-label={t(l, "search")}>
                <Forward className="size-5" />
              </button>
            </label>
          </form>
          <nav className="mt-4 grid max-w-xl grid-cols-2 gap-2.5" aria-label={t(l, "w4_doors")}>
            {[["/#aisles", t(l, "w4_door_groceries"), t(l, "w4_door_groceries_sub", { n: d.itemsTotal }), "fruits_vegetables", ShoppingBasket] as const,
              ["/food", t(l, "w4_door_food"), t(l, "w4_door_food_sub"), "food", UtensilsCrossed] as const].map(([href, title, sub, photo, I]) => (
              <a key={href} href={href} className="press group relative isolate flex min-h-36 flex-col justify-end overflow-hidden rounded-3xl bg-ink p-3.5 text-paper no-underline shadow-lift sm:min-h-40">
                <img src={photoFile(photo)!} alt="" width={480} height={480} loading="eager" decoding="async" className="absolute inset-0 -z-10 size-full object-cover opacity-80 transition duration-500 group-hover:scale-105" />
                <span className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/55 to-transparent" aria-hidden="true" />
                <span className="mb-auto grid size-10 place-items-center rounded-2xl bg-paper/95 text-ink"><I className="size-5" aria-hidden="true" /></span>
                <span className="flex items-center gap-1 text-lg font-bold leading-tight sm:text-xl">{title} <Forward /></span>
                <span className="mt-0.5 text-xs leading-snug text-paper/80">{sub}</span>
              </a>
            ))}
          </nav>
          {typeIt && (
            <div className="mt-4 max-w-xl">
              <p className="m-0 text-[13px] font-semibold text-foreground/70">{t(l, "w4_or_whatsapp")}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <a href={typeIt} target="_blank" rel="noopener" className="press flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-whatsapp px-2 text-center text-sm font-bold leading-tight text-whatsapp-ink no-underline">
                  <WaIcon className="size-5" /><span>{t(l, "w4_type_it")}</span><span className="sr-only">{t(l, "w4_opens_whatsapp")}</span></a>
                {voice && <a href={voice} target="_blank" rel="noopener" className="press flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-card px-2 text-center text-sm font-bold leading-tight text-foreground no-underline ring-1 ring-black/10">
                  <Mic className="size-5" aria-hidden="true" /><span>{t(l, "w4_voice_note")}</span><span className="sr-only">{t(l, "w4_opens_whatsapp")}</span></a>}
              </div>
            </div>
          )}
        </div>
        {sample.length > 0 && fee !== null && (
          <div className="relative hidden lg:block">
            <ChatMock lang={l} title={t(l, "site")} sub={t(l, "w4_mock_sub")} messages={[
              { me: true, voice: true },
              { text: t(l, "w4_mock_got", { items: sample.map((s) => s.name).join(l === "ar" ? "، " : ", ") }) },
              { card: { title: t(l, "w4_mock_basket"), lines: [[t(l, "w4_mock_items", { n: sample.length }), sum], [t(l, "w4_mock_fee"), fee]], total: Math.round((sum + fee) * 100) / 100 } },
              { text: t(l, "w4_mock_cash"), buttons: [t(l, "w4_mock_confirm"), t(l, "w4_mock_change")] },
            ]} />
            {f.village && (
              <div className="absolute -start-10 top-10 flex items-center gap-2 rounded-2xl bg-card py-1.5 ps-1.5 pe-3 shadow-float">
                <span className="grid size-10 place-items-center rounded-xl bg-ink text-gold"><Truck className="size-5" aria-hidden="true" /></span>
                <span className="text-sm leading-tight"><b className="block text-base">{t(l, "w4_eta", { n: f.village.eta })}</b>{t(l, "w4_mock_to", { village: f.village.name })}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** One rail of round photos, one per aisle (the reference's BrowseRail; food by cuisine is not here: no kitchen is orderable yet). */
function BrowseRail({ d }: { d: HomeData }) {
  return (
    <section className="px-4 pt-6 lg:px-8" aria-label={t(d.f.lang, "w4_browse")}>
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:gap-1 lg:overflow-visible lg:px-0">
        {d.categories.map((c) => (
          <a key={c.code} href={`/c/${c.code}`} className="press group flex w-[84px] shrink-0 snap-start flex-col items-center gap-1.5 text-center text-foreground no-underline lg:w-auto">
            <CategoryVisual code={c.code} tone={c.tone} small className="size-[76px] rounded-full shadow-card ring-2 ring-card transition group-hover:ring-gold" />
            <span className="text-[13px] font-semibold leading-tight">{c.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function TrustStrip({ d }: { d: HomeData }) {
  const l = d.f.lang;
  const items: [typeof Banknote, string, string | null][] = [
    [Banknote, t(l, "trust_cash"), t(l, "trust_cash_text")],
    [Bike, t(l, "trust_rider"), t(l, "trust_rider_text")],
    ...(d.f.hours ? [[Clock, t(l, "trust_hours"), d.f.hours] as [typeof Banknote, string, string]] : []),
    ...(d.f.chat ? [[MessageCircle, t(l, "trust_person"), t(l, "trust_person_text")] as [typeof Banknote, string, string]] : []),
  ];
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-px overflow-hidden rounded-3xl bg-border p-0 shadow-card lg:grid-cols-4" aria-label={t(l, "w4_good")}>
      {items.map(([I, title, sub]) => (
        <li key={title} className="flex items-start gap-3 bg-card p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink text-gold"><I className="size-[18px]" aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block text-[14px] font-semibold leading-snug">{title}</span>{sub && <span className="block text-xs text-muted-foreground"><bdi>{sub}</bdi></span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Ask Alo King": behind its switch (settings.web.ask_alo_king), off. The one assistant is the Concierge on WhatsApp (invariant 21): a
 *  question here opens the chat with it typed. */
function AskStrip({ d }: { d: HomeData }) {
  const l = d.f.lang;
  if (!d.ask || !d.f.chat) return null;
  const prompts = [t(l, "w4_ask_p1"), t(l, "w4_ask_p2"), t(l, "w4_ask_p3")];
  return (
    <section className="px-4 pt-8 lg:px-8" aria-labelledby="ask-h">
      <div className="overflow-hidden rounded-3xl bg-ink text-paper shadow-card">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-8">
          <div className="min-w-0">
            <h2 id="ask-h" className="m-0 flex items-center gap-2.5 text-2xl font-bold lg:text-3xl">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gold text-ink"><Sparkles className="size-5" aria-hidden="true" /></span>{t(l, "w4_ask_title")}
            </h2>
            <p className="m-0 mt-2 text-[15px] text-paper/75">{t(l, "w4_ask_text")}</p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-paper/60 rtl:tracking-normal">{t(l, "w4_ask_try")}</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {prompts.map((p) => (
                <a key={p} href={chatWith(d.f.chat, p)!} target="_blank" rel="noopener" className="press flex min-h-12 items-center justify-between gap-2 rounded-2xl bg-white/10 px-4 text-start text-[15px] font-semibold text-paper no-underline ring-1 ring-white/10 hover:bg-white/15">
                  <span className="min-w-0">{p}</span><Forward className="size-4 text-gold" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhatsAppWays({ d }: { d: HomeData }) {
  const { f } = d; const l = f.lang;
  const ways: [typeof Mic, string, string, string | null][] = [
    [MessageCircle, t(l, "w4_type_it"), t(l, "w4_way_type_b"), chatWith(f.chat, f.village ? t(l, "w4_msg_type_v", { village: f.village.name }) : t(l, "wa_greeting"))],
    [Mic, t(l, "w4_way_voice"), t(l, "w4_way_voice_b"), chatWith(f.chat, f.village ? t(l, "w4_msg_voice_v", { village: f.village.name }) : t(l, "w4_msg_voice"))],
  ];
  if (!f.chat) return null;
  // three other real items (each rail's second one in stock), at their real prices
  const sample = d.rails.map((r) => r.items.filter((i) => i.inStock && !i.comingSoon)[1]).filter((x): x is CardData => !!x).slice(0, 3);
  const fee = f.village?.fee ?? (f.villages.length ? Math.min(...f.villages.map((v) => v.fee)) : null);
  const sum = Math.round(sample.reduce((a, s) => a + s.price, 0) * 100) / 100;
  return (
    <section className="mx-4 mt-12 overflow-hidden rounded-4xl bg-ink text-paper lg:mx-8" aria-labelledby="wa-h">
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:p-12">
        <div>
          <p className="m-0 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-whatsapp rtl:tracking-normal"><WaIcon className="size-4" /> {t(l, "w4_wa_kicker")}</p>
          <h2 id="wa-h" className="m-0 mt-2 text-[2rem] font-bold leading-tight lg:text-5xl">{t(l, "w4_wa_title")}</h2>
          <p className="m-0 mt-3 max-w-lg text-paper/75">{t(l, "w4_wa_text")}</p>
          <ul className="m-0 mt-6 grid list-none gap-3 p-0">
            {ways.map(([I, h, b, href]) => href && (
              <li key={h}>
                <a href={href} target="_blank" rel="noopener" className="press flex items-center gap-4 rounded-2xl bg-white/10 p-4 text-paper no-underline ring-1 ring-white/10 hover:bg-white/15">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-whatsapp text-whatsapp-ink"><I className="size-6" aria-hidden="true" /></span>
                  <span><span className="block text-lg font-bold">{h}</span><span className="block text-sm text-paper/75">{b}</span></span>
                  <Forward className="ms-auto size-5 opacity-70" />
                </a>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-4 text-xs text-paper/60">{t(l, "w4_no_promos")}</p>
        </div>
        {sample.length > 0 && fee !== null && <ChatMock lang={l} title={t(l, "site")} sub={t(l, "w4_mock_sub")} messages={[
          { me: true, text: sample.map((s) => `• ${s.name}`).join("\n") },
          { card: { title: t(l, "w4_mock_basket"), lines: [[t(l, "w4_mock_items", { n: sample.length }), sum], [t(l, "w4_mock_fee"), fee]], total: Math.round((sum + fee) * 100) / 100 } },
          { text: t(l, "w4_mock_cash"), buttons: [t(l, "w4_mock_confirm"), t(l, "w4_mock_change")] },
        ]} />}
      </div>
    </section>
  );
}

export function Home({ d }: { d: HomeData }) {
  const { f } = d; const l = f.lang;
  const fresh = d.categories.filter((c) => c.fresh);
  const rest = d.categories.filter((c) => !c.fresh);
  const [firstRail, ...moreRails] = d.rails;
  return (
    <>
      <Hero d={d} />
      <BrowseRail d={d} />
      <AskStrip d={d} />
      <div className="px-4 pt-8 lg:px-8"><TrustStrip d={d} /></div>

      {d.most && d.most.length > 0 && (
        <section className="px-4 pt-8 lg:px-8">
          <SectionHead title={t(l, "w4_most_ordered")} sub={t(l, "w4_most_ordered_sub")} />
          <ProductRail items={d.most} lang={l} back="/" />
        </section>
      )}

      {fresh.length > 0 && (
        <section className="px-4 pt-8 lg:px-8" aria-labelledby="fresh-h">
          <SectionHead id="fresh-h" title={t(l, "w4_fresh")} action={<SeeAll href="#aisles" label={t(l, "w4_all_aisles")} />} />
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-6 lg:px-0">
            {fresh.map((c) => (
              <a key={c.code} href={`/c/${c.code}`} className="press group relative w-[44vw] max-w-52 shrink-0 snap-start overflow-hidden rounded-xl text-white no-underline shadow-card lg:w-auto lg:max-w-none">
                <CategoryVisual code={c.code} tone={c.tone} className="aspect-[4/5] transition duration-500 group-hover:scale-[1.04]" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-10 text-lg font-bold leading-tight">{c.name}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {firstRail && (
        <section className="px-4 pt-10 lg:px-8">
          <SectionHead title={firstRail.name} sub={t(l, "w4_rail_sub")} action={<SeeAll href={`/c/${firstRail.code}`} label={t(l, "w4_see_all")} />} />
          <ProductRail items={firstRail.items} lang={l} back="/" />
        </section>
      )}

      <WhatsAppWays d={d} />

      {moreRails.map((r, i) => (
        <section key={r.code} className={i === 0 ? "mx-4 mt-10 overflow-hidden rounded-3xl bg-secondary p-4 lg:mx-8 lg:p-6" : "px-4 pt-10 lg:px-8"}>
          <SectionHead title={r.name} sub={t(l, "w4_rail_sub")} action={<SeeAll href={`/c/${r.code}`} label={t(l, "w4_see_all")} />} />
          <ProductRail items={r.items} lang={l} back="/" />
        </section>
      ))}

      <section className="px-4 pt-10 lg:px-8" aria-labelledby="aisles-h" id="aisles">
        <h2 id="aisles-h" className="m-0 mb-3 text-[22px] font-bold lg:text-[26px]">{rest.length && fresh.length ? t(l, "w4_pantry") : t(l, "categories")}</h2>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-8">
          {(fresh.length ? rest : d.categories).map((c) => (
            <a key={c.code} href={`/c/${c.code}`} className="press group flex flex-col overflow-hidden rounded-xl bg-card text-foreground no-underline shadow-card">
              <CategoryVisual code={c.code} tone={c.tone} className="aspect-[4/3.4] transition duration-300 group-hover:scale-[1.03]" />
              <span className="px-2.5 py-2 text-[13px] font-bold leading-tight">{c.name}</span>
            </a>
          ))}
          <a href="/food" className="press group flex flex-col overflow-hidden rounded-xl bg-card text-foreground no-underline shadow-card">
            <CategoryVisual code="food" tone="clay" className="aspect-[4/3.4] transition duration-300 group-hover:scale-[1.03]" />
            <span className="px-2.5 py-2 text-[13px] font-bold leading-tight">{t(l, "w4_food_places")}<span className="block text-[11px] font-medium text-muted-foreground">{t(l, "food_tile_note")}</span></span>
          </a>
        </div>
      </section>

      {f.villages.length > 0 && (
        <section className="px-4 pt-12 lg:px-8" id="deliver">
          <div className="rounded-3xl bg-ink p-5 text-paper lg:p-8" aria-labelledby="deliver-h">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
              <div>
                <h2 id="deliver-h" className="m-0 text-2xl font-bold lg:text-3xl">{t(l, "check_title")}</h2>
                {f.village
                  ? <p className="m-0 mt-2 text-paper/80" role="status">{t(l, "check_yes", { village: f.village.name })} {t(l, "check_time", { n: f.village.eta })} · <Price value={f.village.fee} /></p>
                  : <p className="m-0 mt-2 text-paper/75">{t(l, "w4_picker_pin")}</p>}
                <a href="/how" className="mt-3 inline-block text-sm font-semibold text-paper/80 underline underline-offset-4">{t(l, "w4_how")}</a>
              </div>
              <div className="overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10"><PickerBody f={f} idp="home" back="/#deliver" dark /></div>
            </div>
          </div>
        </section>
      )}

      <section className="px-4 pt-6 lg:px-8">
        <a href="/for-vendors" className="press group flex flex-wrap items-center gap-4 rounded-3xl border-2 border-dashed border-input p-5 text-foreground no-underline lg:p-6">
          <span className="grid size-12 place-items-center rounded-2xl bg-ink text-gold"><UtensilsCrossed className="size-6" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold">{t(l, "w4_vendor_title")}</span>
            <span className="block text-sm text-muted-foreground">{t(l, "w4_vendor_text")}</span>
          </span>
          <span className="inline-flex basis-full items-center gap-1 ps-16 font-bold sm:basis-auto sm:ps-0">{t(l, "w4_how")} <Forward /></span>
        </a>
      </section>
    </>
  );
}
