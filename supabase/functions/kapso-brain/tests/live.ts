// One-off capped LIVE verification against staging (kapso-brain-test, dry-run: nothing is sent to WhatsApp, model calls are real and cost money).
// Usage: SELFTEST_TOKEN=… bun tests/live.ts <phase> [--state file.json]
//   phases: ab (caching, basket/browsing/usual/address/pin, up to a confirmed order at vendor 2) | c1 (sweep creates the sold-out offer) | c2 (customer taps Accept new total) | d (privacy deletion) | e (handoff relay) | f (button-only) | g (cheap router)
// Hard cap: refuses to send when the estimated spend of the test phones (ai_call_log) is already at STOP_AT; prints the spend after each phase.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buttonsOf, textOf } from "./harness.ts";

const BASE = process.env.SUPABASE_URL ?? "https://hnjkietmwvkgbyrcnweq.supabase.co";
const FN = process.env.FN ?? "kapso-brain-test";
const TOKEN = process.env.SELFTEST_TOKEN ?? "";
const CAP = Number(process.env.CAP_USD ?? 1.5);
const STOP_AT = CAP * 0.9; // abort before a call could push the run over the cap
const HAIKU = "claude-haiku-4-5-20251001", SONNET = "claude-sonnet-5-5";
const ADMIN = "96171999999";
const TAHOUNEH = "al-tahouneh-restaurant-36524";
const V2 = "paradise-four-manakish-bakery-36979", V2_ITEM = `${V2}-shredded-chicken`, V2_SUB = `${V2}-roasted-chicken`;
const stateFile = process.argv.includes("--state") ? process.argv[process.argv.indexOf("--state") + 1] : "/tmp/live-state.json";
const phase = process.argv[2];
if (!TOKEN) throw new Error("set SELFTEST_TOKEN");

type State = { runId: string; startedAt: string; phones: Record<string, string>; ids: Record<string, string>; checks: { id: string; name: string; pass: boolean; detail?: string }[] };
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { runId: String(Date.now() % 1000).padStart(3, "0"), startedAt: new Date().toISOString(), phones: {}, ids: {}, checks: [] };
const phone = (k: string, i: number) => (state.phones[k] ??= `961700000${state.runId}${String(i).padStart(2, "0")}`);
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 1));
const check = (id: string, name: string, pass: boolean, detail?: string) => { state.checks.push({ id, name, pass, detail: pass ? undefined : detail }); console.log(`${pass ? "PASS" : "FAIL"}  (${id}) ${name}${pass || !detail ? "" : `  -> ${detail}`}`); };

async function call(qs: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/functions/v1/${FN}${qs}`, { method: "POST", headers: { "x-selftest": TOKEN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { throw new Error(`${FN}${qs} said ${res.status}: ${txt.slice(0, 160)}`); }
}
export async function spend() { return call(`?job=spend&since=${encodeURIComponent(state.startedAt)}`, {}); }
async function guard() { const s = await spend(); if (typeof s.spent !== "number" || Number.isNaN(s.spent)) { save(); throw new Error(`ABORT: spend job returned no usable number: ${JSON.stringify(s).slice(0, 120)}`); } if (s.spent >= STOP_AT) { save(); throw new Error(`ABORT: estimated spend $${s.spent.toFixed(4)} reached the stop line $${STOP_AT.toFixed(2)} (cap $${CAP})`); } return s; }

let seq = 0;
const wamid = () => `wamid.live.${Date.now()}.${seq++}`;
type Out = any[];
async function send(from: string, msg: any, headers: Record<string, string> = {}): Promise<Out> {
  await guard();
  const r = await call("", { message: { id: wamid(), from, ...msg } }, headers);
  return r.out ?? [];
}
const say = (p: string, t: string, h?: any) => send(p, { type: "text", text: { body: t } }, h);
const tap = (p: string, id: string, title = "", h?: any) => send(p, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }, h);
const tapList = (p: string, id: string, title = "", h?: any) => send(p, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } }, h);
const loc = (p: string, lat: number, lng: number, h?: any) => send(p, { type: "location", location: { latitude: lat, longitude: lng } }, h);
const mine = (out: Out, p: string) => out.filter((m) => m.to === p);
const txt = (out: Out, p?: string) => (p ? mine(out, p) : out).map(textOf).join("\n");
const btns = (out: Out, p: string) => mine(out, p).flatMap(buttonsOf);
const rowsOf = (out: Out, p: string) => mine(out, p).filter((m) => m.interactive?.type === "list").flatMap((m) => m.interactive.action.sections.flatMap((s: any) => s.rows));
const find = (out: Out, p: string, re: RegExp) => btns(out, p).find((b) => re.test(b.id) || re.test(b.title));
const inspect = async (p: string) => call(`?job=inspect&phone=${p}`, {});
const usageOf = async (p: string) => (await spend()).rows.filter((r: any) => r.customer_phone === p);

async function main() {
  if (phase === "ab") {
    // ---------- (a) prompt caching live: two+ Sonnet turns, same prefix ----------
    const A = phone("A", 1), HS = { "x-selftest-model": SONNET };
    await say(A, "Hi! What do you recommend for lunch?", HS);
    await say(A, "Any vegan options?", HS);
    await say(A, "And something with chicken?", HS);
    const ua = await usageOf(A);
    const rd = ua.reduce((n: number, r: any) => n + r.cache_read_tokens, 0), wr = ua.reduce((n: number, r: any) => n + r.cache_write_tokens, 0);
    check("a1", "model calls were logged for the caching conversation", ua.length >= 2, `${ua.length} calls`);
    check("a2", "cache_control accepted live (cache write tokens > 0 on some call)", wr > 0 || rd > 0, `write ${wr} read ${rd}`);
    check("a3", "cache READ tokens > 0 on a later call (the cached prefix is reused, not the uncached fallback)", ua.slice(1).some((r: any) => r.cache_read_tokens > 0), JSON.stringify(ua.map((r: any) => [r.cache_write_tokens, r.cache_read_tokens])));
    check("a4", "served model is the overridden one (Sonnet 5.5)", ua.every((r: any) => /sonnet/.test(r.model)), ua.map((r: any) => r.model).join(","));
    console.log("   cache per call [write, read, uncached input]:", JSON.stringify(ua.map((r: any) => [r.cache_write_tokens, r.cache_read_tokens, r.input_tokens])));

    // ---------- (b) basket + browsing + usual + saved address + pin (Haiku) ----------
    const B = phone("B", 2), H = { "x-selftest-model": HAIKU };
    let out = await say(B, "I want 2 soft drinks from Al Tahouneh", H);
    check("b1", "basket card with Checkout after adding by text", !!find(out, B, /^CHECKOUT\|/), txt(out, B).slice(0, 160));
    out = await tap(B, `MENU|${TAHOUNEH}`, "Menu", H);
    const cats = rowsOf(out, B);
    check("b2", "menu opens as a category list (<=10 rows, CAT| ids)", cats.length >= 2 && cats.length <= 10 && cats.every((r: any) => r.id.startsWith("CAT|")), `${cats.length} rows`);
    const food = cats.find((r: any) => !/drink|beer|alcohol|عرق|مشروب/i.test(r.title)) ?? cats[0];
    out = await tapList(B, food.id, food.title, H);
    const dishes = rowsOf(out, B).filter((r: any) => r.id.startsWith("ITEM|"));
    check("b3", "category shows a dish list", dishes.length > 0 && dishes.length <= 10, `${dishes.length}`);
    out = await tapList(B, dishes[0].id, dishes[0].title, H);
    const add = find(out, B, /^ADD\|/);
    check("b4", "item card has an Add button with a price in USD and LBP", !!add && /\$\d/.test(txt(out, B)) && /LBP/.test(txt(out, B)), txt(out, B).slice(0, 160));
    if (add) out = await tap(B, add.id, add.title, H);
    check("b5", "adding from the card shows the basket and at most one drink add-on", !!find(out, B, /^CHECKOUT\|/) && mine(out, B).length <= 3, `${mine(out, B).length} messages`);
    out = await say(B, "checkout. my name is Sami and deliver to Baakleen, near the church, building 3", H);
    let confirm = find(out, B, /^CONFIRM\|/);
    if (!confirm) { out = await say(B, "yes use that address and name, show me the order to confirm", H); confirm = find(out, B, /^CONFIRM\|/); }
    check("b6", "order summary with Confirm, delivery fee and total in USD+LBP", !!confirm && /2\.00/.test(txt(out, B)) && /LBP/.test(txt(out, B)), txt(out, B).slice(0, 200));
    const noticeSeen = /delete my data|احذف بياناتي/i.test(txt(out, B));
    check("b7", "one-line privacy notice shown before the card when the address is first saved", noticeSeen, txt(out, B).slice(0, 200));
    if (confirm) out = await tap(B, confirm.id, confirm.title, H);
    let snap = await inspect(B);
    check("b8", "tapping Confirm created exactly one order with server prices (fee 2.00, total = subtotal + 2)", snap.orders.length === 1 && Number(snap.orders[0].delivery_fee_usd) === 2 && Math.abs(Number(snap.orders[0].total_usd) - Number(snap.orders[0].subtotal_usd) - 2) < 0.011, JSON.stringify(snap.orders.map((o: any) => [o.status, o.subtotal_usd, o.total_usd])));
    check("b9", "order-received message has a Cancel button", !!find(out, B, /^CANCEL\|/), btns(out, B).map((b) => b.id.slice(0, 12)).join(","));
    check("b10", "address remembered and consent timestamp recorded", snap.addresses.length >= 1 && !!snap.customer?.data_consent_at, JSON.stringify({ addr: snap.addresses.length, consent: snap.customer?.data_consent_at }));
    state.ids.order1 = snap.orders[0]?.id ?? "";
    // the usual (no model): count calls before/after
    const before = (await usageOf(B)).length;
    out = await say(B, "the usual", H);
    const usualConfirm = find(out, B, /^CONFIRM\|/);
    check("b11", "\"the usual\" re-creates the order summary without a model call", !!usualConfirm && (await usageOf(B)).length === before, `confirm=${!!usualConfirm} calls ${before}->${(await usageOf(B)).length}`);
    // location pin (Baakleen)
    out = await loc(B, 33.6847, 35.5659, H);
    snap = await inspect(B);
    check("b12", "location pin saved as an address with a maps link and sets the village", snap.addresses.some((a: any) => /maps\.google\.com/.test(a.landmark ?? "")) && !!snap.customer?.village, JSON.stringify({ addr: snap.addresses.map((a: any) => [a.village, (a.landmark ?? "").slice(0, 40)]), village: snap.customer?.village }));
    // second vendor: add by tap, checkout with two saved addresses -> picker -> confirm
    out = await tap(B, `ADD|${V2}|${V2_ITEM}|1`, "Add", H);
    const bk = find(out, B, /^CHECKOUT\|/);
    check("b13", "second vendor creates its own basket", !!bk, txt(out, B).slice(0, 120));
    if (bk) out = await tap(B, bk.id, bk.title, H);
    const picker = rowsOf(out, B).filter((r: any) => r.id.startsWith("ADDR|"));
    check("b14", "checkout with two saved addresses asks where to deliver (picker incl. New address)", picker.length >= 2 && picker.some((r: any) => /^ADDR\|new/.test(r.id)), `${picker.length} rows; ${txt(out, B).slice(0, 100)}`);
    const first = picker.find((r: any) => !/^ADDR\|new/.test(r.id));
    if (first) out = await tapList(B, first.id, first.title, H);
    const c2 = find(out, B, /^CONFIRM\|/);
    check("b15", "choosing an address leads to a separate summary (own delivery fee) for vendor 2", !!c2 && /2\.00/.test(txt(out, B)), txt(out, B).slice(0, 200));
    if (c2) await tap(B, c2.id, c2.title, H);
    snap = await inspect(B);
    const o2 = snap.orders.find((o: any) => o.vendor_id === V2);
    check("b16", "second order placed at vendor 2 as pending", !!o2 && o2.status === "pending", JSON.stringify(snap.orders.map((o: any) => [o.vendor_id.slice(0, 14), o.status])));
    state.ids.order2 = o2?.id ?? ""; state.ids.order2total = o2?.total_usd ?? "";
  }

  if (phase === "b2") {
    // Re-run of the order -> usual -> address -> pin -> picker chain on a fresh customer, with Sonnet for the free-text turns (Haiku could not resolve the vendor id in the first run).
    const B = phone("B2", 6), H = { "x-selftest-model": SONNET };
    let out = await say(B, "I want 2 soft drinks from Al Tahouneh", H);
    check("r1", "basket card with Checkout after adding by text", !!find(out, B, /^CHECKOUT\|/), txt(out, B).slice(0, 160));
    out = await say(B, "checkout. my name is Sami and deliver to Baakleen, near the church, building 3", H);
    let confirm = find(out, B, /^CONFIRM\|/);
    if (!confirm) { out = await say(B, "yes use that name and address, show me the order to confirm", H); confirm = find(out, B, /^CONFIRM\|/); }
    check("r2", "order summary with Confirm, delivery fee and total in USD+LBP", !!confirm && /2\.00/.test(txt(out, B)) && /LBP/.test(txt(out, B)), txt(out, B).slice(0, 200));
    const msgs = mine(out, B);
    const noticeIdx = msgs.findIndex((m) => /delete my data|احذف بياناتي/i.test(textOf(m))), cardIdx = msgs.findIndex((m) => buttonsOf(m).some((b) => /^CONFIRM\|/.test(b.id)));
    check("r3", "one-line privacy notice shown before the summary card, nothing after the card", noticeIdx >= 0 && noticeIdx < cardIdx && cardIdx === msgs.length - 1, `notice@${noticeIdx} card@${cardIdx} of ${msgs.length}`);
    if (confirm) out = await tap(B, confirm.id, confirm.title, H);
    let snap = await inspect(B);
    check("r4", "Confirm created exactly one order with server prices (fee 2.00, total = subtotal + 2)", snap.orders.length === 1 && Number(snap.orders[0].delivery_fee_usd) === 2 && Math.abs(Number(snap.orders[0].total_usd) - Number(snap.orders[0].subtotal_usd) - 2) < 0.011, JSON.stringify(snap.orders.map((o: any) => [o.status, o.subtotal_usd, o.total_usd])));
    check("r5", "order-received message has a Cancel button", !!find(out, B, /^CANCEL\|/), btns(out, B).map((b) => b.id.slice(0, 12)).join(","));
    check("r6", "address remembered and consent timestamp recorded", snap.addresses.length >= 1 && !!snap.customer?.data_consent_at && snap.customer?.privacy_notice_version === 1, JSON.stringify({ addr: snap.addresses.length, consent: snap.customer?.data_consent_at }));
    const before = (await usageOf(B)).length;
    out = await say(B, "the usual", H);
    const uc = find(out, B, /^CONFIRM\|/);
    check("r7", "\"the usual\" re-creates the order summary without a model call", !!uc && (await usageOf(B)).length === before, `confirm=${!!uc} calls ${before}->${(await usageOf(B)).length}`);
    out = await loc(B, 33.6847, 35.5659, H);
    snap = await inspect(B);
    check("r8", "location pin saved as a second address with a maps link", snap.addresses.length >= 2 && snap.addresses.some((a: any) => /maps\.google\.com/.test(a.landmark ?? "")), JSON.stringify(snap.addresses.map((a: any) => [a.village, (a.landmark ?? "").slice(0, 40)])));
    out = await tap(B, `ADD|${TAHOUNEH}|${TAHOUNEH}-soft-drinks|1`, "Add", H);
    const bk = find(out, B, /^CHECKOUT\|/);
    if (bk) out = await tap(B, bk.id, bk.title, H);
    const picker = rowsOf(out, B).filter((r: any) => r.id.startsWith("ADDR|"));
    check("r9", "checkout with two saved addresses asks where to deliver (picker incl. New address)", picker.length >= 2 && picker.some((r: any) => /^ADDR\|new/.test(r.id)), `${picker.length} rows; ${txt(out, B).slice(0, 100)}`);
    const first = picker.find((r: any) => !/^ADDR\|new/.test(r.id));
    if (first) out = await tapList(B, first.id, first.title, H);
    check("r10", "choosing an address leads to the order summary", !!find(out, B, /^CONFIRM\|/) && /2\.00/.test(txt(out, B)), txt(out, B).slice(0, 160));
  }

  if (phase === "c1") {
    const B = phone("B", 2);
    const r = await call("?job=order-watchdog", {}, { "x-selftest-admin": ADMIN });
    const offerOut = (r.out ?? []).filter((m: any) => m.to === B && m.interactive);
    const sub = offerOut.flatMap(buttonsOf).find((b: any) => /^SUB\|/.test(b.id));
    const body = offerOut.map(textOf).join("\n");
    check("c1", "sweep sends the sold-out offer with a substitute and its new total in USD+LBP", !!sub && /LBP/.test(body), body.slice(0, 200));
    check("c2", "higher total uses the explicit 'Accept new total' button (SUB|…|up)", offerOut.flatMap(buttonsOf).some((b: any) => /\|up$/.test(b.id) && /Accept new total/.test(b.title)), offerOut.flatMap(buttonsOf).map((b: any) => `${b.id.slice(-8)}:${b.title}`).join(" | "));
    check("c3", "the offer also offers cancel", offerOut.flatMap(buttonsOf).some((b: any) => /\|cancel$/.test(b.id)), "no cancel");
    state.ids.offerUp = offerOut.flatMap(buttonsOf).find((b: any) => /\|up$/.test(b.id))?.id ?? "";
    console.log("   offer text:", body.replace(/\n/g, " / ").slice(0, 300));
  }

  if (phase === "c2") {
    const B = phone("B", 2);
    const out = await tap(B, state.ids.offerUp, "Accept new total");
    const snap = await inspect(B);
    const o2 = snap.orders.find((o: any) => o.id === state.ids.order2);
    const expected = Number(o2?.subtotal_usd) + 2;
    check("c4", "Accept new total swapped the line, subtotal/total recomputed server-side (new total = subtotal + 2.00, higher than before)", !!o2 && o2.items.some((i: any) => i.item_id === V2_SUB) && Math.abs(Number(o2.total_usd) - expected) < 0.011 && Number(o2.total_usd) > Number(state.ids.order2total), JSON.stringify({ items: o2?.items?.map((i: any) => [i.item_id.slice(-18), i.unit_price_usd]), total: o2?.total_usd, was: state.ids.order2total }));
    check("c5", "the kitchen note records the swap", /SWAP #/.test(o2?.notes ?? ""), o2?.notes);
    check("c6", "offer marked accepted; customer told the new total in USD+LBP", snap.offers.some((f: any) => f.status === "accepted") && /LBP/.test(txt(out, B)), JSON.stringify(snap.offers) + txt(out, B).slice(0, 120));
    check("c7", "the vendor was notified (owner message or admin fallback in the output)", out.some((m: any) => /swap/i.test(textOf(m)) && m.to !== B), `${out.length} messages: ${out.map((m: any) => m.to?.slice(-4)).join(",")}`);
  }

  if (phase === "d") {
    const B = phone("B2", 6);
    let out = await say(B, "forget my address");
    let snap = await inspect(B);
    check("d1", "\"forget my address\" deleted saved addresses and the current address/coordinates", snap.addresses.length === 0 && !snap.customer?.last_address && snap.customer?.last_lat == null, JSON.stringify({ addr: snap.addresses.length, last: snap.customer?.last_address, lat: snap.customer?.last_lat }));
    check("d2", "it confirmed what was deleted", /Deleted|deleted|Done/.test(txt(out, B)), txt(out, B).slice(0, 200));
    check("d3", "name was kept by the address-only command", !!snap.customer?.full_name, `${snap.customer?.full_name}`);
    out = await say(B, "delete my data");
    snap = await inspect(B);
    check("d4", "\"delete my data\" removed the name, language, consent timestamp and chat history; marketing off", !snap.customer?.full_name && snap.conversations === 0 && !snap.customer?.data_consent_at && snap.customer?.marketing_opt_in === false && !!snap.customer?.data_deleted_at, JSON.stringify({ name: snap.customer?.full_name, conv: snap.conversations, consent: snap.customer?.data_consent_at, mkt: snap.customer?.marketing_opt_in, del: snap.customer?.data_deleted_at }));
    check("d5", "baskets and pending summaries are gone", snap.baskets.length === 0 && snap.carts.length === 0, JSON.stringify({ baskets: snap.baskets.length, carts: snap.carts.length }));
    check("d6", "open orders keep their delivery details until they finish (not touched)", snap.orders.every((o: any) => ["delivered", "cancelled", "rejected"].includes(o.status) || o.customer_name !== "Deleted customer"), JSON.stringify(snap.orders.map((o: any) => [o.status, o.customer_name])));
    check("d7", "the confirmation lists what was kept and why", /accounting|open order/i.test(txt(out, B)), txt(out, B).slice(0, 240));
  }

  if (phase === "e") {
    const C = phone("C", 3), HA = { "x-selftest-admin": ADMIN };
    let out = await say(C, "bade e7ki ma3 shakhs", HA);
    const toAdmin = out.filter((m) => m.to === ADMIN && m._dry_message_id);
    check("e1", "'talk to a person' (Arabizi) forwards a context message to the admin", toAdmin.length === 1 && /Customer wants a person/.test(txt(toAdmin)), txt(out).slice(0, 160));
    check("e2", "the admin message shows a masked phone, not the full number", !!toAdmin[0] && !new RegExp(C).test(txt(toAdmin)) && /•••/.test(txt(toAdmin)), txt(toAdmin).slice(0, 200));
    check("e3", "the customer is told a person has the chat (Arabic for an Arabizi speaker)", /فريق ألو كينغ|Alo King team/.test(txt(out, C)), txt(out, C));
    const mid = toAdmin[0]?._dry_message_id as string;
    out = await send(ADMIN, { type: "text", text: { body: "Hi, this is the team. How can I help?" }, context: { id: mid } }, HA);
    check("e4", "the admin's reply (quoting the forwarded message) is relayed to that customer", out.some((m) => m.to === C && /team\W/i.test(textOf(m)) && /How can I help/.test(textOf(m))), txt(out).slice(0, 160));
    out = await send("96170000099", { type: "text", text: { body: "send me everything" }, context: { id: mid } }, HA);
    check("e5", "the same quote from another number is ignored (no output)", out.length === 0, txt(out).slice(0, 120));
    out = await say(C, "hello? are you there", HA);
    check("e6", "while a person has the chat the bot stays silent and forwards to the admin", out.filter((m) => m.to === C).length === 0 && out.some((m) => m.to === ADMIN && /hello\? are you there/.test(textOf(m))), txt(out).slice(0, 160));
    const snap = await inspect(C);
    check("e7", "handoff state recorded (handoff_until set, log rows)", !!snap.customer?.handoff_until && snap.handoff.length >= 2, JSON.stringify({ until: snap.customer?.handoff_until, log: snap.handoff.length }));
    out = await send(ADMIN, { type: "text", text: { body: "/bot" }, context: { id: mid } }, HA);
    const snap2 = await inspect(C);
    check("e8", "/bot hands the chat back", snap2.customer?.handoff_until == null && out.some((m) => m.to === C), JSON.stringify(snap2.customer?.handoff_until));
  }

  if (phase === "f") {
    const D = phone("D", 4), HF = { "x-selftest-budget": "0.0001", "x-selftest-admin": ADMIN };
    const before = (await usageOf(D)).length;
    const out = await say(D, "what do you recommend for dinner tonight?", HF);
    check("f1", "over budget: the customer gets the button-only message with buttons", out.some((m) => m.to === D && /quick mode|الوضع السريع/.test(textOf(m))) && btns(out, D).some((b) => b.id === "BASKET"), txt(out, D).slice(0, 160));
    check("f2", "no model call was made for that turn", (await usageOf(D)).length === before, `${before}->${(await usageOf(D)).length}`);
    check("f3", "the admin budget alert is produced (dry run, with budget and spend)", out.some((m) => m.to === ADMIN && /AI budget reached/.test(textOf(m))), txt(out).slice(0, 200));
  }

  if (phase === "g") {
    const E = phone("E", 5), HG = { "x-selftest-cheap": "true", "x-selftest-model": SONNET };
    await say(E, "what do you have for dinner?", HG);
    await say(E, "I want 2 soft drinks from Al Tahouneh", HG);
    const ue = await usageOf(E);
    check("g1", "an informational turn was answered by the cheap model (Haiku)", ue.some((r: any) => /haiku/.test(r.model)), ue.map((r: any) => r.model).join(","));
    check("g2", "an ordering turn used the main model (Sonnet)", ue.some((r: any) => /sonnet/.test(r.model)), ue.map((r: any) => r.model).join(","));
  }

  if (phase === "report") {
    const s = await spend();
    const byPhone: Record<string, { calls: number; usd: number }> = {};
    for (const r of s.rows) { const k = r.customer_phone; byPhone[k] ??= { calls: 0, usd: 0 }; byPhone[k].calls++; byPhone[k].usd += Number(r.est_usd); }
    const orderRows = s.rows.filter((r: any) => r.order_id);
    const byOrder: Record<string, number> = {}; for (const r of orderRows) byOrder[r.order_id] = (byOrder[r.order_id] ?? 0) + Number(r.est_usd);
    const rd = s.rows.reduce((n: number, r: any) => n + r.cache_read_tokens, 0), wr = s.rows.reduce((n: number, r: any) => n + r.cache_write_tokens, 0), inp = s.rows.reduce((n: number, r: any) => n + r.input_tokens, 0);
    console.log(JSON.stringify({ total_usd: s.spent, calls: s.calls, per_conversation: Object.fromEntries(Object.entries(byPhone).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(4)) }])), per_confirmed_order_usd: Object.fromEntries(Object.entries(byOrder).map(([k, v]) => [k, Number(v.toFixed(4))])), cache: { read: rd, write: wr, uncached_input: inp, read_share_of_prompt: Number((rd / Math.max(1, rd + wr + inp)).toFixed(3)) }, models: [...new Set(s.rows.map((r: any) => r.model))], checks: { pass: state.checks.filter((c) => c.pass).length, fail: state.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.name}`) } }, null, 1));
  }
  const s = await spend();
  console.log(`-- phase ${phase} done. estimated spend so far: $${s.spent.toFixed(4)} (${s.calls} model calls), cap $${CAP}`);
  save();
}
main().catch((e) => { save(); console.error(String(e?.message ?? e)); process.exit(2); });
