// Session A5 (0116, G1-18): a message that went out but could not be marked sent is marked from Kapso's status webhook, by the
// message id, through the same record_message_status the webhook already calls. The match is strict: a message that did not go
// out is never marked sent.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { route, type Env } from "../../apps/gateway/src/index";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
let a: string, b: string;
const fx = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kapso/${p}`, import.meta.url)), "utf8")).body;
const TEXT = { type: "text", text: { body: "طلبك #A1B2 صار عالطريق 🛵" } };
const CARD = { type: "interactive", interactive: { type: "button", body: { text: "تأكيد؟" }, action: { buttons: [{ type: "reply", reply: { id: "o:confirm:1", title: "تأكيد" } }] } } };

/** The state after "the message is out, three marks failed": a pending outbox row, and the log row the gateway writes right after. */
async function stuck(key: string, party: string, msg: any, wamid: string | null, opts: { line?: string; status?: string } = {}) {
  await db.pg.query(`insert into wa_outbox(dedupe_key, line, party_id, payload, status, claimed_at, created_at) values ($1, $2, $3, $4::jsonb, 'pending', now() - interval '2 minutes', now() - interval '2 minutes')`,
    [key, opts.line ?? "customer", party, JSON.stringify(msg)]);
  if (wamid) await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, body, category, status) values ($1, 'outbound', $2, $3, $4, $5, 'service', $6)`,
    [opts.line ?? "customer", party, wamid, msg.type, msg.type === "text" ? msg.text.body : JSON.stringify(msg), opts.status ?? "sent"]);
}
const row = (key: string) => db.one(`select status, wa_message_id, last_error from wa_outbox where dedupe_key = $1`, [key]);
const status = (wamid: string, s = "sent") => db.rpc<boolean>("record_message_status", { p_wamid: wamid, p_status: s });

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  a = (await db.one(`insert into parties(role, display_name) values ('customer', 'A') returning id`)).id;
  b = (await db.one(`insert into parties(role, display_name) values ('customer', 'B') returning id`)).id;
}, 60_000);
beforeEach(async () => { await db.pg.exec(`delete from wa_outbox; delete from wa_messages`); });

describe("marked from the status webhook", () => {
  it("a text that went out is marked sent, with its message id, when Kapso says it was sent", async () => {
    await stuck("turn-1:0", a, TEXT, "wamid.X1");
    expect(await status("wamid.X1", "sent")).toBe(true);
    expect(await row("turn-1:0")).toEqual({ status: "sent", wa_message_id: "wamid.X1", last_error: "marked_from_status_webhook" });
    // and the lease no longer lets a retried turn send it again
    expect(await db.rpc("outbox_claim", { p_key: "turn-1:0", p_line: "customer", p_party: a, p_payload: TEXT })).toBe(false);
  });
  it("delivered and read mark it too (the sent status may have been missed)", async () => {
    await stuck("k-read", a, TEXT, "wamid.X2");
    await status("wamid.X2", "read");
    expect((await row("k-read")).status).toBe("sent");
  });
  it("an interactive message is matched by its JSON, not its text", async () => {
    await stuck("k-card", a, CARD, "wamid.X3");
    await status("wamid.X3");
    expect((await row("k-card")).status).toBe("sent");
  });
  it("end to end through the webhook route: a message.sent event for the message id", async () => {
    await stuck("k-route", a, TEXT, "wamid.TEST1757CAEA4B55");
    const { client } = supabaseOver(db);
    await route(client, {} as Env, "customer", "whatsapp.message.sent", fx("whatsapp.message.delivered/api-text-01.json"));
    expect(await row("k-route")).toMatchObject({ status: "sent", wa_message_id: "wamid.TEST1757CAEA4B55" });
  });
});

describe("never marked sent when it was not", () => {
  it("a failed status marks nothing", async () => {
    await stuck("k-fail", a, TEXT, "wamid.F1");
    await status("wamid.F1", "failed");
    expect((await row("k-fail")).status).toBe("pending");
  });
  it("another person's identical words, another line, another text, and a sink row do not match", async () => {
    await stuck("k-other-party", b, TEXT, null);                       // B's row, same words
    await stuck("k-other-line", a, TEXT, null, { line: "ops" });        // same party, other line
    await stuck("k-other-text", a, { type: "text", text: { body: "كلام تاني" } }, null);
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, body, category, status) values ('customer', 'outbound', $1, 'wamid.SINK', 'text', $2, 'service', 'sink')`, [a, TEXT.text.body]);
    await stuck("k-sink", a, TEXT, null);
    await status("wamid.SINK");
    for (const k of ["k-other-party", "k-other-line", "k-other-text", "k-sink"]) expect((await row(k)).status, k).toBe("pending");
  });
  it("with no log row for the message id (the database was down for both writes) nothing is guessed", async () => {
    await stuck("k-nolog", a, TEXT, null);
    expect(await status("wamid.UNKNOWN")).toBe(false);
    expect((await row("k-nolog")).status).toBe("pending");
  });
  it("a row that is already marked, or marked under another id, is left alone", async () => {
    await stuck("k-done", a, TEXT, "wamid.D1");
    await db.pg.query(`update wa_outbox set status = 'sent', wa_message_id = 'wamid.D1' where dedupe_key = 'k-done'`);
    await stuck("k-twin", a, TEXT, null);
    await status("wamid.D1");
    expect((await row("k-twin")).status).toBe("pending");
  });
  it("two identical unmarked rows: each status marks one, the oldest first", async () => {
    await stuck("k-old", a, TEXT, "wamid.T1");
    await db.pg.query(`insert into wa_outbox(dedupe_key, line, party_id, payload, status, claimed_at, created_at) values ('k-new', 'customer', $1, $2::jsonb, 'pending', now() - interval '1 minute', now() - interval '1 minute')`, [a, JSON.stringify(TEXT)]);
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, body, category, status) values ('customer', 'outbound', $1, 'wamid.T2', 'text', $2, 'service', 'sent')`, [a, TEXT.text.body]);
    await status("wamid.T1");
    expect([(await row("k-old")).status, (await row("k-new")).status]).toEqual(["sent", "pending"]);
    await status("wamid.T2");
    expect((await row("k-new")).wa_message_id).toBe("wamid.T2");
  });
  it("the status update itself is unchanged: the log row still takes the status and the billing facts", async () => {
    await stuck("k-meter", a, TEXT, "wamid.M1");
    await db.rpc("record_message_status", { p_wamid: "wamid.M1", p_status: "delivered", p_billable: false, p_category: "service", p_type: "free_customer_service", p_error_code: null });
    expect(await db.one(`select status, billable, pricing_category from wa_messages where wa_message_id = 'wamid.M1'`)).toEqual({ status: "delivered", billable: false, pricing_category: "service" });
  });
});
