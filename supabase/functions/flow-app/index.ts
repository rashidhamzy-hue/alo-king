// flow-app: the data endpoint of the Alo King Flow app (DECISIONS §39.15.13), in eu-central-1. The screens and their
// rules are in ../_shared/flow-app.ts; this file only checks the request and wires the database.
//
// verify_jwt is off (supabase/config.toml): the caller is Kapso's data-endpoint function for the Flows alo_app_ar and
// alo_app_en (whatsapp/flows/endpoint/flow-app-proxy.js). Kapso decrypts Meta's request with the Flow encryption key
// (§39.8) and forwards it here with X-Alo-Timestamp and X-Alo-Signature: an HMAC-SHA256 of `<timestamp>.<body>` with the
// proxy key, which only this database (app_private.flow_app_keys) and that Kapso function's secret hold. Anything else
// gets 401. Kapso's own check of Meta's signature (`signature_valid`) must be true for any customer data; an unsigned
// preview gets the "open it from the chat" screen. The answer is always synchronous (Meta waits about 10 s), the one
// exception to "fast 200 then queue".

import { handleFlowRequest, verifyProxy, type FlowAppStore } from "../_shared/flow-app.ts";
import { reportError } from "../_shared/sentry.ts";

const env = (k: string) => Deno.env.get(k) || undefined;
const supabaseUrl = env("SUPABASE_URL") ?? "";
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sentryDsn = env("SENTRY_DSN");

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(6000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const store: FlowAppStore = {
  session: (t) => rpc("flow_app_session", { p_flow_token: t }),
  explore: (t, q, cat, offset) =>
    rpc("flow_app_explore", { p_token: t, p_q: q, p_category: cat, p_offset: offset }),
  menu: (t, slug) => rpc("flow_app_menu", { p_token: t, p_slug: slug }),
  basket: (t) => rpc("flow_app_basket", { p_token: t }),
  add: (t, item, qty, opts, note, replace) =>
    rpc("flow_app_add", {
      p_token: t,
      p_item_id: item,
      p_quantity: qty,
      p_option_ids: opts,
      p_note: note,
      p_replace: replace,
    }),
  remove: (t, lines) => rpc("flow_app_remove", { p_token: t, p_line_ids: lines }),
  complete: (t) => rpc("flow_app_complete", { p_token: t }),
  thumbs: async (kind, refs) =>
    refs.length ? ((await rpc("flow_app_thumbs", { p_kind: kind, p_refs: refs })) ?? {}) : {},
};

// The proxy key and the page size, read once per worker (both change only by a migration or a dated config row).
let proxyKey: Promise<string | null> | null = null;
let pageSize: Promise<number> | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const raw = await req.text();
  proxyKey ??= rpc("flow_app_proxy_key", {}).catch(() => {
    proxyKey = null;
    return null;
  });
  const ok = await verifyProxy(
    await proxyKey,
    req.headers.get("x-alo-timestamp"),
    req.headers.get("x-alo-signature"),
    raw,
  );
  if (!ok) return json({ error: "unauthorized" }, 401);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const de = body?.data_exchange ?? body;
  // Meta's health check of the endpoint answers with its own shape.
  if (de?.action === "ping") return json({ version: "3.0", data: { status: "active" } });
  try {
    pageSize ??= rpc("config_value", { p_key: "flow_app_page_size" })
      .then((v) => Number(v) || 19)
      .catch(() => 19);
    const out = await handleFlowRequest(store, de, {
      signed: body?.signature_valid === true,
      pageSize: await pageSize,
    });
    console.log(
      JSON.stringify({
        fn: "flow-app",
        action: de?.action,
        go: de?.data?.go ?? null,
        screen: out.screen,
      }),
    );
    return json(out);
  } catch (e) {
    console.log(JSON.stringify({ fn: "flow-app", msg: "failed", error: String(e).slice(0, 200) }));
    void reportError(sentryDsn, e instanceof Error ? e : new Error(String(e)), { fn: "flow-app" });
    // Meta shows its own error when the endpoint fails; the customer can retry or go back to the chat.
    return json({ error: "failed" }, 500);
  }
});
