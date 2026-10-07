// Message audit: how many outgoing business messages one confirmed order costs, per path. Dry run on staging (kapso-brain-test): nothing is sent to WhatsApp,
// every outgoing payload comes back in `out`, so the count is exact. The model-free paths (numbered menu, tap flow, reorder, status updates) cost nothing;
// the free-text path calls the model and only runs with --model (one capped live run).
// Usage: SELFTEST_TOKEN=… bun tests/message-audit.ts [--model] [--out file.json]
// Totals per path exclude the opt-in prompt (first order only), which is reported separately as optinPrompt. The default --out file holds message previews of test data.
// Needs the audit customers seeded first (customers rows 96170000090001-96170000090004 with a saved profile, see tests/README.md).
import { writeFileSync } from "node:fs";
import { buttonsOf, textOf } from "./harness.ts";

const BASE = process.env.SUPABASE_URL ?? "https://tzugbbatfbvrfzxuacqx.supabase.co";
const FN = process.env.FN ?? "kapso-brain-test";
const TOKEN = process.env.SELFTEST_TOKEN ?? "";
const VENDOR = process.env.VENDOR ?? "al-tahouneh-restaurant-36524";
const WITH_MODEL = process.argv.includes("--model");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/message-audit.json";
if (!TOKEN) throw new Error("set SELFTEST_TOKEN");
const P = { numbered: "96170000090001", tap: "96170000090002", reorder: "96170000090003", text: "96170000090004" };

async function call(qs: string, body: unknown) {
  const res = await fetch(`${BASE}/functions/v1/${FN}${qs}`, { method: "POST", headers: { "x-selftest": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body) });
  const txt = await res.text(); try { return JSON.parse(txt); } catch { throw new Error(`${FN}${qs} said ${res.status}: ${txt.slice(0, 160)}`); }
}
let seq = 0; const wamid = () => `wamid.audit.${Date.now()}.${seq++}`;
type Row = { path: string; step: string; to_customer: number; to_others: number; kinds: string[]; previews: string[]; optin: number; model_calls: number };
const rows: Row[] = [];
const kind = (m: any) => (m.type === "interactive" ? `interactive:${m.interactive?.type}` : m.type);
async function turn(path: string, step: string, from: string, msg: any): Promise<any[]> {
  const r = await call("", { message: { id: wamid(), from, ...msg } });
  const all: any[] = r.out ?? [];
  const mine = all.filter((m) => m.to === from), others = all.filter((m) => m.to !== from);
  const calls = r.timings?.[0]?.model_calls ?? 0;
  if (calls > 0 && !WITH_MODEL) throw new Error(`ABORT: step "${step}" made ${calls} model call(s); run with --model (the capped live run) or fix the step`); // the model-free paths must stay model-free
  rows.push({ path, step, to_customer: mine.length, to_others: others.length, kinds: all.map(kind), optin: mine.filter((m) => /first dibs|الأولوية|عروض/.test(textOf(m))).length, previews: all.map((m) => `${m.to === from ? "" : "(to " + String(m.to).slice(-4) + ") "}${textOf(m).replace(/\s+/g, " ").slice(0, 70)}`), model_calls: r.timings?.[0]?.model_calls ?? 0 });
  console.log(`${path.padEnd(9)} ${step.padEnd(26)} customer ${mine.length}  other ${others.length}  model ${r.timings?.[0]?.model_calls ?? 0}`); for (const p of rows[rows.length - 1].previews) console.log(`      - ${p}`);
  return all.filter((m) => m.to === from);
}
const say = (p: string, s: string, f: string, t: string) => turn(p, s, f, { type: "text", text: { body: t } });
const tap = (p: string, s: string, f: string, id: string, title = "") => turn(p, s, f, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const tapRow = (p: string, s: string, f: string, id: string, title = "") => turn(p, s, f, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });
const btn = (msgs: any[], re: RegExp) => msgs.flatMap(buttonsOf).find((b) => re.test(b.id));
const rowsOf = (msgs: any[]) => msgs.flatMap((x: any) => x.interactive?.action?.sections?.flatMap((s: any) => s.rows) ?? []);

async function finishOrder(path: string, from: string, afterBasket: any[]) {
  const direct = btn(afterBasket, /^CONFIRM\|/); // a reorder goes straight to the summary
  const ck = btn(afterBasket, /^CHECKOUT\|/); if (!ck && !direct) { console.log(`${path}: no checkout button`); return; }
  const sum = direct ? afterBasket : await tap(path, "tap Checkout", from, ck!.id, ck!.title);
  const conf = btn(sum, /^CONFIRM\|/); if (!conf) { console.log(`${path}: no confirm button`); return; }
  await tap(path, "tap Confirm", from, conf.id, conf.title);
}

async function main() {
  // 1. numbered menu
  let m = await tap("numbered", "tap See Full Menu", P.numbered, `MENU|${VENDOR}`, "See Full Menu");
  m = await say("numbered", "reply '1x2, 2'", P.numbered, "1x2, 2");
  await finishOrder("numbered", P.numbered, m);
  // 2. tap flow (search-first list -> item card -> add)
  m = await say("tap", "search 'بلدي'", P.tap, "بلدي");
  const row = rowsOf(m).find((r: any) => String(r.id).startsWith("ITEM|"));
  if (row) {
    m = await tapRow("tap", "tap a result row", P.tap, row.id, row.title);
    const add = btn(m, /^ADD\|/); if (add) { m = await tap("tap", "tap Add to basket", P.tap, add.id, add.title); await finishOrder("tap", P.tap, m); }
  }
  // 3. reorder (needs a past order for this phone: run the numbered path for it first)
  m = await tap("seed", "See Full Menu", P.reorder, `MENU|${VENDOR}`, "See Full Menu");
  m = await say("seed", "reply '1'", P.reorder, "1");
  await finishOrder("seed", P.reorder, m); // not counted as the reorder path
  m = await say("reorder", "Hi (reorder card)", P.reorder, "Hi");
  const re = btn(m, /^REORDER\|/);
  if (re) { m = await tap("reorder", "tap Reorder", P.reorder, re.id, re.title); await finishOrder("reorder", P.reorder, m); }
  // 4. free text (model)
  if (WITH_MODEL) {
    // resolves server-side by dish and vendor name (staging menu data): a free-text order that needs no model call. Override with TEXT_ORDER for other data.
    m = await say("text", "'2 Jebneh Baladiyi from Serail El Bek'", P.text, process.env.TEXT_ORDER ?? "I want 2 Jebneh Baladiyi from Serail El Bek");
    await finishOrder("text", P.text, m);
  }
  // Status updates (accepted, preparing, on the way, delivered + rating) are not driven by this script: move a test order through the statuses in the database and call `?job=order-watchdog` (dry run) after each step; the results are in docs/legacy/message-audit.md.
}

main().catch((e) => { console.error(String(e)); process.exitCode = 1; }).finally(() => {
  const by: Record<string, { customer: number; optinPrompt: number; others: number; steps: number }> = {};
  for (const r of rows) { if (r.path === "seed") continue; const b = (by[r.path] ??= { customer: 0, optinPrompt: 0, others: 0, steps: 0 }); b.customer += r.to_customer - r.optin; b.optinPrompt += r.optin; b.others += r.to_others; b.steps++; }
  const summary = { withModel: WITH_MODEL, byPath: by, rows };
  writeFileSync(out, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(by, null, 1)); console.log(`wrote ${out}`);
});
