// Copy parameters of the public site that are not business numbers held in the database. Each has its source.

/** The competitor commission range quoted on the merchant calculator (DECISIONS §37.3: "22-30%"). */
export const COMPETITOR_COMMISSION = { low: 0.22, high: 0.3 } as const;

/** Defaults shown in the merchant savings calculator before the merchant types their own numbers. */
export const CALC_DEFAULTS = { ordersPerMonth: 400, averageTicketUsd: 12 } as const;

/** The first marketing area (DECISIONS §1): the four Shouf villages; their coordinates live in the generated map file. */
export const PILOT_PLACES_NAMES: Record<string, { ar: string; en: string; fr: string }> = {
  "LB-CHF-BAAKLINE": { ar: "بعقلين", en: "Baakline", fr: "Baakline" },
  "LB-CHF-BAKAATA": { ar: "بقعاتا", en: "Bakaata", fr: "Bakaata" },
  "LB-CHF-SEMQANIEH": { ar: "السمقانية", en: "Semqanieh", fr: "Semqanieh" },
  "LB-CHF-BEITEDDINE": { ar: "بيت الدين", en: "Beiteddine", fr: "Beiteddine" },
};

/** The support promise (DECISIONS §30.6): answered within 15 minutes from 09:00 to 23:00 Beirut time, within an hour otherwise. */
export const SUPPORT = {
  fastMinutes: 15,
  fastFrom: "09:00",
  fastTo: "23:00",
  otherwiseMinutes: 60,
} as const;

/** Send Home's two clocks: Beirut and a few cities where many Lebanese live. */
export const DIASPORA_ZONES = [
  { id: "Asia/Dubai", ar: "دبي", en: "Dubai", fr: "Dubaï" },
  { id: "Europe/Paris", ar: "باريس", en: "Paris", fr: "Paris" },
  { id: "America/Montreal", ar: "مونتريال", en: "Montreal", fr: "Montréal" },
  { id: "America/New_York", ar: "نيويورك", en: "New York", fr: "New York" },
  { id: "Australia/Sydney", ar: "سيدني", en: "Sydney", fr: "Sydney" },
] as const;

/** Legal entity line until the company exists (DECISIONS §37.4). */
export const COMPANY_LINE = {
  ar: "ألو كينغ ش.م.م (قيد التأسيس)",
  en: "Alo King SARL (in formation)",
  fr: "Alo King SARL (en cours de constitution)",
} as const;

/** A place or cuisine page is indexed only with this many live merchants (DECISIONS §24.5): thin pages stay out of search. */
export const MIN_MERCHANTS_TO_INDEX = 3;

/**
 * Whether the merchant dashboard's assistant answers (DECISIONS §24.3, §32). The model-backed merchant assistant is ported to
 * the rebuilt system in session 5b; until then the side panel shows its checklist and says so, and never sends to a function
 * that is not deployed. Switch to true when `merchant-ai` joins supabase/functions-deploy.txt.
 */
export const MERCHANT_ASSISTANT_LIVE = false;
