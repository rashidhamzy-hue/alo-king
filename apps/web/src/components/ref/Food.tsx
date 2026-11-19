// WEB4b: the food pages in the reference's look (its Shop and card patterns: the reference's own food screens had no kitchens to show,
// docs/log/ds2.md), rendered on the server with no client directive. Only the look is the reference's: every place, dish, price, choice,
// time and fact is the database's (FD2's API, 0251), passed in by the Astro pages, which also do every form's work. Works with no script:
// a dish's choices are a form in a <details>; a required choice is a required radio, and the server checks again before the dish goes in.
// One filled call to action per page (data-primary): the food basket on a place's page, "Go to checkout" on the basket, the new basket
// on the question. Facts are "declared by the place" or "not confirmed yet: ask us", never "safe" (invariant 15); no rating, no praise
// (invariant 14).
import type { ReactNode } from "react";
import { ArrowLeft, Clock, MapPin, Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import { t, usd, type Lang } from "../../lib/i18n";
import { Forward, Price, btn, cx } from "./ui";

// ---------------------------------------------------------------- the places a visitor may order from (/food)
export interface PlaceCard { href: string; name: string; village: string | null; prep: string; status: string; open: boolean }
export function OrderablePlaces({ lang, places }: { lang: Lang; places: PlaceCard[] }) {
  return (
    <section aria-labelledby="order-from" className="mb-8">
      <h2 id="order-from" className="m-0 text-2xl font-bold">{t(lang, "w4b_order_from")}</h2>
      <p className="m-0 mt-1 text-sm text-muted-foreground">{t(lang, "w4b_order_from_note")}</p>
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {places.map((p) => (
          <li key={p.href}>
            <a href={p.href} data-orderable className="press flex min-h-24 items-center gap-3 rounded-3xl bg-card p-4 text-foreground no-underline shadow-card">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-tone-saffron text-tone-saffron-ink" aria-hidden="true"><UtensilsCrossed className="size-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold leading-tight">{p.name}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{[p.village, p.prep].filter(Boolean).join(" · ")}</span>
                <span className={cx("mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-bold", p.open ? "bg-success/10 text-success" : "bg-muted text-foreground")}>{p.status}</span>
              </span>
              <Forward className="size-5 opacity-60" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- a place's menu (/food/place/<id>)
export interface OptionView { id: string; name: string; delta: number }
export interface GroupView { id: string; name: string; required: boolean; multi: boolean; hint: string; options: OptionView[] }
export interface FactLine { name: string; declared: string | null }
export interface DishView {
  id: string; name: string; altName: { text: string; lang: string } | null; price: number; groups: GroupView[];
  facts: { declared: FactLine[]; notConfirmed: string[] };
}
export interface MenuView {
  lang: Lang; placeId: string; name: string; village: string | null; prep: string; status: string; open: boolean;
  sections: { id: string; title: string | null; dishes: DishView[] }[];
  /** the dish whose choices the visitor must finish (after a refused add): its choices stay open, with the words */
  need: { dish: string; text: string } | null;
  notice: string | null;
  basket: { count: number; here: boolean; label: string } | null;
  back: string; ask: string | null;
}

function FactsBlock({ lang, d }: { lang: Lang; d: DishView }) {
  const sep = lang === "ar" ? "، " : ", ";
  const none = d.facts.declared.length === 0;
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-foreground underline underline-offset-4">{t(lang, "w4b_facts")}</summary>
      <div className="mt-1 rounded-2xl bg-warn/10 p-3 text-sm">
        <p className="m-0 text-warn">{t(lang, "w4b_facts_intro")}</p>
        {none
          ? <p className="m-0 mt-2" data-facts="none">{t(lang, "w4b_all_not_confirmed")}</p>
          : <>
              <ul className="m-0 mt-2 ps-5">{d.facts.declared.map((f) => <li key={f.name}>{`${f.name}: ${f.declared} `}<span className="text-muted-foreground">({t(lang, "w4b_declared")})</span></li>)}</ul>
              {d.facts.notConfirmed.length > 0 && <p className="m-0 mt-2">{t(lang, "w4b_rest_not_confirmed", { list: d.facts.notConfirmed.join(sep) })}</p>}
            </>}
      </div>
    </details>
  );
}

function ChoiceForm({ v, d, open }: { v: MenuView; d: DishView; open: boolean }) {
  const l = v.lang;
  const fields = (
    <>
      <input type="hidden" name="place" value={v.placeId} />
      <input type="hidden" name="dish" value={d.id} />
      <input type="hidden" name="back" value={v.back} />
    </>
  );
  if (d.groups.length === 0) {
    return (
      <form method="post" action="/food/basket/add" className="m-0">
        {fields}<input type="hidden" name="qty" value="1" />
        <button type="submit" aria-label={t(l, "w4b_add_named", { name: d.name })} className={btn("outline", "sm")}>
          <Plus className="size-4" aria-hidden="true" /> {t(l, "w4b_add")}
        </button>
      </form>
    );
  }
  return (
    <details open={open} className="group w-full">
      <summary className={cx(btn("outline", "sm"), "cursor-pointer")}>{t(l, "w4b_choose")}</summary>
      <form method="post" action="/food/basket/add" className="m-0 mt-3 space-y-3">
        {fields}
        {open && v.need && <p className="m-0 rounded-2xl bg-warn/10 p-3 text-sm font-semibold text-warn" role="alert">{v.need.text}</p>}
        {d.groups.map((g) => (
          <fieldset key={g.id} className="m-0 rounded-2xl border border-border p-3" data-group={g.id}>
            <legend className="px-1 text-sm font-bold">{g.name} <span className={cx("ms-1 rounded-full px-2 py-0.5 text-[11px]", g.required ? "bg-ink text-paper" : "bg-muted text-foreground")}>{t(l, g.required ? "w4b_required" : "w4b_optional")}</span></legend>
            <p className="m-0 mb-1 text-xs text-muted-foreground">{g.hint}</p>
            {!g.multi && !g.required && (
              <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="radio" name={`g:${g.id}`} value="" defaultChecked className="size-5 accent-ink" /> {t(l, "w4b_no_thanks")}</label>
            )}
            {g.options.map((o) => (
              <label key={o.id} className="flex min-h-11 items-center gap-3 text-[15px]">
                <input type={g.multi ? "checkbox" : "radio"} name={g.multi ? `g:${g.id}:${o.id}` : `g:${g.id}`} value={o.id} required={!g.multi && g.required} className="size-5 accent-ink" />
                <span className="flex-1">{o.name}</span>
                {o.delta !== 0 && <bdi dir="ltr" className="tabular text-sm text-muted-foreground">{`${o.delta > 0 ? "+" : "−"}${usd(Math.abs(o.delta))}`}</bdi>}
              </label>
            ))}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm font-semibold">{t(l, "w4b_qty")}
            <input type="number" name="qty" defaultValue={1} min={1} max={50} inputMode="numeric" className="mt-1 min-h-11 w-24 rounded-2xl border-2 border-input bg-card px-3 text-base" />
          </label>
          <button type="submit" aria-label={t(l, "w4b_add_named", { name: d.name })} className={btn("soft", "md")}>
            <Plus className="size-4" aria-hidden="true" /> {t(l, "w4b_add")}
          </button>
        </div>
      </form>
    </details>
  );
}

export function MenuPage({ v }: { v: MenuView }) {
  const l = v.lang;
  return (
    <div className="px-4 pb-28 pt-3 lg:px-8 lg:pt-6">
      <a href="/food" className="press inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-3 text-sm font-bold text-foreground no-underline shadow-card">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {t(l, "w4b_back_food")}
      </a>
      <header className="mt-4 rounded-4xl bg-ink p-5 text-paper lg:p-8">
        <h1 className="m-0 text-3xl font-bold leading-tight text-paper lg:text-5xl">{v.name}</h1>
        <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-paper/80">
          {v.village && <span className="inline-flex items-center gap-1"><MapPin className="size-4 text-gold" aria-hidden="true" />{v.village}</span>}
          <span className="inline-flex items-center gap-1"><Clock className="size-4 text-gold" aria-hidden="true" />{v.prep}</span>
          <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-bold", v.open ? "bg-success text-paper" : "bg-paper text-ink")} data-open={v.open ? "yes" : "no"}>{v.status}</span>
        </p>
        <p className="m-0 mt-3 max-w-2xl text-[15px] text-paper/80">{t(l, "w4b_how")}</p>
      </header>
      {v.notice && <p className="m-0 mt-4 rounded-2xl bg-success/10 p-3 font-semibold text-success" role="status">{v.notice}</p>}
      {v.sections.length > 1 && (
        <nav aria-label={t(l, "w4b_sections")} className="no-scrollbar sticky top-[61px] z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto bg-background/95 px-4 py-2.5 backdrop-blur lg:top-[69px] lg:mx-0 lg:px-0">
          {v.sections.map((s) => s.title && (
            <a key={s.id} href={`#${s.id}`} className="press inline-flex min-h-11 shrink-0 items-center rounded-full bg-card px-4 text-sm font-bold text-foreground no-underline shadow-card">{s.title}</a>
          ))}
        </nav>
      )}
      {v.sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-32 pt-6" aria-labelledby={s.title ? `${s.id}-h` : undefined}>
          {s.title && <h2 id={`${s.id}-h`} className="m-0 mb-3 text-2xl font-bold">{s.title}</h2>}
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
            {s.dishes.map((d) => (
              <li key={d.id} id={`dish-${d.id}`} className="scroll-mt-32 rounded-3xl bg-card p-4 shadow-card" data-dish={d.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="m-0 text-[17px] font-bold leading-snug">{d.name}</h3>
                    {d.altName && <p className="m-0 text-sm text-muted-foreground" lang={d.altName.lang} dir={d.altName.lang === "ar" ? "rtl" : "ltr"}>{d.altName.text}</p>}
                  </div>
                  <Price value={d.price} className="shrink-0 text-[17px] font-bold" />
                </div>
                <div className="mt-3"><ChoiceForm v={v} d={d} open={v.need?.dish === d.id} /></div>
                <FactsBlock lang={l} d={d} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {v.ask && <p className="m-0 mt-6 text-sm"><a href={v.ask} target="_blank" rel="noopener" className="font-semibold text-gold-deep underline underline-offset-4">{t(l, "w4b_ask_us")}</a></p>}
      {v.basket && v.basket.count > 0 && (
        <div className="fixed inset-x-0 bottom-[72px] z-30 px-4 lg:bottom-6">
          <div className="mx-auto max-w-xl">
            <a href="/food/basket" data-primary={v.basket.here ? "" : undefined} data-food-basket
              className={cx(btn(v.basket.here ? "primary" : "soft", "lg", true), "shadow-lift")}>
              <ShoppingBag className="size-5" aria-hidden="true" /> {v.basket.label}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the food basket (/food/basket)
export interface BasketLineView { index: number; name: string; options: string; qty: number; total: number | null; unit: number | null; dishHref: string }
export interface BasketView {
  lang: Lang; place: { name: string; href: string } | null; lines: BasketLineView[];
  sums: { label: string; amount: number }[]; total: number | null; eta: string | null; feeLater: boolean;
  issues: string[]; canCheckout: boolean; notice: string | null;
}
function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return <div className={cx("flex items-baseline justify-between gap-3 py-1.5", strong && "border-t border-border pt-3 text-lg font-bold")}><span>{label}</span><span>{children}</span></div>;
}
export function BasketPage({ v }: { v: BasketView }) {
  const l = v.lang;
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-4 lg:px-0 lg:pt-8">
      <h1 className="m-0 text-3xl font-bold">{t(l, "w4b_basket_title")}</h1>
      {v.place && <p className="m-0 mt-1 text-muted-foreground"><a href={v.place.href} className="font-semibold text-foreground underline underline-offset-4">{t(l, "w4b_from", { place: v.place.name })}</a></p>}
      <p className="m-0 mt-3 rounded-2xl bg-muted p-3 text-sm">{t(l, "w4b_apart")}</p>
      {v.notice && <p className="m-0 mt-3 rounded-2xl bg-warn/10 p-3 text-sm font-semibold text-warn" role="status">{v.notice}</p>}
      {v.lines.length === 0
        ? <div className="mt-6 rounded-3xl bg-card p-6 text-center shadow-card">
            <p className="m-0 text-lg font-bold">{t(l, "w4b_basket_empty")}</p>
            <p className="m-0 mt-1 text-muted-foreground">{t(l, "w4b_basket_empty_text")}</p>
            <a href="/food" className={cx(btn("soft", "md"), "mt-4")}>{t(l, "w4b_back_food")}</a>
          </div>
        : <>
            <ul className="m-0 mt-5 list-none space-y-3 p-0">
              {v.lines.map((x) => (
                <li key={x.index} className="rounded-3xl bg-card p-4 shadow-card" data-line={x.index}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={x.dishHref} className="text-[16px] font-bold text-foreground no-underline hover:underline">{x.name}</a>
                      {x.options && <p className="m-0 text-sm text-muted-foreground" data-options>{x.options}</p>}
                    </div>
                    <span className="shrink-0 text-end">
                      {x.total !== null && <Price value={x.total} className="block font-bold" />}
                      {x.unit !== null && x.qty > 1 && <small className="block text-xs text-muted-foreground"><Price value={x.unit} /> × {x.qty}</small>}
                    </span>
                  </div>
                  <form method="post" action="/food/basket/line" className="m-0 mt-2 flex items-center gap-2">
                    <input type="hidden" name="i" value={String(x.index)} />
                    <button type="submit" name="qty" value={String(x.qty - 1)} aria-label={t(l, "w2_less")} className={cx(btn("outline", "sm"), "size-11 px-0")}><Minus className="size-4" aria-hidden="true" /></button>
                    <output className="tabular min-w-8 text-center font-bold" aria-label={t(l, "w2_qty")}>{x.qty}</output>
                    <button type="submit" name="qty" value={String(x.qty + 1)} aria-label={t(l, "w2_more")} className={cx(btn("outline", "sm"), "size-11 px-0")}><Plus className="size-4" aria-hidden="true" /></button>
                    <button type="submit" name="qty" value="0" aria-label={t(l, "w2_remove")} className={cx(btn("ghost", "sm"), "ms-auto")}><Trash2 className="size-4" aria-hidden="true" /> {t(l, "w2_remove")}</button>
                  </form>
                </li>
              ))}
            </ul>
            {v.issues.length > 0 && <ul className="m-0 mt-4 list-none space-y-2 p-0" role="alert">{v.issues.map((i) => <li key={i} className="rounded-2xl bg-warn/10 p-3 text-sm font-semibold text-warn">{i}</li>)}</ul>}
            <div className="mt-5 rounded-3xl bg-card p-4 shadow-card">
              {v.sums.map((s) => <Row key={s.label} label={s.label}><Price value={s.amount} /></Row>)}
              {v.total !== null && <Row label={t(l, "w4b_total")} strong><Price value={v.total} /></Row>}
              {v.feeLater && <p className="m-0 mt-2 text-sm text-muted-foreground">{t(l, "w4b_fee_later")}</p>}
              {v.eta && <p className="m-0 mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-4" aria-hidden="true" />{v.eta}</p>}
              <p className="m-0 mt-2 text-sm text-muted-foreground">{t(l, "w4b_cash")}</p>
            </div>
            <div className="mt-5 flex flex-col gap-3">
              {v.canCheckout && <a href="/food/checkout" data-primary className={btn("primary", "lg", true)}>{t(l, "w4b_checkout")} <Forward /></a>}
              {v.place && <a href={v.place.href} className={btn("soft", "md", true)}>{t(l, "w4b_more_dishes", { place: v.place.name })}</a>}
              <form method="post" action="/food/basket/line" className="m-0"><input type="hidden" name="do" value="clear" />
                <button type="submit" className={btn("ghost", "md", true)}>{t(l, "w4b_empty")}</button></form>
            </div>
          </>}
    </div>
  );
}

// ---------------------------------------------------------------- a dish from a second place: start a new basket?
export interface SwitchView { lang: Lang; oldName: string; newName: string; fields: [string, string][] }
export function SwitchQuestion({ v }: { v: SwitchView }) {
  const l = v.lang;
  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-6">
      <div className="rounded-3xl bg-card p-5 shadow-card">
        <h1 className="m-0 text-2xl font-bold">{t(l, "w4b_switch_title")}</h1>
        <p className="m-0 mt-2 text-[15px]">{t(l, "w4b_switch_text", { old: v.oldName, new: v.newName })}</p>
        <form method="post" action="/food/basket/add" className="m-0 mt-4">
          {v.fields.map(([k, val], i) => <input key={`${k}${i}`} type="hidden" name={k} value={val} />)}
          <input type="hidden" name="replace" value="1" />
          <button type="submit" data-primary className={btn("primary", "lg", true)}>{t(l, "w4b_switch_yes", { new: v.newName })}</button>
        </form>
        <a href="/food/basket" className={cx(btn("ghost", "md", true), "mt-2")}>{t(l, "w4b_switch_no", { old: v.oldName })}</a>
      </div>
    </div>
  );
}
