// SR1: what the search needs on staging, run by .github/workflows/search-eval.yml (never on a branch's own database: staging only).
//   node scripts/search/staging.mjs latency            the added time of find_products over search_catalog, round trip from the runner, median of
//                                                       30 requests each (the same words), and with a fact filter; written to the run summary
//   node scripts/search/staging.mjs embed <model>      embeds staging's search documents that changed (embedding_jobs) on Workers AI and saves
//                                                       them (save_product_embeddings); tokens and dollars recorded (record_embedding_cost, step documents)
//   node scripts/search/staging.mjs switch <model>     settings.search: embeddings 'on' with that model (only after its documents are embedded)
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY; embed needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
import { appendFileSync } from "node:fs";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed"); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const say = (s) => { console.log(s); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n"); };
async function rpc(fn, args) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const timed = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };

const QUERIES = ["labneh", "لبنة", "khebez", "chips", "شيبس", "du lait", "tuna", "رز", "3adas", "zeit zeitoun", "pepsi", "مي", "snacks", "سناكات",
  "protein bars", "shampoo", "حفاضات", "dishwashing liquid", "cat food", "eggs", "قهوة نجار", "frozen fries", "ketchup", "حلوم", "tea", "sugar",
  "pasta", "rice cakes", "juice", "bleach"];

const [cmd, arg] = process.argv.slice(2);
if (cmd === "latency") {
  await rpc("find_products", { p_query: "warm up", p_filters: {}, p_limit: 6 }); await rpc("search_catalog", { p_query: "warm up", p_limit: 6 });
  const old = [], neu = [], facts = [];
  for (const q of QUERIES) {
    old.push(await timed(() => rpc("search_catalog", { p_query: q, p_source_hint: null, p_limit: 6 })));
    neu.push(await timed(() => rpc("find_products", { p_query: q, p_filters: {}, p_limit: 6, p_embedding: null, p_model: null, p_cache_key: null })));
    facts.push(await timed(() => rpc("find_products", { p_query: q, p_filters: { sugar: "none" }, p_limit: 6, p_embedding: null, p_model: null, p_cache_key: null })));
  }
  say(`### Search latency on staging (round trip from the runner, ${QUERIES.length} queries each)`);
  say(`- search_catalog: median ${median(old).toFixed(0)} ms`);
  say(`- find_products, words: median ${median(neu).toFixed(0)} ms; **added: ${(median(neu) - median(old)).toFixed(0)} ms**`);
  say(`- find_products with a fact filter (no sugar): median ${median(facts).toFixed(0)} ms; added: ${(median(facts) - median(old)).toFixed(0)} ms`);
} else if (cmd === "embed") {
  const model = arg ?? "@cf/baai/bge-m3";
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID, tok = process.env.CLOUDFLARE_API_TOKEN;
  if (!acc || !tok) { console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are needed"); process.exit(1); }
  let total = 0, tokens = 0;
  for (;;) {
    const jobs = await rpc("embedding_jobs", { p_model: model, p_limit: 50 });
    if (!jobs.length) break;
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`, {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: jobs.map((j) => j.document) }) });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.success) throw new Error(`workers ai ${r.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    const data = body.result?.data;
    const used = Number(body.result?.usage?.prompt_tokens) || jobs.reduce((a, j) => a + Math.ceil([...j.document].length / 3) + 2, 0);
    await rpc("record_embedding_cost", { p_model: model, p_step: "documents", p_calls: 1, p_tokens: used });
    await rpc("save_product_embeddings", { p_model: model, p_rows: jobs.map((j, i) => ({ product_id: j.product_id, digest: j.digest, embedding: data[i] })) });
    total += jobs.length; tokens += used;
  }
  say(`### Staging documents embedded with ${model}: ${total} (about ${tokens} tokens, recorded in model_costs)`);
} else if (cmd === "switch") {
  const model = arg ?? "@cf/baai/bge-m3";
  const left = await rpc("embedding_jobs", { p_model: model, p_limit: 1 });
  if (left.length) { console.error(`${model}: documents are still waiting to be embedded; not switched on`); process.exit(1); }
  const cur = await (await fetch(`${url}/rest/v1/settings?key=eq.search&select=value`, { headers: H })).json();
  const value = { ...(cur[0]?.value ?? {}), embeddings: "on", model };
  const r = await fetch(`${url}/rest/v1/settings?key=eq.search`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ value, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`settings: ${r.status}`);
  say(`### settings.search: embeddings on, model ${model}`);
} else { console.error("usage: staging.mjs latency | embed <model> | switch <model>"); process.exit(1); }
