// AST1: the nightly digest. The facts come from the database (assistant_digest_facts: 0261's tools, numbers only); the digest model
// (claude-haiku-5-5 by settings.assistant) writes a short text from them in English and Arabic: what went well, what went wrong with
// numbers, slow places, repeated failed searches, things asked for that we don't sell, and the top three things to fix (chosen only from the
// facts' candidates). Every figure in the text is checked against the facts; a text that fails twice is not kept (the facts are).
// It runs with the console's nightly cron, only while the assistant is on and under its caps. It never sends anything.
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db";
import { unsupportedNumbers } from "./guard";
import { readSpend, type ModelFn } from "./run";

const DIGEST_PROMPT = `You write the nightly digest of Alo King's operations for its staff, from the facts given as JSON. Write two versions with the same content: English and Arabic (Western digits).
Each version: at most 10 short lines, in this order:
- What went well (one or two lines).
- What went wrong, with the numbers.
- Slow places, failed searches and things customers asked for that we don't sell, when there are any.
- "Top 3 to fix": at most three items, chosen ONLY from fix_candidates, in their order, each with its figure and its page as [words](/page).
Rules: every number must appear in the facts; never compute new numbers; never praise or criticise a place, a product or a person; never say food is healthy; if a part has no data, say nothing about it.
Answer with JSON only: {"en": "...", "ar": "..."}.`;

export interface DigestResult { day: string; saved: boolean; text: boolean; usd: number; reason?: string }

export async function writeDigest(db: Db, model: ModelFn, now: Date, day?: string): Promise<DigestResult> {
  const d = day ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(now);
  const spend = await readSpend(db, now);
  if (!spend.allowed) return { day: d, saved: false, text: false, usd: 0, reason: spend.reason ?? "off" };
  const facts = await db.rpc<Record<string, unknown>>("assistant_digest_facts", { p_day: d, p_now: now.toISOString() });
  const factsText = JSON.stringify(facts);
  let usd = 0;
  let out: { en: string; ar: string } | null = null;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: `Facts for ${d}:\n${factsText}` }];
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const res = await model({ model: spend.digest_model, max_tokens: 2500, system: DIGEST_PROMPT, messages, output_config: { effort: "low" } } as Anthropic.Messages.MessageCreateParamsNonStreaming);
    const u = res.usage;
    usd += Number(await db.rpc("ast_record_cost", { p_workflow: "assistant-digest", p_model: spend.digest_model, p_step: "digest", p_in: u?.input_tokens ?? 0,
      p_out: u?.output_tokens ?? 0, p_cache_read: u?.cache_read_input_tokens ?? 0, p_cache_write: u?.cache_creation_input_tokens ?? 0 }));
    const text = res.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text").map((b) => b.text).join("");
    let parsed: { en?: unknown; ar?: unknown } | null = null;
    try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { parsed = null; }
    const en = typeof parsed?.en === "string" ? parsed.en.trim() : "", ar = typeof parsed?.ar === "string" ? parsed.ar.trim() : "";
    const bad = [...unsupportedNumbers(en, [factsText, d]), ...unsupportedNumbers(ar, [factsText, d])];
    if (en && ar && !bad.length) { out = { en, ar }; break; }
    messages.push({ role: "assistant", content: text || "{}" },
      { role: "user", content: bad.length ? `These numbers are not in the facts: ${[...new Set(bad)].join(", ")}. Write it again with only numbers from the facts, as JSON {"en","ar"}.` : `Answer with JSON only: {"en": "...", "ar": "..."}.` });
  }
  await db.rpc("ast_digest_save", { p_day: d, p_facts: facts, p_text_en: out?.en ?? null, p_text_ar: out?.ar ?? null, p_model: spend.digest_model, p_usd: usd });
  return { day: d, saved: true, text: !!out, usd };
}

/** The latest digest for Today (the newest day that has one, within the last 3 days). */
export async function latestDigest(db: Db): Promise<{ day: string; text_en: string | null; text_ar: string | null } | null> {
  const rows = await db.rows<{ day: string; text_en: string | null; text_ar: string | null }>("assistant_digests", { select: "day,text_en,text_ar", order: [{ col: "day", desc: true }], limit: 1 });
  return rows[0] ?? null;
}
