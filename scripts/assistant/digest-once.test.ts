// FIX2: the nightly digest, once, by hand (the `assistant-digest` workflow), for a check after a fix. The same code the console's 21:40 cron
// runs (writeDigest -> assistant_digest_facts as assistant_reader -> the digest model of settings.assistant, claude-haiku-5-5), on the
// staging database, under the assistant's own caps (over a cap it writes nothing and spends nothing); the cost is recorded in model_costs
// (workflow assistant-digest). It writes one row of assistant_digests and sends nothing. Skipped unless ALO_DIGEST_ONCE=1 (never in CI).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY; DIGEST_DAY (YYYY-MM-DD, Beirut) optional, default today.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { supabaseDb } from "../../apps/console/src/db";
import { anthropicModel } from "../../apps/console/src/assistant/run";
import { writeDigest } from "../../apps/console/src/assistant/digest";

const env = process.env;
const on = env.ALO_DIGEST_ONCE === "1" && !!env.ANTHROPIC_API_KEY && !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_KEY;

describe.skipIf(!on)("the nightly digest, once, on staging", () => {
  it("writes the day's row", async () => {
    const url = env.SUPABASE_URL!, key = env.SUPABASE_SERVICE_KEY!;
    const day = env.DIGEST_DAY && /^\d{4}-\d{2}-\d{2}$/.test(env.DIGEST_DAY) ? env.DIGEST_DAY : undefined;
    const db = supabaseDb(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), { url, key });
    const r = await writeDigest(db, anthropicModel(env.ANTHROPIC_API_KEY!), new Date(), day);
    const rows = await db.rows<{ day: string; model: string; text_en: string | null }>("assistant_digests", { select: "day,model,text_en", where: { day: r.day }, limit: 1 });
    const line = `- digest of ${r.day}: saved ${r.saved}, text ${r.text}, USD ${r.usd.toFixed(4)}${r.reason ? `, not written: ${r.reason}` : ""}; row in assistant_digests: ${
      rows.length ? `yes (model ${rows[0]!.model}, text ${rows[0]!.text_en ? "present" : "none"})` : "no"}`;
    console.log(line);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, line + "\n");
    expect(rows).toHaveLength(1);
  }, 120_000);
});
