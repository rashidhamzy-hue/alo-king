// Merchant copilot eval (DECISIONS §39.7, §32.4): evals/merchant/cases.jsonl in four languages against the real model
// with the copilot's own system prompt and typed tools (supabase/functions/dispatch/merchant/copilot-model.ts). A case
// scores when the tool call, after the same input checks the bot runs, becomes the expected command kind ("none" = the
// model declined). Cases with `rules: true` are also read by the rules and replayed in CI on every PR (copilot.test.ts).
// Gate: ai_merchant_text_enabled stays off until a model reaches GATE_ALL overall and GATE_LANG in every language;
// switching it on is a dated config row in a PR. Without a key or API credit it prints SKIPPED and succeeds (§32.7).
// Usage: node --experimental-strip-types scripts/evals/merchant-eval.ts [model ...]
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import {
  MERCHANT_SYSTEM,
  MERCHANT_TOOLS,
  toolToCommand,
} from "../../supabase/functions/dispatch/merchant/copilot-model.ts";

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["claude-haiku-4-5-20251001", "claude-haiku-5-5", "claude-sonnet-5-5"];
const GATE_ALL = 0.9;
const GATE_LANG = 0.85;
const claude = new Anthropic();
const cases = readFileSync("evals/merchant/cases.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

async function modelUnavailable(): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return "no ANTHROPIC_API_KEY";
  try {
    await claude.messages.create({
      model: models[0],
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return null;
  } catch (e) {
    const status = (e as { status?: number }).status;
    const text = String(e);
    if (status === 401 || status === 402 || status === 403 || /credit balance|billing/i.test(text))
      return `API unavailable (${status ?? "error"}: ${text.slice(0, 80)})`;
    return null;
  }
}
const unavailable = await modelUnavailable();
if (unavailable) {
  console.log(
    `## Merchant copilot eval\n\nSKIPPED: ${unavailable}. Model cases are skipped, not failed (DECISIONS §32.7). The rule cases run in CI (copilot.test.ts).`,
  );
  process.exit(0);
}

const now = new Date();
type Res = { id: string; lang: string; ok: boolean; got: string; ms: number };
async function run(model: string, c: any): Promise<Res> {
  const t0 = Date.now();
  const msg = await claude.messages.create({
    model,
    max_tokens: 300,
    system: [
      {
        type: "text",
        text: `${MERCHANT_SYSTEM}\nToday in Beirut: ${now.toISOString().slice(0, 10)}.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: MERCHANT_TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: c.text }],
  });
  const use = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const cmd = use ? toolToCommand(use.name, use.input, now) : null;
  const got = cmd?.kind ?? "none";
  return {
    id: c.id,
    lang: c.lang,
    ok: got === c.expect.kind,
    got: `${use?.name ?? "text"} → ${got}`,
    ms: Date.now() - t0,
  };
}

const lines: string[] = ["| model | lang | cases | correct | p50 ms |", "|---|---|---|---|---|"];
const gates: string[] = [];
const misses: string[] = [];
for (const model of models) {
  const res: Res[] = [];
  for (const c of cases) {
    try {
      res.push(await run(model, c));
    } catch (e) {
      res.push({
        id: c.id,
        lang: c.lang,
        ok: false,
        got: `error ${String(e).slice(0, 60)}`,
        ms: 0,
      });
    }
  }
  const share = (lang: string) => {
    const r = res.filter((x) => lang === "all" || x.lang === lang);
    return r.filter((x) => x.ok).length / Math.max(r.length, 1);
  };
  for (const lang of ["ar", "arabizi", "en", "fr", "all"]) {
    const r = res.filter((x) => lang === "all" || x.lang === lang);
    const ms = r.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(r.length / 2)] ?? 0;
    lines.push(`| ${model} | ${lang} | ${r.length} | ${(100 * share(lang)).toFixed(0)}% | ${ms} |`);
  }
  const pass =
    share("all") >= GATE_ALL && ["ar", "arabizi", "en", "fr"].every((l) => share(l) >= GATE_LANG);
  gates.push(`| ${model} | ${(100 * share("all")).toFixed(0)}% | ${pass ? "PASS" : "FAIL"} |`);
  for (const r of res.filter((x) => !x.ok)) {
    const c = cases.find((x: any) => x.id === r.id);
    misses.push(`| ${model} | ${r.id} | ${c.text} | ${c.expect.kind} | ${r.got} |`);
  }
}
console.log(
  [
    "## Merchant copilot eval",
    "",
    `Gate for merchant free text (§32.4, §39.7): ${GATE_ALL * 100}% overall and ${GATE_LANG * 100}% in every language.`,
    "",
    "| model | overall | gate |",
    "|---|---|---|",
    ...gates,
    "",
    "A PASS allows a PR with a dated app_config row ai_merchant_text_enabled = true (and ai_merchant_model set to the passing model). Every change still waits for the merchant's tap.",
    "",
    ...lines,
    "",
    "### Misses",
    "",
    "| model | case | text | expected | got |",
    "|---|---|---|---|---|",
    ...misses,
  ].join("\n"),
);
