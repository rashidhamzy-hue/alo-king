// Merchant onboarding on the Merchant number (DECISIONS §18.1, §18.2): a business claims its listing or
// registers, by text, taps, a pin and photos. Zero model calls: the steps live here, every decision is a
// server function (claim_start, claim_verify_code, claim_add_document, vendor_register…). The sandbox is one
// number for customers and merchants until cut-over (§3), so this runs for a non-member who asks to join
// or who is in the middle of onboarding; everyone else stays with the customer bot.

import { clampInteractive } from "../../_shared/meta-limits.ts";
import {
  businessTypeList,
  claimCodeScript,
  claimCodeText,
  claimSearchList,
  codeSentCard,
  documentsAsk,
  guessLang,
  homeKitchenButtons,
  joinConfirm,
  isCancel,
  isJoinIntent,
  notListedButtons,
  parseOnboardingTap,
  pinRequest,
  say,
  text,
  type OLang,
} from "../../_shared/onboarding-cards.ts";

export type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };

export type OnboardingDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  /** Sends one payload from the Merchant number (the sandbox until cut-over). */
  send: (payload: Record<string, unknown>) => Promise<SendResult>;
  /** Places the call that reads a claim code to a landline (case B); null when no voice provider. */
  voiceCode: ((to: string, script: string) => Promise<SendResult>) | null;
  /** Copies a claim document into private storage; returns its path, or null (the WhatsApp reference is kept). */
  storeDocument?: (
    media: { id: string; url: string | null; mime: string },
    claimId: string,
  ) => Promise<string | null>;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

export type OnboardingInbound = {
  from: string;
  messageId: string;
  type: string;
  text: string | null;
  buttonId: string | null;
  location: { lat: number; lon: number } | null;
  media: { id: string; url: string | null; ref: string; mime: string } | null;
  name: string | null;
};

/** Reads the parts onboarding needs from a Kapso `whatsapp.message.received` payload. */
export function readOnboardingInbound(payload: any): OnboardingInbound | null {
  const msg = payload?.message;
  if (!msg || typeof msg !== "object") return null;
  if (msg.kapso?.direction && msg.kapso.direction !== "inbound") return null;
  const raw = String(payload?.conversation?.phone_number ?? msg.from ?? "");
  const from = raw.startsWith("+") ? raw : raw ? `+${raw}` : "";
  if (!/^\+[1-9][0-9]{6,14}$/.test(from)) return null;
  const type = String(msg.type ?? "unknown");
  const i = msg.interactive;
  const lat = Number(msg.location?.latitude);
  const lon = Number(msg.location?.longitude);
  const mediaObj = type === "image" ? msg.image : type === "document" ? msg.document : null;
  const mediaId = mediaObj?.id ? String(mediaObj.id) : null;
  return {
    from,
    messageId: String(msg.id ?? ""),
    type,
    text: type === "text" ? String(msg.text?.body ?? "").slice(0, 500) : null,
    buttonId:
      type === "interactive"
        ? (i?.button_reply?.id ?? i?.list_reply?.id ?? null)
        : type === "button"
          ? (msg.button?.payload ?? null)
          : null,
    location:
      type === "location" && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
    media: mediaId
      ? {
          id: mediaId,
          url: msg.kapso?.media_url ?? msg.kapso?.media_data?.url ?? null,
          ref: `wa-media:${mediaId}`.slice(0, 300),
          mime: String(mediaObj?.mime_type ?? msg.kapso?.media_data?.content_type ?? ""),
        }
      : null,
    name: payload?.conversation?.contact_name ?? msg.kapso?.contact_name ?? null,
  };
}

type Session = { step: string; data: Record<string, any>; lang: OLang | null } | null;

/**
 * Handles the message when it belongs to onboarding: a join intent, an onboarding tap, or a step in progress.
 * Returns false when it does not (the caller passes it to the customer bot).
 */
export async function handleOnboarding(
  deps: OnboardingDeps,
  m: OnboardingInbound,
): Promise<boolean> {
  const tap = parseOnboardingTap(m.buttonId);
  const s: Session = await deps.rpc("onboarding_session_get", { p_phone: m.from });
  if (!s && !tap && !(m.text && isJoinIntent(m.text))) return false;
  const lang: OLang = (s?.lang as OLang) ?? guessLang(m.text ?? m.name);
  const out: Record<string, unknown>[] = [];
  const reply = (p: Record<string, unknown>) => out.push(p);
  const setStep = (step: string | null, data: Record<string, any> = {}) =>
    deps.rpc("onboarding_session_set", {
      p_phone: m.from,
      p_step: step,
      p_data: data,
      p_lang: lang,
    });

  await route(deps, m, s, tap, lang, reply, setStep);
  for (const p of out) {
    const r = await deps.send(clampInteractive(p));
    if (!r.ok) deps.log?.("onboarding send failed", { error: r.error.slice(0, 120) });
  }
  return true;
}

async function route(
  deps: OnboardingDeps,
  m: OnboardingInbound,
  s: Session,
  tap: ReturnType<typeof parseOnboardingTap>,
  lang: OLang,
  reply: (p: Record<string, unknown>) => void,
  setStep: (step: string | null, data?: Record<string, any>) => Promise<unknown>,
) {
  const to = m.from;
  const data = { ...(s?.data ?? {}) };

  if (tap?.a === "cancel" || (m.text !== null && isCancel(m.text))) {
    await setStep(null);
    return reply(text(to, say(lang, "cancelled")));
  }
  // Taps that are answers to the server's own cards (objection, lost-phone confirmation).
  if (tap?.a === "object") {
    const r = await deps.rpc("claim_object", { p_phone: m.from, p_claim_id: tap.claimId });
    return reply(
      text(
        to,
        say(
          lang,
          r?.status === "objected"
            ? "objected"
            : r?.status === "too_late"
              ? "tooLate"
              : "notAllowed",
        ),
      ),
    );
  }
  if (tap?.a === "recover") {
    const r = await deps.rpc("member_recover_decide", {
      p_phone: m.from,
      p_claim_id: tap.claimId,
      p_approve: tap.approve,
    });
    return reply(
      text(
        to,
        say(
          lang,
          r?.status === "approved"
            ? "recoverOk"
            : r?.status === "rejected"
              ? "recoverNo"
              : "notAllowed",
        ),
      ),
    );
  }

  if (tap?.a === "vendor") return startClaim(deps, m, tap.vendorId, lang, reply, setStep, data);
  if (tap?.a === "new") {
    await setStep("reg_type", { ...data });
    return reply(businessTypeList(to, lang));
  }
  if (tap?.a === "docs") {
    const r = await deps.rpc("claim_use_documents", { p_phone: m.from, p_claim_id: tap.claimId });
    if (r?.status !== "awaiting_documents") return reply(text(to, say(lang, "pending")));
    await setStep("docs", { claim_id: r.claim_id, missing: r.missing });
    return reply(documentsAsk(to, r.missing ?? [], lang));
  }
  if (tap?.a === "noreg") {
    const r = await deps.rpc("claim_no_registration", { p_phone: m.from, p_claim_id: tap.claimId });
    await setStep(null);
    return reply(text(to, say(lang, r?.status === "waitlist" ? "waitlist" : "pending")));
  }
  if (tap?.a === "type") {
    await setStep("reg_home", { ...data, business_type: tap.type });
    return reply(homeKitchenButtons(to, lang));
  }
  if (tap?.a === "home") {
    await setStep("reg_pin", { ...data, home_kitchen: tap.home });
    return reply(pinRequest(to, lang));
  }

  if (tap?.a === "join") {
    await setStep("ask_name", {});
    return reply(text(to, say(lang, "welcome")));
  }
  // No session yet: a join intent asks first, so a customer's message never starts onboarding by mistake.
  if (!s) return reply(joinConfirm(to, lang));

  switch (s.step) {
    case "ask_name":
    case "pick": {
      if (!m.text || m.text.trim().length < 2) return reply(text(to, say(lang, "welcome")));
      const matches: any[] =
        (await deps.rpc("vendor_claim_search", { p_query: m.text.trim(), p_limit: 8 })) ?? [];
      await setStep("pick", { query: m.text.trim().slice(0, 80) });
      if (!matches.length) return reply(notListedButtons(to, lang, true));
      reply(claimSearchList(to, matches, lang));
      return reply(notListedButtons(to, lang));
    }
    case "code": {
      const code = (m.text ?? "")
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/\s/g, "");
      if (!/^[0-9]{6}$/.test(code)) return reply(text(to, say(lang, "wrongCode", { left: "…" })));
      const r = await deps.rpc("claim_verify_code", {
        p_phone: m.from,
        p_code: code,
        p_claim_id: data.claim_id ?? null,
      });
      switch (r?.status) {
        case "approved":
          // The server already queued the welcome with the next step.
          await setStep(null);
          return;
        case "wrong_code":
          return reply(text(to, say(lang, "wrongCode", { left: r.left ?? 0 })));
        case "locked":
          await setStep("docs", { claim_id: r.claim_id, missing: r.missing });
          return reply(documentsAsk(to, r.missing ?? [], lang, { prefix: say(lang, "locked") }));
        case "expired":
          await setStep("pick", data);
          return reply(text(to, say(lang, "expired")));
        default:
          await setStep(null);
          return reply(text(to, say(lang, "pending")));
      }
    }
    case "docs": {
      if (!m.media)
        return reply(
          documentsAsk(to, data.missing ?? ["registration"], lang, {
            homeKitchen: !!data.home_kitchen,
            claimId: data.claim_id,
          }),
        );
      const kind = (data.missing ?? [])[0] ?? "other";
      // A copy in private storage outlives WhatsApp's media retention (the audit of G and I needs it).
      let ref = m.media.ref;
      if (deps.storeDocument && data.claim_id) {
        try {
          ref = (await deps.storeDocument(m.media, String(data.claim_id))) ?? ref;
        } catch (e) {
          deps.log?.("claim document copy failed", { error: String(e).slice(0, 120) });
        }
      }
      const r = await deps.rpc("claim_add_document", {
        p_phone: m.from,
        p_kind: ["registration", "permit", "company", "sign_photo", "id"].includes(kind)
          ? kind
          : "other",
        p_media_ref: ref,
        p_mime: m.media.mime || null,
        p_claim_id: data.claim_id ?? null,
      });
      if (r?.status === "pending_review") {
        await setStep(null);
        return reply(text(to, say(lang, "review")));
      }
      if (r?.status === "awaiting_documents") {
        await setStep("docs", { ...data, missing: r.missing });
        return reply(
          documentsAsk(to, r.missing ?? [], lang, {
            next: true,
            homeKitchen: !!data.home_kitchen,
            claimId: data.claim_id,
          }),
        );
      }
      await setStep(null);
      return reply(text(to, say(lang, "pending")));
    }
    case "reg_type":
      return reply(businessTypeList(to, lang));
    case "reg_home":
      return reply(homeKitchenButtons(to, lang));
    case "reg_pin": {
      if (!m.location) return reply(pinRequest(to, lang));
      const name = String(data.query ?? m.name ?? "").trim();
      const arabic = /[؀-ۿ]/.test(name);
      const r = await deps.rpc("vendor_register", {
        p_phone: m.from,
        p_name_ar: arabic ? name : null,
        p_name_en: arabic ? null : name || "New business",
        p_business_type: data.business_type ?? "restaurant",
        p_lat: m.location.lat,
        p_lon: m.location.lon,
        p_home_kitchen: !!data.home_kitchen,
        p_lang: lang,
      });
      if (r?.status === "rate_limited") {
        await setStep(null);
        return reply(text(to, say(lang, "rateLimited")));
      }
      await setStep("docs", {
        claim_id: r.claim_id,
        missing: r.missing,
        home_kitchen: !!data.home_kitchen,
      });
      return reply(
        documentsAsk(to, r.missing ?? [], lang, {
          homeKitchen: !!data.home_kitchen,
          claimId: r.claim_id,
        }),
      );
    }
    default:
      await setStep(null);
      return reply(text(to, say(lang, "welcome")));
  }
}

async function startClaim(
  deps: OnboardingDeps,
  m: OnboardingInbound,
  vendorId: string,
  lang: OLang,
  reply: (p: Record<string, unknown>) => void,
  setStep: (step: string | null, data?: Record<string, any>) => Promise<unknown>,
  data: Record<string, any>,
) {
  const to = m.from;
  const r = await deps.rpc("claim_start", {
    p_vendor_id: vendorId,
    p_phone: m.from,
    p_name: m.name,
    p_lang: lang,
  });
  switch (r?.status) {
    case "already_owner":
      await setStep(null);
      return reply(text(to, say(lang, "alreadyOwner")));
    case "rate_limited":
      await setStep(null);
      return reply(text(to, say(lang, "rateLimited")));
    case "not_available":
      await setStep(null);
      return reply(text(to, say(lang, "notAvailable")));
    case "code_sent": {
      if (!r.send) {
        // The code sent earlier is still valid: ask for it again, never drop it.
        await setStep("code", { claim_id: r.claim_id, vendor_id: vendorId });
        return reply(
          codeSentCard(
            to,
            r.claim_id,
            String(r.phone_tail ?? ""),
            r.channel === "voice" ? "voice" : "whatsapp",
            lang,
          ),
        );
      }
      // The code goes only to the shop's own number; the claimant types it here.
      const sent = await sendCode(deps, r.send);
      if (!sent?.ok) {
        deps.log?.("claim code not delivered", { channel: String(r.send?.channel ?? "") });
        const d = await deps.rpc("claim_use_documents", {
          p_phone: m.from,
          p_claim_id: r.claim_id,
        });
        await setStep("docs", { claim_id: r.claim_id, missing: d?.missing ?? [] });
        return reply(documentsAsk(to, d?.missing ?? ["registration", "sign_photo"], lang));
      }
      await setStep("code", { claim_id: r.claim_id, vendor_id: vendorId });
      return reply(codeSentCard(to, r.claim_id, String(r.phone_tail ?? ""), r.send.channel, lang));
    }
    case "awaiting_documents": {
      await setStep("docs", { claim_id: r.claim_id, missing: r.missing });
      const prefix = r.contested
        ? say(lang, "contested")
        : r.case === "I"
          ? say(lang, "sale")
          : undefined;
      return reply(documentsAsk(to, r.missing ?? [], lang, { prefix }));
    }
    default:
      await setStep(null, data);
      return reply(text(to, say(lang, "pending")));
  }
}

async function sendCode(
  deps: OnboardingDeps,
  send: { channel: string; to: string; code: string },
): Promise<SendResult> {
  if (!/^\+[1-9][0-9]{6,14}$/.test(String(send.to)) || !/^[0-9]{6}$/.test(String(send.code)))
    return { ok: false, retry: false, error: "bad code target" };
  if (send.channel === "voice") {
    if (!deps.voiceCode) return { ok: false, retry: false, error: "voice provider not configured" };
    return deps.voiceCode(send.to, claimCodeScript(send.code));
  }
  return deps.send(claimCodeText(send.to, send.code));
}
