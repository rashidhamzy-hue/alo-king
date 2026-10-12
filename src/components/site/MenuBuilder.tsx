import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { fmt, lbpAt, pickName, usd, type SiteLang } from "@/lib/site";
import type { MenuSection, SiteVendorPage } from "@/lib/site-data";
import { useSite } from "./context";
import { OrderButton } from "./OrderButton";

type Row = { key: string; name: string; price: number };

function Tags({ item }: { item: MenuSection["items"][number] }) {
  const { t } = useSite();
  const v = t.vendor;
  const names = (item.allergens ?? []).map((a) => v.allergenNames[a] ?? a);
  const tags = [
    item.vegan ? v.vegan : item.vegetarian ? v.vegetarian : null,
    item.spicy > 0 ? v.spicy : null,
    item.pork ? v.pork : null,
    item.alcohol ? v.alcohol : null,
  ].filter(Boolean) as string[];
  if (tags.length === 0 && names.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {tags.map((x) => (
        <span key={x} className="ak-chip !px-2 !py-0.5">
          {x}
        </span>
      ))}
      {names.length > 0 && (
        <span className="text-tone-mute">{fmt(v.allergens, { list: names.join(", ") })}</span>
      )}
    </p>
  );
}

/**
 * The shop's menu with a small order builder (DECISIONS §37.4): pick quantities and "Order on WhatsApp" opens the chat with the
 * basket written in. The server prices the real basket in the chat; the prices here are the menu's, in USD and LBP at today's rate.
 */
export function MenuBuilder({ page, canOrder }: { page: SiteVendorPage; canOrder: boolean }) {
  const { t, lang } = useSite();
  const [qty, setQty] = useState<Record<string, number>>({});
  const vendorName = pickName(page.vendor, "name", lang);
  const rate = page.rate;

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    page.sections.forEach((s, si) =>
      s.items.forEach((it, ii) =>
        m.set(`${si}:${ii}`, {
          key: `${si}:${ii}`,
          name: pickName(it, "name", lang as SiteLang),
          price: it.price_usd,
        }),
      ),
    );
    return m;
  }, [page.sections, lang]);

  const chosen = [...rows.values()].filter((r) => (qty[r.key] ?? 0) > 0);
  const count = chosen.reduce((a, r) => a + (qty[r.key] ?? 0), 0);
  const subtotal = chosen.reduce((a, r) => a + (qty[r.key] ?? 0) * r.price, 0);
  const text = chosen.length
    ? fmt(t.wa.vendorItems, {
        vendor: vendorName,
        items: chosen.map((r) => `${qty[r.key]}× ${r.name}`).join(", "),
      })
    : fmt(t.wa.vendor, { vendor: vendorName });
  const set = (key: string, d: number) =>
    setQty((q) => ({ ...q, [key]: Math.max(0, Math.min(20, (q[key] ?? 0) + d)) }));

  return (
    <div>
      {page.sections.map((s, si) => {
        const title = pickName(s, "name", lang) || t.vendor.menu;
        return (
          <section key={si} className="mt-10 first:mt-0" aria-labelledby={`sec-${si}`}>
            <h3 id={`sec-${si}`} className="ak-h3">
              {title}
            </h3>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {s.items.map((it, ii) => {
                const key = `${si}:${ii}`;
                const name = pickName(it, "name", lang);
                const q = qty[key] ?? 0;
                return (
                  <li key={key} className="ak-card flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="font-bold">{name}</p>
                      {it.description && (
                        <p className="mt-1 text-sm text-tone-mute">{it.description}</p>
                      )}
                      <Tags item={it} />
                      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                        <span className="ak-num text-base font-extrabold">
                          <bdi>{usd(it.price_usd)}</bdi>
                          {it.per_kg && (
                            <span className="text-xs font-medium text-tone-mute">
                              {" "}
                              {t.common.perKg}
                            </span>
                          )}
                        </span>
                        {rate ? (
                          <span className="ak-num text-xs text-tone-mute">
                            <bdi>{lbpAt(it.price_usd, rate, lang)}</bdi> {t.common.lbp}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {canOrder && (
                      <div
                        className="flex shrink-0 items-center gap-1.5"
                        role="group"
                        aria-label={name}
                      >
                        {q > 0 && (
                          <>
                            <button
                              type="button"
                              className="grid size-9 place-items-center rounded-full border border-tone-line"
                              onClick={() => set(key, -1)}
                              aria-label={fmt(t.vendor.builder.remove, { item: name })}
                            >
                              <Minus className="size-4" aria-hidden="true" />
                            </button>
                            <span
                              className="ak-num w-6 text-center font-extrabold"
                              aria-live="polite"
                            >
                              {q}
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          className="grid size-9 place-items-center rounded-full bg-gold text-ink"
                          onClick={() => set(key, 1)}
                          aria-label={fmt(t.vendor.builder.add, { item: name })}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {canOrder && (
        <div
          className="tone-night sticky bottom-3 z-30 mt-10 rounded-2xl border border-tone-line p-3 shadow-2xl sm:p-4"
          role="region"
          aria-label={t.vendor.builder.title}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">
                {count === 0
                  ? t.vendor.builder.empty
                  : count === 1
                    ? t.vendor.builder.itemsOne
                    : fmt(t.vendor.builder.items, { n: count })}
              </p>
              {count > 0 && (
                <p className="ak-num text-sm text-tone-mute">
                  {t.vendor.builder.subtotal}: <bdi>{usd(subtotal)}</bdi>
                  {rate ? (
                    <>
                      {" · "}
                      <bdi>{lbpAt(subtotal, rate, lang)}</bdi> {t.common.lbp}
                    </>
                  ) : null}
                </p>
              )}
            </div>
            <OrderButton
              text={text}
              label={count > 0 ? t.vendor.builder.orderWith : t.vendor.builder.orderNow}
              size="md"
            />
          </div>
          {count > 0 && <p className="mt-2 text-xs text-tone-mute">{t.vendor.builder.note}</p>}
        </div>
      )}
    </div>
  );
}
