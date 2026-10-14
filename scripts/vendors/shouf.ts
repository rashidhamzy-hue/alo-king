// The Shouf pilot vendor file (DECISIONS §38.1–38.2): 315 merchants in 12 villages, in
// supabase/seed/shouf/source/01_shouf_merchants_315.csv. This adapts the file to the §15.2 normaliser
// (normalize.ts) and adds the Shouf rules:
// - the 57 names that mix scripts are split into name_ar and name_en (the file's name_en column carries
//   both; its name_ar column carries the Arabic part);
// - every merchant gets one of the 12 pilot villages: the file's locality, else one named in the address
//   (the 11 rows whose locality is a neighbouring place or a typo);
// - the WhatsApp-candidate flag comes from the number (a Lebanese mobile), never from the file's column;
// - opening hours from the file are kept internal, as a seed hint for the merchant to confirm.
// Ratings and review counts are not in the file and are never read (§15.2).
import {
  normalizeVendors,
  normalizePhone,
  parseCsv,
  type RawVendor,
  type VendorRow,
} from "./normalize.ts";

export const SHOUF_SOURCE = "seed_shouf_2026_10";

/** The 12 pilot villages (§38.1) and their place ids in the all-Lebanon list (§16). */
export const PILOT_VILLAGES: Record<string, string> = {
  Baakleen: "LB-CHF-BAAKLINE",
  Boqaata: "LB-CHF-BAKAATA",
  Barouk: "LB-CHF-BAROUK",
  "Deir El Qamar": "LB-CHF-DEIR-AL-QAMAR",
  Samqaniyeh: "LB-CHF-SEMQANIEH",
  Batloun: "LB-CHF-BATLOUN",
  "Kfar Nabrakh": "LB-CHF-KFAR-NABRAKH",
  "Kfar Him": "LB-CHF-KFARHIM",
  Dmit: "LB-CHF-DAMIT",
  "Ain w Zain": "LB-CHF-AIN-OUZAIN",
  "Maaser El Chouf": "LB-CHF-MAASSER-EL-SHOUF",
  Jdeideh: "LB-CHF-JDEIDET-EL-CHOUF",
};

// Spellings of the pilot villages seen in addresses (English, Arabizi and Arabic), checked in this order.
const ADDRESS_SPELLINGS: [RegExp, string][] = [
  [/\b(baakl[ei]{1,2}ne?|ba3klin|bakl[ei]{1,2}ne?)\b|بعقلين/i, "Baakleen"],
  [/\b(boqaata|bakaata|bq[a3]{1,2}ta|baqaata)\b|بقعاتا/i, "Boqaata"],
  [/\b(samqaniyeh|semqanieh|samqanieh|smaqanieh)\b|السمقانية|سمقانية/i, "Samqaniyeh"],
  [/\bdeir (el|al) ?qamar\b|دير القمر/i, "Deir El Qamar"],
  [/\b(ain ?w ?zain|ain ?wzain|ain ouzain)\b|عين وزين/i, "Ain w Zain"],
  [/\bbatloun\b|بتلون/i, "Batloun"],
  [/\bkfar ?nabrakh\b|كفرنبرخ|كفر نبرخ/i, "Kfar Nabrakh"],
  [/\bkfar ?him\b|كفرحيم|كفر حيم/i, "Kfar Him"],
  [/\b(dmit|damit)\b|دميت/i, "Dmit"],
  [/\bma'?a?ss?er (el|al) ?(chouf|shouf)\b|معاصر الشوف/i, "Maaser El Chouf"],
  [/\bjdeid(eh|et)\b|جديدة الشوف/i, "Jdeideh"],
  // "Barouk Rd" in Beit ed-Dine is a road, not the village.
  [/\bbarouk\b(?!\s*(rd|road|st|street|highway)\b)|الباروك/i, "Barouk"],
];

const ARABIC_CHARS = /[؀-ۿ]/g;
const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const LATIN = /[A-Za-zÀ-ɏ]/;
// A Latin leftover made only of these is a label, not a name ("أبو فؤاد market", "mr فروج").
const GENERIC_LATIN = new Set([
  "mr",
  "mrs",
  "market",
  "shop",
  "store",
  "cafe",
  "snack",
  "restaurant",
  "resto",
  "the",
]);

/** Name in two scripts: the Arabic from name_ar, the Latin part of name_en without the Arabic. */
export function shoufNames(
  nameEn: string,
  nameAr: string,
): { ar: string | null; en: string | null } {
  const ar = nameAr.replace(/\s+/g, " ").trim() || null;
  const raw = nameEn.replace(BIDI_MARKS, "").replace(/\s+/g, " ").trim();
  if (!ar) {
    if (LATIN.test(raw)) return { ar: null, en: raw || null };
    return { ar: raw || null, en: null };
  }
  const en = raw
    .split(ar)
    .join(" ")
    .replace(ARABIC_CHARS, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/[\s،]+/g, " ")
    .replace(/^[\s\-–—|/:.,]+|[\s\-–—|/:.,]+$/g, "")
    .trim();
  const words = en.toLowerCase().split(/\s+/).filter(Boolean);
  if (!LATIN.test(en) || words.every((w) => GENERIC_LATIN.has(w))) return { ar, en: null };
  return { ar, en };
}

/** One of the 12 pilot villages: the locality when it is one, else the first village the address names. */
export function pilotVillage(locality: string, address: string): string | null {
  const l = locality.trim();
  if (PILOT_VILLAGES[l]) return l;
  for (const [re, v] of ADDRESS_SPELLINGS) if (re.test(address) || re.test(l)) return v;
  return null;
}

export type ShoufRow = VendorRow & {
  town_id: string | null;
  village: string | null;
  locality_raw: string;
};

const FOOD_CATEGORIES = new Set(["restaurant", "cafe", "bakery", "grocery", "butcher", "desserts"]);

/**
 * `duplicates` (duplicate place id → kept place id, from the owner's menu file, §39.4): one shop listed twice. The
 * duplicate row is not imported (an exclusion "duplicate of <kept>", which the load also uses to remove an unclaimed
 * duplicate already in the database), and the kept row takes the Arabic name when it has none.
 */
export function normalizeShouf(rawRows: RawVendor[], duplicates: Map<string, string> = new Map()) {
  const all = new Map(rawRows.map((r) => [r.place_id, r]));
  const rows = rawRows
    .filter((r) => !duplicates.has(r.place_id))
    .map((r) => {
      const dup = [...duplicates].find(([, keep]) => keep === r.place_id)?.[0];
      const d = dup ? all.get(dup) : undefined;
      if (!d || (r.name_ar ?? "").trim()) return r;
      const ar = [d.name_ar, d.name_en].map((x) => (x ?? "").trim()).find((x) => /[؀-ۿ]/.test(x));
      return ar ? { ...r, name_ar: ar } : r;
    });
  const merged = [...duplicates]
    .filter(([dup, keep]) => all.has(dup) && all.has(keep))
    .map(([dup, keep]) => ({
      place_id: dup,
      name: (all.get(dup)!.name_en || all.get(dup)!.name_ar || "").trim(),
      reason: `duplicate of ${keep}`,
    }));
  const byId = new Map(rows.map((r) => [r.place_id, r]));
  const adapt = (r: RawVendor, keepGoogleType: boolean): RawVendor => {
    const n = shoufNames(r.name_en ?? "", r.name_ar ?? "");
    return {
      place_id: r.place_id,
      // " | " is the normaliser's script separator; one name passes through unchanged.
      name: [n.ar, n.en].filter(Boolean).join(" | "),
      alo_king_category:
        r.alo_king_category === "desserts" ? "sweets" : (r.alo_king_category ?? ""),
      google_primary_type: keepGoogleType
        ? (r.google_primary_type ?? "").toLowerCase().replace(/\s+/g, "_")
        : "",
      region_code: "CHOUF",
      address: r.address ?? "",
      phone_raw: r.phone_raw ?? "",
      // The number decides (§38.2): the file's is_whatsapp_candidate column is never read.
      phone_e164: r.phone_e164 ?? "",
      website_or_menu_link: r.website_or_menu_link ?? "",
      latitude: r.latitude ?? "",
      longitude: r.longitude ?? "",
    };
  };
  // §38.1 imports all 315: a row the §15.2 rules would drop for its Google type (a "Bar" or "Pub" that the
  // file files as a restaurant) is classified by the file's category instead.
  const first = normalizeVendors(rows.map((r) => adapt(r, true)));
  const retry = new Set(
    first.exclusions
      .filter((e) => FOOD_CATEGORIES.has(byId.get(e.place_id)?.alo_king_category ?? ""))
      .map((e) => e.place_id),
  );
  const result = retry.size
    ? normalizeVendors(rows.map((r) => adapt(r, !retry.has(r.place_id))))
    : first;
  // One number on two listings within 100 m is one shop listed twice ("Shawarma Albasha" / "Al Basha"),
  // not a data error: both keep the number (one claim covers it; the duplicate is in DATA-ISSUES.md).
  const byPlace = new Map(result.vendors.map((v) => [v.place_id, v]));
  for (const issue of result.phoneIssues) {
    if (issue.resolution !== "data error: phone dropped") continue;
    const group = issue.place_ids.map((id) => byPlace.get(id)!);
    const [a] = group;
    if (group.every((g) => metres(a, g) <= 100)) {
      for (const g of group) {
        g.phone_seed = issue.phone;
        g.phone_seed_mobile = normalizePhone(issue.phone)?.mobile ?? false;
      }
      issue.resolution = "one shop listed twice: phone kept";
    }
  }
  const vendors: ShoufRow[] = result.vendors.map((v) => {
    const src = byId.get(v.place_id)!;
    const village = pilotVillage(src.locality_raw ?? "", src.address ?? "");
    const n = shoufNames(src.name_en ?? "", src.name_ar ?? "");
    const labels: Record<string, string> = { ...v.import_labels };
    labels.alo_king_category = src.alo_king_category ?? "";
    if (src.google_primary_type) labels.google_primary_type = src.google_primary_type;
    if ((src.opening_hours ?? "").trim())
      labels.hours_seed = src.opening_hours.replace(/\u202f/g, " ").trim();
    if (village && village !== (src.locality_raw ?? "").trim())
      labels.locality_backfilled_from = src.locality_raw ?? "";
    return {
      ...v,
      // The split above is exact for this file; the normaliser's own split would keep a branch label.
      name_ar: n.ar,
      name_en: n.en,
      branch_label: null,
      import_labels: labels,
      town_id: village ? PILOT_VILLAGES[village] : null,
      village,
      locality_raw: src.locality_raw ?? "",
    };
  });
  return { ...result, vendors, exclusions: [...result.exclusions, ...merged] };
}

function metres(a: VendorRow, b: VendorRow): number {
  if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) return Infinity;
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** File column versus the number: how often the file's WhatsApp flag disagrees with the number. */
export function whatsappDisagreements(rows: RawVendor[]): number {
  return rows.filter((r) => {
    const p = normalizePhone(r.phone_e164 || r.phone_raw || "");
    return (r.is_whatsapp_candidate === "True") !== Boolean(p?.mobile);
  }).length;
}

export { parseCsv };
