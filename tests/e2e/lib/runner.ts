// Executes one scenario against staging: signed webhook in, sim_outbox + database assertions out.
import { randomInt } from "node:crypto";
import { deliver, inboundPayload, type Inbound } from "./kapso";
import { mismatch, optionMatches, render, toOut, valueMatches } from "./match";
import type { DbCheck, Expect, Out, Scenario, ScenarioResult, Step, StepResult } from "./types";

export type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type Env = {
  db: Db;
  webhookUrl: string;
  secret: string;
  phoneNumberId: string;
  merchantPhone: string;
  fetchImpl?: typeof fetch;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: string, n = 220) =>
  (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\n/g, " ⏎ ");

function describe(m: Out): string {
  const opts = m.options.length
    ? `  [${m.options.map((o) => `${o.title} (${o.id.slice(0, 18)})`).join(" | ")}]`
    : "";
  return `${m.kind}: ${short(m.header ? `${m.header} — ${m.text}` : m.text)}${opts}`;
}

/** A fresh customer number per run: +999 <country> <7 digits>, so every scenario meets a brand-new customer. */
export function simPhone(cc: string): string {
  return `+999${cc}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

export async function runScenario(env: Env, sc: Scenario, file: string): Promise<ScenarioResult> {
  const started = Date.now();
  const phones: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const [key, p] of Object.entries(sc.personas)) {
    phones[key] = p.role === "merchant" ? env.merchantPhone : simPhone(p.cc ?? "961");
    names[key] = p.name ?? key;
  }
  const personaOf = (phone: string) =>
    Object.keys(phones).find((k) => phones[k] === phone) ?? phone;
  const vars: Record<string, string> = { ...(sc.vars ?? {}) };
  const scope = () => ({
    ...Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, { phone: v }])),
    vars,
  });
  const results: StepResult[] = [];
  const seen: Out[] = []; // everything the bot sent to this scenario's personas, in order
  const phoneSet = new Set(Object.values(phones));
  const maxId = async () =>
    Number(
      (await env.db.query("select coalesce(max(id), 0) as m from public.sim_outbox")).rows[0].m,
    );
  const fetchNew = async (after: number): Promise<Out[]> => {
    const { rows } = await env.db.query(
      "select id, to_phone, kind, body, payload from public.sim_outbox where id > $1 and to_phone = any($2) order by id",
      [after, [...phoneSet]],
    );
    return rows.map(toOut);
  };

  let ok = true;
  let error: string | undefined;
  for (const [index, step] of sc.steps.entries()) {
    const label = step.note ?? stepLabel(step);
    const r: StepResult = { index: index + 1, label, ok: true, lines: [], failures: [] };
    results.push(r);
    try {
      await runStep(step, r);
    } catch (e) {
      r.ok = false;
      r.failures.push(e instanceof Error ? e.message : String(e));
    }
    if (r.failures.length) r.ok = false;
    if (!r.ok) {
      ok = false;
      error = `step ${r.index} (${label}): ${r.failures[0]}`;
      break; // later steps depend on this one
    }
  }
  // An order the scenario left waiting would be given up minutes later as a missed order; three in a row auto-pause
  // the test shop (DECISIONS §30.2.2) and every later scenario finds it paused. Its customer cancels it instead.
  const customers = Object.entries(sc.personas)
    .filter(([, p]) => p.role !== "merchant")
    .map(([k]) => phones[k]);
  await env.db
    .query(
      `select public.order_cancel_by_customer(o.id, o.customer_id) from public.orders o
         join public.customers c on c.id = o.customer_id
        where c.phone_e164 = any($1) and o.status in ('awaiting_payment', 'placed')`,
      [customers],
    )
    .catch((e) => console.error(`cancelling ${sc.name}'s waiting orders failed`, String(e)));
  return {
    name: sc.name,
    file,
    ok,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    steps: results,
    error,
  };

  async function runStep(step: Step, r: StepResult) {
    const sql = (s: string) => render(s, scope());
    const marker = await maxId();
    let sent: { as: string; text: string } | null = null;

    if (step.say) {
      sent = { as: step.say.as, text: render(step.say.text, scope()) };
      await post(step.say.as, { type: "text", text: sent.text }, r);
    } else if (step.tap) {
      const t = step.tap;
      const pick = t.raw_id
        ? { o: { id: t.raw_id, title: t.title ?? t.raw_id }, list: false }
        : findOption(
            seen.filter((m) => m.to === phones[t.as]),
            t,
          );
      if (!pick) {
        r.failures.push(
          `no button or row to tap for ${JSON.stringify(t)} in what ${t.as} was sent`,
        );
      } else {
        sent = { as: t.as, text: `(taps "${pick.o.title}" ${pick.o.id.slice(0, 18)})` };
        await post(
          t.as,
          { type: pick.list ? "list" : "button", id: pick.o.id, title: pick.o.title },
          r,
        );
      }
    } else if (step.pin) {
      const lat = Number(render(String(step.pin.lat), scope()));
      const lon = Number(render(String(step.pin.lon), scope()));
      sent = { as: step.pin.as, text: `(sends a pin ${lat}, ${lon})` };
      await post(step.pin.as, { type: "location", lat, lon, name: step.pin.name }, r);
    } else if (step.cart) {
      const c = step.cart;
      const last = [...seen]
        .reverse()
        .find((m) => m.to === phones[c.as] && /^interactive:product/.test(m.kind));
      const catalogId = String((last?.raw as any)?.interactive?.action?.catalog_id ?? "");
      const items = c.items.map((x) => {
        const id = x.id ? render(x.id, scope()) : null;
        const o = id ? last?.options.find((y) => y.id === id) : last?.options[x.index ?? 0];
        const price = x.price === undefined ? null : Number(render(String(x.price), scope()));
        return o
          ? { id: o.id, quantity: x.qty, price: Number.isFinite(price) ? price : null }
          : null;
      });
      if (!last || items.some((x) => !x)) {
        r.failures.push(
          `no product message with those items for ${c.as} (${JSON.stringify(c.items)})`,
        );
      } else {
        const ok = items as { id: string; quantity: number; price: number | null }[];
        sent = {
          as: c.as,
          text: `(sends a cart: ${ok.map((x) => `${x.quantity} × ${x.id.slice(0, 8)}${x.price === null ? "" : ` at $${x.price}`}`).join(", ")})`,
        };
        await post(c.as, { type: "order", catalogId, items: ok }, r);
      }
    } else if (step.voice) {
      sent = { as: step.voice.as, text: `(voice note, transcript "${step.voice.transcript}")` };
      await post(step.voice.as, { type: "voice", transcript: step.voice.transcript }, r);
    } else if (step.sql) {
      await env.db.query(sql(step.sql));
      r.lines.push(`sql: ${short(sql(step.sql).replace(/\s+/g, " "), 160)}`);
    } else if (step.wait_s) {
      await sleep(step.wait_s * 1000);
      r.lines.push(`waited ${step.wait_s}s`);
    }
    if (sent) r.lines.push(`${names[sent.as]} → ${sent.text}`);
    if (r.failures.length) return;

    // Replies: collect until every expectation holds and the bot has been quiet for quiet_s.
    const expects = step.expect ?? [];
    const positive = expects.filter((e) => !e.none);
    // A step with no expectation still waits for the bot to finish, so the next step starts from a settled state.
    const quietMs = (step.quiet_s ?? (step.expect ? 2 : step.sql || step.wait_s ? 0 : 4)) * 1000;
    const deadline = Date.now() + (step.timeout_s ?? 30) * 1000;
    const window: Out[] = [];
    let lastNew = Date.now();
    const unmet = () => positive.filter((e) => !satisfied(e, window));
    for (;;) {
      const fresh = await fetchNew(window.length ? window[window.length - 1]!.id : marker);
      if (fresh.length) {
        window.push(...fresh);
        lastNew = Date.now();
      }
      const quiet = Date.now() - lastNew >= quietMs;
      if (!unmet().length && quiet) break;
      if (Date.now() > deadline) break;
      await sleep(500);
    }
    seen.push(...window);
    for (const m of window) r.lines.push(`   ← ${names[personaOf(m.to)] ?? m.to}: ${describe(m)}`);
    for (const e of unmet()) {
      const near = window.filter((m) => !e.to || m.to === phones[e.to]);
      const why = near.length
        ? near.map((m) => `#${m.id}: ${mismatch(e, m)}`).join("; ")
        : "nothing was sent to that persona";
      r.failures.push(`expected ${JSON.stringify(e)} — ${short(why, 400)}`);
    }
    for (const e of expects.filter((x) => x.none)) {
      const got = window.filter((m) => m.to === phones[e.none!]);
      if (got.length)
        r.failures.push(`expected silence to ${e.none}, got ${got.length} message(s)`);
    }
    for (const e of positive) {
      const hit = window.find((m) => (!e.to || m.to === phones[e.to]) && !mismatch(e, m));
      for (const [name, re] of Object.entries(e.capture ?? {})) {
        const g = hit ? new RegExp(re, "u").exec(`${hit.header}\n${hit.text}`) : null;
        if (g?.[1] !== undefined) vars[name] = g[1];
        else r.failures.push(`capture ${name}: /${re}/ not found`);
      }
    }
    for (const c of step.db ?? []) await dbCheck(c, r);
  }

  function satisfied(e: Expect, window: Out[]): boolean {
    return window.some((m) => (!e.to || m.to === phones[e.to]) && !mismatch(e, m));
  }

  async function post(as: string, message: Inbound, r: StepResult) {
    const phone = phones[as];
    if (!phone) throw new Error(`unknown persona "${as}"`);
    const res = await deliver(
      env.webhookUrl,
      env.secret,
      inboundPayload({ phone, phoneNumberId: env.phoneNumberId, name: names[as], message }),
      env.fetchImpl,
    );
    if (res.status !== 200) r.failures.push(`webhook answered ${res.status}: ${res.body}`);
  }

  async function dbCheck(c: DbCheck, r: StepResult) {
    const text = render(c.sql, scope());
    const until = Date.now() + (c.within_s ?? 12) * 1000;
    let last = "";
    for (;;) {
      const { rows } = await env.db.query(text);
      const bad: string[] = [];
      if (c.rows !== undefined && rows.length !== c.rows)
        bad.push(`${rows.length} rows, wanted ${c.rows}`);
      for (const [col, want] of Object.entries(c.row ?? {})) {
        const wantV =
          typeof want === "string" && want.includes("{{") ? render(want, scope()) : want;
        if (!rows[0]) {
          bad.push("no row");
          break;
        }
        if (!valueMatches(rows[0][col], wantV))
          bad.push(`${col} = ${JSON.stringify(rows[0][col])}, wanted ${JSON.stringify(wantV)}`);
      }
      if (!bad.length) {
        for (const [name, col] of Object.entries(c.save ?? {})) vars[name] = String(rows[0]?.[col]);
        r.lines.push(`   db ✓ ${short(text.replace(/\s+/g, " "), 120)}`);
        return;
      }
      last = bad.join("; ");
      if (Date.now() > until) break;
      await sleep(1000);
    }
    r.failures.push(`db check failed (${last}): ${short(text.replace(/\s+/g, " "), 200)}`);
  }
}

function findOption(
  msgs: Out[],
  t: { id?: string; id_prefix?: string; id_re?: string; title?: string; index?: number },
): { o: { id: string; title: string }; list: boolean } | null {
  for (const m of [...msgs].reverse()) {
    // Products are picked with a `cart` step, never tapped.
    if (!m.options.length || m.kind.startsWith("interactive:product")) continue;
    const list = m.kind === "interactive:list";
    if (t.index !== undefined) {
      const o = m.options[t.index];
      return o ? { o, list } : null;
    }
    const o = m.options.find(
      (x) =>
        (t.id !== undefined && x.id === t.id) ||
        (t.id_prefix !== undefined && x.id.startsWith(t.id_prefix)) ||
        (t.id_re !== undefined && new RegExp(t.id_re, "u").test(x.id)) ||
        (t.title !== undefined && optionMatches({ id: "\u0000", title: x.title }, t.title)),
    );
    if (o) return { o, list };
  }
  return null;
}

function stepLabel(s: Step): string {
  if (s.say) return `${s.say.as} says "${s.say.text}"`;
  if (s.tap)
    return `${s.tap.as} taps ${s.tap.raw_id ?? s.tap.id ?? s.tap.id_prefix ?? s.tap.id_re ?? s.tap.title ?? `#${s.tap.index}`}`;
  if (s.pin) return `${s.pin.as} sends a pin`;
  if (s.voice) return `${s.voice.as} sends a voice note`;
  if (s.cart) return `${s.cart.as} sends a cart of ${s.cart.items.length} item(s)`;
  if (s.sql) return "database step";
  if (s.wait_s) return `wait ${s.wait_s}s`;
  return "check";
}
