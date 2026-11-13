// Writes wrangler.staging-noqueue.json: wrangler.jsonc with the staging queue bindings removed.
// Used only when Cloudflare refuses to create queues on the current plan. The queue is the retry path, not the main road
// (apps/gateway/src/index.ts hands events straight to the conversation object), so the Worker still runs without it.
import { readFileSync, writeFileSync } from "node:fs";
const text = readFileSync("wrangler.jsonc", "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const cfg = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
delete cfg.env.staging.queues;
writeFileSync("wrangler.staging-noqueue.json", JSON.stringify(cfg, null, 2));
console.log("wrote wrangler.staging-noqueue.json without queues");
