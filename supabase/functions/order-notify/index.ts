// Called by the signed-in merchant / driver apps right after they change an order's status, so the customer hears about it on WhatsApp at once.
// verify_jwt = true (config.toml); the caller is also authorised here against the order. Nothing in the request body is trusted beyond the order id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyOrderStatus } from "../_shared/notify.ts";

const KAPSO_TOKEN = Deno.env.get("KAPSO_API_TOKEN") ?? "";
const PNID = Deno.env.get("KAPSO_DEFAULT_PHONE_NUMBER_ID") ?? "1384772384720496";
const TRACK_BASE = Deno.env.get("ALO_TRACK_BASE_URL") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function send(payload: Record<string, unknown>): Promise<boolean> {
  if (!KAPSO_TOKEN) return false;
  try {
    const res = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${PNID}/messages`, { method: "POST", headers: { "X-API-Key": KAPSO_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) console.error("order-notify send failed", res.status);
    return res.ok;
  } catch (e) { console.error("order-notify send error", String((e as Error)?.message ?? e).slice(0, 120)); return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const { data: u, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "sign in first" }, 401);
  let body: any; try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const orderId = String(body?.order_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "bad order id" }, 400);

  const [{ data: sp }, { data: o }] = await Promise.all([
    sb.from("staff_profiles").select("role,vendor_id").eq("user_id", u.user.id).maybeSingle(),
    sb.from("orders").select("id,vendor_id,driver_id").eq("id", orderId).maybeSingle(),
  ]);
  const allowed = !!sp && !!o && (sp.role === "admin" || (sp.role === "merchant" && sp.vendor_id === o.vendor_id) || (sp.role === "driver" && o.driver_id === u.user.id));
  if (!allowed) return json({ error: "not allowed" }, 403);
  const r = await notifyOrderStatus(sb, send, orderId, { trackBase: TRACK_BASE });
  return json({ ok: true, ...r });
});
