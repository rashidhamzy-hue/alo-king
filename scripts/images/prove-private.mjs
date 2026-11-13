#!/usr/bin/env node
// After a run: proves the pictures sit in a private bucket. A signed link (scripts/images/sign.mjs) must serve one proposed picture
// as a JPEG, and the same path read without a key through the public route must be refused. Also writes the "photograph at
// intake" list (5.17 step 8) to intake-list.json. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Never prints a key or a link.
import { writeFileSync, appendFileSync } from "node:fs";
import { makeStore } from "./lib/store.mjs";
import { signedImageLink } from "./sign.mjs";

const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("missing SUPABASE_URL or SUPABASE_SERVICE_KEY"); process.exit(2); }
const store = makeStore({ url, key });
const out = [];
const say = (s) => { console.log(s); out.push(`- ${s}`); };

const intake = await store.rpc("photograph_at_intake");
writeFileSync("intake-list.json", JSON.stringify(intake, null, 1));
say(`photograph-at-intake list: ${intake.length} items (intake-list.json)`);

const proposed = await store.rpc("product_images_review", { p_status: "proposed", p_limit: 1 });
let failed = false;
if (!proposed.length) say("no proposed picture to test the signed link on");
else {
  const path = proposed[0].media_path;
  const link = await signedImageLink({ url, key, path, seconds: 60 });
  const res = await fetch(link);
  const type = res.headers.get("content-type") ?? "";
  const bytes = (await res.arrayBuffer()).byteLength;
  say(`signed link serves a picture: HTTP ${res.status}, ${type}, ${bytes} bytes (kept under 300 KB: ${bytes < 300 * 1000})`);
  if (res.status !== 200 || !type.startsWith("image/") || bytes >= 300 * 1000) failed = true;
  const anon = await fetch(`${url}/storage/v1/object/public/media/${path}`);
  say(`the same picture without a link or key: HTTP ${anon.status} (must be refused)`);
  if (![400, 401, 403, 404].includes(anon.status)) failed = true;
  const bad = await fetch(link.split("?")[0]);
  say(`the signed address without its token: HTTP ${bad.status} (must be refused)`);
  if (![400, 401, 403, 404].includes(bad.status)) failed = true;
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
if (failed) { console.error("FAIL: the picture store is not private enough"); process.exit(1); }
