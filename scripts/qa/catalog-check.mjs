#!/usr/bin/env node
// CAT2: the live check of the catalogue message on STAGING (run by the `catalog-check` workflow; never by a model).
//
// «الكتالوج» is entered where a real message enters (wa_inbound_events; the Worker's cron delivers it), and the Worker answers through its
// gateway and Kapso, for real. A probe party cannot prove what Kapso accepts (its sends stop at the gateway), and a number that never wrote
// to Kapso cannot either: Kapso answers 422 "outside the 24-hour window" (run 45343575813, a fiction-range number). So:
//   TESTER=true: the tester (on the list) who wrote to us most recently, if that was in the last 23 hours, so their window is open. They
//     receive one catalogue message, the reply to «الكتالوج». No number is an input, in the repository or printed (the logs are public).
//     The entered message is marked (id wamid.CAT2CHECK…, content "CAT2 check").
//   otherwise: the fiction-range scripted tester (+44 7700 900147; never assigned), which proves the Worker's side only.
// The report says what the Worker sent (type, thumbnail), the message id Kapso returned, and any refusal; Kapso's external API log is then
// read for that send's status (200 expected). Env: DATABASE_URL, TESTER ("true"). Spend: one service message inside the window (free).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
const PHONE_ID = "1378974041965966";
const REAL = process.env.TESTER === "true"
  ? ((await sql`select pi.phone_e164 as p from party_identities pi join wa_messages m on m.party_id = pi.party_id and m.direction = 'inbound'
         where pi.line = 'customer' and coalesce(setting('testers')->'numbers', '[]'::jsonb) ? pi.phone_e164 and m.created_at > now() - interval '23 hours'
           and m.wa_message_id not like 'wamid.CAT2CHECK%' order by m.created_at desc limit 1`)[0]?.p ?? null)
  : "";
if (REAL === null) { console.log("## CAT2 catalogue check (staging)\n- **No tester wrote in the last 23 hours: nobody's window is open, so Kapso would refuse.**"); await sql.end(); process.exit(1); }
const PHONE = REAL || "+447700900147", FROM = PHONE.replace(/^\+/, "");
const BAAKLINE = { lat: 33.67739, lng: 35.56355 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const line = (s) => { out.push(s); console.error(s); };
let failed = false;

line("## CAT2 catalogue check (staging)");
const lead = (await sql`select id from parties where is_probe and role = 'ops_lead' limit 1`)[0]?.id;
let party = (await sql`select party_id from party_identities where line = 'customer' and phone_e164 = ${PHONE}`)[0]?.party_id;
if (REAL) {
  const listed = (await sql`select coalesce(setting('testers')->'numbers', '[]'::jsonb) ? ${PHONE} as ok`)[0]?.ok;
  const open = party && (await sql`select exists (select 1 from wa_messages where party_id = ${party} and direction = 'inbound' and created_at > now() - interval '23 hours') as ok`)[0]?.ok;
  if (!listed || !open) { line(`- **Refused: that number is not a tester with an open 24-hour window** (on the list: ${listed ? "yes" : "no"}, window open: ${open ? "yes" : "no"}).`);
    console.log(out.join("\n")); await sql.end(); process.exit(1); }
  line("- To: a tester on the list whose window is open (the number is not printed).");
} else if (!party) {
  party = (await sql`insert into parties(role, display_name, is_probe) values ('customer', 'CAT2 scripted tester (fiction number)', false) returning id`)[0].id;
  await sql`insert into party_identities(party_id, line, phone_e164) values (${party}, 'customer', ${PHONE})`;
  await sql`insert into consent_events(party_id, line, kind, action, source, wording) values (${party}, 'customer', 'transactional', 'opt_in', 'cat2_setup', 'CAT2 scripted tester')`;
  await sql`select save_customer_pin(${party}, ${BAAKLINE.lat}, ${BAAKLINE.lng}, null)`;
}
if (!REAL) await sql`select set_tester(${lead}, ${PHONE}, true)`;
try {
  const ts = Math.floor(Date.now() / 1000);
  const id = `wamid.CAT2CHECK${ts}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const message = { id, timestamp: String(ts), from: FROM, type: "text", text: { body: "الكتالوج" },
    kapso: { direction: "inbound", status: "received", processing_status: "pending", origin: "cloud_api", has_media: false, content: "CAT2 check" } };
  const body = { message, conversation: { id: `cat2-check-${ts}`, contact_name: null, phone_number: PHONE, business_scoped_user_id: null, status: "active", phone_number_id: PHONE_ID },
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
} finally { if (!REAL) await sql`select set_tester(${lead}, ${PHONE}, false)`.catch(() => undefined); }
console.log(out.join("\n"));
await sql.end();
process.exit(failed ? 1 : 0);
