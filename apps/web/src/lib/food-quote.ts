// WEB4b: a food basket's lines, worded and priced as the database quoted them (web_food_quote, 0251). The names of a dish and of its
// options are the menu's, in the page's language; the line's total and unit price are the quote's. A line the quote could not price (a
// dish gone from the menu) shows no amount, and the quote's issue says why.
import { nameIn, type Lang } from "./i18n";
import type { FoodBasket } from "./food-basket";
import { orderHref } from "./food";
import type { BasketLineView } from "../components/ref/Food";

export function pricedLines(l: Lang, b: FoodBasket, menu: any, quote: any): (BasketLineView & { productId: string })[] {
  const dishes: any[] = menu?.dishes ?? [];
  const used = new Set<number>();
  const qlines: any[] = quote?.lines ?? [];
  const sep = l === "ar" ? "، " : ", ";
  return b.lines.map((line, index) => {
    const dish = dishes.find((d) => d.product_id === line.product_id);
    const optName = (id: string) => {
      for (const g of dish?.groups ?? []) for (const o of g.options ?? []) if (o.id === id) return nameIn(l, o.name_en, o.name_ar);
      return null;
    };
    const want = [...line.options].sort().join();
    let qi = qlines.findIndex((q, i) => !used.has(i) && q.product_id === line.product_id && (q.options ?? []).map((o: any) => o.id).sort().join() === want);
    if (qi < 0) qi = qlines.findIndex((q, i) => !used.has(i) && q.product_id === line.product_id);
    if (qi >= 0) used.add(qi);
    const q = qi >= 0 ? qlines[qi] : null;
    const priced = q && q.ok !== false && !q.coming_soon;
    return {
      index, productId: line.product_id,
      name: dish ? nameIn(l, dish.name_en, dish.name_ar) : q ? nameIn(l, q.name, q.name_ar) : "—",
      options: line.options.map(optName).filter(Boolean).join(sep),
      qty: line.qty, total: priced ? Number(q.line_total_usd) : null, unit: priced ? Number(q.unit_price_usd) : null,
      dishHref: `${orderHref(b.place)}#dish-${line.product_id}`,
    };
  });
}
