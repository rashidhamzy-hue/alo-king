// Task 4.10 on the real schema (0063): probe parties and the sink, the probe's answers, the alarms, Kapso project events.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { probeTick, projectEvent, type Env } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { buttons, KapsoReceived, list, senderKey } from "@ak/wa/kapso";
import { probeInbound, probeReply } from "@ak/wa/probe";
import { offerCard, pickupCard, cashAsk } from "@ak/agents/job-card";
import { orderButtonId } from "@ak/agents/order-card";
import { pickButtonId } from "@ak/agents/choice";
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

  // QA1: from 16 November the hourly probe order «ربطة خبز الفورنو» was asked «أي واحد بدك؟» (B1c's picker, three pick: buttons) and the
  // probe answered nothing, so no probe order was placed for 36 hours and probe_silent stayed open. A person taps one: the probe taps the first.
  it("answers the which-one question by tapping the first product offered, as a person would", () => {
    const ids = ["e2755700-6d60-410a-8591-bdf63abdbcb7", "dba47104-2905-4f14-8be3-cb0bc4e0e29a"].map(pickButtonId);
    expect(probeReply(buttons("«ربطة خبز الفورنو»: أي واحد بدك؟", ids.map((id, i) => ({ id, title: `${i + 1}. خبز` })))))
      .toMatchObject({ kind: "tap", id: ids[0] });
  });

  it("speaks the real Kapso shape: what it sends parses like a real webhook", () => {
    for (const msg of [{ type: "text", body: "بدي مي" }, { type: "tap", id: "job:accept:1", title: "قبول" }, { type: "location", lat: 33.6, lng: 35.5 }] as const) {
      const e = KapsoReceived.parse(probeInbound({ phoneNumberId: "597907523413541", waUserId: "PR.0000000000000002", name: "Probe", msg }));
      expect(senderKey(e)).toEqual({ waUserId: "PR.0000000000000002", phone: undefined });
      expect(e.message.kapso.origin).toBe("cloud_api");
    }
  });

  it("answers each message it was sent once, and places the hourly order only when due", async () => {
    await db.pg.exec(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);   // open (FIX2: the probe orders only while open)
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
    await openedHoursAgo(8);
    for (let i = 0; i < 25; i++) await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload, received_at) values ($1, 'customer', 'whatsapp.message.received', '{}', now() - interval '2 days')`, [`real-${i}`]);
    expect((await alarms()).map((a) => a.kind)).toContain("inbound_silent");
    await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload) values ('real-now', 'customer', 'whatsapp.message.received', '{}')`);
    expect((await alarms()).map((a) => a.kind)).not.toContain("inbound_silent");
  });
});

// FIX2 (Sentry ALO-KING-GATEWAY-3 and -5, staging 19 to 20 November): the probe wrote every hour but stalled, so probe_silent fired
// all day; inbound_silent fired at each opening after a quiet night. Honest, not silenced: the probe now completes its order, and both
// alarms still fire when the channel is really silent while open.
async function openedHoursAgo(h: number) {
  await db.pg.exec(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
      'open', to_char((now() at time zone 'Asia/Beirut') - interval '${h} hours', 'HH24:MI'),
      'close', to_char((now() at time zone 'Asia/Beirut') + interval '3 hours', 'HH24:MI')) where key = 'hours'`);
}
describe("FIX2: the probe completes its order, and silence is counted while open", () => {
  const listMsg = (rows: { id: string; title: string }[]) => list("«ربطة خبز الفورنو»: أي واحد بدك؟", "اختار", rows);
  it("answers the which-one list (CX2) by picking the first product row, sent as a list reply a real webhook parses", () => {
    const ids = ["e2755700-6d60-410a-8591-bdf63abdbcb7", "dba47104-2905-4f14-8be3-cb0bc4e0e29a"].map(pickButtonId);
    const r = probeReply(listMsg([{ id: "other:x", title: "غير شي" }, ...ids.map((id, i) => ({ id, title: `${i + 1}. خبز` }))]));
    expect(r).toMatchObject({ kind: "tap", id: ids[0], list: true });
    const e = KapsoReceived.parse(probeInbound({ phoneNumberId: "1378974041965966", waUserId: "PR.0000000000000001", name: "Probe", msg: { type: "tap", id: ids[0]!, title: "1. خبز", list: true } }));
    expect(e.message.interactive?.list_reply?.id).toBe(ids[0]);
    expect(probeReply(listMsg([{ id: "slot:1", title: "11:00" }]))).toBeNull();     // a list it does not know: no answer (the order stalls, alerted)
  });
  it("answers the pin request even when a 'not found yet' line came after it (the newest answerable message on the line)", async () => {
    await db.pg.exec(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);
    const delivered: { line: string; type: string }[] = [];
    const fakeEnv = { ...env, CONVERSATION: { idFromName: (n: string) => n, get: () => ({ fetch: async (_u: string, i: RequestInit) => { const b = JSON.parse(String(i.body)); delivered.push({ line: b.line, type: b.event.message.type }); return new Response("queued"); } }) } } as unknown as Env;
    const c = supabaseOver(db).client;
    await gatewaySend(c, env, { line: "customer", partyId: probeCustomer, to: "PR.0000000000000001", category: "service", dedupeKey: "fix2:pin", msg: { type: "interactive", interactive: { type: "location_request_message", body: { text: "ابعتلي موقعك" }, action: { name: "send_location" } } } as never });
    await gatewaySend(c, env, { line: "customer", partyId: probeCustomer, to: "PR.0000000000000001", category: "service", dedupeKey: "fix2:notfound", msg: { type: "text", text: { body: "🔎 لسّا ما عنّا" } } });
    await db.pg.exec(`update wa_outbox set created_at = now() - interval '1 second' where dedupe_key = 'fix2:pin'`);
    await probeTick(deps(), fakeEnv);
    expect(delivered.filter((d) => d.line === "customer" && d.type === "location")).toHaveLength(1);
    expect(await db.all(`select dedupe_key, action from probe_answers where dedupe_key like 'fix2:%' order by dedupe_key`))
      .toEqual([{ dedupe_key: "fix2:notfound", action: "none" }, { dedupe_key: "fix2:pin", action: "pin" }]);
  });
  it("places the test order only while the shop is open", async () => {
    await db.pg.exec(`delete from orders where customer_id = '${probeCustomer}'`);
    await db.pg.exec(`delete from wa_inbound_events where idempotency_key like 'probe:%'`);
    await db.pg.exec(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
        'open', to_char((now() at time zone 'Asia/Beirut') + interval '1 hour', 'HH24:MI'),
        'close', to_char((now() at time zone 'Asia/Beirut') + interval '3 hours', 'HH24:MI')) where key = 'hours'`);
    expect(await db.rpc("probe_due")).toBeNull();
    await openedHoursAgo(1);
    expect(await db.rpc("probe_due")).toMatchObject({ wa_user_id: "PR.0000000000000001" });
  });
  it("inbound_silent counts from the opening: a quiet night is not silence, six quiet open hours are", async () => {
    await db.pg.exec(`delete from wa_inbound_events where idempotency_key like 'real-%'`);
    for (let i = 0; i < 25; i++) await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload, received_at) values ($1, 'customer', 'whatsapp.message.received', '{}', now() - interval '14 hours')`, [`real-n${i}`]);
    await openedHoursAgo(1);
    expect(((await db.rpc("heartbeat_alerts")) as { kind: string }[]).map((a) => a.kind)).not.toContain("inbound_silent");
    await openedHoursAgo(7);
    expect(((await db.rpc("heartbeat_alerts")) as { kind: string }[]).map((a) => a.kind)).toContain("inbound_silent");
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
