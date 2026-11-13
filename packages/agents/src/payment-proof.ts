// Payment screenshots (build plan 1.6). A customer with an order waiting for a Whish or OMT transfer sends a picture of the
// receipt. The picture is fetched through Kapso's media URL (never a raw Meta link), copied at once into the private `media`
// bucket, and recorded against the order for the ops lead. An optional model read pre-fills the amount and reference for
// that person. Nothing here confirms a payment: review_payment_proof() does, called by a person (invariants 4 and 12).
// The picture is personal data: its bytes and the model's reading are never logged.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ModelClient } from "./concierge";
import { PaymentProof } from "./schemas";

export const MEDIA_BUCKET = "media";
const MAX_BYTES = 10 * 1024 * 1024;
const META_HOSTS = /(^|\.)(fbsbx\.com|fbcdn\.net|facebook\.com|whatsapp\.net|whatsapp\.com)$/i;

export interface InboundImage { id: string; kapso: { media_url?: string; media_data?: { url: string; content_type?: string } } }
export interface ProofDeps { db: SupabaseClient; fetchMedia?: (url: string) => Promise<Response> }
export type ProofResult =
  | { kind: "not_payment" }                                     // no order waiting for a transfer: a picture is just a picture
  | { kind: "unreadable"; reason: string }                      // no usable media: ask for it again
  | { kind: "stored"; proofId: string; orderId: string; shortCode: string; totalUsd: number; method: string; reusedImage: boolean; already: boolean;
      bytes: Uint8Array; mime: string };

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** The media URL to fetch: Kapso's, never Meta's. Null when there is none we may use. */
export function kapsoMediaUrl(m: InboundImage): string | null {
  const url = m.kapso.media_url ?? m.kapso.media_data?.url ?? null;
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || META_HOSTS.test(u.hostname)) return null;
    return url;
  } catch { return null; }
}

/**
 * A picture from a customer: if an order is waiting for a transfer, store it privately and record it as that order's proof.
 * Errors from storage or the database throw, so the turn retries; the storage key is the picture's hash, so a retry overwrites
 * the same object and submit_payment_proof() returns the row it already wrote.
 */
export async function takePaymentProof(deps: ProofDeps, partyId: string, m: InboundImage): Promise<ProofResult> {
  const expected = await rpc<{ order_id: string } | null>(deps.db, "payment_expected", { p_party: partyId });
  if (!expected) return { kind: "not_payment" };
  const url = kapsoMediaUrl(m);
  if (!url) return { kind: "unreadable", reason: "no_kapso_media_url" };
  const res = await (deps.fetchMedia ?? ((u: string) => fetch(u)))(url);
  if (!res.ok) throw new Error(`MEDIA_FETCH_${res.status}`);
  const mime = (res.headers.get("content-type") ?? m.kapso.media_data?.content_type ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith("image/")) return { kind: "unreadable", reason: "not_an_image" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { kind: "unreadable", reason: "size" };
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  const path = `payment_proofs/${partyId}/${sha}.${EXT[mime] ?? "img"}`;
  const up = await deps.db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) throw new Error(`MEDIA_STORE_FAILED: ${up.error.message}`);
  const r = await rpc<{ proof_id: string | null; order_id: string | null; short_code: string; total_usd: number; method: string; reused_image: boolean; already: boolean }>(
    deps.db, "submit_payment_proof", { p_party: partyId, p_wamid: m.id, p_media_path: path, p_sha256: sha, p_mime: mime });
  if (!r.proof_id || !r.order_id) return { kind: "not_payment" };   // paid or cancelled between the two calls
  return { kind: "stored", proofId: r.proof_id, orderId: r.order_id, shortCode: r.short_code, totalUsd: Number(r.total_usd), method: r.method,
           reusedImage: !!r.reused_image, already: !!r.already, bytes, mime };
}

const READ_TOOL: Anthropic.Tool = {
  name: "record_payment_proof",
  description: "Record what the receipt shows. Use null for anything not clearly visible. Never guess a number.",
  input_schema: (() => { const { $schema: _d, ...s } = z.toJSONSchema(PaymentProof, { io: "input" }) as Record<string, unknown>; return s as Anthropic.Tool["input_schema"]; })(),
};
const READ_PROMPT = "You read Whish and OMT transfer receipts for the person who confirms payments. Report only what is printed on the image. " +
  "You never decide whether a payment is valid; a person does.";

/** The optional model read. Returns null on any failure: it is a convenience for the reviewer, never a reason to fail a turn. */
export async function readPaymentProof(model: ModelClient, modelName: string, bytes: Uint8Array, mime: string): Promise<PaymentProof | null> {
  try {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await model.messages.create({
      model: modelName, max_tokens: 400, system: READ_PROMPT, tools: [READ_TOOL], tool_choice: { type: "tool", name: READ_TOOL.name },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: btoa(bin) } },
        { type: "text", text: "Read this receipt." }] }],
    });
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const parsed = PaymentProof.safeParse(call?.input);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export const PROOF_TEXT = {
  received: (code: string) => `وصلت صورة الدفع لطلب ${code}، شكراً 🙏 حدا من فريقنا عم يتأكد منها وبيرجعلك.`,
  resend: "ما قدرنا نفتح الصورة. فيك تبعتلنا صورة الإيصال مرة تانية؟",
  opsAlert: (p: { shortCode: string; totalUsd: number; method: string; reusedImage: boolean }) =>
    `💳 صورة دفع ${p.method === "omt" ? "OMT" : "Whish"} للطلب #${p.shortCode} (المطلوب $${p.totalUsd.toFixed(2)}). بحاجة لتأكيد من شخص.` +
    (p.reusedImage ? " ⚠️ نفس الصورة انبعتت قبل لطلب تاني." : ""),
};
