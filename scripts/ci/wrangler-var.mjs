// Prints one staging var from wrangler.jsonc, so CI never keeps a second copy of a model id. Usage: node scripts/ci/wrangler-var.mjs MODEL_FAST
import { readFileSync } from "node:fs";
const text = readFileSync("wrangler.jsonc", "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const cfg = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
const v = cfg.env.staging.vars[process.argv[2]];
if (v === undefined) { console.error(`no staging var ${process.argv[2]}`); process.exit(1); }
console.log(v);
