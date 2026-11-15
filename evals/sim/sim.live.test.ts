// SIM1 entry point. Skipped unless asked for. In the workflow (.github/workflows/sim-test.yml):
//   ALO_SIM=1 ANTHROPIC_API_KEY_SIM=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx vitest run evals/sim/sim.live.test.ts
// A dry run with stand-in models and the repository seeds, no key, no network:
//   ALO_SIM=1 SIM_MOCK=1 SIM_LIMIT=12 SIM_OUT=out/sim npx vitest run evals/sim/sim.live.test.ts
// Settings (environment): SIM_LIMIT (first N scenarios), SIM_ONLY (comma-separated ids), SIM_CONCURRENCY (8), SIM_SOFT (27),
// SIM_HARD (33), SIM_BUDGET_USD (if set: no new conversation from 85% of it, every call refused at it; replaces SOFT and HARD),
// SIM_FOLLOWUP (a selection file such as evals/sim/followup-2026-11-15.json: its cut_off ids run as first attempts, its again ids
// once more as attempt 1, nothing else), SIM_REPEATS (3), SIM_MAX_MINUTES (300), SIM_OUT (where results go), SIM_COPY (staging | repo).
// It runs through vitest because the Concierge imports its prompt as a .md module (see evals/README.md).
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KAPSO_ORIGIN, MEDIA_ORIGIN } from "./driver";
import { installFetchGuard } from "./guard";
import { mockConcierge, mockCustomer, mockJudge } from "./mock";
import { buildReport } from "./report";
import { runAll } from "./run";
import { readStaging } from "./staging";
import { limitsFor } from "./budget";
import type { Scenario } from "./scenarios";
import scenarioFile from "./scenarios.json";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const on = env.ALO_SIM === "1";

/** The model ids the Worker uses (wrangler.jsonc vars), unless the environment names them (the workflow reads them from the same file). */
export function wranglerVar(name: string): string | null {
  if (env[name]) return env[name]!;
  const raw = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8");
  return raw.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
}

/** The mock customer reads its items and village from the scenario text in its system prompt. */
const mockItems = (system: string): string => {
  const items = [...system.matchAll(/\d+ × ([^;(]+?)(?: \([^)]*\))?(?=;| for delivery|\. |$)/g)].map((m) => m[1]!.trim());
  const village = system.match(/You live in ([^(]+) \(/)?.[1]?.trim() ?? "Baakline";
  return items.length ? `${items.join(", ")} - deliver to ${village}` : "hello, what do you sell?";
};

describe.skipIf(!on)("SIM1: simulated customers", () => {
  it("runs the scenarios against the real turn code and writes the report", async () => {
    const mock = env.SIM_MOCK === "1";
    const key = env.ANTHROPIC_API_KEY_SIM;
    if (!mock && !key) throw new Error("ANTHROPIC_API_KEY_SIM is not set. The simulation uses that key only and never falls back to another; add the repository secret ANTHROPIC_API_KEY_SIM.");
    const copyMode = env.SIM_COPY ?? (mock ? "repo" : "staging");
    const stagingUrl = env.SUPABASE_URL ?? null;
    if (copyMode === "staging" && (!stagingUrl || !env.SUPABASE_SERVICE_KEY)) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed to copy staging's catalogue (read only)");
    const log = (s: string) => console.log(s);
    const guard = installFetchGuard({ stagingOrigin: stagingUrl ? new URL(stagingUrl).origin : null, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN,
                                      allowHosts: mock ? [] : ["api.anthropic.com"] });
    try {
      const copy = copyMode === "staging" ? await readStaging(stagingUrl!, env.SUPABASE_SERVICE_KEY!, globalThis.fetch, log) : null;
      const models = { concierge: wranglerVar("MODEL_FAST")!, customer: wranglerVar("MODEL_SMART")!, judge: wranglerVar("MODEL_SMART")! };
      if (!models.concierge || !models.customer) throw new Error("MODEL_FAST / MODEL_SMART not found in wrangler.jsonc");
      // Clients are made after the guard is in place: the SDK keeps the fetch it finds when it is built.
      const raw = mock ? { concierge: mockConcierge(), customer: mockCustomer(mockItems), judge: mockJudge() }
        : { concierge: new Anthropic({ apiKey: key!, maxRetries: 0 }),         // as the Worker builds it: turn.ts retries capacity itself
            customer: new Anthropic({ apiKey: key!, maxRetries: 4 }), judge: new Anthropic({ apiKey: key!, maxRetries: 4 }) };
      let scenarios = scenarioFile as Scenario[];
      if (env.SIM_ONLY) { const ids = new Set(env.SIM_ONLY.split(",").map((s) => s.trim())); scenarios = scenarios.filter((s) => ids.has(s.id)); }
      let again = new Set<string>();
      if (env.SIM_FOLLOWUP) {
        const f = JSON.parse(readFileSync(fileURLToPath(new URL(`../../${env.SIM_FOLLOWUP}`, import.meta.url)), "utf8")) as { cut_off: string[]; again: { id: string }[] };
        again = new Set(f.again.map((a) => a.id));
        const ids = new Set([...f.cut_off, ...again]);
        scenarios = scenarios.filter((s) => ids.has(s.id));
        log(`[sim] follow-up ${env.SIM_FOLLOWUP}: ${f.cut_off.length} first attempts, ${again.size} seeds once more`);
      }
      if (env.SIM_LIMIT) scenarios = scenarios.slice(0, Number(env.SIM_LIMIT));
      const limits = limitsFor(env.SIM_BUDGET_USD, Number(env.SIM_SOFT ?? 27), Number(env.SIM_HARD ?? 33));
      log(`[sim] budget: no new conversation from USD ${limits.soft}, every call refused at USD ${limits.hard}`);
      const outDir = env.SIM_OUT ?? null;
      const summary = await runAll({ scenarios, copy, guard, raw, models, outDir, log,
        soft: limits.soft, hard: limits.hard, attemptOf: (s) => (again.has(s.id) ? 1 : 0), concurrency: Number(env.SIM_CONCURRENCY ?? 8),
        calibrate: Number(env.SIM_CALIBRATE ?? 20), reruns: Number(env.SIM_REPEATS ?? 3), maxMinutes: Number(env.SIM_MAX_MINUTES ?? 300) });
      const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
      const { markdown, cases } = buildReport({ summary, runUrl, commit: env.GITHUB_SHA ?? null, date: new Date().toISOString().slice(0, 10) });
      if (outDir) {
        mkdirSync(`${outDir}/cases`, { recursive: true });
        writeFileSync(`${outDir}/report.md`, markdown);
        for (const [name, body] of Object.entries(cases)) writeFileSync(`${outDir}/cases/${name}.json`, JSON.stringify(body, null, 1) + "\n");
      }
      // The proofs, every run: nothing reached staging but GET during the copy, nothing reached Kapso.
      expect(guard.staging.filter((r) => r.method !== "GET")).toEqual([]);
      expect(guard.refused.filter((r) => r.why !== "host not allowed")).toEqual([]);
      log(`[sim] staging requests: ${guard.staging.length} (all GET); Kapso sends recorded: ${guard.kapso.length}; refused: ${guard.refused.length}`);
    } finally { guard.restore(); }
  }, 7 * 3600_000);
});
