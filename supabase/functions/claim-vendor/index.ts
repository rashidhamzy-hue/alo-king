import { createClient } from "npm:@supabase/supabase-js@2";
import { buildOtpPayload } from "./otp.ts";
import { buildClaimCard } from "../_shared/claims.ts";

const KAPSO_TOKEN = Deno.env.get("KAPSO_API_TOKEN") ?? "";
const PNID = Deno.env.get("KAPSO_DEFAULT_PHONE_NUMBER_ID") ?? "1384772384720496";
// Name of an APPROVED WhatsApp authentication template. Without it, claims go to manual admin review.
const OTP_TEMPLATE = Deno.env.get("KAPSO_OTP_TEMPLATE") ?? "";
const OTP_LANG = Deno.env.get("KAPSO_OTP_LANG") ?? "en_US";
// Admin who reviews claims by WhatsApp (Supabase secret, never logged or returned).
const ADMIN_PHONE_RAW = Deno.env.get("ADMIN_WHATSAPP_PHONE") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function normPhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d || /^0+$/.test(d)) return null;
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("961")) return d;
  if (d.startsWith("0")) return "961" + d.slice(1);
  if (d.length <= 8) return "961" + d;
  return d;
}
const mask = (p: string) => `+${p.slice(0, 3)} ••• ••• ${p.slice(-2)}`;
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

async function sendOtp(to: string, code: string): Promise<boolean> {
  if (!OTP_TEMPLATE || !KAPSO_TOKEN) return false;
  try {
    const res = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${PNID}/messages`, {
      method: "POST", headers: { "X-API-Key": KAPSO_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(buildOtpPayload(to, OTP_TEMPLATE, OTP_LANG, code)),
    });
    if (!res.ok) console.error("OTP send failed", res.status, await res.text());
    return res.ok;
  } catch (e) { console.error("OTP send error", e); return false; }
}

async function auditClaim(claimId: string, vendorId: string, event: string, details: Record<string, unknown> = {}) {
  const { error } = await sb.from("claim_audit_log").insert({ claim_id: claimId, vendor_id: vendorId, event, actor: "system", source: "claim-vendor", details });
  if (error) console.error("claim audit failed", event, error.message);
}

// Manual review: log the request and send the admin an Approve / Reject card. Never throws.
// The interactive card needs the admin's 24h window to be open; failures are audit-logged and the claim stays reviewable in /admin.
async function notifyAdminOfClaim(claimId: string, vendor: { vendor_id: string; name_en: string; village_canonical?: string | null }, contactName: string, contactPhone: string, evidence: string | null) {
  await auditClaim(claimId, vendor.vendor_id, "requested", { contact_name: contactName });
  const adminPhone = normPhone(ADMIN_PHONE_RAW);
  if (!adminPhone || !KAPSO_TOKEN) { await auditClaim(claimId, vendor.vendor_id, "admin_notify_failed", { reason: !adminPhone ? "ADMIN_WHATSAPP_PHONE not set" : "KAPSO_API_TOKEN not set" }); return; }
  try {
    const res = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${PNID}/messages`, {
      method: "POST", headers: { "X-API-Key": KAPSO_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(buildClaimCard(adminPhone, { claimId, vendorName: vendor.name_en, village: vendor.village_canonical, contactName, contactPhone, evidence })),
    });
    await auditClaim(claimId, vendor.vendor_id, res.ok ? "admin_notified" : "admin_notify_failed", res.ok ? {} : { status: res.status });
  } catch (_e) { await auditClaim(claimId, vendor.vendor_id, "admin_notify_failed", { reason: "network error" }); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const { data: u, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "Please sign in first." }, 401);
  const user = u.user;

  let body: any; try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  if (body.action === "status") {
    const { data } = await sb.from("vendor_claims").select("id,vendor_id,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return json({ claim: data });
  }

  if (body.action === "start") {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await sb.from("vendor_claims").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Too many claim attempts today. Try again tomorrow." }, 429);

    const contactName = String(body.contact_name ?? "").trim().slice(0, 80);
    const contactPhone = normPhone(body.contact_phone);
    if (!contactName || !contactPhone) return json({ error: "Your name and a valid phone number are required." }, 400);

    const { data: sp } = await sb.from("staff_profiles").select("role,vendor_id").eq("user_id", user.id).maybeSingle();
    if (sp) return json({ error: "This account is already linked to a business." }, 409);

    const { data: vendor } = await sb.from("vendors").select("vendor_id,name_en,village_canonical,whatsapp_number,phone_primary,is_active").eq("vendor_id", String(body.vendor_id)).maybeSingle();
    if (!vendor || !vendor.is_active) return json({ error: "Business not found." }, 404);
    const { data: prof } = await sb.from("vendor_profiles").select("claimed_at").eq("vendor_id", vendor.vendor_id).maybeSingle();
    if (prof?.claimed_at) return json({ error: "This business has already been claimed. Contact Alo King if this is a mistake." }, 409);

    await sb.from("vendor_claims").update({ status: "expired" }).eq("user_id", user.id).in("status", ["pending_otp", "pending_review"]);

    const target = normPhone(vendor.whatsapp_number) ?? normPhone(vendor.phone_primary);
    const evidence = String(body.evidence_note ?? "").slice(0, 500) || null;

    if (target && OTP_TEMPLATE) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const { data: claim, error } = await sb.from("vendor_claims").insert({ vendor_id: vendor.vendor_id, user_id: user.id, contact_name: contactName, contact_phone: contactPhone, evidence_note: evidence, status: "pending_otp", otp_expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }).select("id").single();
      if (error) return json({ error: "Could not start the claim." }, 500);
      await sb.from("vendor_claims").update({ otp_hash: await sha(`${claim.id}:${code}`) }).eq("id", claim.id);
      if (await sendOtp(target, code)) return json({ status: "otp_sent", claim_id: claim.id, sent_to: mask(target), vendor: vendor.name_en });
      await sb.from("vendor_claims").update({ status: "pending_review", otp_hash: null, otp_expires_at: null }).eq("id", claim.id);
      await notifyAdminOfClaim(claim.id, vendor, contactName, contactPhone, evidence);
      return json({ status: "pending_review", claim_id: claim.id, vendor: vendor.name_en, note: "We couldn't send the code, so your request was sent for manual review." });
    }

    const { data: claim, error } = await sb.from("vendor_claims").insert({ vendor_id: vendor.vendor_id, user_id: user.id, contact_name: contactName, contact_phone: contactPhone, evidence_note: evidence, status: "pending_review" }).select("id").single();
    if (error) return json({ error: "Could not start the claim." }, 500);
    await notifyAdminOfClaim(claim.id, vendor, contactName, contactPhone, evidence);
    return json({ status: "pending_review", claim_id: claim.id, vendor: vendor.name_en });
  }

  if (body.action === "verify") {
    const { data: claim } = await sb.from("vendor_claims").select("*").eq("id", String(body.claim_id)).eq("user_id", user.id).maybeSingle();
    if (!claim || claim.status !== "pending_otp") return json({ error: "No active verification found. Start again." }, 404);
    if (!claim.otp_expires_at || new Date(claim.otp_expires_at) < new Date()) { await sb.from("vendor_claims").update({ status: "expired" }).eq("id", claim.id); return json({ error: "That code expired. Start again." }, 410); }
    if (claim.attempts >= 5) { await sb.from("vendor_claims").update({ status: "expired", otp_hash: null }).eq("id", claim.id); return json({ error: "Too many wrong codes. Start again." }, 429); }
    await sb.from("vendor_claims").update({ attempts: claim.attempts + 1 }).eq("id", claim.id);
    if ((await sha(`${claim.id}:${String(body.code ?? "").trim()}`)) !== claim.otp_hash) return json({ error: "Wrong code.", attempts_left: Math.max(0, 4 - claim.attempts) }, 400);
    const { error } = await sb.rpc("finalize_claim", { p_claim_id: claim.id });
    if (error) return json({ error: error.message }, 409);
    return json({ status: "verified", vendor_id: claim.vendor_id });
  }

  return json({ error: "unknown action" }, 400);
});
