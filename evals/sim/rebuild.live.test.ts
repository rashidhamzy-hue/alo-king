// SIM1: the report and the failing cases again, from finished runs' files (results.jsonl and summary.json), with no model call.
// Skipped unless asked for:
//   SIM_REBUILD=<run dir>[,<later run dir>...] [SIM_REBUILD_OUT=<dir>] [SIM_RUN_URL=...] [SIM_COMMIT=...] npx vitest run evals/sim/rebuild.live.test.ts
//     Several runs are read as one (merge.ts): a later run's result replaces an earlier one with the same scenario and attempt.
//     Writes report.md and cases/<class>.json into SIM_REBUILD_OUT (default: the last run's directory).
//   SIM_PICK=<run dir> [SIM_PICK_N=100] [SIM_PICK_OUT=<file>] npx vitest run evals/sim/rebuild.live.test.ts
//     The follow-up's seeds: the first attempts that did not run (cut off), and N failing seeds in proportion to the ten fixes (fixes.ts).
import { describe, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildReport } from "./report";
import { mergeRuns } from "./merge";
import { pickFollowUp } from "./fixes";
import type { ConversationResult, RunSummary } from "./run";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const read = (dir: string) => ({
  label: dir,
  results: readFileSync(`${dir}/results.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ConversationResult),
  summary: JSON.parse(readFileSync(`${dir}/summary.json`, "utf8")) as RunSummary,
});

describe.skipIf(!env.SIM_REBUILD)("SIM1: rebuild the report from runs' files", () => {
  it("writes report.md and the cases", () => {
    const dirs = env.SIM_REBUILD!.split(",");
    const summary = mergeRuns(dirs.map(read));
    const out = env.SIM_REBUILD_OUT ?? dirs[dirs.length - 1]!;
    const { markdown, cases } = buildReport({ summary, runUrl: env.SIM_RUN_URL ?? null, commit: env.SIM_COMMIT ?? null, date: env.SIM_DATE ?? summary.started.slice(0, 10) });
    mkdirSync(`${out}/cases`, { recursive: true });
    writeFileSync(`${out}/report.md`, markdown);
    for (const [name, body] of Object.entries(cases)) writeFileSync(`${out}/cases/${name}.json`, JSON.stringify(body, null, 1) + "\n");
  });
});

describe.skipIf(!env.SIM_PICK)("SIM1: pick the follow-up's seeds", () => {
  it("writes the selection", () => {
    const run = read(env.SIM_PICK!);
    const cutOff = [...new Set(run.results.filter((r) => r.attempt === 0 && r.status !== "judged").map((r) => r.id))].sort();
    const n = Number(env.SIM_PICK_N ?? 100);
    const { counts, quota, picked } = pickFollowUp(run.results, n, Number(env.SIM_PICK_SEED ?? 20261115));
    const body = { about: `SIM1 follow-up: the ${cutOff.length} first attempts the key's limit cut off, and ${picked.length} failing seeds run once more (attempt 1, same seed), drawn in proportion to the ten fixes of docs/SIM_REPORT_2026-11-15.md (evals/sim/fixes.ts, seed ${env.SIM_PICK_SEED ?? 20261115}).`,
      failing_by_fix: counts, quota, cut_off: cutOff, again: picked };
    writeFileSync(env.SIM_PICK_OUT ?? `${env.SIM_PICK}/followup.json`, JSON.stringify(body, null, 1) + "\n");
  });
});
