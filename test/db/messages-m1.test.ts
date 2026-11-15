// Session M1 (message design): the card and the fixed answers in the conversation's language, the address on the card, the gaps in
// Arabic names recorded, "how much in lira?" answered from current_fx(), and the code-started messages that fall back to their
// utility template once the 24-hour window has closed (G1-23).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import { ar, en, fr } from "@ak/agents/messages";
import { sendCodeStarted } from "@ak/agents/messages/notify";
import { supabaseOver } from "./supabase-shim";
import { send as gatewaySend } from "@ak/wa/gateway";

let db: TestDb, ids: Ids;
let outbound: Sent[];
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 60_000);
beforeEach(() => { outbound = recordKapso(); });
afterAll(async () => { await db?.pg.close(); });

const ORDER = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }, { raw: "ربطتين خبز", query: "خبز", qty: 2, unit: "bundle", confidence: 0.9 }],
  address: { village: "بعقلين" } };
const bodyOf = (s: Sent) => (s.body.text?.body ?? s.body.interactive?.body?.text ?? "") as string;

describe("the conversation's language (M1)", () => {
  it("an English order gets the English card: every line, the fee, the total, the address and the payment; Arabic gaps are not logged for it", async () => {
    const t = flow(db, [read({ ...ORDER, language: "en" })]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.text("I want two labneh and two bread to Baakline");
    expect(outbound).toHaveLength(1);
    const card = bodyOf(outbound[0]!);
    expect(card).toMatch(/^🛒 \*Your order AK-\d+\*/);
    expect(card).toContain("Delivery (Baakline): $1.00");
    expect(card).toMatch(/\*Total: \$\d+\.\d\d\*/);
    expect(card).toMatch(/^📍 Baakline/mu);
    expect(card).toContain(en.card.payment("cod"));
    expect(card).toContain(en.card.consent);
    expect(outbound[0]!.body.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual([en.card.confirm, en.card.edit, en.card.cancel]);
    const o = await db.one(`select id from orders where customer_id = $1`, [c.party_id]);
    expect(await db.one(`select count(*)::int as n from name_gaps where lang = 'ar'`)).toEqual({ n: 0 });
    expect(await db.rpc("order_address", { p_order: o.id })).toMatchObject({ village_en: "Baakline", village_ar: "بعقلين" });
  });

  it("an Arabic card shows the approved Arabic name, the English one where none is approved, and records each gap once per product", async () => {
    const t = flow(db, [read(ORDER), read(ORDER), read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    // One product of the card gets an approved Arabic name; the other keeps none.
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين");
    const items = await db.all(`select p.id, p.name_en from order_items i join products p on p.id = i.product_id join orders o on o.id = i.order_id
                                 where o.customer_id = (select party_id from party_identities where wa_user_id = $1) order by p.name_en`, [t.who.waUserId]);
    expect(items).toHaveLength(2);
    await db.pg.query(`update products set name_ar = null where id = any($1)`, [items.map((x: any) => x.id)]);
    await db.pg.query(`update products set name_ar = 'خبز اختبار' where id = $1`, [items[1]!.id]);
    await db.pg.query(`delete from name_gaps`);
    outbound.length = 0;
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين");
    const card = bodyOf(outbound[0]!);
    expect(card).toMatch(/^🛒 \*طلبك AK-\d+\*/);
    expect(card).toContain("خبز اختبار");
    expect(card).toContain(items[0]!.name_en);
    const gaps = [items[0]!.id];
    const rows = await db.all(`select product_id, seen from name_gaps where lang = 'ar' order by product_id`);
    expect(rows.map((r: any) => r.product_id).sort()).toEqual([...gaps].sort());
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين");
    for (const r of await db.all(`select seen from name_gaps where lang = 'ar'`)) expect(r.seen).toBe(2);
  });

  it("a quick question in French is answered in French with no model call; Arabizi keeps the language the reading set", async () => {
    const t = flow(db, []);
    await t.customer();
    await t.text("Où est ma commande ?");
    expect(t.seen).toHaveLength(0);
    expect(bodyOf(outbound[0]!)).toBe(fr.answer.noOpenOrder);
    await t.text("wen el talab");
    expect(bodyOf(outbound[1]!)).toBe(fr.answer.noOpenOrder);       // Arabizi says nothing about the reply language here
    await t.text("وين طلبي");
    expect(bodyOf(outbound[2]!)).toBe(ar.answer.noOpenOrder);
  });
});

describe("how much in lira? (founder decision 2)", () => {
  it("today's rate from current_fx(), and the open order in lira at its own rate, with no model call", async () => {
    const t = flow(db, [read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    const rate = Number(await db.rpc("current_fx", {}));
    await t.text("قديش بالليرة؟");
    expect(t.seen).toHaveLength(0);
    expect(bodyOf(outbound[0]!)).toBe(ar.answer.lira(rate, null));
    await t.text("بدي علبتين لبنة ليبان ليه وربطتين خبز عبعقلين");
    const o = await db.one(`select short_code, total_usd from orders where customer_id = $1`, [c.party_id]);
    await t.text("how much in lira?");
    expect(t.seen).toHaveLength(1);                                   // the order's reading only
    expect(bodyOf(outbound.at(-1)!)).toBe(en.answer.lira(rate, { code: o.short_code, usd: Number(o.total_usd), lbp: Math.round(Number(o.total_usd) * rate / 1000) * 1000 }));
  });
});

describe("code-started messages after 24 hours (G1-23)", () => {
  async function customer(lang: "en" | null, windowOpen: boolean) {
    const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
    const n = Math.floor(Math.random() * 1e6);
    await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1,'customer',$2,$3)`, [party, `M1.${n}`, `+96171${String(n).padStart(6, "0")}`]);
    const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, $2) returning id`,
      [party, windowOpen ? new Date().toISOString() : new Date(Date.now() - 30 * 3600_000).toISOString()])).id;
    await db.pg.query(`insert into consent_events(party_id, line, kind, action, source) values ($1, 'customer', 'transactional', 'opt_in', 'first_order_button')`, [party]);
    if (lang) await db.pg.query(`insert into agent_runs(agent, conversation_id, model, outcome, trace) values ('concierge', $1, 'm', 'ok', jsonb_build_object('intent', jsonb_build_object('language', $2::text)))`, [conv, lang]);
    return party as string;
  }
  const ENV = { KAPSO_BASE_URL: "https://kapso.test/v24.0", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "PN_CUSTOMER", PHONE_NUMBER_ID_OPS: "PN_OPS" };
  const deps = () => { const c = supabaseOver(db).client; return { db: c, send: (r: any) => gatewaySend(c, ENV, r) }; };
  const delayed = (code: string) => (m: typeof en) => ({ msg: { type: "text" as const, text: { body: m.notice.delayed(code) } }, params: [code] });

  it("customer_reach names the event's template in the customer's language", async () => {
    const p = await customer("en", true);
    expect(await db.rpc("customer_reach", { p_party: p, p_event: "order_delayed" })).toMatchObject({ lang: "en", template: "ak_order_delayed_en_v1", template_approved: false });
    const q = await customer(null, true);
    expect(await db.rpc("customer_reach", { p_party: q, p_event: "substitute_question" })).toMatchObject({ lang: "ar", template: "ak_substitute_question_v2", template_approved: false });   // v1 was re-filed as marketing: never chosen
  });

  it("inside the window: the free message in the customer's language", async () => {
    const p = await customer("en", true);
    const r = await sendCodeStarted(deps(), p, "order_delayed", delayed("AK-9001"), "m1:delay:1");
    expect(r.ok).toBe(true);
    expect(outbound.at(-1)!.body).toMatchObject({ type: "text", text: { body: en.notice.delayed("AK-9001") } });
  });

  it("outside the window and not approved yet: nothing is sent, the refusal comes back; approved: the template, under its own key", async () => {
    const p = await customer("en", false);
    const before = outbound.length;
    const r = await sendCodeStarted(deps(), p, "order_delayed", delayed("AK-9002"), "m1:delay:2");
    expect(r).toEqual({ ok: false, refused: "template_not_utility" });
    expect(outbound.length).toBe(before);
    expect(await db.rpc("set_template_status", { p_name: "ak_order_delayed_en_v1", p_status: "APPROVED" })).toBe(true);
    const ok = await sendCodeStarted(deps(), p, "order_delayed", delayed("AK-9002"), "m1:delay:2");
    expect(ok.ok).toBe(true);
    expect(outbound.at(-1)!.body).toMatchObject({ type: "template", template: { name: "ak_order_delayed_en_v1", language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "AK-9002" }] }] } });
    expect(await db.one(`select category from wa_messages where template_name = 'ak_order_delayed_en_v1' order by created_at desc limit 1`)).toEqual({ category: "utility" });
    const again = await sendCodeStarted(deps(), p, "order_delayed", delayed("AK-9002"), "m1:delay:2");
    expect(again).toEqual({ ok: true, wamid: "already_sent" });       // the same event never goes twice
  });

  // Coordinator (14 Nov): Meta re-filed ak_substitute_question_v1, ak_shelf_changes_v1 and ak_kept_order_open_fr_v1 as marketing.
  it("the hourly sync stores Meta's category: a template re-filed as marketing stops being one that may be sent", async () => {
    expect(await db.one(`select category::text from wa_templates where name = 'ak_substitute_question_v1'`)).toEqual({ category: "marketing" });
    expect(await db.rpc("set_template_meta", { p_name: "ak_on_the_way_fr_v1", p_status: "APPROVED", p_category: "UTILITY" })).toBe(true);
    expect(await db.rpc("template_sendable", { p_name: "ak_on_the_way_fr_v1" })).toBe(true);
    expect(await db.rpc("set_template_meta", { p_name: "ak_on_the_way_fr_v1", p_status: "APPROVED", p_category: "MARKETING" })).toBe(true);
    expect(await db.rpc("template_sendable", { p_name: "ak_on_the_way_fr_v1" })).toBe(false);
    expect(await db.one(`select status, category::text from wa_templates where name = 'ak_on_the_way_fr_v1'`)).toEqual({ status: "approved", category: "marketing" });
  });

  it("the gateway refuses a template whose stored category is not utility, whatever category the caller passed", async () => {
    await db.rpc("set_template_meta", { p_name: "ak_substitute_question_v1", p_status: "APPROVED", p_category: "MARKETING" });
    const p = await customer(null, false);
    const to = (await db.one(`select phone_e164 from party_identities where party_id = $1`, [p])).phone_e164;
    const before = outbound.length;
    const r = await deps().send({ line: "customer", partyId: p, to, category: "utility", dedupeKey: "m1:gate:marketing",
      msg: { type: "template", template: { name: "ak_substitute_question_v1", language: { code: "ar" }, components: [] } } });
    expect(r).toEqual({ ok: false, refused: "template_not_utility" });
    expect(outbound.length).toBe(before);                              // nothing reached Kapso
    const unknown = await deps().send({ line: "customer", partyId: p, to, category: "utility", dedupeKey: "m1:gate:unknown",
      msg: { type: "template", template: { name: "ak_not_a_template_v1", language: { code: "ar" }, components: [] } } });
    expect(unknown).toEqual({ ok: false, refused: "template_not_utility" });
    expect(await db.one(`select count(*)::int as n from agent_runs where agent = 'compliance_gateway' and trace->>'reason' = 'template_not_utility'`)).toMatchObject({ n: expect.any(Number) });
  });

  it("no template that may be sent: inside the window the free text; outside, skipped and logged template_not_utility; v2 approved: v2", async () => {
    // ak_substitute_question_v1 is approved but marketing; v2 is utility but not approved yet
    await db.rpc("set_template_meta", { p_name: "ak_substitute_question_v1", p_status: "APPROVED", p_category: "MARKETING" });
    const ask = (code: string) => (m: typeof en) => ({ msg: { type: "text" as const, text: { body: m.sub.question(code, "1", "A", 1, "B", 1.2, 0.2, 5) } },
      params: [code, "1 × A", "1 × B", "$1.20", "5"], payloads: ["sub:keep:x", "sub:remove:x"] });
    const inside = await customer(null, true);
    expect((await sendCodeStarted(deps(), inside, "substitute_question", ask("AK-9101"), "m1:sub:in")).ok).toBe(true);
    expect(outbound.at(-1)!.body).toMatchObject({ type: "text", text: { body: ar.sub.question("AK-9101", "1", "A", 1, "B", 1.2, 0.2, 5) } });

    const outside = await customer(null, false);
    const before = outbound.length;
    expect(await sendCodeStarted(deps(), outside, "substitute_question", ask("AK-9102"), "m1:sub:out")).toEqual({ ok: false, refused: "template_not_utility" });
    expect(outbound.length).toBe(before);
    expect(await db.one(`select trace from agent_runs where trace->>'reason' = 'template_not_utility' and trace->>'party_id' = $1 order by created_at desc limit 1`, [outside]))
      .toMatchObject({ trace: { event: "substitute_question", template: "ak_substitute_question_v2", template_status: "submitted", template_category: "utility" } });

    await db.rpc("set_template_meta", { p_name: "ak_substitute_question_v2", p_status: "APPROVED", p_category: "UTILITY" });
    expect((await sendCodeStarted(deps(), outside, "substitute_question", ask("AK-9102"), "m1:sub:out")).ok).toBe(true);
    expect(outbound.at(-1)!.body).toMatchObject({ type: "template", template: { name: "ak_substitute_question_v2", language: { code: "ar" } } });
  });

  it("a template's quick reply comes back as a tap: the kept order's button carries the basket on", async () => {
    const t = flow(db, []);
    await t.customer();
    await t.say({ type: "button", button: { payload: "kept:send", text: "Send my order" } });
    expect(t.seen).toHaveLength(0);                                   // read as the tap, never as words for the model
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.fixed.keptGone);
  });
});
