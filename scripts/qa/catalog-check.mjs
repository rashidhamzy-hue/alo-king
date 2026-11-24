#!/usr/bin/env node
// CAT2: the live check of the catalogue message on STAGING (run by the `catalog-check` workflow; never by a model).
//
// A scripted tester writes «الكتالوج» (entered where a real message enters: wa_inbound_events; the Worker's cron delivers it). The Worker
// answers through its gateway and Kapso, for real: the scripted tester is NOT a probe party (a probe's sends stop at the gateway and never
// reach Kapso, so they cannot prove what Kapso accepts). Its number is in Ofcom's range for drama and fiction (+44 7700 900xxx, never
// assigned to a subscriber; scripts/ci/personal-data-allow.json), so no person can receive it: Meta takes the request, and reports the
// message undeliverable later. The report says what the Worker sent (type, thumbnail), the message id Kapso returned, and any refusal.
// Kapso's own external API log is then read for that send's status (200 expected): the session reads it, as the report says.
// Env: DATABASE_URL. Spend: one free-form message to a number that cannot exist (Meta does not bill an undeliverable message).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
const PHONE_ID = "1378974041965966";
const PHONE = "+447700900147", FROM = "447700900147";
const BAAKLINE = { lat: 33.67739, lng: 35.56355 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const line = (s) => { out.push(s); console.error(s); };
let failed = false;

line("## CAT2 catalogue check (staging)");
const lead = (await sql`select id from parties where is_probe and role = 'ops_lead' limit 1`)[0]?.id;
let party = (await sql`select party_id from party_identities where line = 'customer' and phone_e164 = ${PHONE}`)[0]?.party_id;
if (!party) {
  party = (await sql`insert into parties(role, display_name, is_probe) values ('customer', 'CAT2 scripted tester (fiction number)', false) returning id`)[0].id;
  await sql`insert into party_identities(party_id, line, phone_e164) values (${party}, 'customer', ${PHONE})`;
  await sql`insert into consent_events(party_id, line, kind, action, source, wording) values (${party}, 'customer', 'transactional', 'opt_in', 'cat2_setup', 'CAT2 scripted tester')`;
  await sql`select save_customer_pin(${party}, ${BAAKLINE.lat}, ${BAAKLINE.lng}, null)`;
}
await sql`select set_tester(${lead}, ${PHONE}, true)`;
try {
  const ts = Math.floor(Date.now() / 1000);
  const id = `wamid.CAT2${ts}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const message = { id, timestamp: String(ts), from: FROM, type: "text", text: { body: "الكتالوج" },
    kapso: { direction: "inbound", status: "received", processing_status: "pending", origin: "cloud_api", has_media: false, content: "الكتالوج" } };
  const body = { message, conversation: { id: `cat2-${FROM}`, contact_name: "CAT2", phone_number: PHONE, business_scoped_user_id: null, status: "active", phone_number_id: PHONE_ID },
                 is_new_conversation: false, phone_number_id: PHONE_ID };
  const since = (await sql`insert into wa_inbound_events(idempotency_key, line, event, payload) values (${"cat2:" + id}, 'customer', 'whatsapp.message.received', ${sql.json(body)})
                           returning received_at::text as at`)[0].at;
  line(`- «الكتالوج» entered at ${since} (UTC) as ${id}`);
  let rows = [];
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    rows = await sql`select o.dedupe_key, o.status, o.wa_message_id, o.last_error as error, o.payload from wa_outbox o where o.party_id = ${party} and o.created_at > ${since}::timestamptz order by o.created_at`;
    if (rows.length && rows.every((r) => r.status !== "pending")) { await sleep(10000); rows = await sql`select o.dedupe_key, o.status, o.wa_message_id, o.last_error as error, o.payload from wa_outbox o where o.party_id = ${party} and o.created_at > ${since}::timestamptz order by o.created_at`; break; }
  }
  if (!rows.length) { line("- **no reply in 3 minutes**"); failed = true; }
  let catalogOk = false;
  for (const r of rows) {
    const p = r.payload ?? {}, i = p.interactive ?? {};
    const what = p.type === "interactive" ? `${i.type}${i.action?.parameters?.thumbnail_product_retailer_id ? ` (thumbnail ${i.action.parameters.thumbnail_product_retailer_id})` : ""}` : p.type;
    line(`- sent: ${what}; outbox ${r.status}; message id ${r.wa_message_id ?? "none"}${r.error ? `; error ${String(r.error).slice(0, 160)}` : ""}`);
    if (i.type === "catalog_message" && r.wa_message_id && !r.error) catalogOk = true;
  }
  const refusals = await sql`select trace from agent_runs where agent = 'compliance_gateway' and outcome = 'refused' and created_at > ${since}::timestamptz order by created_at`;
  for (const x of refusals) line(`- refused: ${x.trace?.reason}${x.trace?.detail ? ` (${String(x.trace.detail).slice(0, 160)})` : ""}`);
  line(catalogOk ? "- **The catalogue message went out: Kapso returned a message id.** Read Kapso's external API log for it (200 expected)."
                 : "- **The catalogue message did not go out as a catalogue message.**");
  if (!catalogOk) failed = true;
} finally { await sql`select set_tester(${lead}, ${PHONE}, false)`.catch(() => undefined); }
console.log(out.join("\n"));
await sql.end();
process.exit(failed ? 1 : 0);
