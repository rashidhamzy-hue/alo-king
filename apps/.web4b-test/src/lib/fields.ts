// The words for a product page's template fields (docs/PRODUCT_DATA_STANDARD.md, "The category templates"), in the three languages of the site.
// The database decides WHICH fields an item has and whether each is approved (web_catalog_product, 0218); this file only words them. The words
// name what is printed or declared ("as printed"): never a judgement about the product (invariant 14). Arabic and French are for a reader to
// confirm (docs/ARABIC_REVIEW.md, LD1).
import type { CatalogField } from "@ak/commerce/index";
import { t, type Lang } from "./i18n";

type L3 = Record<Lang, string>;
const l = (en: string, ar: string, fr: string): L3 => ({ en, ar, fr });

/** A field's label, by its key in `template_fields` (every key of a template's own values; a test keeps the two lists equal). */
export const FIELD_LABELS: Record<string, L3> = {
  pack_count: l("Pack count", "عدد القطع", "Nombre de pièces"), variant: l("Variant", "النوع", "Variante"), origin: l("Country of origin", "بلد المنشأ", "Pays d'origine"),
  serving_size: l("Serving size", "حجم الحصة", "Portion"), caffeine_mg: l("Caffeine per 100 ml", "الكافيين لكل ١٠٠ مل", "Caféine pour 100 ml"),
  age_range: l("Age range as printed", "الفئة العمرية كما هي مكتوبة", "Tranche d'âge imprimée"),
  variety: l("Variety", "الصنف", "Variété"), sale_unit: l("Sold by", "يُباع بـ", "Vendu par"), average_weight_g: l("Average weight of a pack", "الوزن التقريبي للعبوة", "Poids moyen d'un paquet"),
  season: l("Season", "الموسم", "Saison"),
  animal: l("Animal", "الحيوان", "Animal"), cut: l("Cut", "القطعة", "Morceau"), fresh_or_frozen: l("Fresh or frozen", "طازج أو مجمّد", "Frais ou surgelé"),
  weight_per_pack_g: l("Weight per pack", "وزن العبوة", "Poids du paquet"), use_by_days: l("Use by (days)", "الاستهلاك خلال (أيام)", "À consommer sous (jours)"),
  baked_by: l("Baked by", "المخبز", "Boulangerie"), baked_daily: l("Baked daily or packaged", "مخبوز يوميًا أو معبّأ", "Cuit chaque jour ou emballé"),
  best_before_days: l("Best before (days)", "الأفضل قبل (أيام)", "À consommer de préférence avant (jours)"),
  volume_ml: l("Volume", "الحجم", "Volume"), water_type: l("Type", "النوع", "Type"), gallon_exchange: l("Gallon exchange", "استبدال الغالون", "Échange de bonbonne"),
  deposit_usd: l("Deposit", "التأمين", "Consigne"),
  use_surface: l("Use and surface", "الاستخدام والأسطح", "Usage et surfaces"), active_ingredient: l("Active ingredient as printed", "المادة الفعالة كما هي مكتوبة", "Principe actif imprimé"),
  hazard_warnings: l("Hazard warnings as printed", "تحذيرات الخطر كما هي مكتوبة", "Avertissements de danger imprimés"),
  pictograms: l("Hazard pictograms as printed", "رموز الخطر كما هي مكتوبة", "Pictogrammes de danger imprimés"),
  keep_from_children: l("\"Keep away from children\" printed", "عبارة «يُحفظ بعيدًا عن الأطفال» مكتوبة", "« Tenir hors de portée des enfants » imprimé"),
  scent: l("Scent", "الرائحة", "Parfum"), dilution: l("Dilution", "التخفيف", "Dilution"), count: l("Count", "العدد", "Nombre"),
  inci_ingredients: l("Ingredients as printed (INCI list)", "المكوّنات كما هي مكتوبة (قائمة INCI)", "Ingrédients imprimés (liste INCI)"),
  hair_skin_type: l("Hair or skin type", "نوع الشعر أو البشرة", "Type de cheveux ou de peau"), age_group: l("Age", "الفئة العمرية", "Âge"),
  period_after_opening: l("Period after opening (months)", "مدة الاستخدام بعد الفتح (أشهر)", "Durée après ouverture (mois)"),
  size_weight_range: l("Nappy size and weight range", "مقاس الحفاض ومدى الوزن", "Taille de couche et plage de poids"),
  species: l("Species", "نوع الحيوان", "Espèce"), life_stage: l("Life stage", "المرحلة العمرية", "Stade de vie"), pet_weight_range: l("Pet weight range", "وزن الحيوان", "Poids de l'animal"),
  pet_ingredients: l("Ingredients as printed", "المكوّنات كما هي مكتوبة", "Ingrédients imprimés"),
  analytical_constituents: l("Analytical constituents as printed", "المكوّنات التحليلية كما هي مكتوبة", "Constituants analytiques imprimés"),
  pack_weight_g: l("Pack weight", "وزن العبوة", "Poids du paquet"),
  cylinder_size: l("Cylinder size", "حجم الأسطوانة", "Taille de la bouteille"), exchange_or_new: l("Exchange or new", "استبدال أو جديدة", "Échange ou neuve"),
  rider_safety_rules: l("Safety rules for the rider", "قواعد السلامة للمندوب", "Règles de sécurité pour le livreur"),
};

/** The words of the values a field can take (an enum's values, hazard pictograms, certificate kinds). Free text is shown as printed. */
export const VALUE_WORDS: Record<string, L3> = {
  beef: l("Beef", "بقر", "Bœuf"), lamb: l("Lamb", "غنم", "Agneau"), chicken: l("Chicken", "دجاج", "Poulet"), turkey: l("Turkey", "ديك رومي", "Dinde"),
  veal: l("Veal", "عجل", "Veau"), goat: l("Goat", "ماعز", "Chèvre"), fish: l("Fish", "سمك", "Poisson"), other: l("Other", "آخر", "Autre"),
  fresh: l("Fresh", "طازج", "Frais"), frozen: l("Frozen", "مجمّد", "Surgelé"), daily: l("Baked daily", "مخبوز يوميًا", "Cuit chaque jour"), packaged: l("Packaged", "معبّأ", "Emballé"),
  kg: l("By the kilo", "بالكيلو", "Au kilo"), pack: l("By the pack", "بالعبوة", "Au paquet"), bunch: l("By the bunch", "بالربطة", "À la botte"), piece: l("By the piece", "بالحبّة", "À la pièce"),
  mineral: l("Mineral", "معدنية", "Minérale"), drinking: l("Drinking", "للشرب", "De table"), sparkling: l("Sparkling", "فوّارة", "Gazeuse"),
  adult: l("Adult", "للكبار", "Adulte"), kids: l("Kids", "للأطفال", "Enfants"), baby: l("Baby", "للرضّع", "Bébé"), all: l("All", "للجميع", "Tous"),
  cat: l("Cat", "قطة", "Chat"), dog: l("Dog", "كلب", "Chien"), bird: l("Bird", "طيور", "Oiseau"), small_animal: l("Small animal", "حيوان صغير", "Petit animal"),
  young: l("Young", "صغير", "Jeune"), senior: l("Senior", "متقدّم في العمر", "Senior"), not_food: l("Not a food", "ليس طعامًا", "Pas un aliment"),
  exchange: l("Exchange", "استبدال", "Échange"), new: l("New", "جديدة", "Neuve"),
  corrosive: l("Corrosive", "مُسبّب للتآكل", "Corrosif"), flammable: l("Flammable", "قابل للاشتعال", "Inflammable"), irritant: l("Irritant", "مُهيّج", "Irritant"),
  toxic: l("Toxic", "سام", "Toxique"), environment: l("Hazardous to the environment", "خطر على البيئة", "Dangereux pour l'environnement"), oxidising: l("Oxidising", "مؤكسد", "Comburant"),
  gas_under_pressure: l("Gas under pressure", "غاز مضغوط", "Gaz sous pression"), health_hazard: l("Health hazard", "خطر على الصحة", "Danger pour la santé"), explosive: l("Explosive", "متفجر", "Explosif"),
  halal: l("Halal", "حلال", "Halal"), organic: l("Organic", "عضوي", "Bio"), iso_22000: l("ISO 22000", "ISO 22000", "ISO 22000"), haccp: l("HACCP", "HACCP", "HACCP"),
  kosher: l("Kosher", "كوشر", "Casher"), other_certificate: l("Other certificate", "شهادة أخرى", "Autre certificat"),
};

const UNITS: Record<string, L3> = {
  g: l("g", "غ", "g"), ml: l("ml", "مل", "ml"), kg: l("kg", "كغ", "kg"), mg: l("mg", "ملغ", "mg"), months: l("months", "أشهر", "mois"), days: l("days", "أيام", "jours"), C: l("°C", "°م", "°C"),
};

/** The nutrient rows of a panel, in the order a label prints them. `key` is the key of `CatalogNutrition`; `unit` is what the number is in. */
export const NUTRIENTS: { key: string; unit: string; label: L3 }[] = [
  { key: "energy_kcal", unit: "kcal", label: l("Energy", "الطاقة", "Énergie") }, { key: "fat_g", unit: "g", label: l("Fat", "الدهون", "Matières grasses") },
  { key: "saturated_fat_g", unit: "g", label: l("of which saturates", "منها دهون مشبعة", "dont acides gras saturés") },
  { key: "carbohydrate_g", unit: "g", label: l("Carbohydrate", "الكربوهيدرات", "Glucides") }, { key: "sugars_g", unit: "g", label: l("of which sugars", "منها سكريات", "dont sucres") },
  { key: "added_sugars_g", unit: "g", label: l("of which added sugars", "منها سكريات مضافة", "dont sucres ajoutés") },
  { key: "protein_g", unit: "g", label: l("Protein", "البروتين", "Protéines") }, { key: "fibre_g", unit: "g", label: l("Fibre", "الألياف", "Fibres") },
  { key: "salt_g", unit: "g", label: l("Salt", "الملح", "Sel") },
];

const word = (lang: Lang, v: string): string => VALUE_WORDS[v]?.[lang] ?? v.replace(/_/g, " ");
const plain = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** A field's value as the page prints it, or null when there is nothing to print. */
export function fieldText(lang: Lang, f: Pick<CatalogField, "type" | "unit" | "value">): string | null {
  const v = f.value;
  if (v === null || v === undefined) return null;
  const unit = f.unit ? (f.unit === "USD" ? "" : ` ${UNITS[f.unit]?.[lang] ?? f.unit}`) : "";
  const sep = lang === "ar" ? "، " : ", ";
  let out: string | null = null;
  if (f.type === "boolean") out = v === true ? t(lang, "yes") : v === false ? t(lang, "no") : null;
  else if (f.type === "number") { const n = Number(v); out = Number.isFinite(n) ? (f.unit === "USD" ? `$${n.toFixed(2)}` : `${n}${unit}`) : null; }
  else if (f.type === "range" && typeof v === "object" && v !== null && !Array.isArray(v)) {
    const r = v as { from_months?: number | null; to_months?: number | null };
    const a = r.from_months ?? null; const b = r.to_months ?? null;
    out = a !== null && b !== null ? `${a}–${b} ${UNITS.months![lang]}` : a !== null ? `${a}+ ${UNITS.months![lang]}` : b !== null ? `≤ ${b} ${UNITS.months![lang]}` : null;
  } else if (Array.isArray(v)) out = v.map((x) => (typeof x === "string" ? (VALUE_WORDS[x] ? word(lang, x) : x) : plain(x))).filter(Boolean).join(sep) || null;
  else if (f.type === "enum") out = typeof v === "string" ? word(lang, v) : null;
  else out = plain(v) || null;
  return out && out.trim() ? out.trim() : null;
}

export const unitWord = (lang: Lang, unit: string): string => UNITS[unit]?.[lang] ?? unit;
export const certificateWord = (lang: Lang, kind: string): string => (kind === "other" ? VALUE_WORDS.other_certificate![lang] : word(lang, kind));
