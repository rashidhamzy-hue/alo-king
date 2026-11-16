// SR1: the request set on live models. Skipped unless asked for (it spends money); run by .github/workflows/search-eval.yml.
//   SR1_STEP=reading LABEL=before|after   the live reading model (extractOrder, the real prompt and schema) reads each request; then
//       before: today's search (search_catalog, 0053) on each line's query, as the ask loop calls it;
//       after:  the reading step (search-reading.ts) on the line and the customer's words, then find_products (0214), as the Concierge's tool.
//     Capped by MODEL_COST_CAP_USD (1 by default), counted in model_costs (workflow search-eval, step = LABEL).
//   SR1_STEP=embed EMBED_MODELS=@cf/baai/bge-m3,@cf/qwen/qwen3-embedding-0.6b   every search document and every request's query embedded on
//     Workers AI (REST), then words alone against hybrid (words and meaning fused), per language, on the request set and the meaning subset.
//     Each model's tokens and dollars are counted in model_costs (step embed:<model>), priced from model_prices (0212); no price, no call.
// The facts are the seeded test facts (evals/search/facts.json) in PGlite, never staging's. Writes evals/search/results/<step>-<label>.json.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../../test/db/harness";
import { seedSearchFacts } from "../../test/db/search-kit";
import { ALL_REQUESTS, scoreRequest, summarise, table, type Scored } from "./score";
import { startMeter, finishMeter, priceFor, costOfCall, type CostMeter } from "../../scripts/lib/model-cost.mjs";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const step = env.SR1_STEP ?? "";
const live = (step === "reading" && !!env.ANTHROPIC_API_KEY) || (step === "embed" && !!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID);
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const summaryFile = env.GITHUB_STEP_SUMMARY;

async function poolMap<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]!); } }));
  return out;
}
const write = (name: string, body: unknown, md: string) => {
  mkdirSync(here("results"), { recursive: true });
  writeFileSync(here(`results/${name}.json`), JSON.stringify(body, null, 1) + "\n");
  console.log(md);
  if (summaryFile) appendFileSync(summaryFile, md + "\n");
};
const split = (xs: Scored[]) => ({ set: summarise(xs.filter((x) => x.kind !== "meaning")), meaning: summarise(xs.filter((x) => x.kind === "meaning")) });

describe.skipIf(!live)("live: the search request set", () => {
  let meter: CostMeter; let db: TestDb; let skuOf: Map<string, string>;
  beforeAll(async () => {
    meter = await startMeter({ workflow: "search-eval", capDefault: 1, step: step === "reading" ? env.LABEL ?? "reading" : "embed" });
    db = await openTestDb(); ({ skuOf } = await seedSearchFacts(db));
  }, 300_000);
  afterAll(async () => { if (meter) await finishMeter(meter); await db?.pg.close(); });

  it.runIf(step === "reading")("the live reading model, then the search", async () => {
    const { extractOrder } = await import("../../packages/agents/src/concierge");
    const label = env.LABEL ?? "after", model = env.MODEL ?? "claude-haiku-5-5";
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, maxRetries: 6 });
    // after: the new reading step and search, imported only here so this file also runs on the code before SR1 (LABEL=before)
    // the paths are computed so that the code before SR1, which has no search-reading module, still loads this file
    const mod = (name: string) => import(/* @vite-ignore */ `../../packages/agents/src/${name}`);
    const after = label === "before" ? null : {
      read: (await mod("search-reading")) as typeof import("../../packages/agents/src/search-reading"),
      tools: (await mod("concierge-tools")) as typeof import("../../packages/agents/src/concierge-tools"),
    };
    const out = await poolMap(ALL_REQUESTS, 6, async (r) => {
      if (meter.capStop()) return { ...scoreRequest(r, []), lines: [], error: "cost cap reached: not run" };
      const res = await extractOrder(client, model, { texts: [r.text], transcripts: [], state: {} }).catch((e: unknown) => ({ intent: null, error: String(e) }));
      const lines = (res as { intent?: { lines: { raw: string; query: string; modifiers?: string[] }[] } | null }).intent?.lines ?? [];
      const got: string[] = [];
      for (const l of lines) {
        let found: { product_id: string }[] = [];
        if (!after) {
          const m = await db.rpc<{ matches: { product_id: string }[] }>("search_catalog", { p_query: l.query, p_source_hint: null, p_limit: 6 });
          found = m.matches ?? [];
        } else {
          const own = after.read.readSearch([l.raw, ...(l.modifiers ?? [])].join(" "));
          const q = own.query || l.query;
          const filters = after.read.mergeFilters(own.filters, after.tools.filtersSaidFor(q, r.text));
          const m = await db.rpc<{ matches: { product_id: string }[] }>("find_products", { p_query: q, p_filters: filters, p_limit: 6, p_embedding: null, p_model: null, p_cache_key: null });
          found = m.matches ?? [];
        }
        for (const f of found) { const s = skuOf.get(f.product_id) ?? "?"; if (!got.includes(s)) got.push(s); }
      }
      return { ...scoreRequest(r, got), lines: lines.map((l) => ({ raw: l.raw, query: l.query })), error: (res as { error?: string }).error ?? null };
    });
    const s = split(out);
    write(`reading-${label}`, { label, model, at: new Date().toISOString(), stopped_at_cap: meter.stoppedAtCap, summary: s.set, meaning: s.meaning, results: out },
      [table(`Live reading (${model}) then ${label === "before" ? "search_catalog" : "find_products"}: the request set`, s.set),
       table(`... the meaning subset`, s.meaning), `cost so far: USD ${meter.spent.toFixed(4)}${meter.stoppedAtCap ? " (STOPPED AT THE CAP)" : ""}`, ""].join("\n"));
    expect(out.length).toBe(ALL_REQUESTS.length);
  }, 3_600_000);

  it.runIf(step === "embed")("each embedding model against words alone", async () => {
    const mod = (name: string) => import(/* @vite-ignore */ `../../packages/agents/src/${name}`);
    const { restEmbedder, toVector } = (await mod("embeddings")) as typeof import("../../packages/agents/src/embeddings");
    const { readSearch } = (await mod("search-reading")) as typeof import("../../packages/agents/src/search-reading");
    const embedder = restEmbedder({ accountId: env.CLOUDFLARE_ACCOUNT_ID!, token: env.CLOUDFLARE_API_TOKEN! });
    const models = (env.EMBED_MODELS ?? "@cf/baai/bge-m3").split(",").map((m) => m.trim()).filter(Boolean);
    const day = new Date().toISOString().slice(0, 10);
    const docs = await db.all<{ product_id: string; document: string; digest: string }>(`select product_id, document, digest from product_search_documents order by product_id`);
    const readings = ALL_REQUESTS.map((r) => ({ r, reading: readSearch(r.text) }));
    const words: Scored[] = [];
    for (const { r, reading } of readings) {
      const m = await db.rpc<{ matches: { product_id: string }[] }>("find_products", { p_query: reading.query, p_filters: reading.filters, p_limit: 8, p_embedding: null, p_model: null, p_cache_key: null });
      words.push(scoreRequest(r, m.matches.map((x) => skuOf.get(x.product_id) ?? "?")));
    }
    const report: Record<string, unknown> = { at: new Date().toISOString(), words: split(words) };
    const md: string[] = [table("Words alone (find_products): the request set", split(words).set), table("Words alone: the meaning subset", split(words).meaning)];
    for (const model of models) {
      const price = priceFor(meter.prices ?? [], model, day);
      if (!price) { md.push(`**${model}: no model_prices row on staging: not called (never counted as free).**`); continue; }
      const count = (tokens: number) => meter.addLine({ model, step: `embed:${model}`, calls: 1, input_tokens: tokens, usd: costOfCall(price, { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 }) });
      const t0 = Date.now();
      try {
        for (let i = 0; i < docs.length; i += 50) {
          if (meter.capStop()) throw new Error("cost cap reached");
          const batch = docs.slice(i, i + 50);
          const { vectors, tokens } = await embedder.embed(model, batch.map((d) => d.document), "document");
          count(tokens);
          await db.rpc("save_product_embeddings", { p_model: model, p_rows: batch.map((d, k) => ({ product_id: d.product_id, digest: d.digest, embedding: vectors[k] })) });
        }
        const queries = [...new Set(readings.map((x) => x.reading.query).filter(Boolean))];
        const qv = new Map<string, number[]>();
        for (let i = 0; i < queries.length; i += 50) {
          if (meter.capStop()) throw new Error("cost cap reached");
          const batch = queries.slice(i, i + 50);
          const { vectors, tokens } = await embedder.embed(model, batch, "query");
          count(tokens);
          batch.forEach((q, k) => qv.set(q, vectors[k]!));
        }
        const perQueryMs = (Date.now() - t0) / Math.max(1, docs.length + queries.length);
        for (const cut of [0.45, 0.55, 0.65]) {
          await db.pg.query(`update settings set value = value || jsonb_build_object('meaning_max_distance', $1::numeric) where key = 'search'`, [cut]);
          const hybrid: Scored[] = [];
          for (const { r, reading } of readings) {
            const v = qv.get(reading.query);
            const m = await db.rpc<{ matches: { product_id: string }[] }>("find_products", { p_query: reading.query, p_filters: reading.filters, p_limit: 8,
              p_embedding: v ? toVector(v) : null, p_model: model, p_cache_key: null });
            hybrid.push(scoreRequest(r, m.matches.map((x) => skuOf.get(x.product_id) ?? "?")));
          }
          report[`${model}@${cut}`] = split(hybrid);
          md.push(table(`Hybrid with ${model}, meaning_max_distance ${cut}: the request set`, split(hybrid).set),
                  table(`Hybrid with ${model}, meaning_max_distance ${cut}: the meaning subset`, split(hybrid).meaning));
        }
        md.push(`${model}: ${docs.length} documents and ${queries.length} queries embedded; about ${perQueryMs.toFixed(0)} ms a text over REST from the runner.`);
      } catch (e) {
        md.push(`**${model}: failed: ${String((e as Error).message).slice(0, 300)}**`);
        report[`${model}:error`] = String((e as Error).message).slice(0, 300);
      }
    }
    md.push(`cost: USD ${meter.spent.toFixed(6)}`);
    write("embed", report, md.join("\n"));
  }, 3_600_000);
});
