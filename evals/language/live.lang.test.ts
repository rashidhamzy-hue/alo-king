// Build plan 1.22: the catalog language eval on the live model. Skipped unless asked for (it spends money):
//   ALO_LANG_EVAL=1 ANTHROPIC_API_KEY=... MODEL=claude-haiku-5-5 LABEL=after npx vitest run evals/language/live.lang.test.ts
// Each case goes through the production path: extractOrder() (the real prompt, schema and forced call) on the live model,
// then plan_order() on PGlite loaded with every migration and the catalog seeds. The matched products are scored against the
// truth (score.ts). Writes evals/language/results/<LABEL>.json; the workflow puts the summary on the run page.
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractOrder } from "../../packages/agents/src/concierge";
import { openTestDb } from "../../test/db/harness";
import { scoreCase, totals, type Expected, type Got, type CaseScore } from "./score";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const live = env.ALO_LANG_EVAL === "1" && !!env.ANTHROPIC_API_KEY;
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

interface Case { id: string; kind: string; lang: string; text: string; items: Expected[] }
const load = (f: string): Case[] => existsSync(here(f)) ? (JSON.parse(readFileSync(here(f), "utf8")) as { cases: Case[] }).cases : [];

async function poolMap<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]!); } }));
  return out;
}

describe.skipIf(!live)("live: catalog language (1.22)", () => {
  it("scores the eval set", async () => {
    const model = env.MODEL ?? "claude-haiku-5-5", label = env.LABEL ?? "run", repeat = Number(env.REPEAT ?? 1);
    const only = env.ONLY ? new Set(env.ONLY.split(",")) : null;
    const cases = [...load("hand.json"), ...load("cases.json")].filter((c) => !only || only.has(c.id) || only.has(c.kind));
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, maxRetries: 6 });
    const db = await openTestDb();
    const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
    const skuOf = new Map((await db.all<{ id: string; sku: string }>(`select id, sku from products`)).map((r) => [r.id, r.sku]));
    const usage = { input: 0, output: 0 };

    const runs = await poolMap(cases.flatMap((c) => Array.from({ length: repeat }, (_, k) => ({ c, k }))), 8, async ({ c, k }) => {
      const r = await extractOrder(client, model, { texts: [c.text], transcripts: [], state: {} }).catch((e) => ({ intent: null, errors: String(e), usage: { input: 0, output: 0 } }));
      usage.input += r.usage.input; usage.output += r.usage.output;
      let lines: any[] = []; let next: string | null = null;
      if (r.intent) {
        // the turn passes the customer's own words with the reading (pipeline.ts planReading); on older code the key is ignored
        const plan = await db.rpc("plan_order_core", { p_party: party, p_intent: { ...r.intent, _message: c.text }, p_village: null, p_choices: {} });
        lines = plan.lines ?? []; next = plan.next;
      }
      const got: Got[] = lines.filter((l) => l.status === "matched" && l.chosen).map((l) => ({ sku: skuOf.get(l.chosen.product_id) ?? "?", assumed: !!l.assumed }));
      const s = scoreCase(c.items, got);
      return { id: c.id, k, kind: c.kind, lang: c.lang, text: c.text, expected: c.items, got, score: s, next,
               errors: (r as { errors?: unknown }).errors ?? null,
               lines: (r.intent?.lines ?? []).map((l, i) => ({ raw: l.raw, query: l.query, brand_hint: l.brand_hint, source_hint: l.source_hint, qty: l.qty, unit: l.unit, modifiers: l.modifiers, status: lines[i]?.status ?? null,
                        candidates: (lines[i]?.candidates ?? []).map((x: any) => skuOf.get(x.product_id)) })) };
    });

    const by = (key: (r: typeof runs[number]) => string) => {
      const groups = new Map<string, CaseScore[]>();
      for (const r of runs) { const g = key(r); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r.score); }
      return Object.fromEntries([...groups].map(([g, s]) => [g, totals(s)]));
    };
    const all = totals(runs.map((r) => r.score));
    const card0013 = runs.filter((r) => r.id === "h0013").map((r) => r.score.tp === 3 && r.score.wrong.length === 0);
    const report = { label, model, repeat, at: new Date().toISOString(), usage, all, by_kind: by((r) => r.kind), by_lang: by((r) => r.lang),
      demo_0013_right: card0013, wrong: runs.filter((r) => r.score.wrong.length).map(({ id, text, expected, got, lines }) => ({ id, text, expected, got, lines })),
      missed: runs.filter((r) => r.score.missed.length).map(({ id, text, score, lines, errors }) => ({ id, text, missed: score.missed, lines, errors })),
      // every reading, so replay.test.ts can run the same readings through a changed planner without the model
      readings: runs.map(({ id, k, lines }) => ({ id, k, lines: lines.map(({ raw, query, brand_hint, source_hint, qty, unit, modifiers }) => ({ raw, query, brand_hint, source_hint, qty, unit, modifiers })) })) };
    mkdirSync(here("results"), { recursive: true });
    writeFileSync(here(`results/${label}.json`), JSON.stringify(report, null, 1) + "\n");
    const md = [`### Catalog language eval: ${label} (${model}, ${runs.length} runs)`, "",
      `| | items | F1 | precision | recall | wrong products | missed |`, `| --- | --- | --- | --- | --- | --- | --- |`,
      ...Object.entries({ all, ...report.by_kind, ...report.by_lang }).map(([k, t]) => `| ${k} | ${t.items} | ${t.f1} | ${t.precision} | ${t.recall} | ${t.fp} | ${t.fn} |`),
      "", `0.13 demo message right: ${JSON.stringify(card0013)}`, ""].join("\n");
    console.log(md);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n");
    expect(runs.length).toBeGreaterThan(0);
  }, 3_600_000);
});
