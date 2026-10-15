// Voice eval (DECISIONS §30.7, §32.4): each labelled real voice note in evals/voice/batch-NN/ is transcribed with the
// vocabulary prompt, read by the customer model with the bot's own prompt and tools, and the basket it asks for is
// compared with the label (items and quantities). The metric is the basket, not the words (§32.4): the gate is 85% exact
// before any question. Voice stays off (config ai_voice_enabled) until it passes.
// Without labelled notes, an OpenAI key, or Anthropic credit the eval prints SKIPPED and exits 0 (§32.7): skipped, not failed.
// Usage: node --experimental-strip-types scripts/evals/voice-eval.ts [model]
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_PROMPT, TOOLS } from "../../supabase/functions/dispatch/customer/tools.ts";

const model = process.argv[2] ?? "claude-haiku-4-5-20251001";
const GATE = 0.85;
const skip = (why: string) => {
  console.log(
    `## Voice eval\n\nSKIPPED: ${why}. Voice notes stay off (ai_voice_enabled) until this eval passes (DECISIONS §32.4, §32.7).`,
  );
  process.exit(0);
};

type Label = {
  file: string;
  transcript: string;
  items: { name: string; quantity: number }[];
  needs_review: boolean;
};
function labels(): Label[] {
  const root = "evals/voice";
  const out: Label[] = [];
  for (const b of readdirSync(root)
    .filter((d) => /^batch-\d+$/.test(d))
    .sort()) {
    const f = join(root, b, "labels.csv");
    if (!existsSync(f)) continue;
    const [head, ...rows] = readFileSync(f, "utf8").trim().split("\n");
    const cols = head.split(",");
    for (const r of rows) {
      const v = r.split(",");
      const get = (k: string) => v[cols.indexOf(k)] ?? "";
      // expected_items: "2x shawarma; 1x fries"
      const items = get("expected_items")
        .split(";")
        .map((x) => /(\d+)\s*x\s*(.+)/i.exec(x.trim()))
        .filter(Boolean)
        .map((m) => ({ quantity: Number(m![1]), name: m![2].trim().toLowerCase() }));
      if (get("needs_review") === "true") continue; // only notes Rasheed confirmed count
      out.push({
        file: join(root, b, get("file")),
        transcript: get("transcript"),
        items,
        needs_review: false,
      });
    }
  }
  return out;
}

const set = labels();
if (!set.length)
  skip(
    "no confirmed voice labels yet (labels.csv is produced by voice-label.yml once the OpenAI key works, #77)",
  );
if (!process.env.OPENAI_API_KEY) skip("no OPENAI_API_KEY for transcription");
if (!process.env.ANTHROPIC_API_KEY) skip("no ANTHROPIC_API_KEY");
const claude = new Anthropic();
try {
  await claude.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  });
} catch (e) {
  const status = (e as { status?: number }).status;
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    /credit balance|billing/i.test(String(e))
  )
    skip(`Anthropic API unavailable (${status ?? "error"})`);
}

const vocab = readFileSync("evals/voice/vocabulary.txt", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .join(", ")
  .slice(0, 800);
let exact = 0;
const rows: string[] = [];
for (const l of set) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(l.file)], { type: "audio/ogg" }), "note.ogg");
  form.append("model", process.env.TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe");
  form.append(
    "prompt",
    `Lebanese food order, Arabic (Lebanese dialect) mixed with English or French. Words: ${vocab}`,
  );
  const t = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!t.ok) skip(`OpenAI transcription answered ${t.status}`);
  const text = String((await t.json()).text ?? "");
  const msg = await claude.messages.create({
    model,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    tools: TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `<context>\n{"reply_language":"Lebanese Arabic","refs":{}}\n</context>\n<voice_transcript>\n${text}\n</voice_transcript>`,
      },
    ],
  });
  const got = msg.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .flatMap((u: any) =>
      u.name === "add_items"
        ? (u.input.items ?? []).map((i: any) => ({
            name: String(i.name ?? "").toLowerCase(),
            quantity: i.quantity,
          }))
        : u.name === "search_items"
          ? [{ name: String(u.input.query ?? "").toLowerCase(), quantity: u.input.quantity ?? 1 }]
          : [],
    );
  const ok =
    got.length === l.items.length &&
    l.items.every((e) =>
      got.some(
        (g: any) =>
          g.quantity === e.quantity && (g.name.includes(e.name) || e.name.includes(g.name)),
      ),
    );
  if (ok) exact++;
  rows.push(
    `| ${l.file.split("/").pop()} | ${ok ? "✓" : "✗"} | ${text.slice(0, 60).replace(/\|/g, "/")} |`,
  );
}
const share = exact / set.length;
console.log(
  [
    "## Voice eval",
    "",
    `${model}: ${exact}/${set.length} exact baskets before any question (${(100 * share).toFixed(0)}%), gate ${GATE * 100}%: **${share >= GATE ? "PASS" : "FAIL"}**`,
    "",
    "A PASS means voice may be switched on: a PR with a dated app_config row ai_voice_enabled = true. Nothing switches by itself.",
    "",
    "| note | basket | transcript |",
    "|---|---|---|",
    ...rows,
  ].join("\n"),
);
