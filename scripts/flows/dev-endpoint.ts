// A local data endpoint for the Alo King Flow app over fixtures (DECISIONS §39.15.13): Flowso's scenarios in CI, the
// screenshots and `flowso preview` use it in place of Kapso and flow-app. Each Flow token gets its own fixture basket.
// Usage: pnpm exec tsx scripts/flows/dev-endpoint.ts [port] [ar|en]   (default 4312, en)
import { createServer, type Server } from "node:http";
import { handleFlowRequest } from "../../supabase/functions/_shared/flow-app";
import { fixtureStore } from "./fixture-store";

export function startDevEndpoint(
  port = 0,
  lang: "ar" | "en" = "en",
): Promise<{ server: Server; url: string }> {
  const stores = new Map<string, ReturnType<typeof fixtureStore>>();
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const de = body.data_exchange ?? body;
        const key = String(de.flow_token ?? "");
        if (!stores.has(key)) stores.set(key, fixtureStore(lang));
        const out =
          de.action === "ping"
            ? { version: "3.0", data: { status: "active" } }
            : await handleFlowRequest(stores.get(key)!, de, { signed: true, pageSize: 19 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e).slice(0, 200) }));
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const a = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : port}/flow`,
      });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4312);
  const lang = process.argv[3] === "ar" ? "ar" : "en";
  startDevEndpoint(port, lang).then(({ url }) =>
    console.log(`Flow app endpoint (fixtures, ${lang}): ${url}`),
  );
}
