// Usage: SELFTEST_TOKEN=… [FN=kapso-brain-test] [bun] run supabase/functions/kapso-brain/tests/run.ts [--phase N] [--only id,id] [--json out.json]
// --phase N: roadmap items 1..N are considered landed, so their assertions count as failures; later ones show as "pending".
import { writeFileSync } from "node:fs";
import { Customer, FN, buttonsOf, textOf, type Result } from "./harness.ts";
import { personas, runPersona } from "./personas.ts";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const phase = Number(arg("phase") ?? 0);
const only = arg("only")?.split(",");
const runId = String(Date.now() % 1000).padStart(3, "0"); // fresh phones per run: no history contamination
const list = personas.filter((p) => !only || only.includes(p.id));

const customers: Customer[] = [];
const reports = await Promise.all(list.map((p, i) => {
  const phone = `961700000${runId}${String(i).padStart(2, "0")}`;
  const cu = new Customer(phone, p.id); customers.push(cu);
  return runPersona(p, cu, phase);
}));
if (process.argv.includes("--dump")) for (const cu of customers) { // transcripts, for debugging a failing persona
  console.log(`\n## ${cu.name}`);
  for (const t of cu.turns) { console.log(`> ${t.input}`); for (const m of t.msgs) console.log(`  < ${textOf(m).replace(/\n+/g, " / ").slice(0, 240)}${buttonsOf(m).length ? ` [${buttonsOf(m).map((b) => b.id.slice(0, 40)).join(" ")}]` : ""}`); }
}

const all: Result[] = reports.flatMap((r) => r.results);
const icon = { pass: "✅", fail: "❌", pending: "⏳" } as const;
console.log(`\nPersona suite on ${FN} (phase ${phase}, run ${runId})\n`);
console.log("| Persona | Pass | Fail | Pending | Failing / pending assertions |\n|---|---|---|---|---|");
for (const r of reports) {
  const n = (s: string) => r.results.filter((x) => x.status === s).length;
  const notes = r.results.filter((x) => x.status !== "pass").map((x) => `${icon[x.status]} ${x.name}${x.detail ? ` (${x.detail.replace(/\|/g, "/")})` : ""}${x.status === "pending" ? ` [item ${x.phase}]` : ""}`).join("<br>");
  console.log(`| ${r.persona} | ${n("pass")} | ${n("fail")} | ${n("pending")} | ${notes} |`);
}
const f = all.filter((x) => x.status === "fail").length;
console.log(`\nTotal: ${all.filter((x) => x.status === "pass").length} pass, ${f} fail, ${all.filter((x) => x.status === "pending").length} pending`);
const out = arg("json"); if (out) writeFileSync(out, JSON.stringify(all, null, 1));
process.exit(f ? 1 : 0);
