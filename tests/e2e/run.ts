// Staging conversation simulator (DECISIONS §36). Posts signed Kapso-shaped events to the deployed
// whatsapp-webhook, reads what the bot "sent" from sim_outbox, asserts replies and database state.
// Env: DB_URL, WEBHOOK_URL, E2E_WEBHOOK_SECRET; optional OUT_DIR (default e2e-out), ONLY (comma list of scenario names).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse } from "yaml";
import { expand } from "./lib/parts";
import { runScenario } from "./lib/runner";
import { summary, transcript } from "./lib/report";
import type { Scenario, ScenarioResult } from "./lib/types";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const MERCHANT_PHONE = "+99996100000001";

async function main() {
  const out = process.env.OUT_DIR ?? "e2e-out";
  mkdirSync(join(out, "transcripts"), { recursive: true });
  const dir = fileURLToPath(new URL("./scenarios/", import.meta.url));
  const only = (process.env.ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const scenarios = files
    .map((f) => ({
      f,
      sc: expand(parse(readFileSync(join(dir, f), "utf8")) as Scenario, join(dir, "_parts")),
    }))
    .filter(
      ({ f, sc }) => !only.length || only.includes(sc.name) || only.includes(basename(f, ".yaml")),
    );
  if (!scenarios.length) throw new Error("no scenario matched");

  // The session pooler's certificate is not in Node's trust store; psql's sslmode=require (used by every other job)
  // does not verify it either. The staging project is pinned by scripts/staging-db-url.sh.
  const url = new URL(need("DB_URL"));
  // sslmode=disable: a local Postgres for a run before merging (tests/e2e/README.md "Running locally").
  const local = url.searchParams.get("sslmode") === "disable";
  url.searchParams.delete("sslmode");
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const results: ScenarioResult[] = [];
  try {
    const prep = (await client.query("select public.sim_prepare($1) as r", [MERCHANT_PHONE]))
      .rows[0].r;
    if (prep.status !== "ok")
      throw new Error(
        `sim_prepare answered ${prep.status} (is the sink on and the test merchant installed?)`,
      );
    // The number the bot sends from (the US test number once connected, else the sandbox): the 24-hour window is per
    // business number (DECISIONS §39.8), so the simulated customers write to the number that answers them.
    const pn = await client.query(
      "select public.whatsapp_sender('customer') as phone_number_id where public.whatsapp_sender('customer') is not null",
    );
    if (!pn.rows[0]) throw new Error("no active sending number in whatsapp_numbers");
    await client.query(
      "delete from public.sim_outbox where created_at < now() - interval '3 days'",
    );
    const env = {
      db: client,
      webhookUrl: need("WEBHOOK_URL"),
      secret: need("E2E_WEBHOOK_SECRET"),
      phoneNumberId: String(pn.rows[0].phone_number_id),
      merchantPhone: MERCHANT_PHONE,
    };
    // The staging test market is orderable only inside its own scenario (DECISIONS §38.2.3); a run that stopped
    // half-way must not leave a second orderable shop for the others.
    await client.query("select public.sim_market($1, false)", [MERCHANT_PHONE]);
    for (const { f, sc } of scenarios) {
      console.log(`▶ ${sc.name}`);
      let r: ScenarioResult;
      try {
        r = await runScenario(env, sc, f);
      } catch (e) {
        r = {
          name: sc.name,
          file: f,
          ok: false,
          seconds: 0,
          steps: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
      results.push(r);
      writeFileSync(join(out, "transcripts", `${basename(f, ".yaml")}.md`), transcript(r) + "\n");
      console.log(`${r.ok ? "✅" : "❌"} ${sc.name}${r.error ? ` — ${r.error}` : ""}`);
    }
  } finally {
    await client
      .query("select public.sim_market($1, false)", [MERCHANT_PHONE])
      .catch((e) => console.error("sim_market off failed", String(e)));
    await client
      .query("select public.sim_restore()")
      .catch((e) => console.error("sim_restore failed", String(e)));
    await client.end();
  }
  const md = [summary(results), "", ...results.map(transcript)].join("\n\n");
  writeFileSync(join(out, "summary.md"), md + "\n");
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md.slice(0, 900_000) + "\n", { flag: "a" });
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
