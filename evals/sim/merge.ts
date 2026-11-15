// SIM1: several runs read as one, for the report. A later run's result replaces an earlier one with the same scenario and attempt;
// an earlier run's repeat that never ran (status error) is dropped once a later run exists, since it measured nothing.
// Spend, calls and the guard's counts add up; the first run's calibration and copy notes stay; the last run says what stopped it.
import type { ConversationResult, RunSummary } from "./run";

export interface RunFiles { summary: RunSummary; results: ConversationResult[]; label: string }

export function mergeRuns(runs: RunFiles[]): RunSummary & { runs: { label: string; spent: number; conversations: number; judged: number }[] } {
  if (!runs.length) throw new Error("no run to merge");
  const byKey = new Map<string, ConversationResult>();
  runs.forEach((run, i) => {
    const later = i < runs.length - 1;
    for (const r of run.results) {
      if (later && r.attempt > 0 && r.status === "error") continue;
      byKey.set(`${r.id}#${r.attempt}`, r);
    }
  });
  const first = runs[0]!.summary, last = runs[runs.length - 1]!.summary;
  const roles = ["concierge", "customer", "judge"] as const;
  const staging = new Map<string, number>();
  for (const run of runs) for (const s of run.summary.guard.stagingRequests) staging.set(s.method, (staging.get(s.method) ?? 0) + s.count);
  return {
    started: runs.map((r) => r.summary.started).sort()[0]!, finished: runs.map((r) => r.summary.finished).sort().reverse()[0]!,
    source: first.source, models: first.models,
    spent: runs.reduce((s, r) => s + r.summary.spent, 0),
    byRole: Object.fromEntries(roles.map((k) => [k, { usd: runs.reduce((s, r) => s + r.summary.byRole[k].usd, 0), calls: runs.reduce((s, r) => s + r.summary.byRole[k].calls, 0) }])) as RunSummary["byRole"],
    calls: runs.reduce((s, r) => s + r.summary.calls, 0),
    calibration: first.calibration,
    adjustments: first.adjustments, featuresDropped: [...new Set(runs.flatMap((r) => r.summary.featuresDropped))],
    guard: { kapsoRecorded: runs.reduce((s, r) => s + r.summary.guard.kapsoRecorded, 0), refused: runs.flatMap((r) => r.summary.guard.refused),
             stagingRequests: [...staging].map(([method, count]) => ({ method, count })) },
    stoppedBy: last.stoppedBy,
    results: [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt),
    runs: runs.map((r) => ({ label: r.label, spent: r.summary.spent, conversations: r.results.length, judged: r.results.filter((x) => x.status === "judged").length })),
  };
}
