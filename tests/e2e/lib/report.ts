// Readable transcripts: one markdown file per scenario plus a summary table (job summary and artifact).
import type { ScenarioResult } from "./types";

export function transcript(r: ScenarioResult): string {
  const out = [`## ${r.ok ? "✅" : "❌"} ${r.name} (${r.seconds}s)`, ""];
  for (const s of r.steps) {
    out.push(`${s.ok ? "✅" : "❌"} **${s.index}. ${s.label}**`);
    for (const l of s.lines) out.push(`    ${l}`);
    for (const f of s.failures) out.push(`    ❗ ${f}`);
  }
  if (r.error) out.push("", `**Failed:** ${r.error}`);
  return out.join("\n");
}

export function summary(rs: ScenarioResult[]): string {
  const rows = rs.map(
    (r) =>
      `| ${r.ok ? "✅ pass" : "❌ fail"} | ${r.name} | ${r.seconds}s | ${r.error ? r.error.slice(0, 160).replace(/\|/g, "\\|") : ""} |`,
  );
  const pass = rs.filter((r) => r.ok).length;
  return [
    `# staging-e2e: ${pass}/${rs.length} scenarios passed`,
    "",
    "| Result | Scenario | Time | First failure |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
