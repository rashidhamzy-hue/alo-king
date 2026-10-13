// The website's side of the claim, registration and driver forms (DECISIONS §18, §24.3, §37.4): one typed call to the
// `site-claim` edge function (supabase/functions/_shared/site-claim.ts). Plain fetch, no supabase-js: these pages are public.
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export type ClaimHit = {
  vendor_id: string;
  name: string;
  branch_label: string | null;
  town: string | null;
  claimed: boolean;
  frozen: boolean;
  phone_tail: string | null;
};

/** What the server says about a claim. The code and the shop's phone number are never in it. */
export type ClaimState = {
  status: string;
  claim_id?: string;
  case?: string;
  channel?: "whatsapp" | "voice";
  phone_tail?: string;
  missing?: string[];
  contested?: boolean;
  left?: number;
  code_not_delivered?: boolean;
  name?: string;
};

export type CallResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error:
        | "rate_limited"
        | "offline"
        | "file_type"
        | "file_size"
        | "bad_request"
        | "pin_outside_lebanon"
        | "consent_required"
        | "server";
    };

const URL_ = `${SUPABASE_URL}/functions/v1/site-claim`;
const TIMEOUT_MS = 20_000;

async function call<T>(init: { body: BodyInit; json?: boolean }): Promise<CallResult<T>> {
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        ...(init.json ? { "content-type": "application/json" } : {}),
      },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as
      ({ ok: boolean; error?: string } & T) | null;
    if (res.ok && body?.ok) return { ok: true, data: body };
    const e = body?.error;
    if (res.status === 429 || e === "rate_limited") return { ok: false, error: "rate_limited" };
    if (
      e === "file_type" ||
      e === "file_size" ||
      e === "pin_outside_lebanon" ||
      e === "consent_required"
    )
      return { ok: false, error: e };
    if (res.status === 400) return { ok: false, error: "bad_request" };
    return { ok: false, error: "server" };
  } catch {
    return { ok: false, error: "offline" };
  }
}

const post = <T>(body: Record<string, unknown>) =>
  call<T>({ body: JSON.stringify(body), json: true });

export const searchBusinesses = (q: string) =>
  post<{ results: ClaimHit[] }>({ action: "search", q });

export type ClaimBusiness = ClaimHit & { in_brand: boolean };

/** One business by id (the claim page's address names it). Null when it does not exist or cannot be claimed. */
export async function lookupBusiness(vendorId: string): Promise<ClaimBusiness | null> {
  const r = await post<{ found: boolean; business?: ClaimBusiness }>({
    action: "lookup",
    vendor_id: vendorId,
  });
  return r.ok && r.data.found && r.data.business ? r.data.business : null;
}

export const startClaim = (a: {
  vendor_id: string;
  phone: string;
  name: string;
  lang: string;
  brand_wide: boolean;
}) => post<ClaimState>({ action: "start", ...a });

export const verifyCode = (a: { claim_id: string; phone: string; code: string }) =>
  post<ClaimState>({ action: "verify", ...a });

export const switchToPapers = (a: { claim_id: string; phone: string }) =>
  post<ClaimState>({ action: "use_documents", ...a });

export const noRegistration = (a: { claim_id: string; phone: string }) =>
  post<ClaimState>({ action: "no_registration", ...a });

export const claimStatus = (a: { claim_id: string; phone: string }) =>
  post<ClaimState>({ action: "status", ...a });

export const registerBusiness = (a: {
  phone: string;
  name_ar: string;
  name_en: string;
  business_type: string;
  lat: number;
  lon: number;
  home_kitchen: boolean;
  brand_wide: boolean;
  lang: string;
}) => post<ClaimState>({ action: "register", ...a });

export const uploadDocument = (a: {
  claim_id: string;
  phone: string;
  kind: string;
  file: Blob;
}) => {
  const f = new FormData();
  f.set("claim_id", a.claim_id);
  f.set("phone", a.phone);
  f.set("kind", a.kind);
  f.set("file", a.file, "document");
  return call<ClaimState>({ body: f });
};

export const applyToDrive = (a: {
  name: string;
  phone: string;
  place: string;
  vehicle: string;
  licence: boolean;
  languages: string[];
  availability: string[];
  note: string;
  consent: boolean;
  lang: string;
}) => post<{ status: string }>({ action: "driver_apply", ...a });

// ---- Phone numbers ----------------------------------------------------------------------------------------------
/** Country codes offered first (Lebanon, then where many Lebanese live). The visitor can type any other code. */
export const COUNTRY_CODES = [
  "961",
  "971",
  "33",
  "1",
  "61",
  "49",
  "44",
  "966",
  "974",
  "20",
  "90",
  "357",
] as const;

/**
 * Builds an E.164 number from a country code and what the visitor typed. A Lebanese number may start with 0 (03 123456,
 * 71 123456); a number typed with + or 00 is taken as already international. Returns null when it cannot be valid.
 */
export function toE164(countryCode: string, typed: string): string | null {
  const cc = countryCode.replace(/\D/g, "");
  let digits = typed.trim().replace(/[\s\-().]/g, "");
  // Arabic-Indic and Persian digits.
  digits = digits
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  let e164: string;
  if (digits.startsWith("+")) e164 = digits;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else e164 = `+${cc}${digits.replace(/^0+/, "")}`;
  return /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : null;
}

/** "+96176555001" -> "+961 76 ••• 001": enough to recognise one's own number, not to read it out. */
export const maskPhone = (e164: string) => `${e164.slice(0, 4)} ••• ${e164.slice(-3)}`;
