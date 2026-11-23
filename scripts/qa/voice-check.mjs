#!/usr/bin/env node
// VOICE1: the live check of our own transcription on STAGING (run by the `voice-check` workflow; never by a model).
//
//   stored  the founder's test voice note of 23 November (10:30 to 10:40 UTC; the window is an input): its audio from the private `media`
//           bucket (or Kapso's media link), sent once to ElevenLabs Scribe with the keyterms staging gives today (stt_keyterms, 0276). The
//           transcript is written onto that message's row (wa_messages.transcript.voice1_check), never printed: the report says only
//           whether the place («صفا» / Safa) and the dish («فروج») were heard, by Scribe and by Kapso, and what it cost.
//   fresh   (input) a fresh voice note on staging, by a scripted tester (a probe party with an invented number, so nothing reaches a phone):
//           the same audio, by Kapso's own media link, entered where a real note enters (wa_inbound_events; the Worker's cron delivers it).
//           The Worker reads it as a customer's note: the report says which transcript it chose, its cost, and the first line of each reply.
// Voice audio and transcripts are personal data: nothing here logs them. Env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY,
// ELEVENLABS_API_KEY, NOTE_FROM, NOTE_TO, FRESH ("true"). Spend: one or two notes of a few seconds (fractions of a cent).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
const FROM = process.env.NOTE_FROM || "2026-11-23T10:30:00Z", TO = process.env.NOTE_TO || "2026-11-23T10:40:00Z";
const PHONE_ID = "1378974041965966";
const BAAKLINE = { lat: 33.67739, lng: 35.56355 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const line = (s) => { out.push(s); console.error(s); };
const heard = (t) => ({ place: /صفا|safa/i.test(t ?? ""), dish: /فروج|farr?ou?j|chicken/i.test(t ?? "") });
const yn = (b) => (b ? "yes" : "no");
let failed = false;

async function audioOf(note) {
  if (note.media_path) {
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${note.media_path}`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
    if (r.ok) return { bytes: await r.arrayBuffer(), from: "the private media bucket" };
    line(`- the stored audio answered ${r.status}; trying Kapso's link`);
  }
  if (note.media_url && /^https:\/\/([a-z0-9-]+\.)*kapso\.ai\//i.test(note.media_url)) {
    const r = await fetch(note.media_url);
    if (r.ok) return { bytes: await r.arrayBuffer(), from: "Kapso's media link" };
    line(`- Kapso's media link answered ${r.status}`);
  }
  return null;
}

async function scribe(bytes, keyterms, model) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/ogg" }), "note.ogg");
  form.append("model_id", model);
  form.append("tag_audio_events", "false");
  for (const k of keyterms) form.append("keyterms", k);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, body: form });
  const j = r.ok ? await r.json() : null;
  return { status: r.status, text: j?.text ?? null, seconds: Number(j?.audio_duration_secs ?? 0) || null, lang: j?.language_code ?? null };
}

async function stored() {
  const note = (await sql`select m.wa_message_id, m.media_path, m.transcript->>'kapso' as kapso, m.created_at::text as at,
      (select e.payload->'message'->'kapso'->>'media_url' from wa_inbound_events e where e.payload->'message'->>'id' = m.wa_message_id limit 1) as media_url,
      (select (e.payload->'message'->'kapso'->'media_data'->>'byte_size')::int from wa_inbound_events e where e.payload->'message'->>'id' = m.wa_message_id limit 1) as byte_size
    from wa_messages m where m.type = 'audio' and m.created_at between ${FROM}::timestamptz and ${TO}::timestamptz order by m.created_at limit 1`)[0];
  if (!note) { line(`- **No voice note between ${FROM} and ${TO}.**`); failed = true; return null; }
  line(`- The note: ${note.at} (UTC); stored audio: ${yn(!!note.media_path)}; Kapso link: ${yn(!!note.media_url)}`);
  const audio = await audioOf(note);
  if (!audio) { line("- **The audio could not be read.**"); failed = true; return note; }
  const ctx = (await sql`select stt_context() as c`)[0].c;
  const s = ctx.settings ?? {};
  const terms = (ctx.keyterms ?? []).slice(0, Math.min(100, s.keyterms_max ?? 100));
  const model = s.scribe?.model ?? "scribe_v2";
  const r = await scribe(audio.bytes, terms, model);
  line(`- Scribe (${model}, ${terms.length} keyterms, audio from ${audio.from}): HTTP ${r.status}${r.lang ? `, language ${r.lang}` : ""}${r.seconds ? `, ${r.seconds.toFixed(1)} s` : ""}`);
  if (!r.text) { failed = true; return note; }
  const usd = ((r.seconds ?? 0) / 3600) * (Number(s.scribe?.usd_per_hour ?? 0.2) + (terms.length ? Number(s.scribe?.keyterms_usd_per_hour ?? 0.05) : 0));
  const k = heard(note.kapso), ours = heard(r.text);
  line(`- Kapso heard the place: ${yn(k.place)}, the dish: ${yn(k.dish)}. **Scribe heard the place: ${yn(ours.place)}, the dish: ${yn(ours.dish)}** (${r.text.split(/\s+/).filter(Boolean).length} words). Cost about USD ${usd.toFixed(5)}`);
  await sql`update wa_messages set transcript = coalesce(transcript, '{}'::jsonb) || jsonb_build_object('voice1_check',
              jsonb_build_object('provider', 'elevenlabs_scribe', 'model', ${model}::text, 'text', ${r.text}::text, 'keyterms', ${terms.length}::int, 'usd', ${usd}::numeric, 'at', now()))
             where wa_message_id = ${note.wa_message_id}`;
  await sql`select record_stt_cost(${"voice1-check:" + note.wa_message_id}, ${model}, ${r.seconds ?? 0}, ${usd})`;
  if (!ours.place) failed = true;
  return note;
}

async function fresh(note) {
  if (!note?.media_url) { line("- Fresh note: skipped (no Kapso media link for the audio)."); return; }
  const lead = (await sql`select id from parties where is_probe and role = 'ops_lead' limit 1`)[0]?.id;
  const phone = "+96170000970", wa = "PR.VOICE1FRESH";
  let party = (await sql`select party_id from party_identities where line = 'customer' and wa_user_id = ${wa}`)[0]?.party_id;
  if (!party) {
    party = (await sql`insert into parties(role, display_name, is_probe) values ('customer', 'VOICE1 scripted tester', true) returning id`)[0].id;
    await sql`insert into party_identities(party_id, line, wa_user_id, phone_e164) values (${party}, 'customer', ${wa}, ${phone})`;
    await sql`insert into consent_events(party_id, line, kind, action, source, wording) values (${party}, 'customer', 'transactional', 'opt_in', 'voice1_setup', 'VOICE1 scripted tester')`;
    await sql`select save_customer_pin(${party}, ${BAAKLINE.lat}, ${BAAKLINE.lng}, null)`;
  }
  await sql`select set_tester(${lead}, ${phone}, true)`;
  try {
    const ts = Math.floor(Date.now() / 1000);
    const id = `wamid.VOICE1${ts}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const message = { id, timestamp: String(ts), from_user_id: wa, type: "audio", audio: { id: `v1-${ts}`, voice: true, mime_type: "audio/ogg; codecs=opus" },
      kapso: { direction: "inbound", status: "received", processing_status: "pending", origin: "cloud_api", has_media: true, content: "Audio (VOICE1)",
               transcript: { text: note.kapso ?? "" }, media_url: note.media_url, media_data: { url: note.media_url, byte_size: note.byte_size ?? 2100 * 6 } } };
    const body = { message, conversation: { id: `voice1-${wa}`, contact_name: "VOICE1", phone_number: null, business_scoped_user_id: wa, status: "active", phone_number_id: PHONE_ID },
                   is_new_conversation: false, phone_number_id: PHONE_ID };
    const since = (await sql`insert into wa_inbound_events(idempotency_key, line, event, payload) values (${"voice1:" + id}, 'customer', 'whatsapp.message.received', ${sql.json(body)})
                             returning received_at::text as at`)[0].at;
    let row = null;
    for (let i = 0; i < 36 && !row?.transcript?.chosen; i++) { await sleep(5000); row = (await sql`select transcript from wa_messages where wa_message_id = ${id}`)[0]; }
    const t = row?.transcript ?? {};
    line(`- **Fresh note on staging: the Worker chose ${t.chosen ?? "nothing"}**${t.ours ? ` (Scribe: ${t.ours.keyterms} keyterms, USD ${Number(t.ours.usd).toFixed(5)})` : ""}${t.notes ? `; notes ${JSON.stringify(t.notes)}` : ""}`);
    if (t.chosen !== "elevenlabs_scribe") failed = true;
    await sleep(20000);
    const replies = await sql`select payload from wa_outbox where party_id = ${party} and created_at > ${since}::timestamptz order by created_at`;
    for (const r of replies) {
      const p = r.payload; const b = p?.text?.body ?? p?.interactive?.body?.text ?? "";
      const rows = [...(p?.interactive?.action?.buttons ?? []).map((x) => x.reply?.title), ...(p?.interactive?.action?.sections ?? []).flatMap((s) => (s.rows ?? []).map((x) => x.title))].filter(Boolean);
      line(`  - reply: «${b.split("\n")[0].slice(0, 90)}»${rows.length ? ` [${rows.slice(0, 6).join(" | ")}]` : ""}${p?.interactive?.type === "catalog_message" ? " [View catalog]" : ""}`);
    }
    if (!replies.length) { line("  - **no reply in 3 minutes**"); failed = true; }
  } finally { await sql`select set_tester(${lead}, ${phone}, false)`.catch(() => undefined); }
}

line("## VOICE1 voice check (staging)");
const note = await stored().catch((e) => { line(`- **stored: ${String(e.message).slice(0, 120)}**`); failed = true; return null; });
if (process.env.FRESH === "true") await fresh(note).catch((e) => { line(`- **fresh: ${String(e.message).slice(0, 120)}**`); failed = true; });
console.log(out.join("\n"));
await sql.end();
process.exit(failed ? 1 : 0);
