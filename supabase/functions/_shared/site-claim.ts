// The website's claim, registration and driver forms (DECISIONS §18, §24.3, §37.4), as one HTTP handler over the same
// server functions the WhatsApp onboarding uses (claim_start, claim_verify_code, claim_add_document, vendor_register…).
// Pure: the database, WhatsApp, voice and storage are injected, so it is unit-tested in site-claim.test.ts and the
// Deno entry point (site-claim/index.ts) only wires them.
//
// Who can call it: anybody on the internet. So every action is rate limited per visitor (a hashed address, never
// stored raw), the per-phone limits of the database still apply, a claim code is never returned to the browser (it
// goes to the shop's own number and nowhere else), and nothing here returns a seed phone, coordinates or a document.

export type SendResult = { ok: boolean; retry?: boolean; id?: string; error?: string };
type Json = Record<string, unknown>;

export type SiteClaimDeps = {
  rpc: (fn: string, args: Json) => Promise<any>;
  /** The claim code to the shop's own number by WhatsApp (case A). */
  whatsappCode: (to: string, code: string) => Promise<SendResult>;
  /** The claim code read out by a voice call (case B); null while no voice provider is configured. */
  voiceCode: ((to: string, code: string) => Promise<SendResult>) | null;
  /** Copies a document into the private bucket; false when it could not be stored. */
  storeDocument: (path: string, bytes: Uint8Array, mime: string) => Promise<boolean>;
  removeDocument: (path: string) => Promise<void>;
  log: (msg: string, fields?: Record<string, string>) => void;
  /** A stable, non-reversible key for the visitor (a hash of their address). */
  visitorKey: (req: Request) => Promise<string>;
};

// Abuse guards (not business numbers): [hits, window in seconds] per visitor and action.
export const LIMITS = {
  search: [40, 600],
  start: [8, 3600],
  verify: [20, 3600],
  document: [20, 3600],
  register: [4, 86400],
  driver: [5, 86400],
  read: [60, 600],
} as const satisfies Record<string, readonly [number, number]>;

const MAX_DOC_BYTES = 8 * 1024 * 1024;
const PHONE = /^\+[1-9][0-9]{6,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGS = ["ar", "en", "fr"] as const;
const DOC_KINDS = ["registration", "permit", "company", "sign_photo", "other"] as const;
const BUSINESS_TYPES = [
  "restaurant",
  "fast_food",
  "cafe",
  "bakery_manakish",
  "sweets_pastry",
  "ice_cream",
  "grocery_supermarket",
  "minimarket",
  "butcher",
  "poultry",
  "fish_market",
  "produce",
  "roastery_nuts",
  "home_essentials",
  "other_food",
] as const;
const VEHICLES = ["motorbike", "car", "bicycle", "van"] as const;
const AVAILABILITY = ["mornings", "afternoons", "evenings", "nights", "weekends"] as const;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const out = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
const bad = (error: string, status = 400) => out({ ok: false, error }, status);

// ---- "Ask them to join" (DECISIONS §39.3) ------------------------------------------------------------------------------
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SITE = /^https:\/\/[^\s/?#]+$/;
/** The only places the join route sends a browser: the customer's own WhatsApp, on the shop's number or none. */
export const JOIN_TARGET = /^https:\/\/wa\.me\/(\d{8,15})?(\?text=.*)?$/;
export type JoinLang = "ar" | "en" | "fr";

/** The invitation the customer sends the shop, in the page language; the claim link only once the site's address is set. */
export const JOIN_WORDS: Record<
  JoinLang,
  { invite: string; inviteNoLink: string; tooMany: string; gone: string; onAloKing: string }
> = {
  ar: {
    invite:
      "مرحبا {name}! حابب اطلب منكن عبر ألو كينغ، خدمة الطلب عالواتساب بالشوف. محلكن موجود عليه بس بعدو ما عم ياخد طلبات. استلامو ببلاش: {link}",
    inviteNoLink:
      "مرحبا {name}! حابب اطلب منكن عبر ألو كينغ، خدمة الطلب عالواتساب بالشوف. محلكن موجود عليه بس بعدو ما عم ياخد طلبات. انضمّوا لألو كينغ، استلام المحل ببلاش.",
    tooMany: "طلبات كتير من هالاتصال. جرّب بعد ساعة.",
    gone: "هالمحل ما عاد موجود عنا.",
    onAloKing: "هالمحل صار على ألو كينغ: فيك تطلب منو عالواتساب.",
  },
  en: {
    invite:
      "Hello {name}! I'd like to order from you on Alo King, the WhatsApp ordering service in the Shouf. Your shop is listed there but doesn't take orders yet. Claiming it is free: {link}",
    inviteNoLink:
      "Hello {name}! I'd like to order from you on Alo King, the WhatsApp ordering service in the Shouf. Your shop is listed there but doesn't take orders yet. Please join Alo King: claiming your shop is free.",
    tooMany: "Too many requests from this connection. Please try again in an hour.",
    gone: "This shop is not listed any more.",
    onAloKing: "This shop is on Alo King now: you can order from it on WhatsApp.",
  },
  fr: {
    invite:
      "Bonjour {name} ! J'aimerais commander chez vous sur Alo King, le service de commande par WhatsApp dans le Chouf. Votre commerce y est listé mais ne prend pas encore de commandes. Le réclamer est gratuit : {link}",
    inviteNoLink:
      "Bonjour {name} ! J'aimerais commander chez vous sur Alo King, le service de commande par WhatsApp dans le Chouf. Votre commerce y est listé mais ne prend pas encore de commandes. Rejoignez Alo King : réclamer votre commerce est gratuit.",
    tooMany: "Trop de demandes depuis cette connexion. Réessayez dans une heure.",
    gone: "Ce commerce n'est plus listé.",
    onAloKing: "Ce commerce est sur Alo King : vous pouvez y commander sur WhatsApp.",
  },
};

export function joinInvite(l: JoinLang, name: string, claimLink: string | null): string {
  const w = JOIN_WORDS[l];
  return (claimLink ? w.invite : w.inviteNoLink)
    .replace("{name}", () => name.replace(/\s+/g, " ").trim())
    .replace("{link}", () => claimLink ?? "");
}

/** wa.me with the invitation; null unless the database gave a wa.me address and the result is one the route may send. */
export function joinTarget(waUrl: unknown, text: string): string | null {
  if (typeof waUrl !== "string" || !/^https:\/\/wa\.me\/(\d{8,15})?$/.test(waUrl)) return null;
  const t = `${waUrl}?text=${encodeURIComponent(text)}`;
  return JOIN_TARGET.test(t) ? t : null;
}

/** The link the website's button and the bot's card open: this function, in the customer's browser. */
export const joinLink = (functionUrl: string, slug: string, l: JoinLang, ch: "web" | "bot") =>
  `${functionUrl}?action=join&slug=${encodeURIComponent(slug)}&lang=${l}&ch=${ch}`;

/**
 * The visitor key: HMAC-SHA256 of the visitor's address with the function's secret pepper, hex. The address is the one the
 * platform's edge saw (cf-connecting-ip, else the LAST x-forwarded-for entry, which the platform appends; the first
 * entries are whatever the client wrote). Address only, no user agent. Throws when there is no platform address.
 */
export async function visitorKeyFrom(req: Request, pepper: string): Promise<string> {
  const ip =
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  if (!ip) throw new Error("no visitor address");
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const JOIN_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
const joinRedirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to, ...JOIN_HEADERS } });
const joinPage = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...JOIN_HEADERS, ...extra },
  });

const str = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
};
const lang = (v: unknown) => ((LANGS as readonly string[]).includes(String(v)) ? String(v) : null);
const pick = <T extends string>(list: readonly T[], v: unknown): T | null =>
  list.includes(v as T) ? (v as T) : null;
const subset = <T extends string>(list: readonly T[], v: unknown): T[] | null =>
  Array.isArray(v) && v.length <= list.length && v.every((x) => list.includes(x as T))
    ? [...new Set(v as T[])]
    : null;

function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  const is = (...sig: number[]) => sig.every((x, i) => b[i] === x);
  if (is(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (is(0x89, 0x50, 0x4e, 0x47)) return { mime: "image/png", ext: "png" };
  if (is(0x25, 0x50, 0x44, 0x46)) return { mime: "application/pdf", ext: "pdf" };
  if (
    is(0x52, 0x49, 0x46, 0x46) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}

/** What the browser may learn about a claim: never the code, never the seed phone beyond its last two digits. */
function claimView(r: any): Json {
  const o: Json = { status: String(r?.status ?? "unknown") };
  if (r?.claim_id) o.claim_id = r.claim_id;
  if (r?.case) o.case = r.case;
  if (r?.channel) o.channel = r.channel;
  if (r?.phone_tail) o.phone_tail = r.phone_tail;
  if (Array.isArray(r?.missing)) o.missing = r.missing;
  if (typeof r?.contested === "boolean") o.contested = r.contested;
  if (typeof r?.left === "number") o.left = r.left;
  return o;
}

export function makeHandler(deps: SiteClaimDeps) {
  const allowed = async (req: Request, action: keyof typeof LIMITS) => {
    const [max, windowS] = LIMITS[action];
    try {
      const key = `site:${action}:${await deps.visitorKey(req)}`;
      return (
        (await deps.rpc("web_rate_hit", { p_key: key, p_max: max, p_window_s: windowS })) === true
      );
    } catch (e) {
      // A limiter that cannot answer must not become a way in: fail closed.
      deps.log("rate limiter failed", { error: String(e).slice(0, 120) });
      return false;
    }
  };

  const hit = async (key: string, max: number, windowS: number) => {
    try {
      return (
        (await deps.rpc("web_rate_hit", { p_key: key, p_max: max, p_window_s: windowS })) === true
      );
    } catch {
      return false;
    }
  };

  async function sendCode(send: {
    channel?: string;
    to?: string;
    code?: string;
  }): Promise<SendResult> {
    if (!PHONE.test(String(send.to)) || !/^[0-9]{6}$/.test(String(send.code)))
      return { ok: false, retry: false, error: "bad code target" };
    if (send.channel === "voice") {
      if (!deps.voiceCode)
        return { ok: false, retry: false, error: "voice provider not configured" };
      return deps.voiceCode(send.to!, send.code!);
    }
    return deps.whatsappCode(send.to!, send.code!);
  }

  async function documents(req: Request): Promise<Response> {
    if (!(await allowed(req, "document"))) return bad("rate_limited", 429);
    // Refuse an oversize body before reading it: formData() would buffer all of it in memory first.
    const declared = Number(req.headers.get("content-length"));
    if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_DOC_BYTES + 64 * 1024)
      return bad("file_size", 413);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("bad_request");
    }
    const claimId = String(form.get("claim_id") ?? "");
    const phone = String(form.get("phone") ?? "");
    const kind = pick(DOC_KINDS, form.get("kind"));
    const file = form.get("file") as unknown;
    const isFile = (f: unknown): f is { size: number; arrayBuffer: () => Promise<ArrayBuffer> } =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { arrayBuffer?: unknown }).arrayBuffer === "function";
    if (!UUID.test(claimId) || !PHONE.test(phone) || !kind || !isFile(file))
      return bad("bad_request");
    if (file.size === 0 || file.size > MAX_DOC_BYTES) return bad("file_size");
    // The claim must be waiting for documents from this number before anything is stored.
    const open = ((await deps.rpc("claims_for_phone", { p_phone: phone })) ?? []) as any[];
    if (!open.some((c) => c.claim_id === claimId && c.status === "awaiting_documents"))
      return out({ ok: true, status: "no_claim" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kindOfFile = sniff(bytes);
    if (!kindOfFile) return bad("file_type");
    const path = `${claimId}/${kind}-${crypto.randomUUID()}.${kindOfFile.ext}`;
    if (!(await deps.storeDocument(path, bytes, kindOfFile.mime))) return bad("storage", 502);
    let r: any;
    try {
      r = await deps.rpc("claim_add_document", {
        p_phone: phone,
        p_kind: kind,
        p_media_ref: `storage:claim-documents/${path}`,
        p_mime: kindOfFile.mime,
        p_claim_id: claimId,
      });
    } catch (e) {
      // The file was stored but not recorded: do not leave it behind.
      await deps.removeDocument(path);
      throw e;
    }
    if (r?.status === "no_claim" || r?.status === "too_many") await deps.removeDocument(path);
    return out({ ok: true, ...claimView(r) });
  }

  /**
   * "Ask them to join" (DECISIONS §39.3): GET ?action=join&slug=…&lang=ar|en|fr&ch=web|bot, opened by the customer's own
   * browser from the website's button or the bot's link. The tap is counted against a visitor key made here from the
   * platform's view of the request (never from anything the caller sends), then the customer goes to their own WhatsApp.
   */
  async function join(url: URL, req: Request): Promise<Response> {
    const slug = url.searchParams.get("slug") ?? "";
    const l = lang(url.searchParams.get("lang"));
    const chRaw = url.searchParams.get("ch");
    const ch = chRaw === null ? "web" : pick(["web", "bot"] as const, chRaw);
    if (!SLUG.test(slug) || slug.length > 120 || !l || !ch) return joinPage(400, "Bad request");
    const words = JOIN_WORDS[l as JoinLang];
    let key: string;
    try {
      key = await deps.visitorKey(req);
    } catch {
      // No platform address: the limiter fails closed.
      return joinPage(400, words.tooMany);
    }
    if (!/^[0-9a-f]{64}$/.test(key)) return joinPage(400, words.tooMany);
    let r: any;
    try {
      r = await deps.rpc("vendor_join_request", { p_slug: slug, p_channel: ch, p_visitor: key });
    } catch (e) {
      deps.log("site-claim failed", { action: "join", error: String(e).slice(0, 200) });
      return joinPage(503, words.gone);
    }
    const site = typeof r?.site_url === "string" && SITE.test(r.site_url) ? r.site_url : null;
    if (r?.status === "claimed")
      return site ? joinRedirect(`${site}/${l}/m/${slug}`) : joinPage(200, words.onAloKing);
    if (r?.status === "rate_limited")
      return joinPage(429, words.tooMany, { "retry-after": "3600" });
    if (r?.status !== "ok" || !UUID.test(String(r.vendor_id))) return joinPage(404, words.gone);
    const name =
      (l === "ar" ? r.name_ar : l === "fr" ? r.name_fr : r.name_en) ??
      r.name_en ??
      r.name_ar ??
      r.name_fr ??
      "";
    const target = joinTarget(
      r.wa_url,
      joinInvite(l as JoinLang, String(name), site ? `${site}/${l}/claim?v=${r.vendor_id}` : null),
    );
    return target ? joinRedirect(target) : joinPage(404, words.gone);
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("action") === "join") {
        try {
          return await join(url, req);
        } catch (e) {
          deps.log("site-claim failed", { action: "join", error: String(e).slice(0, 200) });
          return joinPage(500, "Error");
        }
      }
    }
    if (req.method !== "POST") return bad("method_not_allowed", 405);
    const type = req.headers.get("content-type") ?? "";
    try {
      if (type.startsWith("multipart/form-data")) return await documents(req);
      let b: Json;
      try {
        b = (await req.json()) as Json;
      } catch {
        return bad("bad_request");
      }
      if (!b || typeof b !== "object") return bad("bad_request");

      switch (b.action) {
        case "search": {
          const q = str(b.q, 2, 80);
          if (!q) return bad("bad_request");
          if (!(await allowed(req, "search"))) return bad("rate_limited", 429);
          const rows = ((await deps.rpc("vendor_claim_search", { p_query: q, p_limit: 8 })) ??
            []) as any[];
          return out({
            ok: true,
            results: rows.map((r) => ({
              vendor_id: r.vendor_id,
              name: r.name,
              branch_label: r.branch_label ?? null,
              town: r.town ?? null,
              claimed: r.claim_status === "claimed",
              frozen: r.claim_status === "frozen",
              phone_tail: r.seed_phone_tail ?? null,
            })),
          });
        }

        case "lookup": {
          const vendorId = String(b.vendor_id ?? "");
          if (!UUID.test(vendorId)) return bad("bad_request");
          if (!(await allowed(req, "read"))) return bad("rate_limited", 429);
          const rows = ((await deps.rpc("vendor_claim_lookup", { p_vendor_id: vendorId })) ??
            []) as any[];
          const r = rows[0];
          if (!r) return out({ ok: true, found: false });
          return out({
            ok: true,
            found: true,
            business: {
              vendor_id: r.vendor_id,
              name: r.name,
              branch_label: r.branch_label ?? null,
              town: r.town ?? null,
              claimed: r.claim_status === "claimed",
              frozen: r.claim_status === "frozen",
              phone_tail: r.seed_phone_tail ?? null,
              in_brand: r.in_brand === true,
              // "N customers asked for you" (DECISIONS §39.3): taps on "Ask them to join", distinct people.
              asked: Math.max(0, Math.trunc(Number(r.asked ?? 0)) || 0),
            },
          });
        }

        case "start": {
          const vendorId = String(b.vendor_id ?? "");
          const phone = String(b.phone ?? "");
          if (!UUID.test(vendorId) || !PHONE.test(phone)) return bad("bad_request");
          if (!(await allowed(req, "start"))) return bad("rate_limited", 429);
          // A cap per shop, whoever asks: rotating visitors and typed numbers must not make Alo King message or call one shop
          // owner again and again (number quality, call cost).
          if (!(await hit(`site:seed:${vendorId}`, 3, 86400)))
            return out({ ok: true, status: "rate_limited" });
          const r = await deps.rpc("claim_start", {
            p_vendor_id: vendorId,
            p_phone: phone,
            p_name: str(b.name, 1, 80),
            p_lang: lang(b.lang),
            p_brand_wide: b.brand_wide === true,
          });
          if (r?.status === "code_sent" && r.send) {
            const sent = await sendCode(r.send);
            if (!sent.ok) {
              // The code could not reach the shop's number (outside WhatsApp's window, no voice provider…): the claim
              // moves to documents instead of waiting for a code that will never come.
              deps.log("claim code not delivered", { channel: String(r.send.channel ?? "") });
              const d = await deps.rpc("claim_use_documents", {
                p_phone: phone,
                p_claim_id: r.claim_id,
              });
              return out({ ok: true, ...claimView(d), code_not_delivered: true });
            }
          }
          return out({ ok: true, ...claimView(r) });
        }

        case "verify": {
          const claimId = String(b.claim_id ?? "");
          const phone = String(b.phone ?? "");
          const code = String(b.code ?? "");
          if (!UUID.test(claimId) || !PHONE.test(phone) || !/^[0-9]{6}$/.test(code))
            return bad("bad_request");
          if (!(await allowed(req, "verify"))) return bad("rate_limited", 429);
          const r = await deps.rpc("claim_verify_code", {
            p_phone: phone,
            p_code: code,
            p_claim_id: claimId,
          });
          return out({ ok: true, ...claimView(r) });
        }

        case "use_documents": {
          const claimId = String(b.claim_id ?? "");
          const phone = String(b.phone ?? "");
          if (!UUID.test(claimId) || !PHONE.test(phone)) return bad("bad_request");
          if (!(await allowed(req, "read"))) return bad("rate_limited", 429);
          return out({
            ok: true,
            ...claimView(
              await deps.rpc("claim_use_documents", { p_phone: phone, p_claim_id: claimId }),
            ),
          });
        }

        case "no_registration": {
          const claimId = String(b.claim_id ?? "");
          const phone = String(b.phone ?? "");
          if (!UUID.test(claimId) || !PHONE.test(phone)) return bad("bad_request");
          if (!(await allowed(req, "read"))) return bad("rate_limited", 429);
          return out({
            ok: true,
            ...claimView(
              await deps.rpc("claim_no_registration", { p_phone: phone, p_claim_id: claimId }),
            ),
          });
        }

        case "status": {
          const claimId = String(b.claim_id ?? "");
          const phone = String(b.phone ?? "");
          if (!UUID.test(claimId) || !PHONE.test(phone)) return bad("bad_request");
          if (!(await allowed(req, "read"))) return bad("rate_limited", 429);
          const rows = ((await deps.rpc("claims_for_phone", { p_phone: phone })) ?? []) as any[];
          const c = rows.find((x) => x.claim_id === claimId);
          return out({
            ok: true,
            ...(c ? claimView({ ...c, claim_id: c.claim_id }) : { status: "no_claim" }),
            ...(c?.vendor_name ? { name: String(c.vendor_name) } : {}),
          });
        }

        case "register": {
          const phone = String(b.phone ?? "");
          const nameAr = b.name_ar == null || b.name_ar === "" ? null : str(b.name_ar, 1, 80);
          const nameEn = b.name_en == null || b.name_en === "" ? null : str(b.name_en, 1, 80);
          const type = pick(BUSINESS_TYPES, b.business_type);
          const lat = Number(b.lat);
          const lon = Number(b.lon);
          if (!PHONE.test(phone) || !type || (!nameAr && !nameEn)) return bad("bad_request");
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            lat < 33 ||
            lat > 34.8 ||
            lon < 35 ||
            lon > 36.7
          )
            return bad("pin_outside_lebanon");
          if (!(await allowed(req, "register"))) return bad("rate_limited", 429);
          const r = await deps.rpc("vendor_register", {
            p_phone: phone,
            p_name_ar: nameAr,
            p_name_en: nameEn,
            p_business_type: type,
            p_lat: lat,
            p_lon: lon,
            p_home_kitchen: b.home_kitchen === true,
            p_lang: lang(b.lang),
            p_brand_wide: b.brand_wide === true,
          });
          return out({ ok: true, ...claimView(r) });
        }

        case "driver_apply": {
          const phone = String(b.phone ?? "");
          const name = str(b.name, 2, 80);
          const place = str(b.place, 2, 80);
          const vehicle = pick(VEHICLES, b.vehicle);
          const languages = subset(LANGS, b.languages ?? []);
          const availability = subset(AVAILABILITY, b.availability ?? []);
          const note = b.note == null || b.note === "" ? null : str(b.note, 1, 400);
          if (!PHONE.test(phone) || !name || !place || !vehicle || !languages || !availability)
            return bad("bad_request");
          if (b.note != null && b.note !== "" && !note) return bad("bad_request");
          if (b.consent !== true) return bad("consent_required");
          if (!(await allowed(req, "driver"))) return bad("rate_limited", 429);
          const r = await deps.rpc("driver_apply", {
            p_name: name,
            p_phone: phone,
            p_place: place,
            p_vehicle: vehicle,
            p_licence: b.licence === true,
            p_languages: languages,
            p_availability: availability,
            p_note: note,
            p_lang: lang(b.lang),
          });
          return out({ ok: true, status: String(r?.status ?? "received") });
        }

        default:
          return bad("unknown_action");
      }
    } catch (e) {
      // The visitor gets nothing about the cause; the log keeps a short, redacted reason.
      deps.log("site-claim failed", {
        error: String(e)
          .replace(/\+?\d{6,}/g, "…")
          .slice(0, 160),
      });
      return bad("server", 500);
    }
  };
}
