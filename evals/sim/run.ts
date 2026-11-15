// SIM1: the whole run. Phases, in order:
//   0. copy      staging's catalogue and settings, GET only (staging.ts); then staging is closed (guard.ts)
//   1. calibrate 20 day conversations; the cost per conversation is measured and the projection for the rest printed
//   2. night     the 35 night conversations on their own database with the clock at 02:xx; then the clock moves to the morning
//                after and each conversation carries on (the kept basket)
//   3. day       every other scenario, on the day database
//   4. repeat    while money is left under the soft limit, each failing seed again, three times, to measure how often it repeats
// No new conversation starts above the soft limit (USD 27); at the hard limit (USD 33) every model call is refused (budget.ts).
// Each conversation is judged as soon as it ends. Results are appended to results.jsonl as they finish.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { ModelClient } from "../../packages/agents/src/concierge";
import { Budget, BudgetStop, normalisePrices } from "./budget";
import { newFeatures, type Features } from "./call";
import { NOTE_CODES, type BotMsg } from "./checks";
import { Customer, noisyTranscript, renderForCustomer, voiceSeconds, type CustomerMove } from "./customer";
import { followUpText, SimConversation, type Action, type Failure, type TurnRecord } from "./driver";
import type { Guard } from "./guard";
import { judge, type Verdict } from "./judge";
import { metered, newMeter } from "./metered";
import { oosPool, type Scenario } from "./scenarios";
import { loadCatalog } from "./catalog";
import type { Copy } from "./staging";
import { openWorld, type World } from "./world";

export interface RunOptions {
  scenarios: Scenario[];
  copy: Copy | null;
  guard: Guard;
  raw: { concierge: ModelClient; customer: ModelClient; judge: ModelClient };
  models: { concierge: string; customer: string; judge: string };
  soft: number; hard: number; concurrency: number; calibrate: number; reruns: number;
  maxMinutes: number;
  outDir: string | null;
  /** The attempt number each scenario runs as (0 = its first run). A follow-up runs a seed again as attempt 1. Default 0. */
  attemptOf?: (s: Scenario) => number;
  log?: (s: string) => void;
}

export interface ConversationResult {
  id: string; seed: number; attempt: number; category: string; variant: string; lang: string; voice: boolean; burst: boolean; clock: string;
  status: "judged" | "unjudged" | "budget_stop" | "error";
  error: string | null;
  endReason: string;
  turns: TurnRecord[];
  facts: Awaited<ReturnType<SimConversation["facts"]>> | null;
  failures: Failure[];
  verdict: Verdict | null;
  usd: { concierge: number; customer: number; judge: number; total: number };
  conciergeCalls: number; conciergeApiErrors: number;
  passed: boolean;
}

export interface RunSummary {
  started: string; finished: string; source: string; models: RunOptions["models"];
  spent: number; byRole: Budget["byRole"]; calls: number;
  calibration: { conversations: number; usdPerConversation: number; projectedTotal: number } | null;
  adjustments: string[]; featuresDropped: string[];
  guard: { kapsoRecorded: number; refused: Guard["refused"]; stagingRequests: { method: string; count: number }[] };
  stoppedBy: string | null;
  results: ConversationResult[];
}

/** A conversation passes when code found no hard failure and the judge found the goal reached with no harm. */
export function passes(r: Pick<ConversationResult, "status" | "failures" | "verdict">): boolean {
  if (r.status !== "judged" || !r.verdict) return false;
  if (r.failures.some((f) => !NOTE_CODES.has(f.code))) return false;
  const v = r.verdict;
  return v.goal_reached && !v.wrong_or_uninvited_product && !v.invented_fact && !v.rating_praise_health && !v.dead_end;
}

function toAction(conv: SimConversation, s: Scenario, move: CustomerMove, first: boolean): Action {
  let a: Action;
  switch (move.action) {
    case "done": return { kind: "done" };
    case "pin": a = { kind: "pin", where: s.pin === "outside" ? "outside" : "home" }; break;
    case "tap": {
      const ref = (move.option ?? "").replace(/[[\]\s]/g, "").toLowerCase();
      const opt = conv.options.get(ref) ?? [...conv.options.values()].reverse().find((o) => o.title.trim() === (move.option ?? move.text ?? "").trim());
      a = opt ? { kind: "tap", option: opt } : { kind: "text", text: move.text || move.option || "?" };
      break;
    }
    case "texts": a = move.texts?.length ? { kind: "texts", texts: move.texts.slice(0, 4).filter(Boolean) } : { kind: "text", text: move.text ?? "" }; break;
    case "voice": { const said = move.text ?? ""; a = { kind: "voice", said, transcript: noisyTranscript(said, s.seed, s.lang), seconds: voiceSeconds(said) }; break; }
    default: a = { kind: "text", text: move.text ?? "" };
  }
  // The scenario's form for the first real message: a voice note (a quarter of them) or a burst (a tenth), whatever the model chose.
  if (first && s.voice && (a.kind === "text" || a.kind === "texts")) {
    const said = a.kind === "text" ? a.text : a.texts.join(" ");
    a = { kind: "voice", said, transcript: noisyTranscript(said, s.seed, s.lang), seconds: voiceSeconds(said) };
  } else if (first && s.burst && a.kind === "text") {
    const parts = a.text.split(/(?<=[.!?؟،,\n])\s+|\s+(?:w|و|and|et)\s+/u).map((x) => x.trim()).filter(Boolean);
    a = parts.length >= 2 ? { kind: "texts", texts: parts.slice(0, 3) } : a;
  }
  if (a.kind === "text" && !a.text.trim()) return { kind: "done" };
  return a;
}

interface Live { conv: SimConversation; customer: Customer; last: BotMsg[]; note?: string; followUps: number | null; firstDone: boolean; ended: string | null }

/** Runs customer turns until the customer stops, the turn limit, or (night) the night part ends. */
async function talk(l: Live, s: Scenario, clock: string, limit: number, log: (x: string) => void): Promise<void> {
  while (!l.ended && l.conv.turns.length < limit) {
    const shop = l.conv.turns.length === 0 && !l.last.length ? "(The chat with the shop is empty. Send your first message.)" : renderForCustomer(l.last);
    const move = await l.customer.next(shop, l.note);
    l.note = undefined;
    let a = toAction(l.conv, s, move, !l.firstDone);
    if (a.kind === "done") {
      if (l.followUps !== null && l.followUps > 0) a = { kind: "text", text: followUpText(s.lang) };
      else { l.ended = `customer stopped (${move.goal})`; break; }
    }
    if (a.kind === "text" || a.kind === "texts" || a.kind === "voice") l.firstDone = true;
    const rec = await l.conv.act(a, clock);
    l.last = rec.replies;
    if (l.followUps !== null) {
      l.followUps--;
      if (l.followUps <= 0) { l.ended = "two messages after the hand-off sent"; break; }
      l.note = "Nobody has answered yet. Send one more short follow-up message.";
    } else if (rec.handoffs.length || (await l.conv.handedOff())) {
      l.followUps = 2;
      l.note = "The shop has handed you to a person. Send a short follow-up message (you will send two in all).";
    }
    if (l.conv.optedOut && s.variant === "stop" && rec.afterOptOut) { l.ended = "one message after STOP"; break; }
    if (move.goal !== "in_progress" && l.followUps === null && a.kind !== "tap") { l.ended = `customer said goal ${move.goal}`; break; }
  }
  if (!l.ended && l.conv.turns.length >= limit) l.ended = `turn limit ${limit}`;
  void log;
}

export async function runAll(o: RunOptions): Promise<RunSummary> {
  const log = o.log ?? ((s: string) => console.log(s));
  const started = new Date();
  const deadline = started.getTime() + o.maxMinutes * 60_000;
  const results: ConversationResult[] = [];
  const features: Features = newFeatures();
  if (o.outDir) { mkdirSync(o.outDir, { recursive: true }); writeFileSync(`${o.outDir}/results.jsonl`, ""); }
  const oos = oosPool(loadCatalog());
  o.guard.phase = "run";                                        // staging is closed from here on

  const day = await openWorld({ label: "day", copy: o.copy, oosSkus: oos, log });
  await day.setClock("day");
  const prices = normalisePrices(await day.db.all(`select * from model_prices`));
  const budget = new Budget(o.soft, o.hard, prices, log);
  let stoppedBy: string | null = null;

  const runOne = async (world: World, s: Scenario, attempt: number, plan: "day" | "night"): Promise<ConversationResult> => {
    const meter = newMeter();
    const conv = new SimConversation(world, s, attempt, o.guard, meter, metered(o.raw.concierge, { role: "concierge", budget, meter }), o.models.concierge);
    const customer = new Customer(metered(o.raw.customer, { role: "customer", budget, meter }), o.models.customer, s, features);
    const live: Live = { conv, customer, last: [], followUps: null, firstDone: false, ended: null };
    const r: ConversationResult = { id: s.id, seed: s.seed, attempt, category: s.category, variant: s.variant, lang: s.lang, voice: s.voice, burst: s.burst, clock: s.clock,
      status: "unjudged", error: null, endReason: "", turns: conv.turns, facts: null, failures: [], verdict: null,
      usd: { concierge: 0, customer: 0, judge: 0, total: 0 }, conciergeCalls: 0, conciergeApiErrors: 0, passed: false };
    try {
      await conv.start();
      if (plan === "night") {
        await talk(live, s, "night", 6, log);
        (r as { _live?: Live })._live = live;                    // the morning part carries on from here
        return r;
      }
      await talk(live, s, "day", s.max_turns, log);
      await finish(r, live, s);
    } catch (e) { mark(r, e); }
    return r;
  };
  const mark = (r: ConversationResult, e: unknown) => {
    if (e instanceof BudgetStop || (e as Error)?.name === "BudgetStop") { r.status = "budget_stop"; stoppedBy = String((e as Error).message); }
    else { r.status = "error"; r.error = String((e as Error)?.stack ?? e).slice(0, 600); }
  };
  const finish = async (r: ConversationResult, live: Live, s: Scenario) => {
    const conv = live.conv;
    r.endReason = live.ended ?? "";
    r.facts = await conv.facts();
    r.failures = conv.turns.flatMap((t) => t.failures);
    const hard = r.failures.filter((f) => !NOTE_CODES.has(f.code)).map((f) => `${f.code} (turn ${f.turn}): ${f.detail}`);
    try {
      r.verdict = await judge(metered(o.raw.judge, { role: "judge", budget, meter: conv.meter }), o.models.judge, features, s, conv.turns, { ...r.facts, end: r.endReason }, hard);
      r.status = r.verdict ? "judged" : "unjudged";
    } catch (e) { mark(r, e); }
    const calls = conv.meter.calls;
    const sum = (role: string) => calls.filter((c) => c.role === role).reduce((a, c) => a + c.usd, 0);
    r.usd = { concierge: sum("concierge"), customer: sum("customer"), judge: sum("judge"), total: 0 };
    r.usd.total = r.usd.concierge + r.usd.customer + r.usd.judge;
    r.conciergeCalls = calls.filter((c) => c.role === "concierge").length;
    r.conciergeApiErrors = calls.filter((c) => c.role === "concierge" && c.error).length;
    r.passed = passes(r);
  };
  const record = (r: ConversationResult) => {
    delete (r as { _live?: Live })._live;
    results.push(r);
    if (o.outDir) appendFileSync(`${o.outDir}/results.jsonl`, JSON.stringify(r) + "\n");
    log(`[sim] ${r.id}#${r.attempt} ${r.category}/${r.variant} ${r.lang}${r.voice ? " voice" : ""}${r.burst ? " burst" : ""}: ${r.status}${r.passed ? " PASS" : " FAIL"} ` +
        `turns ${r.turns.length} usd ${r.usd.total.toFixed(4)} hard [${[...new Set(r.failures.map((f) => f.code))].join(",")}] | total USD ${budget.spent.toFixed(3)}`);
  };
  const open = () => budget.canStart() && Date.now() < deadline;
  /** Runs `work` over the items, o.concurrency at a time. `carryOn`: conversations already started (the morning part) always finish. */
  async function pool<T>(items: T[], work: (x: T) => Promise<void>, carryOn = false): Promise<void> {
    let i = 0;
    const lanes = Array.from({ length: Math.min(o.concurrency, items.length) }, async () => {
      while (i < items.length) {
        if (!carryOn && !open()) { stoppedBy ??= budget.canStart() ? "time limit" : `soft limit USD ${o.soft} reached: no new conversation`; return; }
        const x = items[i++]!;
        await work(x);
      }
    });
    await Promise.all(lanes);
  }

  const daySet = o.scenarios.filter((s) => s.clock === "day");
  const nightSet = o.scenarios.filter((s) => s.clock === "night");
  // 1. calibrate on 20 day conversations spread over the categories
  const byCat = new Map<string, Scenario[]>();
  for (const s of daySet) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
  const calib: Scenario[] = [];
  for (let k = 0; calib.length < Math.min(o.calibrate, daySet.length); k++) for (const list of byCat.values()) if (list[k] && calib.length < o.calibrate) calib.push(list[k]!);
  const first = (s: Scenario) => o.attemptOf?.(s) ?? 0;
  await pool(calib, async (s) => record(await runOne(day, s, first(s), "day")));
  const done = results.length || 1;
  const perConv = budget.spent / done;
  const calibration = { conversations: results.length, usdPerConversation: perConv, projectedTotal: budget.spent + perConv * (o.scenarios.length - results.length) };
  log(`[calibration] ${results.length} conversations, USD ${budget.spent.toFixed(3)}: USD ${perConv.toFixed(4)} each; all ${o.scenarios.length} would cost about USD ${calibration.projectedTotal.toFixed(2)} (soft limit ${o.soft}, hard ${o.hard})`);
  if (calibration.projectedTotal > o.soft) log(`[calibration] the projection is above the soft limit: the run will stop starting conversations at USD ${o.soft}`);

  // 2. night, then the morning after
  const nightRun = async (set: Scenario[], attempt: number) => {
    if (!set.length || !open()) return;
    const night = await openWorld({ label: `night${attempt ? `-${attempt}` : ""}`, copy: o.copy, oosSkus: [], log });
    await night.setClock("night");
    const parked: ConversationResult[] = [];
    await pool(set, async (s) => { const r = await runOne(night, s, attempt + first(s), "night"); if ((r as { _live?: Live })._live) parked.push(r); else record(r); });
    await night.setClock("morning");
    await pool(parked, async (r) => {
      const s = set.find((x) => x.id === r.id)!;
      const live = (r as { _live?: Live })._live!;
      try {
        if (live.ended && /hand-off|STOP/.test(live.ended)) { await finish(r, live, s); record(r); return; }
        live.ended = null;
        live.note = "It is now the next morning, a little after the shop opens. Carry on towards your goal.";
        await talk(live, s, "morning", s.max_turns, log);
        await finish(r, live, s);
      } catch (e) { mark(r, e); }
      record(r);
    }, true);
    await night.db.pg.close();
  };
  await nightRun(nightSet, 0);
  // 3. the rest of the day
  const left = daySet.filter((s) => !calib.includes(s));
  await pool(left, async (s) => record(await runOne(day, s, first(s), "day")));
  // 4. failing seeds again, three times each, while money is left
  const failing = o.scenarios.filter((s) => results.some((r) => r.id === s.id && r.attempt === 0 && r.status === "judged" && !r.passed));
  if (o.reruns > 0 && failing.length && open()) {
    log(`[repeat] ${failing.length} failing seed(s), ${o.reruns} more time(s) each, while under USD ${o.soft}`);
    for (let k = 1; k <= o.reruns && open(); k++) {
      await pool(failing.filter((s) => s.clock === "day"), async (s) => record(await runOne(day, s, k, "day")));
      await nightRun(failing.filter((s) => s.clock === "night"), k);
    }
  }
  const counts = new Map<string, number>();
  for (const r of o.guard.staging) counts.set(r.method, (counts.get(r.method) ?? 0) + 1);
  const summary: RunSummary = {
    started: started.toISOString(), finished: new Date().toISOString(), source: day.source, models: o.models,
    spent: budget.spent, byRole: budget.byRole, calls: budget.calls, calibration,
    adjustments: day.adjustments, featuresDropped: features.dropped,
    guard: { kapsoRecorded: o.guard.kapso.length, refused: o.guard.refused, stagingRequests: [...counts].map(([method, count]) => ({ method, count })) },
    stoppedBy, results,
  };
  await day.db.pg.close();
  if (o.outDir) {
    writeFileSync(`${o.outDir}/summary.json`, JSON.stringify({ ...summary, results: undefined }, null, 1));
    // COST1: the run's cost in the shape scripts/lib/model-cost.mjs records in model_costs (the workflow's last step does it: this run
    // may not write to staging). The cap is the hard limit; the run stopped at it when a call was refused or no new conversation could start.
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    writeFileSync(`${o.outDir}/model-cost.json`, JSON.stringify({ workflow: "sim-test", run_id: env.MODEL_COST_RUN_ID ?? env.GITHUB_RUN_ID ?? `local-${Date.now()}`, cap_usd: o.hard,
      stopped_at_cap: /^(BUDGET_STOP|soft limit)/.test(String(stoppedBy ?? "")), lines: budget.costLines() }, null, 1));
  }
  log(`[sim] done: ${results.length} conversations, ${results.filter((r) => r.status === "judged").length} judged, USD ${budget.spent.toFixed(3)} spent${stoppedBy ? `; stopped: ${stoppedBy}` : ""}`);
  return summary;
}
