// A local stand-in for Kapso's data-endpoint function, for the Flow screenshots (DECISIONS §39.15.13): Flowso's preview
// posts plaintext requests here; each is wrapped as Kapso forwards it (signature_valid true), its Flow token replaced by
// a real one made on staging for a simulator tester, signed with the proxy key and sent to the deployed flow-app. Runs
// only in the flow-screens workflow, which reads the key and makes the token from staging; nothing is printed.
// Env: FLOW_APP_URL, FLOW_APP_PROXY_KEY (64 hex), FLOW_TOKEN; argv[2] = port.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const { FLOW_APP_URL = "", FLOW_APP_PROXY_KEY = "", FLOW_TOKEN = "" } = process.env;
if (
  !/^https:\/\/[a-z]{20}\.supabase\.co\/functions\/v1\/flow-app\?forceFunctionRegion=eu-central-1$/.test(
    FLOW_APP_URL,
  )
)
  throw new Error("FLOW_APP_URL is not the staging flow-app");
if (!/^[0-9a-f]{64}$/.test(FLOW_APP_PROXY_KEY) || !FLOW_TOKEN)
  throw new Error("set FLOW_APP_PROXY_KEY and FLOW_TOKEN");

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    try {
      const de = JSON.parse(raw || "{}");
      const body = JSON.stringify({
        source: "whatsapp_flow",
        flow: { id: "screens", meta_flow_id: "screens" },
        data_exchange: { ...de, flow_token: FLOW_TOKEN },
        signature_valid: true,
        received_at: new Date().toISOString(),
      });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", Buffer.from(FLOW_APP_PROXY_KEY, "hex"))
        .update(`${ts}.${body}`)
        .digest("hex");
      const r = await fetch(FLOW_APP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alo-timestamp": ts,
          "x-alo-signature": sig,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e).slice(0, 120) }));
    }
  });
}).listen(Number(process.argv[2] ?? 4340), "127.0.0.1");
