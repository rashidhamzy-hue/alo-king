#!/usr/bin/env node
// TEST1: the friends' test journeys on STAGING, by scripted customers (run by the `test1-journeys` workflow; never by a model).
//
// Each journey is one invented customer: a probe party (so nothing is ever sent to a real phone: can_send answers probe_sink and the
// message is recorded in the outbox, never handed to Kapso) with an invented phone number (+961 70 000 95x, the project's fake block),
// so the friends' test gate treats it as anyone else (0273). Testers are put on the tester list for the run and taken off at the end.
// Its messages enter exactly where a real one does: a Kapso-shaped inbound event stored in wa_inbound_events, which the Worker's minute
// cron hands to the conversation (stale_inbound_events, after 45 s). Every reply is read back from wa_outbox, as it would have been sent.
//
//   stranger  a number not on the list writes: "we're not open yet", no price, no model
//   typed     a typed grocery order: the card with the test line; the Confirm tap; "where's my order?"; the walk to delivered; the
//             feedback question and its tap; no stock, payment or ledger row
//   voice     a voice note (Kapso's transcript given; no audio file): the card; the tap
//   cart      a cart from the WhatsApp catalogue (settings.catalog.catalog_id): the card; nothing confirmed until the tap
//   food      a Safa Chicken dish with a required choice: choices asked by code; the card «🍗 من: Safa Chicken»; the tap; the call ahead
//             simulated and accepted; "<place> took the order"
//   web       the website (a headless browser): basket, sign-in by a WhatsApp code the customer sends, checkout, the card to WhatsApp,
//             the tap there
// Prints a Markdown report. Exit 1 if any journey fails. Env: DATABASE_URL (staging), WEB_URL. Spend: the reading of three orders.
import postgres from "postgres";
import { createRequire } from "node:module";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 4, idle_timeout: 20 });
const WEB = (process.env.WEB_URL ?? "").replace(/\/+$/, "");
const PHONE_ID = "1378974041965966";
const LINE = "🧪 طلب تجريبي: ما في توصيل ولا دفع";
const BAAKLINE = { lat: 33.67739, lng: 35.56355 };      // Baakline's centre (as prepare-staging.sql)
// A run uses one set of six fresh customers (+961 70 000 9S0 to 9S5, S = JOURNEY_SET, 5 to 9), so an earlier run's chats never carry over.
const SET = /^[5-9]$/.test(process.env.JOURNEY_SET ?? "") ? process.env.JOURNEY_SET : "5";
const WHO = Object.fromEntries(["stranger", "typed", "voice", "cart", "food", "web"].map((k, i) => [k, `+961700009${SET}${i}`]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const say = (j, ok, what) => { report.push({ j, ok, what }); console.error(`${ok ? "ok  " : "FAIL"} ${j}: ${what}`); };
const bodyOf = (p) => p?.text?.body ?? p?.interactive?.body?.text ?? "";
const rowsOf = (p) => [...(p?.interactive?.action?.buttons ?? []).map((b) => b.reply),
  ...(p?.interactive?.action?.sections ?? []).flatMap((s) => s.rows ?? [])].filter(Boolean);

let lead;
async function setup() {
  lead = (await sql`select id from parties where is_probe and role = 'ops_lead' limit 1`)[0]?.id;
  if (!lead) throw new Error("no probe ops lead on staging (prepare-staging.sql)");
  const out = {};
  for (const [k, phone] of Object.entries(WHO)) {
    const wa = `PR.TEST1${SET}${k.toUpperCase()}`;
    let party = (await sql`select party_id from party_identities where line = 'customer' and wa_user_id = ${wa}`)[0]?.party_id;
    if (!party) {
      party = (await sql`insert into parties(role, display_name, is_probe) values ('customer', ${`TEST1 scripted ${k} ${SET}`}, true) returning id`)[0].id;
      await sql`insert into party_identities(party_id, line, wa_user_id, phone_e164) values (${party}, 'customer', ${wa}, ${phone})`;
      await sql`insert into consent_events(party_id, line, kind, action, source, wording) values (${party}, 'customer', 'transactional', 'opt_in', 'test1_setup', 'TEST1 scripted customer')`;
    }
    if (k !== "stranger") {
      await sql`select set_tester(${lead}, ${phone}, true)`;
      const pin = (await sql`select save_customer_pin(${party}, ${BAAKLINE.lat}, ${BAAKLINE.lng}, null) as r`)[0].r;
      await sql`select set_place_details(${party}::uuid, ${pin.place_id}::uuid, 'بيت الاختبار', 'الطابق الأول', 'حد ساحة الضيعة')`;
      await sql`select set_contact_phone(${party}, ${phone})`;
    }
    out[k] = { party, wa, phone };
  }
  return out;
}
async function teardown() {
  for (const [k, phone] of Object.entries(WHO)) if (k !== "stranger") await sql`select set_tester(${lead}, ${phone}, false)`.catch(() => undefined);
}

/** A message from a scripted customer, stored exactly as Kapso's webhook is (the cron delivers it). */
async function inject(who, msg) {
  const ts = Math.floor(Date.now() / 1000);
  const id = `wamid.TEST1${ts}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const message = { id, timestamp: String(ts), from_user_id: who.wa, from_parent_user_id: null, username: null, context: null,
    type: msg.type === "tap" ? "interactive" : msg.type,
    kapso: { direction: "inbound", status: "received", processing_status: "pending", origin: "cloud_api", has_media: msg.type === "audio", content: msg.content ?? "" } };
  if (msg.type === "text") message.text = { body: msg.body };
  if (msg.type === "tap") message.interactive = msg.list ? { type: "list_reply", list_reply: { id: msg.id, title: msg.title } } : { type: "button_reply", button_reply: { id: msg.id, title: msg.title } };
  if (msg.type === "audio") { message.audio = { id: `t1-${ts}`, voice: true, mime_type: "audio/ogg; codecs=opus" }; message.kapso.transcript = { text: msg.transcript }; }
  if (msg.type === "order") message.order = msg.order;
  if (msg.type === "location") message.location = { latitude: msg.lat, longitude: msg.lng };
  const body = { message, conversation: { id: `test1-${who.wa}`, contact_name: "TEST1", phone_number: null, business_scoped_user_id: who.wa, status: "active", phone_number_id: PHONE_ID },
                 is_new_conversation: false, phone_number_id: PHONE_ID };
  await sql`insert into wa_inbound_events(idempotency_key, line, event, payload) values (${"test1:" + id}, 'customer', 'whatsapp.message.received', ${sql.json(body)})`;
  return new Date();
}

/** The next message sent to this customer after `since` that `want` accepts. */
async function next(who, since, want = () => true, ms = 300_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const rows = await sql`select payload, created_at, dedupe_key from wa_outbox where party_id = ${who.party} and line = 'customer' and created_at > ${since} order by created_at`;
    const hit = rows.find((r) => want(r.payload, r.dedupe_key));
    if (hit) return hit;
    await sleep(5000);
  }
  return null;
}
const hasConfirm = (p) => rowsOf(p).some((r) => /^order:confirm:/.test(r.id ?? ""));
const confirmOf = (p) => rowsOf(p).find((r) => /^order:confirm:/.test(r.id ?? ""));
/** A message the test-order walk sent (its key is test:<step>:<order>), not an answer to the customer's own message. */
const walkKey = (k) => /^test:/.test(k ?? "");
/** Model turns of this customer's conversations since t (agent_runs is per conversation). */
const modelTurns = async (who, t) => (await sql`select count(*)::int n from agent_runs r join conversations c on c.id = r.conversation_id
  where c.party_id = ${who.party} and r.created_at > ${t} and r.agent = 'concierge'`)[0].n;
const orderOfConfirm = (p) => /^order:confirm:([0-9a-f-]{36})/.exec(confirmOf(p)?.id ?? "")?.[1];

/** Answers what the bot asks on the way to a card, as a person would: the first product of a "which one?", the first choice of a dish's
 *  required group ("no, thanks" for an optional one is the first row too), the pin, the house and floor. Returns the card, or null. */
async function toCard(j, who, since) {
  let after = since;
  for (let i = 0; i < 8; i++) {
    const m = await next(who, after, () => true);
    if (!m) return null;
    after = m.created_at;
    const p = m.payload;
    if (hasConfirm(p)) return m;
    if (p.type === "interactive" && p.interactive?.type === "location_request_message") { after = await inject(who, { type: "location", ...BAAKLINE }); continue; }
    if (/كرمال السائق/.test(bodyOf(p))) { after = await inject(who, { type: "text", body: "بيت الاختبار، الطابق الأول، حد ساحة الضيعة" }); continue; }
    const rows = rowsOf(p);
    // The first-ever welcome (its buttons start a new basket): a person reads it and waits for the answer to what they wrote.
    if (rows.some((r) => /^(welcome|menu):/.test(r.id ?? ""))) continue;
    if (rows.length) { const r = rows[0]; after = await inject(who, { type: "tap", id: r.id, title: r.title ?? "", list: p.interactive?.type === "list" }); continue; }
    // a plain text on the way (a note before the card): wait for the next one
  }
  return null;
}

async function tap(who, payload) { const c = confirmOf(payload); return inject(who, { type: "tap", id: c.id, title: c.title ?? "" }); }
async function order(id) { return (await sql`select short_code, status::text, is_test, test_cleared_at from orders where id = ${id}`)[0]; }
async function moved(id) {
  return (await sql`select (select count(*) from stock_movements where order_id = ${id})::int s, (select count(*) from payments where order_id = ${id})::int p,
                           (select count(*) from ledger_entries where order_id = ${id})::int l, (select count(*) from delivery_stops where order_id = ${id})::int d`)[0];
}
async function confirmCard(j, who, card) {
  const id = orderOfConfirm(card.payload);
  const o = await order(id);
  say(j, o.is_test && o.status === "awaiting_confirmation", `card for ${o.short_code} waits for the tap (status ${o.status}, test order ${o.is_test})`);
  say(j, bodyOf(card.payload).includes(LINE), "the card carries the test line");
  const t = await tap(who, card.payload);
  const conf = await next(who, t, (p, k) => /AK-/.test(bodyOf(p)) && !walkKey(k));
  const after = await order(id);
  say(j, after.status === "confirmed" || after.status === "preparing", `the Confirm tap confirmed ${o.short_code} (now ${after.status})`);
  say(j, !!conf && bodyOf(conf.payload).includes(LINE), `the confirmation carries the test line: «${bodyOf(conf?.payload).split("\n")[0]}»`);
  return id;
}

// ---------- the journeys ----------
async function stranger(w) {
  const t = await inject(w.stranger, { type: "text", body: "مرحبا، بدي ربطة خبز وكرتونة مي لو سمحت" });
  const r = await next(w.stranger, t);
  const b = bodyOf(r?.payload);
  say("stranger", /لسّا ما فتحنا/.test(b) && !/\$/.test(b), r ? `answered «${b.replace(/\n/g, " / ")}»` : "no answer");
  const runs = await modelTurns(w.stranger, t);
  say("stranger", runs === 0, `no model turn for a number not on the list (${runs})`);
}

async function typed(w) {
  const t = await inject(w.typed, { type: "text", body: "بدي تلات كراتين مي تنورين وربطتين خبز الفورنو" });
  const card = await toCard("typed", w.typed, t);
  if (!card) return say("typed", false, "no card");
  const id = await confirmCard("typed", w.typed, card);
  const code = (await order(id)).short_code;
  const q = await inject(w.typed, { type: "text", body: "وين صار طلبي؟" });
  const ans = await next(w.typed, q, (p, k) => bodyOf(p).includes(code) && !walkKey(k));
  say("typed", !!ans, `"where's my order?" answered: «${bodyOf(ans?.payload).replace(/\n/g, " / ")}»`);
  const fb = await next(w.typed, q, (p) => rowsOf(p).some((r) => /^fb:fine:/.test(r.id ?? "")), 900_000);
  const walked = await sql`select step, sent_at is not null as sent from test_order_steps where order_id = ${id} order by done_at`;
  say("typed", walked.map((x) => x.step).join(",") === "preparing,on_the_way,at_door,delivered,feedback" && walked.every((x) => x.sent),
      `the walk: ${walked.map((x) => x.step).join(" → ")}`);
  const msgs = await sql`select payload from wa_outbox where party_id = ${w.typed.party} and dedupe_key like ${"test:%:" + id}`;
  say("typed", msgs.length === 5 && msgs.every((m) => bodyOf(m.payload).includes(LINE)), `${msgs.length} status messages, each with the test line`);
  if (fb) {
    const r = rowsOf(fb.payload).find((x) => /^fb:fine:/.test(x.id));
    const ft = await inject(w.typed, { type: "tap", id: r.id, title: r.title ?? "" });
    const thanks = await next(w.typed, ft);
    say("typed", !!thanks, `the feedback tap answered: «${bodyOf(thanks?.payload)}»`);
  } else say("typed", false, "no feedback question");
  const o = await order(id); const m = await moved(id);
  say("typed", o.status === "delivered" && m.s + m.p + m.l + m.d === 0, `${o.short_code} ended ${o.status}; stock ${m.s}, payments ${m.p}, ledger ${m.l}, delivery stops ${m.d}`);
}

async function voice(w) {
  const t = await inject(w.voice, { type: "audio", transcript: "مرحبا، بدي كرتونة مي تنورين وقهوة نجار لو سمحت", content: "Audio (TEST1)" });
  const card = await toCard("voice", w.voice, t);
  if (!card) return say("voice", false, "no card after the voice note");
  await confirmCard("voice", w.voice, card);
}

async function cart(w) {
  const cat = (await sql`select value->>'catalog_id' id from settings where key = 'catalog'`)[0]?.id;
  const items = (await sql`select x->>'sku' sku, (x->>'price_usd')::numeric price from jsonb_array_elements(catalog_feed()) x
                            where (x->>'in_stock')::boolean and x->>'feed_jpeg_path' is not null and (x->>'price_usd')::numeric between 2 and 8 limit 2`);
  const t = await inject(w.cart, { type: "order", order: { catalog_id: cat, text: "TEST1",
    product_items: items.map((i) => ({ product_retailer_id: i.sku, quantity: 2, item_price: Number(i.price), currency: "USD" })) } });
  const card = await toCard("cart", w.cart, t);
  if (!card) return say("cart", false, "no card from the cart");
  const runs = await modelTurns(w.cart, t);
  say("cart", true, `catalogue ${cat}: a cart of ${items.map((i) => i.sku).join(", ")} became the card (model turns: ${runs})`);
  await confirmCard("cart", w.cart, card);
}

async function food(w) {
  const d = (await sql`select p.id, coalesce(p.name_ar, p.name_en) as name from products p join sources s on s.id = p.owner_source_id
     where s.name = 'Safa Chicken' and p.is_active and product_orderable_for(p.id, ${w.food.party})
       and exists (select 1 from dish_option_groups g where g.product_id = p.id and g.required) order by p.name_en limit 1`)[0];
  if (!d) return say("food", false, "no orderable Safa Chicken dish with a required choice for a tester");
  const t = await inject(w.food, { type: "text", body: `بدي ${d.name} من صفا` });
  const card = await toCard("food", w.food, t);
  if (!card) return say("food", false, `no card for «${d.name}»`);
  say("food", /🍗 من: Safa Chicken/.test(bodyOf(card.payload)), `the card names the place: «${bodyOf(card.payload).split("\n").find((l) => l.includes("🍗")) ?? ""}»`);
  const id = await confirmCard("food", w.food, card);
  const call = (await sql`select c.status, c.ready_in_min, (select count(*)::int from place_call_log l where l.call_id = c.id and (l.detail->>'simulated')::boolean) sim
                            from place_calls c where c.order_id = ${id}`)[0];
  say("food", call?.status === "accepted" && call.sim === 1, `the call ahead: ${call?.status}, ready in ${call?.ready_in_min} min, simulated (nobody called Safa)`);
  const took = await next(w.food, new Date(Date.now() - 600_000), (p, k) => walkKey(k) && /Safa Chicken/.test(bodyOf(p)) && bodyOf(p).includes(LINE), 300_000);
  say("food", !!took, `the customer is told: «${bodyOf(took?.payload).replace(/\n/g, " / ")}»`);
}

async function web(w) {
  if (!WEB) return say("web", false, "no WEB_URL");
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ locale: "ar" })).newPage();
    const sku = (await sql`select x->>'sku' sku from jsonb_array_elements(catalog_feed()) x where (x->>'in_stock')::boolean and (x->>'price_usd')::numeric between 6 and 12 limit 1`)[0].sku;
    await page.goto(`${WEB}/p/${sku}`);
    await page.locator('form[action="/cart/line"] button').first().click();
    await page.goto(`${WEB}/checkout`);
    await page.locator('form[action="/signin"] button').first().click();
    await page.waitForURL(/\/signin/);
    // The sign-in panel's own chat link carries the code (the header's chat link carries a greeting).
    const code = (await page.locator(".w2-code").first().textContent({ timeout: 30_000 }))?.trim();
    const href = await page.locator('.panel a[href*="wa.me"]').first().getAttribute("href");
    const text = new URL(href).searchParams.get("text");
    say("web", !!code && text.includes(code), `the sign-in code ${code} is in the chat link's words`);
    say("web", !!text, `the website's sign-in code, sent from WhatsApp as the customer would: «${text}»`);
    const t = await inject(w.web, { type: "text", body: text });
    const linked = await next(w.web, t);
    say("web", !!linked, `WhatsApp answered the code: «${bodyOf(linked?.payload)}»`);
    await page.goto(`${WEB}/checkout`);
    const send = page.locator('button[name="do"][value="place"]');
    await send.waitFor({ timeout: 30_000 });
    const before = new Date();
    await send.click();
    await page.waitForLoadState("load");
    const card = await next(w.web, before, hasConfirm);
    if (!card) return say("web", false, "no card on WhatsApp after the website's checkout");
    const id = orderOfConfirm(card.payload);
    const o = await order(id);
    say("web", (await sql`select channel from orders where id = ${id}`)[0].channel === "web", `the website made ${o.short_code} (channel web) and sent its card to WhatsApp`);
    await confirmCard("web", w.web, card);
  } finally { await browser.close(); }
}

async function main() {
  const w = await setup();
  try {
    const runs = [stranger(w), typed(w), voice(w), cart(w), food(w), web(w)].map((p, i) =>
      p.catch((e) => say(["stranger", "typed", "voice", "cart", "food", "web"][i], false, `error: ${String(e.message ?? e).slice(0, 200)}`)));
    await Promise.all(runs);
  } finally { await teardown(); }
  const failed = report.filter((r) => !r.ok).length;
  console.log(`### TEST1 journeys on staging (${new Date().toISOString()})\n\n| Journey | | What happened |\n|---|---|---|`);
  for (const r of report) console.log(`| ${r.j} | ${r.ok ? "✅" : "❌"} | ${String(r.what).replace(/\|/g, "/")} |`);
  console.log(`\n${failed ? `**${failed} check(s) failed.**` : "**Every check passed.**"} Scripted customers +961 70 000 9${SET}0 to 9${SET}5 (invented; probe parties, nothing sent to a phone); taken off the tester list again.`);
  await sql.end();
  if (failed) process.exit(1);
}
main().catch(async (e) => { console.error(e); await teardown().catch(() => undefined); process.exit(1); });
