// Session C4 (commerce core), docs/SYSTEM_PLAN.md section 1, on the real migrations (0128-0132).
// Done when: one basket through the chat path, a catalog cart and the commerce client gives the same lines, totals and ledger;
// web_channel can call no staff or money function; a link code is single use, expires and cannot be claimed by a second phone;
// the agent still cannot confirm. Also: a confirm sent twice confirms once, and a session not linked by a claimed code (or with
// settings.web.confirm_on_page off) confirms only by the WhatsApp tap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { asSupabase, type TestDb } from "./harness";
import { collect, deliverToDoor, expectBooksBalanced, openHub, type Hub } from "./hub-kit";
import { channelCommerce, webCommerce, WEB_CHANNEL_FUNCTIONS, type RpcSource } from "@ak/commerce/index";

let h: Hub; let db: TestDb;
let svc: ReturnType<typeof channelCommerce>;   // the gateway's face, service role
let web: ReturnType<typeof webCommerce>;       // the website's face, run as the database role web_channel
const BASKET = [{ sku: "AK-0103", qty: 2 }, { sku: "AK-0080", qty: 1 }, { sku: "AK-0133", qty: 3 }];
const pid: Record<string, string> = {};
let phones = 0;

/** The website's connection: every call runs as web_channel, as the Worker will. */
function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}
/** A customer who has written to the customer line (the conversation exists), with a pinned place in the hub's village. */
async function customer() {
  const n = ++phones;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-c4-${n}`, p_phone: `+9617600${String(n).padStart(4, "0")}`, p_name: `C4 ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const place = (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [t.party_id])).id;
  return { party: t.party_id as string, conversation: t.conversation_id as string, place: place as string };
}
/** A web visitor with these lines in the cart, linked to a customer by a claimed code. */
async function linkedVisitor(lines = BASKET) {
  const c = await customer();
  const s = await web.startSession("test phone");
  for (const l of lines) await web.setLine(s.token, l.sku, l.qty);
  const code = await web.linkCode(s.token);
  if (!code.ok) throw new Error("no code");
  const claim = await svc.claimLinkCode(c.party, `${code.code}`, `wamid-code-${phones}`);
  expect(claim).toMatchObject({ ok: true, status: "linked" });
  return { ...c, token: s.token };
}
const items = async (orderId: string) => (await db.all(
  `select p.sku, i.qty::numeric as qty, i.unit_price_usd::numeric as unit from order_items i join products p on p.id = i.product_id
    where i.order_id = $1 and i.status = 'ok' order by p.sku`, [orderId])).map((r: any) => ({ sku: r.sku, qty: Number(r.qty), unit: Number(r.unit) }));
const money = async (orderId: string) => {
  const o = await db.one(`select subtotal_usd, delivery_fee_usd, small_order_fee_usd, total_usd, payment_method, status, channel from orders where id = $1`, [orderId]);
  return { subtotal: Number(o.subtotal_usd), fee: Number(o.delivery_fee_usd), small: Number(o.small_order_fee_usd), total: Number(o.total_usd), payment: o.payment_method };
};
/** The order's ledger, as (account code, currency, amount) rows; a party's id in an account code reads <rider>. */
const ledger = async (orderId: string) => (await db.all(
  `select regexp_replace(a.code, '[0-9a-f]{8}-[0-9a-f-]{27}', '<rider>') as code, e.currency::text as currency, sum(e.amount)::numeric as amount from ledger_entries e join ledger_accounts a on a.id = e.account_id
    where e.order_id = $1 group by 1, 2 having sum(e.amount) <> 0 order by 1, 2`, [orderId])).map((r: any) => [r.code, r.currency, Number(r.amount)]);
const statusOf = async (orderId: string) => (await db.one(`select status from orders where id = $1`, [orderId])).status as string;
const confirmEvents = async (orderId: string) => Number((await db.one(
  `select count(*) as n from order_events where order_id = $1 and to_status in ('confirmed', 'awaiting_payment') and from_status = 'awaiting_confirmation'`, [orderId])).n);
const setConfirmOnPage = (on: boolean) => db.pg.query(`update settings set value = value || jsonb_build_object('confirm_on_page', $1::boolean) where key = 'web'`, [on]);

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false }); db = h.db;   // no picker on the ops line: offered at confirmation
  svc = channelCommerce(asSupabase(db));
  web = webCommerce(asWebChannel(db));
  for (const l of BASKET) pid[l.sku] = (await db.one(`select id from products where sku = $1`, [l.sku])).id;
}, 120_000);
afterAll(async () => { await db?.pg.close(); });

describe("settings and schema (0128)", () => {
  it("C1 is approved: confirm on the page is on; every order made before C4 is a WhatsApp order", async () => {
    expect((await db.one(`select value from settings where key = 'web'`)).value).toMatchObject({ confirm_on_page: true, link_code_minutes: 10, session_days: 90 });
    expect((await db.one(`select column_default from information_schema.columns where table_name = 'orders' and column_name = 'channel'`)).column_default).toContain("whatsapp");
    await expect(db.one(`update orders set channel = 'fax' where false returning id`)).resolves.toBeUndefined();
    await expect(db.pg.query(`insert into orders(short_code, customer_id, channel) select 'AK-X', id, 'fax' from parties limit 1`)).rejects.toThrow(/orders_channel/);
  });
});

describe("one basket, three channels: the same lines, totals and ledger", () => {
  const ids: Record<"chat" | "catalog" | "web", string> = {} as any;
  const quotes: Record<string, any> = {};

  it("the chat path (the card the Concierge's tool makes), the WhatsApp catalog cart and the website give the same card", async () => {
    // Chat: the reading resolved to products; issueCard calls create_order_for_turn with the turn key (SP1).
    const a = await customer();
    const chat = await svc.createOrderForTurn({ turnKey: "turn-c4-chat", customer: a.party, conversation: a.conversation,
      lines: BASKET.map((l) => ({ product_id: pid[l.sku]!, qty: l.qty })), village: h.village, place: a.place });
    expect(chat.created).toBe(true);
    expect((await svc.confirmTap(chat.order_id!, a.party, "wamid-c4-chat")).status).toBe("confirmed");
    ids.chat = chat.order_id!; quotes.chat = chat.quote;

    // Catalog: the cart as WhatsApp sends it, through plan_cart, then the same card function (turn.ts, K1).
    const b = await customer();
    const plan = await svc.planCart(b.party, BASKET.map((l) => ({ sku: l.sku, qty: l.qty, price: 0, currency: "USD" })));
    expect(plan.removed).toEqual([]);
    const cat = await svc.createOrderForTurn({ turnKey: "turn-c4-cat", customer: b.party, conversation: b.conversation,
      lines: plan.quote_lines, village: plan.village_id, place: plan.place_id, payment: plan.payment_method });
    expect((await svc.confirmTap(cat.order_id!, b.party, "wamid-c4-cat")).status).toBe("confirmed");
    ids.catalog = cat.order_id!; quotes.catalog = plan.quote;

    // Web: the commerce client as web_channel. Cart, code on WhatsApp, quote, card, confirm on the page.
    const c = await linkedVisitor();
    const q = await web.checkoutQuote(c.token, { place: c.place });
    expect(q.ready).toBe(true);
    const card = await web.checkoutOrder(c.token, { requestKey: "req-c4-web-card-1", place: c.place });
    expect(card).toMatchObject({ created: true });
    expect(await statusOf(card.order_id!)).toBe("awaiting_confirmation");        // making the card never confirms
    const conf = await web.confirm(c.token, card.order_id!, "req-c4-web-confirm-1");
    expect(conf).toMatchObject({ status: "confirmed", changed: true });
    ids.web = card.order_id!; quotes.web = q.quote;

    const strip = (x: any) => ({ lines: x.lines.map((l: any) => [l.sku, l.qty, l.unit_price_usd, l.line_total_usd]).sort(),
      subtotal: x.subtotal_usd, fee: x.delivery_fee_usd, small: x.small_order_fee_usd, total: x.total_usd, issues: x.issues });
    expect(strip(quotes.catalog)).toEqual(strip(quotes.chat));
    expect(strip(quotes.web)).toEqual(strip(quotes.chat));
    expect(await items(ids.catalog)).toEqual(await items(ids.chat));
    expect(await items(ids.web)).toEqual(await items(ids.chat));
    expect(await money(ids.catalog)).toEqual(await money(ids.chat));
    expect(await money(ids.web)).toEqual(await money(ids.chat));
    expect((await items(ids.chat)).length).toBe(3);
    const ch = await db.all(`select id, channel, request_key from orders where id = any($1::uuid[])`, [[ids.chat, ids.catalog, ids.web]]);
    expect(Object.fromEntries(ch.map((r: any) => [r.id, [r.channel, r.request_key]]))).toEqual({
      [ids.chat]: ["whatsapp", null], [ids.catalog]: ["whatsapp", null], [ids.web]: ["web", "req-c4-web-confirm-1"] });
  });

  it("delivered and paid in cash, the three orders post the same ledger, and the books balance", async () => {
    for (const k of ["chat", "catalog", "web"] as const) {     // one rider, one order at a time
      await deliverToDoor(h, ids[k]);
      await collect(h, ids[k]);
      expect(await statusOf(ids[k])).toBe("closed");
    }
    const chat = await ledger(ids.chat);
    expect(chat.length).toBeGreaterThan(2);
    expect(await ledger(ids.catalog)).toEqual(chat);
    expect(await ledger(ids.web)).toEqual(chat);
    await expectBooksBalanced(h);
  });
});

describe("link codes: single use, they expire, and a second phone cannot claim one", () => {
  it("is single use: the same phone again is the same answer (a retried turn); another phone is refused", async () => {
    const a = await customer(); const b = await customer();
    const s = await web.startSession(null);
    const code = await web.linkCode(s.token);
    expect(code.ok && /^ALO-[23456789A-HJ-NP-Z]{6}$/.test(code.code)).toBe(true);
    if (!code.ok) return;
    expect(await svc.claimLinkCode(a.party, `ana ${code.code.toLowerCase()} min el site`, "wamid-a")).toMatchObject({ ok: true, status: "linked", again: false });
    expect(await svc.claimLinkCode(a.party, code.code, "wamid-a")).toMatchObject({ ok: true, status: "linked", again: true });
    expect(await svc.claimLinkCode(b.party, code.code, "wamid-b")).toMatchObject({ ok: false, status: "used" });
    const row = await db.one(`select s.party_id, c.used_by, c.used_wamid from web_sessions s join link_codes c on c.id = s.link_code_id where c.code = $1`, [code.code]);
    expect(row).toEqual({ party_id: a.party, used_by: a.party, used_wamid: "wamid-a" });
    // The message is the consent (invariant 17: the customer messaged us first).
    expect(await db.one(`select action, source, evidence_message_id from consent_events where party_id = $1 and source = 'web_link_code'`, [a.party]))
      .toEqual({ action: "opt_in", source: "web_link_code", evidence_message_id: "wamid-a" });
    expect((await web.sessionState(s.token))).toMatchObject({ valid: true, linked: true });
    // A linked session stays that person's: no new code for it.
    expect(await web.linkCode(s.token)).toEqual({ ok: false, error: "already_linked" });
  });

  it("expires after its minutes, and a newer code replaces an older one", async () => {
    const a = await customer();
    const s = await web.startSession(null);
    const first = await web.linkCode(s.token); const second = await web.linkCode(s.token);
    if (!first.ok || !second.ok) throw new Error("no code");
    expect(second.code).not.toBe(first.code);
    expect(await svc.claimLinkCode(a.party, first.code)).toMatchObject({ ok: false, status: "expired" });
    const mins = (Date.parse(second.expires_at) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(9); expect(mins).toBeLessThanOrEqual(10);
    await db.pg.query(`update link_codes set expires_at = now() - interval '1 second' where code = $1`, [second.code]);
    expect(await svc.claimLinkCode(a.party, second.code)).toMatchObject({ ok: false, status: "expired" });
    expect((await web.sessionState(s.token)).linked).toBe(false);
  });

  it("not a code, an unknown code, a staff party, a signed-out session", async () => {
    const a = await customer();
    expect(await svc.claimLinkCode(a.party, "مرحبا")).toMatchObject({ ok: false, status: "not_a_code" });
    expect(await svc.claimLinkCode(a.party, "ALO-2222ZZ")).toMatchObject({ ok: false, status: "unknown" });
    const s = await web.startSession(null);
    const code = await web.linkCode(s.token); if (!code.ok) throw new Error("no code");
    expect(await svc.claimLinkCode(h.ops, code.code)).toMatchObject({ ok: false, status: "not_customer" });
    await web.endSession(s.token);
    expect(await svc.claimLinkCode(a.party, code.code)).toMatchObject({ ok: false, status: "expired" });
    await expect(web.viewCart(s.token)).rejects.toThrow(/NO_SESSION/);
    expect(await web.sessionState(s.token)).toEqual({ valid: false, linked: false });
  });

  it("the token is never stored, only its hash; sign out everywhere ends every session of the party", async () => {
    const v = await linkedVisitor();
    expect(Number((await db.one(`select count(*) as n from web_sessions where token_hash = $1`, [v.token])).n)).toBe(0);
    expect(Number((await db.one(`select count(*) as n from web_sessions where token_hash = web_token_hash($1)`, [v.token])).n)).toBe(1);
    expect(await svc.revokeWebSessions(v.party)).toBe(1);
    await expect(web.viewCart(v.token)).rejects.toThrow(/NO_SESSION/);
  });
});

describe("confirm on the page (C1): only a session linked by a claimed code, only while the setting is on", () => {
  it("a confirm sent twice confirms once; the key cannot confirm a second order", async () => {
    const v = await linkedVisitor();
    const card = await web.checkoutOrder(v.token, { requestKey: "req-twice-card", place: v.place });
    const one = await web.confirm(v.token, card.order_id!, "req-twice-key-1");
    const two = await web.confirm(v.token, card.order_id!, "req-twice-key-1");
    expect(one).toMatchObject({ status: "confirmed", changed: true });
    expect(two).toMatchObject({ status: "confirmed", changed: false });
    expect(await confirmEvents(card.order_id!)).toBe(1);
    // the confirm action's evidence, where a tap has its message id
    expect((await db.one(`select meta from order_events where order_id = $1 and to_status = 'confirmed'`, [card.order_id])).meta).toEqual({ wamid: "web:req-twice-key-1" });
    // the next line starts a new cart; the same card submit again is that order, never a second one
    let next = await web.setLine(v.token, "AK-0103", 1);
    for (const l of BASKET) next = await web.setLine(v.token, l.sku, l.qty);
    const again = await web.checkoutOrder(v.token, { requestKey: "req-twice-card", place: v.place });
    expect(again).toMatchObject({ created: true, reused: true, order_id: card.order_id, status: "confirmed" });
    const card2 = await web.checkoutOrder(v.token, { requestKey: "req-twice-card-2", place: v.place });
    expect(card2.order_id).not.toBe(card.order_id);
    expect(next.cart_id).not.toBeNull();
    await expect(web.confirm(v.token, card2.order_id!, "req-twice-key-1")).rejects.toThrow(/REQUEST_KEY_REUSED/);
    expect(await statusOf(card2.order_id!)).toBe("awaiting_confirmation");
  });

  it("a retried card submit makes one card", async () => {
    const v = await linkedVisitor();
    const a = await web.checkoutOrder(v.token, { requestKey: "req-retry-card", place: v.place });
    const b = await web.checkoutOrder(v.token, { requestKey: "req-retry-card", place: v.place });
    expect(b).toMatchObject({ created: true, reused: true, order_id: a.order_id });
    expect(Number((await db.one(`select count(*) as n from orders where customer_id = $1`, [v.party])).n)).toBe(1);
  });

  it("with the setting off, the page cannot confirm: the answer is 'confirm on WhatsApp' and the tap there confirms", async () => {
    const v = await linkedVisitor();
    const card = await web.checkoutOrder(v.token, { requestKey: "req-off-card", place: v.place });
    await setConfirmOnPage(false);
    try {
      expect(await web.confirm(v.token, card.order_id!, "req-off-key")).toMatchObject({ status: "confirm_on_whatsapp", changed: false, order_status: "awaiting_confirmation" });
      expect(await statusOf(card.order_id!)).toBe("awaiting_confirmation");
      expect(await svc.confirmTap(card.order_id!, v.party, "wamid-off-tap")).toMatchObject({ status: "confirmed", changed: true });
    } finally { await setConfirmOnPage(true); }
    expect((await db.one(`select request_key from orders where id = $1`, [card.order_id])).request_key).toBeNull();
  });

  it("a session not linked by a claimed code confirms only by the WhatsApp tap", async () => {
    const v = await linkedVisitor();
    const card = await web.checkoutOrder(v.token, { requestKey: "req-nolink-card", place: v.place });
    // A session carrying the party some other way (no claimed code behind it): never enough to confirm.
    const token = "f".repeat(64);
    const sid = (await db.one(`insert into web_sessions(token_hash, party_id, expires_at) values (web_token_hash($1), $2, now() + interval '1 day') returning id`, [token, v.party])).id;
    expect(await web.confirm(token, card.order_id!, "req-nolink-key")).toMatchObject({ status: "confirm_on_whatsapp", changed: false });
    expect(await db.rpc("confirm_order_checked", { p_order: card.order_id, p_party: v.party, p_wamid: null, p_request_key: "req-nolink-key", p_session: sid }))
      .toMatchObject({ status: "confirm_on_whatsapp" });
    // A request key with no session at all, as the service role could send: the same.
    expect(await db.rpc("confirm_order_checked", { p_order: card.order_id, p_party: v.party, p_wamid: null, p_request_key: "req-nolink-key" }))
      .toMatchObject({ status: "confirm_on_whatsapp" });
    expect(await statusOf(card.order_id!)).toBe("awaiting_confirmation");
    // An anonymous session: not linked.
    const anon = await web.startSession(null);
    expect(await web.confirm(anon.token, card.order_id!, "req-nolink-key")).toMatchObject({ status: "confirm_on_whatsapp", reason: "not_linked" });
    expect(await web.checkoutOrder(anon.token, { requestKey: "req-anon-card", place: v.place })).toMatchObject({ created: false, error: "not_linked" });
    // Another customer's linked session: not their order.
    const other = await linkedVisitor();
    await expect(web.confirm(other.token, card.order_id!, "req-other-key")).rejects.toThrow(/NOT_YOUR_ORDER/);
    // The tap still confirms.
    expect(await svc.confirmTap(card.order_id!, v.party, "wamid-nolink-tap")).toMatchObject({ status: "confirmed" });
  });

  it("a confirm needs exactly one action: a message id or a request key", async () => {
    const v = await linkedVisitor();
    const card = await web.checkoutOrder(v.token, { requestKey: "req-one-card", place: v.place });
    await expect(db.rpc("confirm_order_checked", { p_order: card.order_id, p_party: v.party })).rejects.toThrow(/CONFIRM_NEEDS_AN_ACTION/);
    await expect(db.rpc("confirm_order_checked", { p_order: card.order_id, p_party: v.party, p_wamid: "w", p_request_key: "req-one-key-1" })).rejects.toThrow(/ONE_CONFIRM_ACTION/);
    await expect(web.confirm(v.token, card.order_id!, "short")).rejects.toThrow(/CONFIRM_NEEDS_AN_ACTION/);
    expect(await statusOf(card.order_id!)).toBe("awaiting_confirmation");
  });
});

describe("the agent still cannot confirm (invariant 4)", () => {
  it("transition_order refuses actor 'agent' past awaiting_confirmation, and the seed rows give the agent only the card", async () => {
    const v = await linkedVisitor();
    const card = await web.checkoutOrder(v.token, { requestKey: "req-agent-card", place: v.place });
    for (const to of ["confirmed", "awaiting_payment"]) {
      await expect(db.rpc("transition_order", { p_order: card.order_id, p_to: to, p_actor: "agent" })).rejects.toThrow(/ILLEGAL_TRANSITION/);
    }
    const agentRows = await db.all(`select from_status::text || '->' || to_status::text as t from order_transitions where 'agent' = any(actors)`);
    // The agent may put a card up and take it back; nothing else (packages/core/src/order-machine.ts keeps the same rows).
    expect(agentRows.map((r: any) => r.t).sort()).toEqual(["awaiting_confirmation->draft", "draft->awaiting_confirmation"]);
    expect(await statusOf(card.order_id!)).toBe("awaiting_confirmation");
  });

  it("no agent code can reach a confirm: packages/agents names no confirm function and does not use the commerce client", () => {
    const dir = new URL("../../packages/agents/src/", import.meta.url);
    const src = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n")
      .replace(/\/\/.*$/gm, "");   // comments may mention them
    for (const fn of ["confirm_order_checked", "web_confirm_order", "claim_link_code", "@ak/commerce"]) expect(src).not.toContain(fn);
    expect(src).not.toMatch(/handle_order_button[^\n]*confirm/);
  });
});

describe("web_channel: the website's functions and nothing else (G1-12)", () => {
  it("may execute exactly the client's list", async () => {
    const rows = await db.all(`select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
                                  and has_function_privilege('web_channel', p.oid, 'execute') order by 1`);
    expect(rows.map((r: any) => r.proname)).toEqual([...WEB_CHANNEL_FUNCTIONS].sort());
  });

  it("is refused every staff, money and party-id function, and every table", async () => {
    const probes = [
      `select confirm_order_checked(null::uuid, null::uuid, 'x'::text)`, `select claim_link_code(null::uuid, 'ALO-222222')`,
      `select handle_order_button(null::uuid, 'confirm', null::uuid)`, `select transition_order(null::uuid, 'confirmed'::order_status, 'customer'::actor_kind)`,
      `select plan_cart(null::uuid, '[]'::jsonb)`, `select quote_order('[]'::jsonb)`, `select create_order_from_quote(null::uuid, null::uuid, '[]'::jsonb, null::uuid, null::uuid, false)`,
      `select confirm_payment(null::uuid, null::uuid, null::text, null::numeric)`, `select rider_collect(null::uuid, null::uuid, 0, 0)`,
      `select approve_merchant(null::uuid, null::uuid)`, `select web_sessions_revoke(null::uuid)`, `select web_session_of('x')`,
      `select * from orders limit 1`, `select * from payments limit 1`, `select * from ledger_entries limit 1`, `select * from stock_levels limit 1`,
      `select * from web_sessions limit 1`, `select * from link_codes limit 1`, `select * from cart_lines limit 1`, `select * from parties limit 1`,
      `insert into carts(session_id) values (gen_random_uuid())`,
    ];
    for (const sql of probes) {
      await db.pg.exec("set role web_channel");
      try { await expect(db.pg.query(sql), sql).rejects.toThrow(/permission denied|does not exist/); }
      finally { await db.pg.exec("reset role"); }
    }
    // and none of them was refused for a typo: as the owner each one resolves
    for (const fn of ["confirm_payment", "rider_collect", "approve_merchant", "create_order_from_quote"]) {
      expect(Number((await db.one(`select count(*) as n from pg_proc where proname = $1`, [fn])).n), fn).toBeGreaterThan(0);
    }
  });
});

describe("the cart reads like a catalog cart (plan_cart): nothing new prices anything", () => {
  it("names a sold-out line and a price that moved, removes a line at 0, refuses an unknown sku", async () => {
    const s = await web.startSession(null);
    const water = await db.one(`select o.price_usd from offers o join sources s on s.id = o.source_id where o.product_id = $1 and s.kind = 'dark_store'`, [pid["AK-0103"]]);
    const seen = Math.round((Number(water.price_usd) - 0.25) * 100) / 100;
    await web.setLine(s.token, "AK-0103", 2, seen);
    await web.setLine(s.token, "AK-0080", 1);
    expect(await web.setLine(s.token, "AK-9999", 1)).toMatchObject({ ok: false, error: "unknown_product" });
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [pid["AK-0080"]]);
    try {
      const v = await web.viewCart(s.token);
      expect(v.removed).toEqual([expect.objectContaining({ sku: "AK-0080", reason: "out_of_stock" })]);
      expect(v.price_changed).toEqual([expect.objectContaining({ sku: "AK-0103", price_usd: Number(water.price_usd) })]);
      expect(v.quote!.lines.map((l) => l.sku)).toEqual(["AK-0103"]);
      expect(v.linked).toBe(false);
      // the same items sent as a WhatsApp catalog cart read the same way
      const plan = await svc.planCart(null, [{ sku: "AK-0103", qty: 2, price: seen, currency: "USD" }, { sku: "AK-0080", qty: 1, price: null, currency: "USD" }]);
      expect({ removed: v.removed, changed: v.price_changed, quote: v.quote }).toEqual({ removed: plan.removed, changed: plan.price_changed, quote: plan.quote });
    } finally { await db.pg.query(`update stock_levels set on_hand = 50 where product_id = $1`, [pid["AK-0080"]]); }
    const after = await web.setLine(s.token, "AK-0080", 0);
    expect(after.lines!.map((l) => l.sku)).toEqual(["AK-0103"]);
  });

  it("an anonymous visitor's quote: a village gives its fee; another person's place is refused; a window goes to quote_order", async () => {
    const s = await web.startSession(null);
    await web.setLine(s.token, "AK-0133", 3);
    const q = await web.checkoutQuote(s.token, { village: h.village });
    const direct = await svc.quoteOrder([{ product_id: pid["AK-0133"]!, qty: 3 }], h.village);
    expect(q.quote).toEqual(direct);
    expect(direct.ok).toBe(true);
    expect(q.ready).toBe(true);
    expect(q.quote!.delivery_fee_usd).toBeGreaterThan(0);
    const someone = await customer();
    expect(await web.checkoutQuote(s.token, { place: someone.place })).toEqual({ ok: false, error: "not_your_place" });
    const unknownSlot = "00000000-0000-0000-0000-000000000001";
    const w = await web.checkoutQuote(s.token, { village: h.village, slot: unknownSlot });
    expect(w.quote).toEqual(await svc.quoteOrder([{ product_id: pid["AK-0133"]!, qty: 3 }], h.village, false, unknownSlot));
    expect(w.issues!.map((i) => i.code)).toContain("slot_unknown");
    expect(w.ready).toBe(false);
    const empty = await web.startSession(null);
    expect(await web.checkoutQuote(empty.token, {})).toMatchObject({ ok: false, error: "empty_cart" });
  });
});
