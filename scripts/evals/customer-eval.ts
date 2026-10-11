// Customer AI eval (DECISIONS §7 Phase 3, §29.3): the four-language set in evals/customer/cases.jsonl run
// against the real model with the bot's own system prompt and typed tools. Cases with `expect.intent` are
// deterministic and run in CI on every PR (intents.test.ts); this script scores the model cases: the right
// tool, and the key argument where the case names one. Prints a table by language and model.
// Usage: node --experimental-strip-types scripts/evals/customer-eval.ts [model ...]
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT, TOOLS } from "../../supabase/functions/dispatch/customer/tools.ts";

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["claude-haiku-4-5-20251001", "claude-sonnet-5-5"];
const claude = new Anthropic();
const cases = readFileSync("evals/customer/cases.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((c) => c.expect.tool);
const LANG: Record<string, string> = {
  ar: "Lebanese Arabic",
  en: "English",
  fr: "French",
  arabizi: "Arabizi (Lebanese Arabic in Latin letters)",
};

type Res = {
  id: string;
  lang: string;
  ok: boolean;
  got: string;
  ms: number;
  inTok: number;
  outTok: number;
};
async function run(model: string, c: any): Promise<Res> {
  const context = {
    reply_language: LANG[c.lang],
    refs: {},
    focused_place: null,
    basket: null,
    open_orders: [],
    pending_question: null,
    customer: { past_orders: 0 },
    ...(c.context ?? {}),
  };
  const t0 = Date.now();
  const msg = await claude.messages.create({
    model,
    max_tokens: 700,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `<context>\n${JSON.stringify(context)}\n</context>\n<customer_message>\n${c.text}\n</customer_message>`,
      },
    ],
  });
  const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const hit = uses.find((u) => u.name === c.expect.tool) as any;
  let ok = !!hit;
  const a = c.expect.args ?? {};
  if (ok && a.query_contains)
    ok = String(hit.input.query ?? "")
      .toLowerCase()
      .includes(String(a.query_contains).toLowerCase());
  if (ok && a.first_quantity) ok = hit.input.items?.[0]?.quantity === a.first_quantity;
  if (ok && a.key) ok = hit.input.key === a.key;
  return {
    id: c.id,
    lang: c.lang,
    ok,
    got: uses.map((u) => u.name).join("+") || "text",
    ms: Date.now() - t0,
    inTok: msg.usage.input_tokens,
    outTok: msg.usage.output_tokens,
  };
}

// DECISIONS §32.7: without API credit (or a key) a model eval is reported as skipped, not failed.
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
    `## Customer AI eval\n\nSKIPPED: ${unavailable}. Model cases are skipped, not failed (DECISIONS §32.7).`,
  );
  process.exit(0);
}

const lines: string[] = ["| model | lang | cases | correct | p50 ms |", "|---|---|---|---|---|"];
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
        inTok: 0,
        outTok: 0,
      });
    }
  }
  for (const lang of ["ar", "arabizi", "en", "fr", "all"]) {
    const r = res.filter((x) => lang === "all" || x.lang === lang);
    const ms = r.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(r.length / 2)] ?? 0;
    lines.push(
      `| ${model} | ${lang} | ${r.length} | ${((100 * r.filter((x) => x.ok).length) / Math.max(r.length, 1)).toFixed(0)}% | ${ms} |`,
    );
  }
  for (const r of res.filter((x) => !x.ok)) {
    const c = cases.find((x: any) => x.id === r.id);
    misses.push(`| ${model} | ${r.id} | ${c.text} | ${c.expect.tool} | ${r.got} |`);
  }
}
console.log(
  [
    "## Customer AI eval",
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
