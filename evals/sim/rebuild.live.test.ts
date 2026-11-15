// SIM1: the report and the failing cases again, from a finished run's files (results.jsonl and summary.json), with no model call.
// Skipped unless asked for:  SIM_REBUILD=<run dir> [SIM_RUN_URL=...] [SIM_COMMIT=...] npx vitest run evals/sim/rebuild.live.test.ts
// Writes report.md and cases/<class>.json into the same directory.
import { describe, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildReport } from "./report";
import type { ConversationResult, RunSummary } from "./run";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const dir = env.SIM_REBUILD;

describe.skipIf(!dir)("SIM1: rebuild the report from a run's files", () => {
  it("writes report.md and the cases", () => {
    const results = readFileSync(`${dir}/results.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ConversationResult);
    const summary = { ...(JSON.parse(readFileSync(`${dir}/summary.json`, "utf8")) as RunSummary), results };
    const { markdown, cases } = buildReport({ summary, runUrl: env.SIM_RUN_URL ?? null, commit: env.SIM_COMMIT ?? null, date: env.SIM_DATE ?? summary.started.slice(0, 10) });
    mkdirSync(`${dir}/cases`, { recursive: true });
    writeFileSync(`${dir}/report.md`, markdown);
    for (const [name, body] of Object.entries(cases)) writeFileSync(`${dir}/cases/${name}.json`, JSON.stringify(body, null, 1) + "\n");
  });
});
