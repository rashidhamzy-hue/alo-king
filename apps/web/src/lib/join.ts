// The two join pages' helpers (session UX3): what a form post says, made safe; the words for a shift or a vehicle; and the answers the database can give, in words.
// The pages ask the database for everything they show (web_join_options) and send it only what the visitor typed; the party always comes from the confirmed session.
import type { JoinApplied, JoinOptions, RiderApplication, VendorApplication } from "@ak/commerce/index";
import { DICTS, t, type Key, type Lang } from "./i18n";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const one = (form: FormData, k: string, max: number) => String(form.get(k) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const many = (form: FormData, k: string) => form.getAll(k).map((x) => String(x).slice(0, 20));

export interface RiderValues { name: string; village: string; vehicle: string; licence: string; days: string[]; shifts: string[] }
export interface VendorValues { name: string; kind: string; village: string; listing: string }
export const riderValues = (f: FormData): RiderValues => ({ name: one(f, "name", 80), village: one(f, "village", 60), vehicle: one(f, "vehicle", 20), licence: one(f, "licence", 3), days: many(f, "days"), shifts: many(f, "shifts") });
export const vendorValues = (f: FormData): VendorValues => ({ name: one(f, "name", 80), kind: one(f, "kind", 30), village: one(f, "village", 60), listing: one(f, "listing", 120) });

/** What is missing from a rider's form, as the key of the sentence that says so; null when it can be sent. (The database checks again.) */
export function riderProblem(v: RiderValues, o: JoinOptions): Key | null {
  if (!v.name) return "join_err_name";
  if (!v.village) return "join_err_village";
  if (!o.vehicles.includes(v.vehicle)) return "join_err_vehicle";
  if (v.licence !== "yes" && v.licence !== "no") return "join_err_licence";
  if (v.days.length === 0 || v.shifts.length === 0) return "join_err_hours";
  return null;
}
export function vendorProblem(v: VendorValues, o: JoinOptions): Key | null {
  if (!v.name) return "vend_err_name";
  if (!o.vendor_kinds.includes(v.kind)) return "vend_err_kind";
  return null;
}
export const riderApplication = (v: RiderValues): RiderApplication => ({ name: v.name, village: v.village, vehicle: v.vehicle, licence: v.licence === "yes", days: v.days, shifts: v.shifts });
export const vendorApplication = (v: VendorValues): VendorApplication => ({ name: v.name, kind: v.kind, village: v.village, listing: v.listing || null });

/** The database's refusal, in words (the checks above catch most before the call). */
export function refusal(r: Extract<JoinApplied, { ok: false }>): Key {
  switch (r.error) {
    case "bad_name": return "join_err_name";
    case "bad_village": return "join_err_village";
    case "bad_vehicle": return "join_err_vehicle";
    case "bad_licence": return "join_err_licence";
    case "bad_hours": return "join_err_hours";
    case "bad_kind": return "vend_err_kind";
    case "limit": return "join_err_limit";
    case "not_confirmed":
    case "no_session": return "join_err_confirm";
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
/** A shift or a vehicle in the page's language; one the words do not know yet is shown as its id, capitalised. */
export const shiftName = (l: Lang, id: string) => { const k = `join_shift_${id}`; return DICTS.en[k] ? t(l, k as Key) : cap(id); };
export const vehicleName = (l: Lang, id: string) => { const k = `join_vehicle_${id}`; return DICTS.en[k] ? t(l, k as Key) : cap(id); };
export const dayName = (l: Lang, d: string) => t(l, `join_day_${d}` as Key);
/** The village as the page's language writes it, to put in the box: the Arabic name on an Arabic page where we have one. */
export const villageText = (l: Lang, v: { name_en: string; name_ar: string | null }) => (l === "ar" && v.name_ar ? v.name_ar : v.name_en);
/** An amount inside a sentence of any direction keeps its own order. */
export const money = (n: number) => `⁦$${Number(n).toFixed(2)}⁩`;
