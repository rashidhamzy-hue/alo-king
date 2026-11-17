// Session WEB2 on the customer line: the website's sign-in code, "sign out" and the card of a web order, all read BY CODE before any model
// (the model is scripted so that any call to it fails this test), and the card sent by the gateway's cron, never by the website (invariant 1).
// The card is the same card a chat order gets; its Confirm button confirms (invariant 4); "Card AK-xxxx" only sends it again. Real migrations;
// invented numbers only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { send as gatewaySend } from "@ak/wa/gateway";
import { ar, en, fr } from "@ak/agents/messages";
import { sendWebCards } from "@ak/agents/web-orders";
import { formatOrderCard } from "@ak/agents/order-card";
import type { ConversationState } from "@ak/agents/concierge-tools";
import { webCommerce, webOrdering, type RpcSource } from "@ak/commerce/index";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";

let db: TestDb; let village: string;
let web: ReturnType<typeof webCommerce>; let ord: ReturnType<typeof webOrdering>;
const env = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };

function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 50;`);
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.pg.query(`update sources set village_id = $1 where kind = 'dark_store'`, [village]);
  web = webCommerce(asWebChannel(db)); ord = webOrdering(asWebChannel(db));
}, 120_000);

let toolSeq = 0; let n = 0;
function customer(lang?: "ar" | "en" | "fr") {
  const k = ++n;
  const seen: unknown[] = [];
  const model = { messages: { create: async (body: unknown) => {
    seen.push(structuredClone(body));
    return { id: "msg", type: "message", role: "assistant", model: "test", content: [], stop_reason: "end_turn", stop_sequence: null,
             usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message;
  } } };
  const who = { waUserId: `bsuid-web2t-${k}`, phone: `+9617630${String(k).padStart(4, "0")}` };
  const shim = supabaseOver(db);
  const deps: TurnDeps = { db: shim.client, model: model as any, modelName: "fast", send: (req) => gatewaySend(shim.client, env, req),
                           capacity: { backoffMs: [1, 1, 1], sleep: async () => undefined } };
  const state: ConversationState = lang ? { lang } : {};
  const event = (message: Record<string, unknown>): Pending[] => [{ line: "customer", who, event: { phone_number_id: "PN_CUSTOMER",
    conversation: { id: `c${k}`, contact_name: "Test" },
    message: { id: `wamid.web2.${k}.${Math.random()}`, timestamp: "0", kapso: { direction: "inbound", origin: "cloud_api" }, ...message } } as any }];
  const text = (body: string) => event({ type: "text", text: { body } });
  const tap = (id: string, title: string) => event({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
  const conv = async () => db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: who.waUserId, p_phone: who.phone, p_name: "Test" });
  return { seen, deps, state, who, text, tap, conv, shim, turn: (p: Pending[]) => runTurn(deps, p, state) };
}
/** A website visitor with a basket; the code to send from WhatsApp. */
async function visitor() {
  const s = await web.startSession("test phone");
  for (const [sku, qty] of [["AK-0103", 2], ["AK-0080", 1], ["AK-0133", 3]] as const) await web.setLine(s.token, sku, qty);
  const code = await web.linkCode(s.token);
  if (!code.ok) throw new Error("no code");
  return { token: s.token, code: code.code };
}

let outbound: { url: string; body: any }[];
beforeEach(() => {
  outbound = []; toolSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    outbound.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${Math.random()}` }] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const bodies = () => outbound.map((o) => o.body.text?.body ?? o.body.interactive?.body?.text ?? "");
void toolSeq;

describe("Confirm your number on WhatsApp: the code, read by code before any model", () => {
  it("links the website's session to this number, records consent, answers one fixed line, and calls no model", async () => {
    const v = await visitor();
    const t = customer("en");
    const r = await t.turn(t.text(v.code));
    expect(r.outcome).toBe("claim");
    expect(t.seen).toHaveLength(0);
    expect(bodies()).toEqual([en.web.linked]);
    const c = await t.conv();
    expect(await web.sessionState(v.token)).toMatchObject({ valid: true, linked: true });
    expect((await db.one(`select party_id from web_sessions where token_hash = web_token_hash($1)`, [v.token])).party_id).toBe(c.party_id);
    expect((await db.one(`select source, kind, action from consent_events where party_id = $1 and source = 'web_link_code'`, [c.party_id])))
      .toEqual({ source: "web_link_code", kind: "transactional", action: "opt_in" });
  });

  it("works with words around it, in the sender's language; a second number cannot use it; an old or unknown code is said so", async () => {
    const v = await visitor();
    const t = customer("fr");
    await t.turn(t.text(`Bonjour, voici mon code ${v.code}`));
    expect(bodies()).toEqual([fr.web.linked]);
    const other = customer("ar");
    outbound.length = 0;
    await other.turn(other.text(v.code));
    expect(bodies()).toEqual([ar.web.codeUsed]);
    const old = await visitor();
    await db.pg.query(`update link_codes set expires_at = now() - interval '1 minute' where code = $1`, [old.code]);
    outbound.length = 0;
    await other.turn(other.text(old.code));
    expect(bodies()).toEqual([ar.web.codeExpired]);
    outbound.length = 0;
    await other.turn(other.text("ALO-ZZZZZZ"));
    expect(bodies()).toEqual([ar.web.codeUnknown]);
    expect(other.seen).toHaveLength(0);
  });

  it("STOP still wins over a code", async () => {
    const v = await visitor();
    const t = customer("en");
    expect((await t.turn(t.text("STOP"))).outcome).toBe("opt_out");
    expect((await web.sessionState(v.token)).linked).toBe(false);
  });
});

describe("'sign out' on WhatsApp ends every website session of this number", () => {
  it("both devices are signed out, and the reply says how many; again, nothing is signed in", async () => {
    const t = customer("en");
    const a = await visitor(); const b = await visitor();
    await t.turn(t.text(a.code)); await t.turn(t.text(b.code));
    outbound.length = 0;
    const r = await t.turn(t.text("sign out"));
    expect(r.outcome).toBe("claim");
    expect(bodies()).toEqual([en.web.signedOut(2)]);
    expect((await web.sessionState(a.token)).valid).toBe(false);
    expect((await web.sessionState(b.token)).valid).toBe(false);
    outbound.length = 0;
    await t.turn(t.text("تسجيل الخروج"));
    expect(bodies()).toEqual([ar.web.notSignedIn]);          // answered in the language of the words
    expect(t.seen).toHaveLength(0);
  });

  it("a longer message that only mentions signing out is a message for the Concierge", async () => {
    const t = customer("en");
    await t.turn(t.text("how do I sign out of the site and order milk"));
    expect(t.seen.length).toBeGreaterThan(0);
  });
});

describe("the card of a web order: sent by the gateway, confirmed by its button", () => {
  async function placed(lang: "ar" | "en" | "fr" = "en") {
    const t = customer(lang);
    const v = await visitor();
    await t.turn(t.text(v.code));
    const c = await t.conv();
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const placeId = (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [c.party_id])).id;
    const r = await ord.placeOrder(v.token, { requestKey: `req-web2t-${n}`, place: placeId, payment: "cod", cash: "usd", note: 50, missing: "best_match", items: { "AK-0080": "remove" }, lang });
    expect(r.created).toBe(true);
    outbound.length = 0;
    return { t, v, c, r };
  }

  it("the cron sends the same card a chat order gets, once, through the gateway, in the page's language", async () => {
    const { t, c, r } = await placed("en");
    expect(await sendWebCards({ db: t.shim.client, send: t.deps.send })).toBe(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.url).toContain("PN_CUSTOMER");
    expect(outbound[0]!.body.to).toBe(t.who.phone);
    const card = outbound[0]!.body.interactive;
    expect(card.action.buttons.map((b: any) => b.reply.id)).toEqual([`order:confirm:${r.order_id}`, `order:edit:${r.order_id}`, `order:cancel:${r.order_id}`]);
    // the same text formatOrderCard makes from the stored card: lines, fee, total, the note, the missing-item choices
    const stored = await db.rpc("order_card", { p_order: r.order_id, p_party: c.party_id });
    const address = await db.rpc("order_address", { p_order: r.order_id });
    const expected = formatOrderCard({ orderId: r.order_id!, shortCode: r.short_code!, quote: stored.quote, paymentMethod: "cod", changeForUsd: 50,
      missingPref: "best_match", missingItems: stored.missing_items, lang: "en", address, prepay: null, window: null, replaces: null, reopenedFrom: null, keepChange: false })
      .map((o: any) => o.interactive?.body?.text ?? o.text?.body);
    expect(card.body.text).toBe(expected.at(-1));
    expect(card.body.text).toContain(en.cx.missingLine("best_match"));
    expect(card.body.text).toMatch(/: we take it off/);
    expect(card.body.text).toContain("$50.00");
    // a second minute sends nothing again
    expect(await sendWebCards({ db: t.shim.client, send: t.deps.send })).toBe(0);
    expect(outbound).toHaveLength(1);
    expect((await db.one(`select outcome from web_card_requests where order_id = $1`, [r.order_id])).outcome).toBe("sent");
    expect((await db.one(`select status from orders where id = $1`, [r.order_id])).status).toBe("awaiting_confirmation");
    // the customer's tap on the card confirms it, as for any chat order
    await t.turn(t.tap(`order:confirm:${r.order_id}`, "Confirm"));
    expect((await db.one(`select status from orders where id = $1`, [r.order_id])).status).toBe("confirmed");
    expect(t.seen).toHaveLength(0);
  });

  it("outside the 24-hour window the card is not sent, and that is recorded; 'Card AK-xxxx' from the customer brings it", async () => {
    const { t, c, r } = await placed("ar");
    await db.pg.query(`update conversations set last_inbound_at = now() - interval '25 hours' where party_id = $1`, [c.party_id]);
    expect(await sendWebCards({ db: t.shim.client, send: t.deps.send })).toBe(0);
    expect(outbound).toHaveLength(0);
    expect((await db.one(`select outcome from web_card_requests where order_id = $1`, [r.order_id])).outcome).toBe("refused:window_closed_use_template");
    const res = await t.turn(t.text(`Card ${r.short_code}`));
    expect(res.outcome).toBe("claim");
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive.action.buttons[0].reply.id).toBe(`order:confirm:${r.order_id}`);
    expect((await db.one(`select status from orders where id = $1`, [r.order_id])).status).toBe("awaiting_confirmation");   // never confirms
    expect(t.seen).toHaveLength(0);
  });

  it("'Card AK-xxxx' for an order already confirmed, or another person's, is said so and sends no card", async () => {
    const { t, r } = await placed("en");
    await t.turn(t.tap(`order:confirm:${r.order_id}`, "Confirm"));
    outbound.length = 0;
    await t.turn(t.text(`card ${r.short_code}`));
    expect(bodies()).toEqual([en.web.cardNotWaiting(r.short_code!)]);
    const stranger = customer("en");
    outbound.length = 0;
    await stranger.turn(stranger.text(`Card ${r.short_code}`));
    expect(bodies()).toEqual([en.web.cardUnknown]);
  });
});
