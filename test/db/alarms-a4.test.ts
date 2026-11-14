// Session A4, audit 14 Nov item 1: the heartbeat alarms on the real schema.
// Seen on staging: "heartbeat:probe_silent" opened a new ops exception every hour the shop was closed (12 open on 14 Nov),
// each with its own Sentry event, and nobody ever resolved them. Three rules, each a test:
//   1. the probe is only expected to order while the shop is open, and for long enough since it opened;
//   2. one problem is one exception, however many hours it lasts;
//   3. when the problem is gone, the exception closes itself (with a note), including the hourly ones left from before.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeatAlerts } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let probe: string, conv: string;
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_C", PHONE_NUMBER_ID_OPS: "PN_O" };
const deps = (): TurnDeps => { const { client } = supabaseOver(db); return { db: client, model: {} as never, modelName: "x", send: (r) => gatewaySend(client, env, r) } as TurnDeps; };
const alarms = async () => (await db.rpc("heartbeat_alerts")) as { kind: string; ref: string }[];
const kinds = async () => (await alarms()).map((a) => a.kind);

/** Opening hours relative to the clock in Beirut: opened `openedAgo` ago, closing `closesIn` from now. Wraps midnight as real hours can. */
async function hours(openedAgo: string, closesIn: string) {
  await db.pg.query(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
      'open',  to_char((now() at time zone 'Asia/Beirut') - $1::interval, 'HH24:MI'),
      'close', to_char((now() at time zone 'Asia/Beirut') + $2::interval, 'HH24:MI')) where key = 'hours'`, [openedAgo, closesIn]);
}
/** Closed now: opens in an hour, closes in two. */
const closed = () => db.pg.exec(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
      'open',  to_char((now() at time zone 'Asia/Beirut') + interval '1 hour', 'HH24:MI'),
      'close', to_char((now() at time zone 'Asia/Beirut') + interval '2 hours', 'HH24:MI')) where key = 'hours'`);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  await db.pg.exec(`update settings set value = value || '{"enabled": true}' where key = 'probe'`);
  probe = (await db.one(`insert into parties(role, is_probe, created_at) values ('customer', true, now() - interval '2 days') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'customer', 'PR.A4')`, [probe]);
  conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [probe])).id;
  // the last probe order closed five hours ago (the evening before)
  await db.pg.query(`insert into orders(short_code, customer_id, conversation_id, status, created_at) values ('A4P1', $1, $2, 'closed', now() - interval '5 hours')`, [probe, conv]);
  // one ops lead, so an alarm has someone to reach
  const lead = (await db.one(`insert into parties(role) values ('ops_lead') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, phone_e164) values ($1, 'ops', '+96170000444')`, [lead]);
  await db.pg.query(`insert into conversations(line, party_id, last_inbound_at) values ('ops', $1, now())`, [lead]);
}, 60_000);

describe("the probe is expected to order only while the shop is open (audit item 1)", () => {
  it("closed: a probe with no order for five hours is not an alarm", async () => {
    await closed();
    expect(await kinds()).not.toContain("probe_silent");
  });

  it("just opened: the hourly order has not had three hours to happen yet", async () => {
    await hours("30 minutes", "10 hours");
    expect(await kinds()).not.toContain("probe_silent");
  });

  it("open for four hours with no probe order: that is the alarm", async () => {
    await hours("4 hours", "10 hours");
    expect(await kinds()).toContain("probe_silent");
  });

  it("opening hours that run past midnight are open after midnight", async () => {
    await hours("4 hours", "4 hours");                 // e.g. 22:00 to 06:00 when it is 02:00
    expect(await kinds()).toContain("probe_silent");
  });
});

describe("one problem, one alarm; gone, it closes itself (audit item 1)", () => {
  it("the same silence an hour later is the same case: one exception, one ops message", async () => {
    await hours("4 hours", "10 hours");
    await heartbeatAlerts(deps());
    // an hour later the probe is still silent; before A4 the ref was the hour, so this opened a second case
    const silent = (await alarms()).find((a) => a.kind === "probe_silent")!;
    expect(silent.ref).not.toMatch(/T\d\d$/);
    await heartbeatAlerts(deps());
    const open = await db.all(`select ref from ops_exceptions where kind = 'heartbeat:probe_silent' and status <> 'resolved'`);
    expect(open).toHaveLength(1);
    const sent = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))).filter((b) => b.to === "+96170000444");
    expect(sent).toHaveLength(1);
  });

  it("when the shop closes, the open silence closes itself, and so do the hourly ones left from before A4", async () => {
    await db.pg.exec(`insert into ops_exceptions(kind, ref, detail) values ('heartbeat:probe_silent', '2026-11-14T05', '{}'), ('heartbeat:probe_silent', '2026-11-14T04', '{}')`);
    await closed();
    await heartbeatAlerts(deps());
    const rows = await db.all<{ status: string; cleared: string | null }>(`select status, detail->>'cleared_at' as cleared from ops_exceptions where kind = 'heartbeat:probe_silent'`);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.status === "resolved" && r.cleared)).toBe(true);
  });

  it("an alarm that is not a heartbeat (a Kapso account event, a failed turn) is never closed by the heartbeat", async () => {
    await db.pg.exec(`insert into ops_exceptions(kind, ref, detail) values ('kapso:account.restricted', 'wae_a4', '{}'), ('turn_failed', 'turn:a4', '{}')`);
    await heartbeatAlerts(deps());
    expect((await db.all(`select status from ops_exceptions where kind in ('kapso:account.restricted', 'turn_failed')`)).map((r: any) => r.status)).toEqual(["open", "open"]);
  });

  it("a stuck probe order is its own case, and closes when the order moves", async () => {
    await hours("4 hours", "10 hours");
    await db.pg.query(`insert into orders(short_code, customer_id, conversation_id, status, created_at) values ('A4P2', $1, $2, 'confirmed', now() - interval '45 minutes')`, [probe, conv]);
    await heartbeatAlerts(deps());
    expect((await db.one(`select count(*)::int n from ops_exceptions where kind = 'heartbeat:probe_stuck' and status = 'open'`)).n).toBe(1);
    await db.pg.exec(`update orders set status = 'closed' where short_code = 'A4P2'`);
    await heartbeatAlerts(deps());
    expect((await db.one(`select count(*)::int n from ops_exceptions where kind = 'heartbeat:probe_stuck' and status = 'open'`)).n).toBe(0);
  });
});
