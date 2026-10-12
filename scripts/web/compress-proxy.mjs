#!/usr/bin/env node
// Stands in for the CDN in the quality checks: forwards to the site and compresses text responses with brotli or gzip, as
// Vercel does in production. Lighthouse's simulated 4G counts transferred bytes, so an uncompressed local server would
// understate the real score.   node scripts/web/compress-proxy.mjs <listen-port> <target-port>
import { createServer, request } from "node:http";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const [listen, target] = [Number(process.argv[2] ?? 4011), Number(process.argv[3] ?? 4010)];
const TEXT = /text\/|javascript|json|xml|svg/;

createServer((req, res) => {
  const up = request(
    {
      host: "127.0.0.1",
      port: target,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, "accept-encoding": "identity" },
    },
    (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => {
        let body = Buffer.concat(chunks);
        // Experiments only: STRIP="font-preload,modulepreload" removes those links from the HTML.
        if (process.env.STRIP && String(r.headers["content-type"] ?? "").includes("text/html")) {
          let h = body.toString("utf8");
          if (process.env.STRIP.includes("font-preload"))
            h = h.replace(/<link rel="preload" as="font"[^>]*>/g, "");
          if (process.env.STRIP.includes("modulepreload"))
            h = h.replace(/<link rel="modulepreload"[^>]*>/g, "");
          if (process.env.STRIP.includes("deferjs")) {
            h = h.replace(/<link rel="modulepreload"[^>]*>/g, "");
            h = h.replace(
              /<script type="module" async="" src="([^"]+)"><\/script>/,
              (_, src) =>
                `<script>addEventListener("load",()=>setTimeout(()=>import("${src}"),0))</script>`,
            );
          }
          if (process.env.STRIP.includes("lowpri"))
            h = h.replace(
              /<link rel="modulepreload"/g,
              '<link rel="modulepreload" fetchpriority="low"',
            );
          body = Buffer.from(h);
        }
        const headers = { ...r.headers };
        delete headers["transfer-encoding"];
        const ae = String(req.headers["accept-encoding"] ?? "");
        if (body.length > 512 && TEXT.test(String(headers["content-type"] ?? ""))) {
          if (ae.includes("br")) {
            body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
            headers["content-encoding"] = "br";
          } else if (ae.includes("gzip")) {
            body = gzipSync(body);
            headers["content-encoding"] = "gzip";
          }
          headers["vary"] = "accept-encoding";
        }
        headers["content-length"] = String(body.length);
        res.writeHead(r.statusCode ?? 200, headers).end(body);
      });
    },
  );
  up.on("error", () => res.writeHead(502).end());
  req.pipe(up);
}).listen(listen, "127.0.0.1", () => console.log(`compress proxy ${listen} -> ${target}`));
