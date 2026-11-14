// Session A4, audit 14 Nov item 8: the three utility templates existed in Arabic only, and customers also write in English and
// French. 0093 adds English and French versions (submitted to Meta through Kapso, their own names, same wording rules) and
// picks the language from how the customer last wrote (the Concierge's reading, agent_runs.trace.intent.language).
// Arabic, Lebanese Arabic, Arabizi and mixed stay Arabic. The words that fill the template are in the same language.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotice } from "../../apps/gateway/src/index";
import type { TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb;
const env = { KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1378974041965966", PHONE_NUMBER_ID_OPS: "597907523413541" };
let sent: any[];
beforeEach(() => { sent = []; vi.stubGlobal("fetch", vi.fn(async (_u: string, i: RequestInit) => { sent.push(JSON.parse(String(i.body))); return new Response(JSON.stringify({ messages: [{ id: `wamid.l${Math.random()}` }] }), { status: 200, headers: { "content-type": "application/json" } }); })); });
afterEach(() => vi.unstubAllGlobals());
const deps = (): TurnDeps => { const { client } = supabaseOver(db); return { db: client, model: {} as never, modelName: "x", send: (r) => gatewaySend(client, env, r) } as TurnDeps; };
const due = async () => (await db.rpc("customer_notices_due")) as any[];
const tick = async () => { for (const n of await due()) await sendNotice(deps(), n); };

let n = 0;
/** A customer whose last Concierge reading was in `language` (null: never read), with a confirmed cash payment. */
async function paidCustomer(language: string | null, windowOpen = false) {
  n++;
  const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1,'customer',$2,$3)`, [party, `LG.${String(n).padStart(16, "0")}`, `+9617100${String(n).padStart(4, "0")}`]);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, $2) returning id`,
    [party, windowOpen ? new Date().toISOString() : new Date(Date.now() - 30 * 3600_000).toISOString()])).id;
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source) values ($1, 'customer', 'transactional', 'opt_in', 'first_order_button')`, [party]);
  if (language) {
    await db.pg.query(`insert into agent_runs(agent, conversation_id, model, outcome, trace, created_at) values ('concierge', $1, 'm', 'ok', jsonb_build_object('intent', jsonb_build_object('language', 'ar_lb')), now() - interval '1 day')`, [conv]);
    await db.pg.query(`insert into agent_runs(agent, conversation_id, model, outcome, trace) values ('concierge', $1, 'm', 'ok', jsonb_build_object('intent', jsonb_build_object('language', $2::text)))`, [conv, language]);
  }
  const code = `L${n}G`;
  const order = (await db.one(`insert into orders(short_code, customer_id, conversation_id, status, subtotal_usd) values ($1, $2, $3, 'delivered', 12.5) returning id`, [code, party, conv])).id;
  await db.pg.query(`insert into payments(order_id, method, status, amount_usd, received_usd, change_usd, confirmed_at) values ($1, 'cod', 'confirmed', 12.5, 20, 7.5, now())`, [order]);
  return { party, order, code, conv };
}

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  for (const t of ["ak_payment_received_v1", "ak_payment_received_en_v1", "ak_payment_received_fr_v1", "ak_order_cancelled_en_v1"]) {
    expect(await db.rpc("set_template_status", { p_name: t, p_status: "APPROVED" })).toBe(true);
  }
}, 60_000);

describe("notices in the customer's language (audit item 8)", () => {
  it("English and French versions of the three templates exist, utility, with the same variables as the Arabic ones", async () => {
    const t = await db.all<{ name: string; language: string; category: string; variables: string[]; body: string }>(
      `select name, language, category, variables, body from wa_templates where name like 'ak\\_%' order by name`);
    expect(t.map((x) => `${x.name}:${x.language}`)).toEqual([
      "ak_order_cancelled_en_v1:en", "ak_order_cancelled_fr_v1:fr", "ak_order_cancelled_v1:ar",
      "ak_payment_received_en_v1:en", "ak_payment_received_fr_v1:fr", "ak_payment_received_v1:ar",
      "ak_rider_at_door_en_v1:en", "ak_rider_at_door_fr_v1:fr", "ak_rider_at_door_v1:ar"]);
    const vars = Object.fromEntries(t.map((x) => [x.name, x.variables]));
    for (const kind of ["order_cancelled", "rider_at_door", "payment_received"]) {
      expect(vars[`ak_${kind}_en_v1`]).toEqual(vars[`ak_${kind}_v1`]);
      expect(vars[`ak_${kind}_fr_v1`]).toEqual(vars[`ak_${kind}_v1`]);
    }
    for (const x of t) {
      expect(x.category).toBe("utility");
      expect(x.body).not.toMatch(/offer|discount|free|best|new|promo|offre|remise|gratuit|meilleur|nouveau/i);   // nothing promotional
    }
  });

  it("a customer who writes in English gets the English template, filled in English", async () => {
    const c = await paidCustomer("en");
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "template", template: { name: "ak_payment_received_en_v1", language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: c.code }, { type: "text", text: "12.50$ cash" }] }] } });
  });

  it("a customer who writes in French gets the French template, filled in French", async () => {
    const c = await paidCustomer("fr");
    await tick();
    expect(sent[0]).toMatchObject({ template: { name: "ak_payment_received_fr_v1", language: { code: "fr" },
      components: [{ parameters: [{ text: c.code }, { text: "12.50$ en espèces" }] }] } });
  });

  it("Lebanese Arabic, Arabizi, mixed, or never read: the Arabic template, as before", async () => {
    for (const lang of ["ar_lb", "arabizi", "mixed", null]) {
      sent.length = 0;
      const c = await paidCustomer(lang);
      await tick();
      expect(sent[0]).toMatchObject({ template: { name: "ak_payment_received_v1", language: { code: "ar" },
        components: [{ parameters: [{ text: c.code }, { text: "12.50$ نقداً" }] }] } });
    }
  });

  it("the language follows the latest reading: Arabic yesterday, English today is English", async () => {
    const c = await paidCustomer("en");
    expect(await db.rpc("customer_language", { p_party: c.party })).toBe("en");
    await tick();                                                         // its payment notice goes now, not into the next test
  });

  it("before Meta approves the French template: the French words as free text inside the window", async () => {
    const c = await paidCustomer("fr", true);
    await db.pg.query(`update payments set confirmed_at = null, status = 'pending' where order_id = $1`, [c.order]);
    await db.pg.query(`insert into order_events(order_id, from_status, to_status, actor, reason) values ($1, 'delivered', 'cancelled', 'system', 'timeout:awaiting_payment')`, [c.order]);
    await tick();
    expect(sent[0]).toMatchObject({ type: "text", text: { body: `Votre commande #${c.code} a été annulée : le paiement n'est pas arrivé à temps. Écrivez-nous si vous la voulez toujours.` } });
  });

  it("an approved English cancellation template carries the English reason", async () => {
    const c = await paidCustomer("en");
    await db.pg.query(`update payments set confirmed_at = null, status = 'pending' where order_id = $1`, [c.order]);
    await db.pg.query(`insert into order_events(order_id, from_status, to_status, actor, reason) values ($1, 'delivered', 'cancelled', 'system', 'timeout:awaiting_confirmation')`, [c.order]);
    await tick();
    expect(sent[0]).toMatchObject({ template: { name: "ak_order_cancelled_en_v1", language: { code: "en" },
      components: [{ parameters: [{ text: c.code }, { text: "the order was not confirmed in time" }] }] } });
  });
});
