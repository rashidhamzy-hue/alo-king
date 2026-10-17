import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bike, Clock, MapPin, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { Crown } from "@/design/Crown";
import { WhatsAppIcon } from "@/design/icons";
import { WHATSAPP_NUMBER } from "@/lib/config";
import { fmt, iso, lbpAt, pickName, usd, waLink, type SiteLang } from "@/lib/site";
import { declaredAllergens, optionRule } from "@/lib/item";
import {
  addLine,
  cartTotals,
  lineKey,
  linesFromBasket,
  saveWebBasket,
  sectionAnchor,
  setQuantity,
  sitePhotoUrl,
  toggleOption,
  unitPrice,
  unmetGroups,
  type WebItem,
  type WebLine,
  type WebMenu as WebMenuData,
} from "@/lib/web-menu";
import { useSite } from "../context";

type Ok = Extract<WebMenuData, { status: "ok" }>;

/** The chat with Alo King, with nothing typed (the summary is already on its way there). */
const chatLink = () => (WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : null);

const storeKey = (token: string) => `ak_wm_${token}`;
function readStored(token: string): WebLine[] | null {
  try {
    const v = sessionStorage.getItem(storeKey(token));
    const p = v ? JSON.parse(v) : null;
    return Array.isArray(p) ? (p as WebLine[]) : null;
  } catch {
    return null;
  }
}
function writeStored(token: string, lines: WebLine[]) {
  try {
    sessionStorage.setItem(storeKey(token), JSON.stringify(lines));
  } catch {
    // A private window or blocked storage: the cart lives in memory only.
  }
}

/**
 * The web shop menu (CUSTOMER-EXPERIENCE §4), inside WhatsApp's own browser: the shop's cover and one line, sticky section
 * tabs, every item the shop takes now (a photo, or a clean text row), the item sheet with its required choices, add-ons,
 * a note, "Goes well with", declared allergens and estimated nutrition, and the cart bar. "Continue in WhatsApp" hands the
 * lines to the server, which checks and prices them and sends the summary in the chat.
 */
export function WebMenu({ d, token }: { d: Ok; token: string }) {
  const { t, lang } = useSite();
  const w = t.webMenu;
  const shop = d.shop;
  const shopName = pickName(shop, "name", lang);
  const items = useMemo(() => {
    const m = new Map<string, WebItem>();
    for (const s of d.sections) for (const i of s.items) m.set(i.id, i);
    return m;
  }, [d.sections]);
  const [lines, setLines] = useState<WebLine[]>(() => linesFromBasket(d));
  const [open, setOpen] = useState<WebItem | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [state, setState] = useState<
    | { s: "idle" }
    | { s: "saving" }
    | { s: "saved" }
    | { s: "closed" }
    | { s: "error"; msg: string }
    | { s: "other"; vendor: string }
  >({ s: "idle" });
  const restored = useRef(false);

  // A reload keeps what the customer picked (the server's basket is only replaced on Continue).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const s = readStored(token);
    if (s) setLines(s.filter((l) => items.has(l.item_id)));
  }, [token, items]);
  useEffect(() => {
    if (restored.current) writeStored(token, lines);
  }, [token, lines]);

  const totals = cartTotals(lines, items);
  const rate = d.rate ?? null;
  const place = pickName(d.delivery, "place", lang);
  const fee = d.delivery.fee_usd;
  const canOrder = shop.open_now && !shop.paused;

  async function save(replace = false) {
    if (!lines.length) return;
    setState({ s: "saving" });
    const r = await saveWebBasket(token, shop.slug, lines, replace);
    if (r.status === "saved") {
      writeStored(token, []);
      // The window is closed: the customer writes first, then the summary comes (the page says so, no redirect).
      if (r.chat_closed) return setState({ s: "closed" });
      setState({ s: "saved" });
      const back = chatLink();
      if (back) window.location.href = back;
      return;
    }
    if (r.status === "other_vendor") {
      const v =
        lang === "ar" ? (r.vendor_ar ?? r.vendor_en ?? "") : (r.vendor_en ?? r.vendor_ar ?? "");
      return setState({ s: "other", vendor: v });
    }
    if (r.status === "expired") return setState({ s: "error", msg: w.expiredText });
    if (r.status === "too_many") return setState({ s: "error", msg: w.tooMany });
    const bad = "item_id" in r ? r.item_id : undefined;
    // A required choice no longer matches the menu: that item's sheet opens again to choose.
    if (r.status === "choices" && bad && items.has(bad)) {
      setLines((x) => x.filter((l) => l.item_id !== bad));
      setBasketOpen(false);
      setOpen(items.get(bad)!);
      return setState({ s: "error", msg: w.choiceAgain });
    }
    // Sold out since the page opened: its lines go, and the customer checks the basket.
    if (r.status === "unavailable" && bad) {
      setLines((x) => x.filter((l) => l.item_id !== bad));
      return setState({ s: "error", msg: w.soldOut });
    }
    return setState({ s: "error", msg: w.saveError });
  }

  return (
    <div className="wm" data-wm="menu">
      <TopBar title={shopName} />
      <Cover d={d} name={shopName} place={place} />
      <SectionTabs d={d} />
      <div className="wm-body ak-container">
        {d.sections.map((s, k) => (
          <section
            key={s.id ?? k}
            id={sectionAnchor(k)}
            className="wm-sec"
            aria-labelledby={`${sectionAnchor(k)}-h`}
          >
            <h2 id={`${sectionAnchor(k)}-h`} className="wm-sec-title">
              {pickName(s, "name", lang) || t.vendor.menu}
            </h2>
            <ul className="wm-list">
              {s.items.map((it) => (
                <li key={it.id}>
                  <ItemRow
                    it={it}
                    lang={lang}
                    inCart={lines
                      .filter((l) => l.item_id === it.id)
                      .reduce((a, l) => a + l.quantity, 0)}
                    onOpen={() => setOpen(it)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="wm-fine">{t.vendor.kitchenNote}</p>
        {rate ? (
          <p className="wm-fine">
            {fmt(t.common.lbpNote, { rate: Math.round(rate).toLocaleString("en-US") })}
          </p>
        ) : null}
      </div>

      {totals.count > 0 && (
        <div className="wm-bar">
          <button type="button" className="wm-bar-btn" onClick={() => setBasketOpen(true)}>
            <span className="wm-bar-count ak-num" aria-hidden="true">
              {totals.count}
            </span>
            <span className="wm-bar-label">{w.viewBasket}</span>
            <span className="ak-num">
              <bdi>
                {fmt(totals.count === 1 ? w.barOne : w.barMany, {
                  n: totals.count,
                  total: usd(totals.subtotal),
                })}
              </bdi>
            </span>
          </button>
        </div>
      )}

      {open && (
        <ItemSheet
          it={open}
          d={d}
          lang={lang}
          onClose={() => setOpen(null)}
          onOpenOther={(id) => {
            const o = items.get(id);
            if (o) setOpen(o);
          }}
          onAdd={(l) => {
            setLines((x) => addLine(x, l));
            setOpen(null);
            setState({ s: "idle" });
          }}
          canOrder={canOrder}
          items={items}
        />
      )}

      {basketOpen && (
        <Sheet
          label={fmt(w.basketTitle, { vendor: shopName })}
          onClose={() => setBasketOpen(false)}
        >
          <h2 className="wm-sheet-title">{fmt(w.basketTitle, { vendor: shopName })}</h2>
          {lines.length === 0 ? (
            <p className="mt-4 text-tone-mute">{w.emptyBasket}</p>
          ) : (
            <ul className="wm-lines">
              {lines.map((l) => {
                const it = items.get(l.item_id);
                if (!it) return null;
                const name = pickName(it, "name", lang);
                const opts = it.groups
                  .flatMap((g) => g.options)
                  .filter((o) => l.option_ids.includes(o.id))
                  .map((o) => pickName(o, "name", lang));
                const key = lineKey(l);
                return (
                  <li key={key} className="wm-line">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{name}</p>
                      {opts.length > 0 && (
                        <p className="text-sm text-tone-mute">{opts.join(" · ")}</p>
                      )}
                      {l.note && <p className="text-sm text-tone-mute">📝 {l.note}</p>}
                      <p className="ak-num mt-1 text-sm font-semibold">
                        <bdi>{usd(unitPrice(it, l.option_ids) * l.quantity)}</bdi>
                      </p>
                    </div>
                    <Stepper
                      value={l.quantity}
                      label={name}
                      onChange={(q) => setLines((x) => setQuantity(x, key, q))}
                      removeLabel={fmt(w.removeLine, { item: name })}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="wm-sum">
            <div>
              <dt>{w.subtotal}</dt>
              <dd className="ak-num">
                <bdi>{usd(totals.subtotal)}</bdi>
                {rate ? (
                  <small>
                    <bdi>{lbpAt(totals.subtotal, rate, lang)}</bdi> {t.common.lbp}
                  </small>
                ) : null}
              </dd>
            </div>
            {fee != null && shop.delivery && (
              <div>
                <dt>{fmt(w.deliveryFee, { place })}</dt>
                <dd className="ak-num">
                  <bdi>{usd(fee)}</bdi>
                  {rate ? (
                    <small>
                      <bdi>{lbpAt(fee, rate, lang)}</bdi> {t.common.lbp}
                    </small>
                  ) : null}
                </dd>
              </div>
            )}
          </dl>
          {shop.min_order_usd != null && totals.subtotal < Number(shop.min_order_usd) && (
            <p className="wm-warn">{fmt(w.minOrder, { amount: iso(usd(shop.min_order_usd)) })}</p>
          )}
          <p className="mt-3 text-sm text-tone-mute">{w.totalNote}</p>
          {state.s === "error" && (
            <p className="wm-warn" role="alert">
              {state.msg}
            </p>
          )}
          {state.s === "other" ? (
            <div className="wm-other" role="alertdialog" aria-labelledby="wm-other-t">
              <p id="wm-other-t" className="font-bold">
                {w.otherShopTitle}
              </p>
              <p className="mt-1 text-sm">
                {fmt(w.otherShop, { vendor: state.vendor, shop: shopName })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ak-btn ak-btn-gold ak-btn-sm"
                  onClick={() => save(true)}
                >
                  {w.startNew}
                </button>
                {chatLink() && (
                  <a className="ak-btn ak-btn-line ak-btn-sm" href={chatLink()!}>
                    {fmt(w.keep, { vendor: state.vendor })}
                  </a>
                )}
              </div>
            </div>
          ) : state.s === "closed" ? (
            <div className="wm-other" role="status">
              <p className="font-bold">{w.chatClosedTitle}</p>
              <p className="mt-1 text-sm">{w.chatClosedText}</p>
              {waLink(t.wa.basket) && (
                <a className="wm-wa mt-3" href={waLink(t.wa.basket)!}>
                  <WhatsAppIcon className="size-5 shrink-0" />
                  {w.backToChat}
                </a>
              )}
            </div>
          ) : state.s === "saved" ? (
            <div className="wm-other" role="status">
              <p className="font-bold">{w.savedTitle}</p>
              <p className="mt-1 text-sm">{w.savedText}</p>
              {chatLink() && (
                <a className="wm-wa mt-3" href={chatLink()!}>
                  <WhatsAppIcon className="size-5 shrink-0" />
                  {w.backToChat}
                </a>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="wm-wa mt-4"
              disabled={!lines.length || state.s === "saving" || !canOrder}
              onClick={() => save(false)}
              data-wm="continue"
            >
              <WhatsAppIcon className="size-5 shrink-0" />
              {state.s === "saving" ? w.saving : w.continue}
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}

function TopBar({ title }: { title: string }) {
  const { t } = useSite();
  const back = chatLink();
  return (
    <div className="wm-top">
      {back ? (
        <a className="wm-top-back" href={back} aria-label={t.webMenu.backToChat}>
          <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
        </a>
      ) : (
        <span className="wm-top-back" aria-hidden="true" />
      )}
      <p className="wm-top-title">{title}</p>
      <Crown className="size-7 text-gold" title="Alo King" />
    </div>
  );
}

function Cover({ d, name, place }: { d: Ok; name: string; place: string }) {
  const { t, lang } = useSite();
  const w = t.webMenu;
  const s = d.shop;
  const cuisine = pickName(s, "cuisine", lang);
  const village = pickName(s, "village", lang);
  const hours = (s.hours_today ?? "").trim();
  const change = waLink(t.wa.changeAddress);
  return (
    <header className="wm-cover tone-night">
      <div className="wm-cover-img">
        {s.cover ? (
          <img
            src={sitePhotoUrl({ shop: s.vendor_id })}
            alt=""
            width={800}
            height={450}
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div className="wm-cover-fallback" aria-hidden="true">
            <Crown className="size-16 text-gold" />
          </div>
        )}
      </div>
      <div className="ak-container wm-cover-text">
        <h1 className="wm-name">
          {name}
          {s.branch_label ? ` · ${s.branch_label}` : ""}
        </h1>
        <p className="wm-line1">{[cuisine, village].filter(Boolean).join(" · ")}</p>
        <ul className="wm-facts">
          {s.demo && <li className="ak-chip">{t.common.demo}</li>}
          <li className={`ak-chip ${s.open_now && !s.paused ? "ak-chip-gold" : ""}`}>
            <Clock className="size-3.5" aria-hidden="true" />
            {s.open_now && !s.paused
              ? hours && !/^open 24 hours$/i.test(hours)
                ? fmt(w.openToday, { hours: iso(hours) })
                : t.common.openNow
              : w.closedNow}
          </li>
          {s.delivery && d.delivery.fee_usd != null && (
            <li className="ak-chip">
              <Bike className="size-3.5" aria-hidden="true" />
              <span className="ak-num">
                {fmt(w.fee, { fee: iso(usd(d.delivery.fee_usd)) })} ·{" "}
                {fmt(w.eta, { min: d.delivery.eta_min, max: d.delivery.eta_max })}
              </span>
            </li>
          )}
          {s.min_order_usd != null && (
            <li className="ak-chip">{fmt(w.minOrder, { amount: iso(usd(s.min_order_usd)) })}</li>
          )}
        </ul>
        {place && (
          <p className="wm-place">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span>{fmt(w.deliveringTo, { place })}</span>
            {change && (
              <a href={change} className="wm-place-change">
                {w.change}
              </a>
            )}
          </p>
        )}
      </div>
    </header>
  );
}

/** Sticky section tabs: the section in view is marked, a tap scrolls to its section. */
function SectionTabs({ d }: { d: Ok }) {
  const { t, lang } = useSite();
  const [active, setActive] = useState(0);
  const nav = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = d.sections
      .map((_, k) => document.getElementById(sectionAnchor(k)))
      .filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (es) => {
        const seen = es
          .filter((e) => e.isIntersecting)
          .map((e) => els.indexOf(e.target as HTMLElement));
        if (seen.length) setActive(Math.min(...seen));
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [d.sections]);
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>(`[data-k="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  if (d.sections.length < 2) return null;
  return (
    <nav className="wm-tabs" aria-label={t.webMenu.sections}>
      <div className="wm-tabs-row" ref={nav}>
        {d.sections.map((s, k) => (
          <a
            key={s.id ?? k}
            data-k={k}
            href={`#${sectionAnchor(k)}`}
            className={`wm-tab ${k === active ? "is-on" : ""}`}
            aria-current={k === active ? "true" : undefined}
          >
            {pickName(s, "name", lang) || t.vendor.menu}
          </a>
        ))}
      </div>
    </nav>
  );
}

function ItemRow({
  it,
  lang,
  inCart,
  onOpen,
}: {
  it: WebItem;
  lang: SiteLang;
  inCart: number;
  onOpen: () => void;
}) {
  const { t } = useSite();
  const name = pickName(it, "name", lang);
  // The Arabic name under the title when the page is not in Arabic (spec §2 item 2).
  const ar = lang !== "ar" && it.name_ar && it.name_ar !== name ? it.name_ar : null;
  return (
    <button type="button" className={`wm-row ${it.photo ? "" : "wm-row-text"}`} onClick={onOpen}>
      <span className="wm-row-text-col">
        <span className="wm-row-name">{name}</span>
        {ar && (
          <span className="wm-row-ar" lang="ar">
            {ar}
          </span>
        )}
        {it.description && <span className="wm-row-desc">{it.description}</span>}
        <span className="wm-row-price ak-num">
          {/* A kilo item shows its price per kilo here; the sheet shows what one usually costs. */}
          <bdi>{usd(it.per_kg ? it.price_usd : unitPrice(it, []))}</bdi>
          {it.per_kg && <small> {t.common.perKg}</small>}
        </span>
      </span>
      {it.photo ? (
        <span className="wm-row-img">
          <img
            src={sitePhotoUrl({ item: it.id })}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
          />
          <span className="wm-row-add" aria-hidden="true">
            {inCart > 0 ? <span className="ak-num">{inCart}</span> : <Plus className="size-4" />}
          </span>
        </span>
      ) : (
        <span className="wm-row-add wm-row-add-text" aria-hidden="true">
          {inCart > 0 ? <span className="ak-num">{inCart}</span> : <Plus className="size-4" />}
        </span>
      )}
    </button>
  );
}

function ItemSheet({
  it,
  d,
  lang,
  onClose,
  onAdd,
  onOpenOther,
  canOrder,
  items,
}: {
  it: WebItem;
  d: Ok;
  lang: SiteLang;
  onClose: () => void;
  onAdd: (l: WebLine) => void;
  onOpenOther: (id: string) => void;
  canOrder: boolean;
  items: Map<string, WebItem>;
}) {
  const { t } = useSite();
  const w = t.webMenu;
  // Nothing is chosen for the customer: a required size is picked, never assumed (the Add button asks for it).
  const [opts, setOpts] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const name = pickName(it, "name", lang);
  const ar = lang !== "ar" && it.name_ar && it.name_ar !== name ? it.name_ar : null;
  const unmet = unmetGroups(it, opts);
  const price = unitPrice(it, opts) * qty;
  const allergens = declaredAllergens({ allergens: it.allergens }, t);
  const well = it.goes_well ? items.get(it.goes_well) : undefined;
  const n = it.nutrition;
  return (
    <Sheet label={name} onClose={onClose}>
      {it.photo && (
        <div className="wm-sheet-img">
          <img
            src={sitePhotoUrl({ item: it.id })}
            alt={name}
            width={800}
            height={800}
            decoding="async"
          />
          {it.photo_source === "illustrative" && <span className="wm-illus">{w.illustration}</span>}
        </div>
      )}
      <h2 className="wm-sheet-title">{name}</h2>
      {ar && (
        <p className="wm-row-ar text-base" lang="ar">
          {ar}
        </p>
      )}
      {it.description && <p className="mt-2 text-tone-mute">{it.description}</p>}
      <p className="ak-num mt-2 text-lg font-extrabold">
        <bdi>{usd(it.per_kg ? it.price_usd : unitPrice(it, []))}</bdi>
        {it.per_kg && (
          <small className="text-sm font-medium text-tone-mute"> {t.common.perKg}</small>
        )}
      </p>
      {it.per_kg && it.est_weight_kg && (
        <p className="text-sm text-tone-mute">{fmt(w.perKgNote, { kg: it.est_weight_kg })}</p>
      )}

      {it.groups.map((g) => {
        const gname = pickName(g, "name", lang);
        const single = g.max === 1;
        return (
          <fieldset key={g.id} className="wm-group">
            <legend className="wm-group-head">
              <span className="font-bold">{gname}</span>
              <span className={`ak-chip !py-0.5 ${g.min > 0 ? "ak-chip-gold" : ""}`}>
                {g.min > 0 ? w.required : optionRule(g, t)}
              </span>
            </legend>
            {g.min > 0 && <p className="text-xs text-tone-mute">{optionRule(g, t)}</p>}
            {g.options.map((o) => {
              const on = opts.includes(o.id);
              return (
                <label key={o.id} className={`wm-opt ${on ? "is-on" : ""}`}>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={`g-${g.id}`}
                    checked={on}
                    onChange={() => setOpts((x) => toggleOption(it, x, g, o.id))}
                  />
                  <span className="flex-1">{pickName(o, "name", lang)}</span>
                  {Number(o.price_usd) > 0 && (
                    <span className="ak-num text-sm">
                      <bdi>{fmt(t.item.plus, { price: usd(o.price_usd) })}</bdi>
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <label className="wm-group block">
        <span className="font-bold">{w.note}</span>
        <textarea
          className="wm-note"
          rows={2}
          maxLength={d.note_max || 80}
          placeholder={w.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="text-xs text-tone-mute">{fmt(w.noteHelp, { n: d.note_max || 80 })}</span>
      </label>

      {well && (
        <div className="wm-group">
          <p className="font-bold">{t.item.goesWell}</p>
          <button type="button" className="wm-well" onClick={() => onOpenOther(well.id)}>
            {well.photo && (
              <img
                src={sitePhotoUrl({ item: well.id })}
                alt=""
                width={56}
                height={56}
                loading="lazy"
              />
            )}
            <span className="flex-1 text-start">{pickName(well, "name", lang)}</span>
            <span className="ak-num font-semibold">
              <bdi>{usd(unitPrice(well, []))}</bdi>
            </span>
          </button>
        </div>
      )}

      {allergens && (
        <div className="wm-group">
          <p className="font-bold">{t.item.allergens}</p>
          <p className="text-sm">
            {fmt(t.item.contains, { list: allergens.join(lang === "ar" ? "، " : ", ") })}
          </p>
          <p className="text-xs text-tone-mute">{t.item.declared}</p>
        </div>
      )}
      {n && (
        <div className="wm-group">
          <p className="font-bold">
            {n.status === "merchant_verified" ? t.item.nutritionVerified : t.item.nutrition}
          </p>
          <p className="ak-num text-sm">
            {[
              fmt(t.item.kcalValue, { n: Math.round(n.kcal) }),
              n.protein_g != null
                ? `${t.item.protein} ${fmt(t.item.grams, { n: n.protein_g })}`
                : null,
              n.carbs_g != null ? `${t.item.carbs} ${fmt(t.item.grams, { n: n.carbs_g })}` : null,
              n.fat_g != null ? `${t.item.fat} ${fmt(t.item.grams, { n: n.fat_g })}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-xs text-tone-mute">
            {n.status === "merchant_verified" ? t.item.verifiedNote : t.item.estimatedNote}
          </p>
        </div>
      )}

      <div className="wm-sheet-foot">
        <Stepper value={qty} label={name} min={1} onChange={setQty} />
        <button
          type="button"
          className="ak-btn ak-btn-gold flex-1"
          disabled={unmet.length > 0 || !canOrder}
          onClick={() =>
            onAdd({ item_id: it.id, quantity: qty, option_ids: opts, note: note.trim() || null })
          }
          data-wm="add"
        >
          {!canOrder
            ? w.closedNow
            : unmet.length
              ? fmt(w.choose, { group: pickName(unmet[0]!, "name", lang) })
              : fmt(w.addPrice, { price: usd(price) })}
        </button>
      </div>
    </Sheet>
  );
}

function Stepper({
  value,
  label,
  onChange,
  min = 0,
  removeLabel,
}: {
  value: number;
  label: string;
  onChange: (n: number) => void;
  min?: number;
  removeLabel?: string;
}) {
  const { t } = useSite();
  return (
    <div className="wm-step" role="group" aria-label={`${t.webMenu.quantity}: ${label}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={value === 1 && removeLabel ? removeLabel : t.webMenu.less}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span className="ak-num" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(50, value + 1))}
        disabled={value >= 50}
        aria-label={t.webMenu.more}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A bottom sheet on the native <dialog>: focus stays inside, Escape and the backdrop close it. */
function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useSite();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal?.();
    return () => el?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="wm-sheet"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="wm-sheet-in">
        <button type="button" className="wm-sheet-x" onClick={onClose} aria-label={t.webMenu.close}>
          <X className="size-5" aria-hidden="true" />
        </button>
        {children}
      </div>
    </dialog>
  );
}

/** The page for a link that has expired, or a shop that cannot take this customer's order. */
export function WebMenuGone({ kind }: { kind: "expired" | "unavailable" }) {
  const { t } = useSite();
  const w = t.webMenu;
  const again = waLink(t.wa.menu);
  return (
    <div className="wm wm-gone ak-container">
      <ShoppingBag className="size-10 text-gold" aria-hidden="true" />
      <h1 className="wm-name mt-4">{kind === "expired" ? w.expiredTitle : w.unavailableTitle}</h1>
      <p className="mt-2 text-tone-mute">
        {kind === "expired" ? w.expiredText : w.unavailableText}
      </p>
      {again && (
        <a className="wm-wa mt-6" href={again}>
          <WhatsAppIcon className="size-5 shrink-0" />
          {kind === "expired" ? w.newLink : w.backToChat}
        </a>
      )}
    </div>
  );
}
