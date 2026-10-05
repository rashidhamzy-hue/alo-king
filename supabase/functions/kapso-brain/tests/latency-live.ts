// ONE capped live run against staging (kapso-brain-test, dry run: nothing is sent to WhatsApp, the database is real, test phones only, model calls are real and cost money).
// Measures calls per turn, handler p50/p95 (the function's own turn_timing, which excludes Kapso's buffer window) and cost per order, and asserts the latency targets:
//   taps: < 1.5 s of handler time and NO model call;  free text: at most ONE model call when the message resolves server-side.
// Usage: SELFTEST_TOKEN=… bun tests/latency-live.ts [--out file.json]
// Hard cap: CAP_USD (default 1.50) measured from ai_call_log via the staging `spend` job; every turn first checks the spend and aborts at 90% of the cap.
import { writeFileSync } from "node:fs";
import { buttonsOf, textOf } from "./harness.ts";

const BASE = process.env.SUPABASE_URL ?? "https://hnjkietmwvkgbyrcnweq.supabase.co";
const FN = process.env.FN ?? "kapso-brain-test";
const TOKEN = process.env.SELFTEST_TOKEN ?? "";
const CAP = Number(process.env.CAP_USD ?? 1.5), STOP_AT = CAP * 0.8; // a model-bound turn that starts just under the line can still add a few cents: keep a 20% margin
const TAP_MS = 1500;
const QS = process.env.QS ?? ""; // e.g. "forceFunctionRegion=ap-northeast-1" (pins the function next to the database)
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/latency-live.json";
if (!TOKEN) throw new Error("set SELFTEST_TOKEN");
const startedAt = new Date(Date.now() - 60_000).toISOString(); // a minute of margin for clock skew between this machine and the database
const run = String(Date.now() % 1000).padStart(3, "0");
const phone = (i: number) => `961700000${run}${String(i).padStart(2, "0")}`;
const VENDOR = process.env.VENDOR ?? "al-tahouneh-restaurant-36524";

async function call(qs: string, body: unknown) {
  const res = await fetch(`${BASE}/functions/v1/${FN}${qs ? qs + (QS ? "&" + QS : "") : QS ? "?" + QS : ""}`, { method: "POST", headers: { "x-selftest": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body) });
  const txt = await res.text(); try { return JSON.parse(txt); } catch { throw new Error(`${FN}${qs} said ${res.status}: ${txt.slice(0, 160)}`); }
}
const spend = () => call(`?job=spend&since=${encodeURIComponent(startedAt)}`, {});
async function guard() { const s = await spend(); if (typeof s.spent !== "number" || Number.isNaN(s.spent)) throw new Error("ABORT: no usable spend"); if (s.spent >= STOP_AT) throw new Error(`ABORT: spend $${s.spent.toFixed(4)} reached the stop line $${STOP_AT.toFixed(2)} (cap $${CAP})`); return s; }

type Rec = { label: string; kind: string; ms: number | null; total_ms: number | null; calls: number; first_send_ms: number | null; db_n: number | null; db_ms: number | null };
const recs: Rec[] = []; const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail: pass ? undefined : detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `  -> ${detail}`}`); };
let seq = 0; const wamid = () => `wamid.lat.${Date.now()}.${seq++}`;
async function turn(label: string, from: string, msg: any, expect: { maxCalls?: number; tap?: boolean } = {}) {
  await guard();
  const t0 = performance.now();
  const r = await call("", { message: { id: wamid(), from, ...msg } });
  const wall = performance.now() - t0; const tm = r.timings?.[0] ?? {};
  check(`${label}: the response carried turn_timing (kind, total_ms, model_calls)`, typeof tm.total_ms === "number" && typeof tm.model_calls === "number" && (tm.kind === "tap" || tm.kind === "text" || tm.kind === "location" || tm.kind === "voice"), JSON.stringify(tm).slice(0, 120));
  const rec: Rec = { label, kind: tm.kind ?? "?", ms: Math.round(wall), total_ms: tm.total_ms ?? null, calls: tm.model_calls ?? 0, first_send_ms: tm.first_send_ms ?? null, db_n: tm.db?.n ?? null, db_ms: tm.db?.ms ?? null };
  recs.push(rec);
  const mine = (r.out ?? []).filter((m: any) => m.to === from);
  console.log(`   ${label}: ${rec.total_ms} ms handler, ${rec.calls} model call(s), ${rec.db_n} db queries (${rec.db_ms} ms), ${mine.length} message(s)`);
  if (expect.maxCalls !== undefined) check(`${label}: <= ${expect.maxCalls} model call(s)`, rec.calls <= expect.maxCalls, `${rec.calls}`);
  if (expect.tap) check(`${label}: handler < ${TAP_MS} ms`, (rec.total_ms ?? 1e9) < TAP_MS, `${rec.total_ms} ms`);
  return mine;
}
const say = (l: string, p: string, t: string, e?: any) => turn(l, p, { type: "text", text: { body: t } }, e);
const tap = (l: string, p: string, id: string, title = "", e?: any) => turn(l, p, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }, { tap: true, maxCalls: 0, ...e });
const tapList = (l: string, p: string, id: string, title = "", e?: any) => turn(l, p, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } }, { tap: true, maxCalls: 0, ...e });
const dishNames = (msgs: any[]) => msgs.map(textOf).join("\n").split("\n").map((l) => l.match(/^(\d+)\. (.+?)( ⚙)? — /)).filter(Boolean).map((m) => ({ n: Number(m![1]), name: m![2], options: !!m![3] }));
const btn = (msgs: any[], re: RegExp) => msgs.flatMap(buttonsOf).find((b) => re.test(b.id) || re.test(b.title));
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };

async function main() {
  const A = phone(1);
  // ---- item 4: numbered quick-order (taps and replies, no model) ----
  let m = await tap("tap See Full Menu", A, `MENU|${VENDOR}`, "See Full Menu");
  const dishes = dishNames(m);
  check("numbered list has dishes with prices", dishes.length >= 3 && /\$\d/.test(m.map(textOf).join("")), `${dishes.length}`);
  check("numbered body <= 1024", m.every((x: any) => textOf(x).length <= 1024));
  const more = btn(m, /^NUM\|/);
  if (more) { const m2 = await tap("tap More dishes", A, more.id, more.title); check("more page has dishes", dishNames(m2).length > 0); }
  m = await tap("tap See Full Menu (again)", A, `MENU|${VENDOR}`, "See Full Menu");
  const plain = dishes.filter((d) => !d.options); // dishes with options start an option list instead of a basket line
  const [p1, p2] = [plain[0]?.n ?? 1, plain[1]?.n ?? 2];
  m = await say(`reply '${p1}x2, ${p2}'`, A, `${p1}x2, ${p2}`, { maxCalls: 0 });
  check("numbered reply produced a basket card", !!btn(m, /^CHECKOUT\|/), m.map(textOf).join(" ").slice(0, 120));
  // ---- item 5: running basket card, edit taps, typed edits ----
  const edit = btn(m, /^BEDIT\|/); check("basket card has an Edit button", !!edit);
  if (edit) { const l = await tap("tap Edit", A, edit.id, edit.title); const row = l.flatMap((x: any) => x.interactive?.action?.sections?.flatMap((s: any) => s.rows) ?? []).find((r: any) => r.id.startsWith("BLINE|"));
    if (row) { const b = await tapList("tap a basket line", A, row.id, row.title); const more1 = btn(b, /^BSET\|.*\|2$/) ?? btn(b, /^BSET\|/); if (more1) await tap("tap One more", A, more1.id, more1.title); } }
  m = await say("typed 'make it 3'", A, "make it 3", { maxCalls: 0 });
  check("'make it 3' answered with a basket card", !!btn(m, /^CHECKOUT\|/));
  // ---- item 3: multi-item natural language in three languages (server-resolved, no model) ----
  const B = phone(2), names = dishes.filter((d) => !d.options).map((d) => d.name).filter((n) => /^[\p{L}\s]{4,30}$/u.test(n) && !/\b(and|w)\b/i.test(n)).slice(0, 3);
  if (names.length === 3) {
    m = await say("EN multi-item", B, `2 ${names[0]}, ${names[1]} and a ${names[2]}`, { maxCalls: 1 });
    check("EN multi-item ended in one basket card", !!btn(m, /^CHECKOUT\|/) || !!btn(m, /^ADD\|/), m.map(textOf).join(" ").slice(0, 120));
    const C = phone(3); m = await say("Arabizi multi-item", C, `badde etneen ${names[0]} w ${names[1]}`, { maxCalls: 1 });
    check("Arabizi multi-item produced a card or one question", !!btn(m, /^CHECKOUT\|/) || !!btn(m, /^ADD\|/));
  }
  // ---- item 6: search-first (no category tree) ----
  const D = phone(4);
  const word = (dishes.map((d) => d.name.split(/\s+/).find((w) => /^\p{L}{4,}$/u.test(w))).find(Boolean) ?? "falafel").toLowerCase();
  m = await say(`search '${word}'`, D, word, { maxCalls: 0 });
  const rows = m.flatMap((x: any) => x.interactive?.action?.sections?.flatMap((s: any) => s.rows) ?? []);
  check(`'${word}' returns ONE list of dishes (<=10 rows, ITEM| ids), no category tree`, rows.length >= 1 && rows.length <= 10 && rows.every((r: any) => r.id.startsWith("ITEM|")), `${rows.length} rows`);
  m = await say("mood 'something sweet'", D, "something sweet", { maxCalls: 3 });
  // ---- a genuinely model-bound turn, to see the real number of calls ----
  m = await say("model-bound free text", D, "what would you recommend for a family dinner for four under 40 dollars?", { maxCalls: 3 });
  // ---- cost per order: profile + checkout + confirm on the numbered basket ----
  const E = phone(5);
  await tap("E: open menu", E, `MENU|${VENDOR}`, "See Full Menu");
  m = await say("E: numbered reply '1'", E, "1", { maxCalls: 0 });
  m = await say("E: give delivery details", E, "My name is Test Tester, Baakleen, near the church, building 3", { maxCalls: 3 });
  const ck = btn(m, /^CHECKOUT\|/) ?? btn(await tap("E: tap basket", E, "BASKET", "basket"), /^CHECKOUT\|/);
  if (ck) { m = await tap("E: tap Checkout", E, ck.id, ck.title, { tap: false, maxCalls: 3 }); const conf = btn(m, /^CONFIRM\|/); if (conf) await tap("E: tap Confirm", E, conf.id, conf.title, { tap: false }); }
}

main().catch((e) => { console.error(String(e)); process.exitCode = 1; }).finally(async () => {
  let s: any = null; try { s = await spend(); } catch { /* ignore */ }
  const taps = recs.filter((r) => r.kind === "tap").map((r) => r.total_ms ?? 0), texts = recs.filter((r) => r.kind === "text").map((r) => r.total_ms ?? 0);
  const callsPerTurn = recs.map((r) => r.calls);
  const orders = s?.rows?.filter((r: any) => r.order_id) ?? [];
  const costPerOrder = orders.length ? orders.reduce((n: number, r: any) => n + Number(r.est_usd), 0) / new Set(orders.map((r: any) => r.order_id)).size : null;
  const summary = { startedAt, cap: CAP, spent: s?.spent ?? null, modelCalls: s?.calls ?? null, turns: recs.length, callsPerTurn: { mean: callsPerTurn.length ? callsPerTurn.reduce((a, b) => a + b, 0) / callsPerTurn.length : null, max: Math.max(0, ...callsPerTurn) },
    region: QS || "default", dbPerTap: { mean: avg(recs.filter((r) => r.kind === "tap").map((r) => r.db_n ?? 0)), max: Math.max(0, ...recs.filter((r) => r.kind === "tap").map((r) => r.db_n ?? 0)) }, wallMs: { tap: { p50: pct(recs.filter((r) => r.kind === "tap").map((r) => r.ms ?? 0), 50), p95: pct(recs.filter((r) => r.kind === "tap").map((r) => r.ms ?? 0), 95) } }, handlerMs: { tap: { n: taps.length, p50: pct(taps, 50), p95: pct(taps, 95) }, text: { n: texts.length, p50: pct(texts, 50), p95: pct(texts, 95) } }, costPerOrderUsd: costPerOrder, checks, recs };
  writeFileSync(out, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, recs: undefined, checks: checks.filter((c) => !c.pass) }, null, 1));
  console.log(`failed checks: ${checks.filter((c) => !c.pass).length} of ${checks.length}; wrote ${out}`);
});
