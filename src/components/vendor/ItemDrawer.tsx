import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { lbp, usd } from "@/lib/format";
import { ALLERGEN_LABEL, clean, waLink, type MenuItem } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { ItemBadges, MacroChip, itemName } from "./ItemBits";

export function ItemDrawer({ item, vendorName, onClose }: { item: MenuItem | null; vendorName: string; onClose: () => void }) {
  const { lang } = useLang();
  const L = useL();
  const i = item;
  const rows: [string, string, number | null | undefined, string][] = i
    ? [
        ["Calories", "سعرات", i.calories, "kcal"],
        ["Protein", "بروتين", i.protein_grams, "g"],
        ["Carbs", "كربوهيدرات", i.carbs_grams, "g"],
        ["Fat", "دهون", i.fat_grams, "g"],
        ["Saturated fat", "دهون مشبعة", i.saturated_fat_g, "g"],
        ["Sugar", "سكر", i.sugar_grams, "g"],
        ["Fiber", "ألياف", i.fiber_g, "g"],
        ["Sodium", "صوديوم", i.sodium_mg, "mg"],
      ]
    : [];
  const shownRows = rows.filter((r) => r[2] != null);
  return (
    <Sheet open={!!i} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl sm:mx-auto sm:max-w-2xl">
        {i && (
          <>
            {clean(i.image_url) && <img src={i.image_url!} alt="" className="-mx-6 -mt-6 mb-4 h-56 w-[calc(100%+3rem)] max-w-none object-cover" />}
            <SheetHeader className="p-0 text-start">
              <SheetTitle className="text-2xl">{itemName(i, lang)}</SheetTitle>
              {clean(lang === "ar" ? i.item_name_en : i.item_name_ar) && <p className="text-sm text-muted-foreground">{lang === "ar" ? i.item_name_en : i.item_name_ar}</p>}
            </SheetHeader>
            <div className="mt-3 space-y-5 pb-4">
              {i.price_usd != null && <p><span className="text-xl font-semibold text-gold">{usd(i.price_usd)}</span> <span className="text-sm text-muted-foreground">{lbp(i.price_usd)}</span></p>}
              <ItemBadges i={i} />
              {(clean(i.description_en) || clean(i.description_ar)) && (
                <p className="text-sm leading-relaxed text-muted-foreground">{lang === "ar" ? clean(i.description_ar) || i.description_en : clean(i.description_en) || i.description_ar}</p>
              )}
              {!!i.ingredients?.length && (
                <div>
                  <h4 className="mb-1 text-sm font-semibold">{L("Ingredients", "المكونات")}</h4>
                  <p className="text-sm text-muted-foreground">{i.ingredients.join(", ")}</p>
                </div>
              )}
              {shownRows.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">{L("Nutrition", "القيم الغذائية")}</h4>
                    <MacroChip i={i} />
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {shownRows.map(([en, ar, v, u]) => (
                        <tr key={en} className="border-b border-border/50">
                          <td className="py-1.5 text-muted-foreground">{L(en, ar)}</td>
                          <td className="py-1.5 text-end">{Math.round(v!)} {u}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {i.portion_grams && <p className="mt-1 text-xs text-muted-foreground">{L("Per portion", "لكل حصة")} ~{i.portion_grams}g</p>}
                </div>
              )}
              <div>
                <h4 className="mb-1 text-sm font-semibold">{L("Allergens", "مسببات الحساسية")}</h4>
                {i.allergen_list?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {i.allergen_list.map((a) => <span key={a} className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">{L(...(ALLERGEN_LABEL[a] ?? [a, a]))}</span>)}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{L("None listed", "لا شيء مذكور")}</p>
                )}
                {!i.allergens_reviewed && <p className="mt-1 text-xs text-warning">{L("Allergen info not yet confirmed by the restaurant.", "معلومات الحساسية مش مؤكدة من المطعم بعد.")}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{L("Ask the restaurant if you have a serious allergy.", "اسأل المطعم إذا عندك حساسية قوية.")}</p>
              </div>
              {!!i.customizations?.length && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">{L("Options", "الخيارات")}</h4>
                  {i.customizations.map((g) => (
                    <div key={g.name} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium">
                        {g.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          {g.required ? L("Required", "إلزامي") : L("Optional", "اختياري")}
                          {g.max ? ` · ${L("up to", "حتى")} ${g.max}` : ""}
                        </span>
                      </p>
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {g.options?.map((o) => (
                          <li key={o.name} className="flex justify-between"><span>{o.name}</span>{!!o.price_delta_usd && <span>+{usd(o.price_delta_usd)}</span>}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="gold" size="lg" className="w-full" asChild>
                <a href={waLink(`Hi Alo King, I'd like to order "${itemName(i, "en")}" from ${vendorName}`)} target="_blank" rel="noreferrer">
                  <MessageCircle /> {L("Order this on WhatsApp", "اطلبها على واتساب")}
                </a>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
