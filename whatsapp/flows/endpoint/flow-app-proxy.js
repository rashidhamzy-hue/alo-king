// Kapso data endpoint of the Alo King Flow app (alo_app_ar, alo_app_en; DECISIONS §39.15.13). Kapso decrypts Meta's
// request with the Flow encryption key (§39.8) and calls this function; it forwards the plaintext body unchanged to our
// own endpoint, the Supabase edge function flow-app in eu-central-1, signed with the proxy key, and returns its answer.
// All logic, data and prices live in flow-app. Secrets (set by scripts/kapso/flows.ts from staging, never in this file):
// FLOW_APP_URL (…/functions/v1/flow-app?forceFunctionRegion=eu-central-1) and FLOW_APP_PROXY_KEY (64 hex characters).
async function handler(request, env) {
  const raw = await request.text();
  const ts = String(Math.floor(Date.now() / 1000));
  const bytes = new Uint8Array(
    (env.FLOW_APP_PROXY_KEY.match(/../g) || []).map((h) => parseInt(h, 16)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + raw));
  const sig = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const res = await fetch(env.FLOW_APP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-alo-timestamp": ts, "x-alo-signature": sig },
    body: raw,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
}
