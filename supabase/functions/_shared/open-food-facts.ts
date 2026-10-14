// Open Food Facts by barcode for groceries (DECISIONS §39.5): on demand, when a merchant scans or types a product's
// barcode, never a bulk download. Results are cached in `public.off_products` (their own table, with the ODbL
// attribution, so the share-alike stays contained to it) and shown as "estimated" until the merchant confirms
// (§32.3 evidence rule). No health claims beyond allergens and estimated calories.
// Pure functions plus one fetch with a deadline (Deno and Node).

/** EU-14 allergens (our `public.allergen` enum) from Open Food Facts allergen tags ("en:milk", "en:gluten"…). */
const OFF_ALLERGENS: Record<string, string> = {
  "en:gluten": "gluten",
  "en:crustaceans": "shellfish",
  "en:eggs": "eggs",
  "en:fish": "fish",
  "en:peanuts": "peanuts",
  "en:soybeans": "soy",
  "en:milk": "dairy",
  "en:nuts": "nuts",
  "en:celery": "celery",
  "en:mustard": "mustard",
  "en:sesame-seeds": "sesame",
  "en:sulphur-dioxide-and-sulphites": "sulphites",
  "en:lupin": "lupin",
  "en:molluscs": "molluscs",
};

export type OffProduct = {
  barcode: string;
  found: boolean;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  allergens: string[];
  ingredients_text: string | null;
  nutriscore_grade: string | null;
  energy_kcal_100g: number | null;
  image_url: string | null;
};

/** A GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN) or GTIN-14 with a valid check digit; Arabic digits and spaces allowed. */
export function normalizeGtin(raw: string): string | null {
  const s = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return null;
  const digits = s.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? s : null;
}

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

/** The OFF API v2 answer → our cached shape. `status: 0` (not found) keeps a "not found" row so we do not ask again. */
export function normalizeOff(barcode: string, json: unknown): OffProduct {
  const j = (json ?? {}) as Record<string, any>;
  const p = (j.product ?? {}) as Record<string, any>;
  const found = j.status === 1 && !!j.product;
  const kcal = Number(p.nutriments?.["energy-kcal_100g"]);
  const grade = text(p.nutriscore_grade, 1)?.toLowerCase() ?? null;
  const image = text(p.image_front_url ?? p.image_url, 500);
  return {
    barcode,
    found,
    name: text(p.product_name_ar, 160) ?? text(p.product_name_en, 160) ?? text(p.product_name, 160),
    brand: text(String(p.brands ?? "").split(",")[0], 80),
    quantity: text(p.quantity, 40),
    allergens: [
      ...new Set(
        (Array.isArray(p.allergens_tags) ? p.allergens_tags : [])
          .map((t: string) => OFF_ALLERGENS[t])
          .filter(Boolean),
      ),
    ] as string[],
    ingredients_text: text(p.ingredients_text_en ?? p.ingredients_text, 2000),
    nutriscore_grade: grade && /^[a-e]$/.test(grade) ? grade : null,
    energy_kcal_100g: Number.isFinite(kcal) && kcal >= 0 && kcal < 1000 ? Math.round(kcal) : null,
    image_url: image && /^https:\/\/[a-z0-9.-]*openfoodfacts\.org\//.test(image) ? image : null,
  };
}

export const OFF_FIELDS =
  "product_name,product_name_ar,product_name_en,brands,quantity,allergens_tags,ingredients_text,ingredients_text_en,nutriscore_grade,nutriments,image_front_url";

/** One product from the OFF API, with a deadline; throws on a network error or a server error. */
export async function fetchOff(
  barcode: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number; baseUrl?: string } = {},
): Promise<OffProduct> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(
    `${opts.baseUrl ?? "https://world.openfoodfacts.org"}/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`,
    {
      // OFF asks every app to name itself in the User-Agent.
      headers: {
        "user-agent": "AloKing/1.0 (https://github.com/rashidhamzy-hue/alo-king)",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    },
  );
  if (res.status === 404) return normalizeOff(barcode, { status: 0 });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`open food facts returned ${res.status}`);
  }
  return normalizeOff(barcode, await res.json());
}

/** Cache first (rpc `off_product_get`), then OFF, then the cache is written (`off_product_put`). */
export async function lookupProduct(
  barcode: string,
  deps: { rpc: (fn: string, args: Record<string, unknown>) => Promise<any>; fetch?: typeof fetch },
): Promise<OffProduct | null> {
  const cached = await deps.rpc("off_product_get", { p_barcode: barcode });
  if (cached?.barcode) return cached as OffProduct;
  let p: OffProduct;
  try {
    p = await fetchOff(barcode, { fetch: deps.fetch });
  } catch {
    return null;
  }
  await deps.rpc("off_product_put", { p_product: p });
  return p;
}

const ALLERGEN_AR: Record<string, string> = {
  gluten: "غلوتين",
  shellfish: "قشريات",
  eggs: "بيض",
  fish: "سمك",
  peanuts: "فول سوداني",
  soy: "صويا",
  dairy: "حليب",
  nuts: "مكسرات",
  celery: "كرفس",
  mustard: "خردل",
  sesame: "سمسم",
  sulphites: "كبريتيت",
  lupin: "ترمس",
  molluscs: "رخويات",
};

/** The merchant's card for a scanned barcode: what Open Food Facts says, marked estimated, with the attribution. */
export function productCardText(p: OffProduct | null, barcode: string): string {
  if (!p)
    return `📦 ${barcode}\nما قدرنا نوصل لـ Open Food Facts هلق. جرّب بعد شوي. / Open Food Facts is not reachable now; try again later.`;
  if (!p.found)
    return `📦 ${barcode}\nهالباركود مش موجود على Open Food Facts. / This barcode is not on Open Food Facts.`;
  const lines = [
    `📦 ${[p.name, p.brand, p.quantity].filter(Boolean).join(" · ") || barcode}`,
    p.allergens.length
      ? `⚠️ مسببات حساسية (تقديرية) / Allergens (estimated): ${p.allergens.map((a) => `${ALLERGEN_AR[a] ?? a} ${a}`).join(", ")}`
      : "⚠️ ما في مسببات حساسية مذكورة (تقديري) / No allergens listed (estimated)",
    ...(p.energy_kcal_100g !== null
      ? [`🔥 ~${p.energy_kcal_100g} kcal / 100 g (تقديري / estimated)`]
      : []),
    ...(p.nutriscore_grade ? [`Nutri-Score ${p.nutriscore_grade.toUpperCase()}`] : []),
    "المصدر: Open Food Facts (ODbL). تقديري لحد ما تأكّد. / Source: Open Food Facts (ODbL), estimated until you confirm.",
  ];
  return lines.join("\n");
}
