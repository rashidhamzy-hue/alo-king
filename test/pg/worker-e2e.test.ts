// Task 4.5: the Worker end to end, in the local Workers runtime (workerd, through wrangler), against a REAL Postgres.
// Only the edges are stand-ins: Supabase's HTTP front (a PostgREST-compatible layer over the real database, postgrest-shim.ts),
// Kapso's send endpoint (a recorder that can be told to fail), and the model (a scripted Anthropic endpoint).
// Everything between them is the code that ships: worker.ts, index.ts, the conversation object and its alarms, turn.ts,
// ops-turn.ts, the agents, the gateway, every migration.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";
import { startPostgrest } from "./postgrest-shim";

const run = realPostgresAvailable() ? describe : describe.skip;
const require_ = createRequire(import.meta.url);
const CUSTOMER_LINE = "1378974041965966", OPS_LINE = "597907523413541", SECRET = "e2e-secret";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pg: RealPg, sql: postgres.Sql, rest: Awaited<ReturnType<typeof startPostgrest>>;
let worker: { fetch: (p: string, i?: RequestInit) => Promise<Response>; stop: () => Promise<void> };
const servers: Server[] = [];

// ---- Kapso: records every send; can fail the next N sends that match a predicate
type Sent = { pnid: string; to: string; type: string; body: any };
const kapso = { sent: [] as Sent[], failNext: 0, failWhen: (_b: any) => true, attempts: 0 };
// ---- the model: a reading per inbound text, end_turn for anything else
const readings: [RegExp, Record<string, unknown>][] = [];
let modelCalls = 0;

function listen(handler: (path: string, body: any) => { status: number; json: unknown }): Promise<string> {
  const s = createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c)).on("end", () => {
      const out = handler(req.url ?? "/", d ? JSON.parse(d) : null);
      res.writeHead(out.status, { "content-type": "application/json" }); res.end(JSON.stringify(out.json));
    });
  });
  servers.push(s);
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`)));
}

async function hmac(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function webhook(line: "customer" | "ops", event: string, body: unknown, idem: string): Promise<Response> {
  const raw = JSON.stringify(body);
  return worker.fetch(`/webhooks/kapso/${line}`, { method: "POST", body: raw, headers: { "X-Webhook-Signature": await hmac(raw), "X-Webhook-Event": event, "X-Idempotency-Key": idem, "content-type": "application/json" } });
}
const cron = () => worker.fetch("/__scheduled?cron=*+*+*+*+*");
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(250); }
}

/** A real Kapso inbound message (from the 4.1 fixtures), re-addressed to a test sender. */
function fixtureMessage(file: string, patch: (m: any) => void): any {
  const body = JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kapso/${file}`, import.meta.url)), "utf8")).body;
  body.message.id = `wamid.E2E${Math.random().toString(36).slice(2)}`;
  body.message.timestamp = String(Math.floor(Date.now() / 1000));
  patch(body.message);
  return body;
}

run("Worker end to end (workerd + real Postgres)", () => {
  beforeAll(async () => {
    pg = await startRealPostgres();
    sql = pg.connect(5);
    pg.psql("scripts/staging/prepare-staging.sql");                         // the probe customer and rider, stock, fx, hub
    await sql.unsafe(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"every_minutes": 60}' where key = 'probe';`);
    rest = await startPostgrest(sql);
    const kapsoUrl = await listen((path, body) => {
      const m = /\/meta\/whatsapp\/v[\d.]+\/(\d+)\/messages$/.exec(path);
      if (!m) return { status: 200, json: { data: [] } };                 // platform reads (health, templates): nothing to report
      kapso.attempts++;
      if (kapso.failNext > 0 && kapso.failWhen(body)) { kapso.failNext--; return { status: 500, json: { error: { message: "injected failure", code: 1 } } }; }
      kapso.sent.push({ pnid: m[1]!, to: body.to, type: body.type, body });
      return { status: 200, json: { messaging_product: "whatsapp", messages: [{ id: `wamid.OUT${kapso.sent.length}` }] } };
    });
    const modelUrl = await listen((_path, body) => {
      modelCalls++;
      const forced = body?.tool_choice?.name === "extract_order";
      const lastUser = JSON.stringify(body?.messages?.[body.messages.length - 1] ?? "");
      const hit = readings.find(([re]) => re.test(lastUser));
      const content = forced && hit ? [{ type: "tool_use", id: `tu_${modelCalls}`, name: "extract_order", input: { intent: { language: "ar_lb", ...hit[1] } } }] : [{ type: "text", text: "تمام" }];
      return { status: 200, json: { id: `msg_${modelCalls}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content,
        stop_reason: content[0]!.type === "tool_use" ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } };
    });
    // The same reading the Concierge flow test (1.1) proves gives a card in one go: one product per line, no question to ask.
    const LINES = [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }, { raw: "ربطتين خبز", query: "خبز", qty: 2, unit: "bundle", confidence: 0.9 }];
    readings.push([/عبعقلين/, { intent: "order", fulfilment: "delivery", lines: LINES, address: { village: "بعقلين", building: "بناية النسيم" } }]);
    readings.push([/لبنة ليبان ليه/, { intent: "order", fulfilment: "delivery", lines: LINES, address: { village: null } }]);

    process.env.NO_PROXY = "127.0.0.1,localhost";
    const { unstable_dev } = require_("wrangler");
    worker = await unstable_dev("apps/gateway/src/worker.ts", { config: "wrangler.jsonc", local: true, persist: false, logLevel: process.env.E2E_DEBUG ? "log" : "error",
      vars: { SUPABASE_URL: rest.url, SUPABASE_SERVICE_KEY: "service-key", KAPSO_BASE_URL: `${kapsoUrl}/meta/whatsapp/v24.0`, KAPSO_API_KEY: "kapso-key",
        KAPSO_WEBHOOK_SECRET_CUSTOMER: SECRET, KAPSO_WEBHOOK_SECRET_OPS: SECRET, PHONE_NUMBER_ID_CUSTOMER: CUSTOMER_LINE, PHONE_NUMBER_ID_OPS: OPS_LINE,
        ANTHROPIC_API_KEY: "model-key", ANTHROPIC_BASE_URL: modelUrl, BUFFER_SECONDS: "1", PROBE_MODE: "on", ENVIRONMENT: "e2e" },
      experimental: { disableExperimentalWarning: true, testScheduled: true } });
  }, 240_000);

  afterAll(async () => {
    if (process.env.E2E_DEBUG) {
      console.log("REST CALLS", rest?.calls.slice(0, 80).join(" "));
      console.log("KAPSO", kapso.attempts, JSON.stringify(kapso.sent).slice(0, 500), "MODEL", modelCalls);
      console.log("INBOUND", JSON.stringify(await sql`select idempotency_key, event, processed_at, error from wa_inbound_events order by received_at`).slice(0, 1500));
      console.log("RUNS", JSON.stringify(await sql`select agent, outcome, trace from agent_runs order by created_at desc limit 8`).slice(0, 3000));
      console.log("OUTBOX", JSON.stringify(await sql`select dedupe_key, status, last_error, payload from wa_outbox`).slice(0, 4000));
      console.log("HANDOFFS", JSON.stringify(await sql`select * from handoffs`).slice(0, 2500));
      console.log("EXC", JSON.stringify(await sql`select kind, ref, detail from ops_exceptions`).slice(0, 1500));
      console.log("VILLAGES", JSON.stringify(await sql`select v.id, v.name_en, v.is_served, z.name zone from villages v left join zones z on z.id = v.zone_id where not v.is_served or v.name_en = 'Baakline'`));
      console.log("PLACES", JSON.stringify(await sql`select cp.village_id, cp.lat, p.is_probe from customer_places cp join parties p on p.id = cp.party_id`));
    }
    await worker?.stop(); await rest?.close();
    for (const s of servers) await new Promise((ok) => s.close(ok));
    await sql?.end(); await pg?.stop();
  }, 60_000);

  it("the webhook path: signature, store once, the conversation object, the turn, a real send", async () => {
    expect((await worker.fetch("/webhooks/kapso/customer", { method: "POST", body: "{}" })).status).toBe(401);
    const msg = fixtureMessage("whatsapp.message.received/api-text-01.json", (m) => { m.text.body = "بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين بناية النسيم"; m.from = "96170009001"; m.from_user_id = "XX.0000000000009001"; });
    msg.conversation.phone_number = "96170009001"; msg.conversation.business_scoped_user_id = "XX.0000000000009001";
    expect((await webhook("customer", "whatsapp.message.received", msg, "e2e-1")).status).toBe(200);
    expect((await webhook("customer", "whatsapp.message.received", msg, "e2e-1")).status).toBe(200);    // Kapso retries: stored once
    const pin = await until("the pin request", async () => kapso.sent.find((s) => s.to === "+96170009001"));
    expect(pin).toMatchObject({ pnid: CUSTOMER_LINE, type: "interactive", body: { interactive: { type: "location_request_message" } } });
    expect(Number((await sql`select count(*) n from wa_inbound_events where idempotency_key = 'e2e-1'`)[0]!.n)).toBe(1);
    await until("processed", async () => (await sql`select processed_at from wa_inbound_events where idempotency_key = 'e2e-1'`)[0]?.processed_at);
    await sleep(1500);
    expect(kapso.sent.filter((s) => s.to === "+96170009001")).toHaveLength(1);
    // the line check: an event for the ops number on the customer route is refused
    const crossed = fixtureMessage("whatsapp.message.received/api-text-02.json", () => {}); crossed.phone_number_id = OPS_LINE;
    expect((await webhook("customer", "whatsapp.message.received", crossed, "e2e-crossed")).status).toBe(400);
  }, 60_000);

  it("a crash in the middle of a turn: the order is written, the send fails; the retry sends the card once and makes no second order", async () => {
    kapso.failNext = 1; kapso.failWhen = (b) => b.type === "interactive" && b.interactive?.type === "button";
    const loc = fixtureMessage("whatsapp.message.received/api-location-01.json", (m) => { m.from = "96170009001"; m.from_user_id = "XX.0000000000009001"; m.location = { latitude: 33.6789, longitude: 35.5778 }; });
    loc.conversation.phone_number = "96170009001"; loc.conversation.business_scoped_user_id = "XX.0000000000009001";
    expect((await webhook("customer", "whatsapp.message.received", loc, "e2e-2")).status).toBe(200);
    const card = await until("the card, after the retry", async () => kapso.sent.find((s) => s.to === "+96170009001" && s.body.interactive?.type === "button"));
    expect(kapso.failNext).toBe(0);                                         // the failure did happen
    await sleep(3000);                                                      // let any duplicate show itself
    expect(kapso.sent.filter((s) => s.to === "+96170009001" && s.body.interactive?.type === "button")).toHaveLength(1);
    const orders = await sql`select o.id, o.status, (select reason from order_events e where e.order_id = o.id and e.to_status = 'cancelled' limit 1) why
                             from orders o join party_identities i on i.party_id = o.customer_id where i.wa_user_id = 'XX.0000000000009001' order by o.created_at`;
    // One live order, and the card the customer got is for it. The retried turn re-plans and issues a new card, which
    // cancels the first draft as superseded (0005). Recorded for session B2 in HANDOFF: key the card on the turn instead.
    const live = orders.filter((o) => o.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(orders.filter((o) => o.status === "cancelled").every((o) => o.why === "superseded_by_new_card")).toBe(true);
    expect(card.body.interactive.action.buttons[0].reply.id).toBe(`order:confirm:${live[0]!.id}`);
    // and the customer is not told that a draft they never saw was cancelled (4.3's notice skips superseded drafts)
    await cron(); await sleep(500);
    expect(kapso.sent.filter((s) => s.to === "+96170009001" && s.type === "text" && /انلغى/.test(s.body.text.body))).toEqual([]);
    const [ob] = await sql`select count(*) filter (where status = 'sent') sent, count(*) total from wa_outbox o join party_identities i on i.party_id = o.party_id where i.wa_user_id = 'XX.0000000000009001'`;
    expect(Number(ob!.sent)).toBe(Number(ob!.total));
  }, 60_000);

  it("scheduled(): the hourly probe order walks to closed, every step through the real path, and nothing reaches Kapso", async () => {
    const before = kapso.sent.length;
    await cron();                                                           // the probe customer orders
    const order = await until("the probe's order", async () => (await sql`select o.id, o.short_code from orders o join parties p on p.id = o.customer_id where p.is_probe`)[0], 30_000);
    for (let i = 0; i < 12; i++) {
      const [o] = await sql`select status from orders where id = ${order.id}`;
      if (o!.status === "closed") break;
      await cron(); await sleep(2500);
    }
    const [o] = await sql`select status, total_usd from orders where id = ${order.id}`;
    expect(o!.status).toBe("closed");
    const trail = await sql`select e.from_status, e.to_status, e.reason, e.actor, exists (select 1 from order_transitions t where t.from_status = e.from_status and t.to_status = e.to_status) ok
                            from order_events e where e.order_id = ${order.id} order by e.created_at`;
    // A row whose from and to are the same is a note (a late tap, the learning job), not a move: nothing to allow.
    expect(trail.filter((t) => !t.ok && t.from_status !== null && t.from_status !== t.to_status).map((t) => `${t.from_status}->${t.to_status} ${t.reason} ${t.actor}`)).toEqual([]);
    const [pay] = await sql`select status, amount_usd from payments where order_id = ${order.id}`;
    expect(pay).toMatchObject({ status: "confirmed" });
    const [ledger] = await sql`select round(coalesce(sum(usd_equiv), 0), 4)::text total from ledger_entries`;
    expect(ledger!.total).toBe("0.0000");
    // Stock: what was picked out of the store equals what was sold (reserve -q and pick +q net to zero by design; on_hand fell by q)
    const [stock] = await sql`select coalesce(sum(i.qty), 0) - coalesce((select sum(m.qty_delta) from stock_movements m where m.order_id = ${order.id} and m.reason = 'pick'), 0) diff,
                                     (select count(*) from stock_movements m where m.order_id = ${order.id} and m.reason = 'pick') picks
                              from order_items i where i.order_id = ${order.id} and i.status = 'ok'`;
    expect(Number(stock!.picks)).toBeGreaterThan(0);
    expect(Number(stock!.diff)).toBe(0);
    expect(kapso.sent.length).toBe(before);                                 // every probe message went to the sink
    const [sink] = await sql`select count(*) n from wa_messages where status = 'sink'`;
    expect(Number(sink!.n)).toBeGreaterThan(5);
    const [dup] = await sql`select count(*) n from (select dedupe_key from wa_outbox group by 1 having count(*) > 1) x`;
    expect(Number(dup!.n)).toBe(0);
    expect((await sql`select at from heartbeats where name = 'cron'`).length).toBe(1);
    expect(await sql`select kind from ops_exceptions where status = 'open'`).toEqual([]);
  }, 120_000);
});
