// Task 4.1 on the real schema: the non-message webhook events, read from the saved Kapso payloads, applied through SQL (0060).
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { route, type Env } from "../../apps/gateway/src/index";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

const fx = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kapso/${p}`, import.meta.url)), "utf8")).body;
let db: TestDb;
const env = {} as Env;
let party: string;

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  party = (await db.one(`insert into parties(role, display_name) values ('customer', 'Test Person 1') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', 'XX.0000000000000001', '+96170000001')`, [party]);
}, 60_000);

const marketing = () => db.all(`select action, provider_sequence from consent_events where party_id = $1 and kind = 'marketing' order by created_at, provider_sequence`, [party]);

describe("marketing_preference_changed", () => {
  it("a STOP is saved as an opt-out (it used to be saved as an opt-in), and a redelivery changes nothing", async () => {
    const { client } = supabaseOver(db);
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", fx("whatsapp.contact.marketing_preference_changed/doc-stopped-01.json"));
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", fx("whatsapp.contact.marketing_preference_changed/doc-stopped-01.json"));
    expect(await marketing()).toEqual([{ action: "opt_out", provider_sequence: 4821 }]);
  });

  it("a newer resume applies; an older change arriving late does not", async () => {
    const { client } = supabaseOver(db);
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", fx("whatsapp.contact.marketing_preference_changed/doc-resumed-02.json"));
    const late = fx("whatsapp.contact.marketing_preference_changed/doc-stopped-01.json");
    late.marketing_preference.sequence = 4800;
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", late);
    expect((await marketing()).map((r) => r.action)).toEqual(["opt_out", "opt_in"]);
  });

  it("is not a sign of life: no party for a stranger, and the reply window stays shut", async () => {
    const { client } = supabaseOver(db);
    const before = await db.one(`select (select count(*) from parties) p, (select count(*) from conversations) c`);
    const stranger = fx("whatsapp.contact.marketing_preference_changed/doc-stopped-01.json");
    stranger.contact = { wa_id: "96170009999", business_scoped_user_id: "XX.0000000000009999" };
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", stranger);
    await route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", fx("whatsapp.contact.marketing_preference_changed/doc-stopped-01.json"));
    expect(await db.one(`select (select count(*) from parties) p, (select count(*) from conversations) c`)).toEqual(before);
  });

  it("an unreadable payload fails loudly, so the event is kept with its error and retried, never dropped", async () => {
    const { client } = supabaseOver(db);
    await expect(route(client, env, "customer", "whatsapp.contact.marketing_preference_changed", { contact: {}, marketing_preference: "stop" })).rejects.toThrow(/unreadable/);
  });
});

describe("identity_changed", () => {
  it("re-keys the party to the new business-scoped id, so the next message finds the same customer", async () => {
    const { client } = supabaseOver(db);
    await route(client, env, "customer", "whatsapp.contact.identity_changed", fx("whatsapp.contact.identity_changed/doc-01.json"));
    expect(await db.one(`select wa_user_id, phone_e164 from party_identities where party_id = $1`, [party])).toEqual({ wa_user_id: "XX.0000000000000099", phone_e164: "+96170000001" });
    const again = await db.rpc("rekey_identity", { p_line: "customer", p_old: "XX.0000000000000001", p_new: "XX.0000000000000099", p_phone: "+96170000001" });
    expect(again).toBe("already");
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "XX.0000000000000099", p_phone: null });
    expect(t.party_id).toBe(party);
  });
});

describe("statuses", () => {
  it("update the stored message by wamid", async () => {
    const { client } = supabaseOver(db);
    const body = fx("whatsapp.message.read/api-interactive-01.json");
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, status) values ('customer','outbound',$1,$2,'interactive','sent')`, [party, body.message.id]);
    await route(client, env, "customer", "whatsapp.message.read", body);
    expect((await db.one(`select status from wa_messages where wa_message_id = $1`, [body.message.id])).status).toBe("read");
  });
});
