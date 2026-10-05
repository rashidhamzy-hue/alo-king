import { Cake, Coffee, Croissant, LayoutGrid, ShoppingBasket, Store, UtensilsCrossed, type LucideIcon } from "lucide-react";

export const CATEGORIES: { value: string | null; en: string; ar: string; icon: LucideIcon }[] = [
  { value: null, en: "All", ar: "الكل", icon: LayoutGrid },
  { value: "Restaurant", en: "Restaurants", ar: "مطاعم", icon: UtensilsCrossed },
  { value: "Cafe", en: "Cafes", ar: "مقاهي", icon: Coffee },
  { value: "Bakery", en: "Bakeries", ar: "أفران", icon: Croissant },
  { value: "Grocery", en: "Groceries", ar: "سمانة", icon: ShoppingBasket },
  { value: "Sweets", en: "Sweets", ar: "حلويات", icon: Cake },
];

export function CategoryIcon({ cat, className }: { cat: string | null | undefined; className?: string }) {
  const I = CATEGORIES.find((c) => c.value && c.value === cat)?.icon ?? Store;
  return <I className={className} aria-hidden />;
}

export const catLabel = (cat: string | null | undefined, lang: "en" | "ar") => {
  const c = CATEGORIES.find((x) => x.value === cat);
  return c ? (lang === "ar" ? c.ar : c.value!) : (cat ?? "");
};
