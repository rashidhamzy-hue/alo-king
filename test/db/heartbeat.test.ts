// Task 4.10 on the real schema (0063): probe parties and the sink, the probe's answers, the alarms, Kapso project events.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { probeTick, projectEvent, type Env } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { buttons, KapsoReceived, senderKey } from "@ak/wa/kapso";
import { probeInbound, probeReply } from "@ak/wa/probe";
import { offerCard, pickupCard, cashAsk } from "@ak/agents/job-card";
import { orderButtonId } from "@ak/agents/order-card";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541" };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.real" }] }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

let probeCustomer: string, probeRider: string, realCustomer: string;
const deps = (): TurnDeps => { const { client } = supabaseOver(db); return { db: client, model: {} as never, modelName: "x", send: (r) => gatewaySend(client, env, r) } as TurnDeps; };

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  probeCustomer = (await db.one(`insert into parties(role, is_probe) values ('customer', true) returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'customer', 'PR.0000000000000001')`, [probeCustomer]);
  probeRider = (await db.one(`insert into parties(role, is_probe) values ('driver', true) returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'ops', 'PR.0000000000000002')`, [probeRider]);
  realCustomer = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, phone_e164) values ($1, 'customer', '+96170000001')`, [realCustomer]);
  await db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()), ('customer', $2, now())`, [probeCustomer, realCustomer]);
}, 60_000);

describe("probe parties and the sink", () => {
  it("probes disabled (the default, and production): nothing is sent to a probe, by anyone", async () => {
    expect(await db.rpc("can_send", { p_party: probeCustomer, p_line: "customer", p_category: "service", p_is_template: false })).toBe("probe_disabled");
    const r = await gatewaySend(supabaseOver(db).client, env, { line: "customer", partyId: probeCustomer, to: "PR.0000000000000001", category: "service", dedupeKey: "t:probe:0", msg: { type: "text", text: { body: "x" } } });
    expect(r).toEqual({ ok: false, refused: "probe_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes enabled: claimed, marked and logged like any message, but never handed to Kapso", async () => {
    await db.pg.exec(`update settings set value = value || '{"enabled": true, "pin": {"lat": 33.6789, "lng": 35.5778}}' where key = 'probe'`);
    const r = await gatewaySend(supabaseOver(db).client, env, { line: "customer", partyId: probeCustomer, to: "PR.0000000000000001", category: "service", dedupeKey: "t:probe:1", msg: { type: "text", text: { body: "x" } } });
    expect(r).toEqual({ ok: true, wamid: "sink:t:probe:1" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.one(`select status from wa_outbox where dedupe_key = 't:probe:1'`)).toEqual({ status: "sent" });
    expect(await db.one(`select status from wa_messages where wa_message_id = 'sink:t:probe:1'`)).toEqual({ status: "sink" });
    // and the marketing lock still comes first, for probes too
    expect(await db.rpc("can_send", { p_party: probeCustomer, p_line: "customer", p_category: "marketing", p_is_template: true })).toBe("marketing_disabled");
  });

  it("a real customer is unaffected: the message goes to Kapso", async () => {
    const r = await gatewaySend(supabaseOver(db).client, env, { line: "customer", partyId: realCustomer, to: "+96170000001", category: "service", dedupeKey: "t:real:1", msg: { type: "text", text: { body: "x" } } });
    expect(r).toEqual({ ok: true, wamid: "wamid.real" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the probe's answers", () => {
  const job = { delivery_id: "11111111-1111-4111-8111-111111111111", driver_id: "d", status: "offered", collect_usd: 9,
    stops: [{ seq: 1, kind: "pickup", done: false, source: "Alo King Hub" }, { seq: 2, kind: "dropoff", done: false, order_id: "22222222-2222-4222-8222-222222222222", short_code: "AB12", customer: "Probe", collect_usd: 9 }] } as never;
  it("taps the button a person would, in order, and nothing else", () => {
    expect(probeReply(buttons("x", [{ id: orderButtonId("confirm", "22222222-2222-4222-8222-222222222222"), title: "تأكيد" }, { id: "order:cancel:2", title: "إلغاء" }])))
      .toMatchObject({ kind: "tap", id: "order:confirm:22222222-2222-4222-8222-222222222222" });
    expect(probeReply(offerCard(job, 5))).toMatchObject({ kind: "tap", id: "job:accept:11111111-1111-4111-8111-111111111111" });
    expect(probeReply(pickupCard(job))).toMatchObject({ kind: "tap", id: "job:picked:11111111-1111-4111-8111-111111111111" });
    expect(probeReply(cashAsk({ order_id: "22222222-2222-4222-8222-222222222222", short_code: "AB12", total_usd: 9 }))).toMatchObject({ kind: "tap", id: "stop:exact:22222222-2222-4222-8222-222222222222" });
    expect(probeReply({ type: "interactive", interactive: { type: "location_request_message", body: { text: "x" }, action: { name: "send_location" } } })).toEqual({ kind: "pin" });
    expect(probeReply({ type: "text", text: { body: "تم" } })).toBeNull();
  });

  it("speaks the real Kapso shape: what it sends parses like a real webhook", () => {
    for (const msg of [{ type: "text", body: "بدي مي" }, { type: "tap", id: "job:accept:1", title: "قبول" }, { type: "location", lat: 33.6, lng: 35.5 }] as const) {
      const e = KapsoReceived.parse(probeInbound({ phoneNumberId: "597907523413541", waUserId: "PR.0000000000000002", name: "Probe", msg }));
      expect(senderKey(e)).toEqual({ waUserId: "PR.0000000000000002", phone: undefined });
      expect(e.message.kapso.origin).toBe("cloud_api");
    }
  });

  it("answers each message it was sent once, and places the hourly order only when due", async () => {
    const delivered: { line: string; id: string }[] = [];
    const fakeEnv = { ...env, CONVERSATION: { idFromName: (n: string) => n, get: () => ({ fetch: async (_u: string, i: RequestInit) => { const b = JSON.parse(String(i.body)); delivered.push({ line: b.line, id: b.event.message.interactive?.button_reply?.id ?? b.event.message.type }); return new Response("queued"); } }) } } as unknown as Env;
    await gatewaySend(supabaseOver(db).client, env, { line: "ops", partyId: probeRider, to: "PR.0000000000000002", category: "utility", dedupeKey: "offer:probe-d1", msg: offerCard(job, 5) });
    await probeTick(deps(), fakeEnv);
    await probeTick(deps(), fakeEnv);
    expect(delivered.filter((d) => d.line === "ops")).toEqual([{ line: "ops", id: "job:accept:11111111-1111-4111-8111-111111111111" }]);
    expect(delivered.filter((d) => d.line === "customer").map((d) => d.id)).toEqual(["text"]);       // the hourly order, once: probe_due sees no order yet
    expect((await db.one(`select count(*)::int n from wa_inbound_events where idempotency_key like 'probe:%' and processed_at is not null`)).n).toBe(2);
  });
});

describe("the probe's cash (OPS1, 15 Nov: the probe riders held more cash than the cap and the orders stopped at confirmed)", () => {
  it("each minute the probe step hands the probe riders' cash in, through the database function and nothing else", async () => {
    const d = deps(); const calls: string[] = [];
    const rpc = d.db.rpc.bind(d.db); (d.db as { rpc: unknown }).rpc = (fn: string, ...a: unknown[]) => { calls.push(fn); return (rpc as (...x: unknown[]) => unknown)(fn, ...a); };
    await probeTick(d, { ...env, CONVERSATION: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("ok") }) } } as unknown as Env);
    expect(calls).toContain("probe_remit_cash");
    expect(calls.indexOf("probe_remit_cash")).toBeLessThan(calls.indexOf("probe_due"));       // before a new order is placed
  });
});

describe("alarms", () => {
  const alarms = async () => (await db.rpc("heartbeat_alerts")) as { kind: string; ref: string; detail: Record<string, unknown> }[];
  it("a probe order that does not finish, and a probe that stops ordering", async () => {
    const conv = (await db.one(`select id from conversations where party_id = $1`, [probeCustomer])).id;
    await db.pg.query(`insert into orders(short_code, customer_id, conversation_id, status, created_at) values ('PRB1', $1, $2, 'confirmed', now() - interval '45 minutes')`, [probeCustomer, conv]);
    const stuck = (await alarms()).find((a) => a.kind === "probe_stuck")!;
    // OPS1: it says why. This probe rider is on no shift here, so there is nobody who could take the order.
    expect(stuck.detail).toMatchObject({ order: "PRB1", status: "confirmed", riders_on_shift: 0, riders_with_room: 0 });
    await db.pg.exec(`update orders set status = 'closed', created_at = now() - interval '5 hours' where short_code = 'PRB1'`);
    // since 0090 (A4) the probe is only expected to order while open, and once open for three probe periods
    await db.pg.exec(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
        'open', to_char((now() at time zone 'Asia/Beirut') - interval '4 hours', 'HH24:MI'),
        'close', to_char((now() at time zone 'Asia/Beirut') + interval '4 hours', 'HH24:MI')) where key = 'hours'`);
    const kinds = (await alarms()).map((a) => a.kind);
    expect(kinds).not.toContain("probe_stuck");
    expect(kinds).toContain("probe_silent");
  });

  it("the cron came back after a gap", async () => {
    await db.rpc("cron_beat");
    await db.pg.exec(`update heartbeats set at = now() - interval '9 minutes' where name = 'cron'`);
    await db.rpc("cron_beat");
    expect((await alarms()).find((a) => a.kind === "cron_gap")).toBeTruthy();
  });

  it("customers usually write and nobody has for hours, while open: the webhook may be dead", async () => {
    await db.pg.exec(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);
    for (let i = 0; i < 25; i++) await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload, received_at) values ($1, 'customer', 'whatsapp.message.received', '{}', now() - interval '2 days')`, [`real-${i}`]);
    expect((await alarms()).map((a) => a.kind)).toContain("inbound_silent");
    await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload) values ('real-now', 'customer', 'whatsapp.message.received', '{}')`);
    expect((await alarms()).map((a) => a.kind)).not.toContain("inbound_silent");
  });
});

describe("Kapso project events (account enforcement)", () => {
  const restricted = { id: "wae_test_1", event: "whatsapp.account.restricted", occurred_at: "2026-11-13T12:00:00Z", business_account_id: "1086076707594153",
    phone_numbers: [{ id: "1378974041965966", display_phone_number: "+961 70 000 099" }], restrictions: [{ type: "RESTRICTED_BIZ_INITIATED_MESSAGING" }], source: { provider: "meta", event: "ACCOUNT_RESTRICTION" } };
  it("opens one ops exception per event, however often it is delivered", async () => {
    await projectEvent(deps(), "whatsapp.account.restricted", restricted);
    await projectEvent(deps(), "whatsapp.account.restricted", restricted);
    const rows = await db.all(`select kind, ref, detail->>'numbers' as numbers from ops_exceptions where kind like 'kapso:%'`);
    expect(rows).toEqual([{ kind: "kapso:account.restricted", ref: "wae_test_1", numbers: "+961 70 000 099" }]);
  });
  it("ignores smoke tests and unknown events", async () => {
    await projectEvent(deps(), "smoke.test", {});
    expect((await db.one(`select count(*)::int n from ops_exceptions where kind like 'kapso:%'`)).n).toBe(1);
  });
});
