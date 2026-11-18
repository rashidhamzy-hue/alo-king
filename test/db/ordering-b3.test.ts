// Session B3 (ordering): 1.8, 1.13, 1.17, 2.9 on the real schema. Only the model (scripted) and Kapso's HTTP endpoint
// (a recorder) are replaced. 1.22 is in catalog-language.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import { runTurn } from "../../apps/gateway/src/turn";
import { ar } from "@ak/agents/messages";

let db: TestDb, ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const ORDER = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }], address: { village: "بعقلين" } };

describe("model text is marked for the gateway's second check (A2's request)", () => {
  it("a reply the model wrote goes out with authored: model; the card written by code does not", async () => {
    const { use } = await import("./flow-kit");
    const t = flow(db, [read({ intent: "order", lines: [{ raw: "زقزوق مقرمش", query: "زقزوق مقرمش", qty: 1, confidence: 0.5 }] }),
                        [use("reply", { text: "ما لقيت هيدا عنا. شو بتحب بدالو؟" })]]);
    await t.customer();
    const reqs: any[] = [];
    const send = t.deps.send;
    await runTurn({ ...t.deps, send: async (r) => { reqs.push(r); return send(r); } }, t.pending({ type: "text", text: { body: "بدي زقزوق مقرمش" } }), {});
    expect(reqs.map((r) => r.authored?.by ?? null)).toEqual(["model"]);
  });
});

describe("typing indicator and a cap on model turns (1.8)", () => {
  it("the typing indicator goes on the message being answered, once, only when the model is needed", async () => {
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const typing = vi.fn(async () => undefined);
    const p = t.pending({ type: "text", text: { body: "بدي علبتين لبنة ليبان ليه" } });
    await runTurn({ ...t.deps, typing }, p, {});
    expect(typing).toHaveBeenCalledTimes(1);
    expect(typing).toHaveBeenCalledWith(p[0]!.event.message.id);
    const tap = vi.fn(async () => undefined);
    await runTurn({ ...t.deps, typing: tap }, t.pending({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "marketing:no", title: "x" } } }), {});
    expect(tap).not.toHaveBeenCalled();                                 // a button needs no model, so no indicator
  });

  it("a typing indicator that fails never stops the turn", async () => {
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const r = await runTurn({ ...t.deps, typing: async () => { throw new Error("kapso down"); } }, t.pending({ type: "text", text: { body: "بدي لبنة" } }), {});
    expect(r.outcome).toBe("card");
  });

  it("past the hourly cap: no model call, a fixed menu, ops are alerted once an hour; nobody locks the chat (HO1)", async () => {
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 2}' where key = 'model_turns'`);
    const t = flow(db, [read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await db.pg.query(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`);
    for (let i = 0; i < 2; i++) await db.pg.query(`insert into agent_runs(agent, conversation_id, model, input_tokens, output_tokens, latency_ms, outcome)
                                                    values ('concierge', $1, 'fast', 900, 50, 1000, 'ok')`, [c.conversation_id]);
    expect(await db.rpc("model_turn_budget", { p_party: c.party_id })).toEqual({ allowed: false, used: 2, limit: 2 });
    await t.text("بدي كمان لبنة");
    expect(t.seen).toHaveLength(0);
    expect(outbound.map((o) => o.body.interactive?.body?.text)).toContain(ar.support.capMenu);
    expect((await db.one(`select human_handoff from conversations where id = $1`, [c.conversation_id])).human_handoff).toBe(false);
    expect(await db.all(`select kind from ops_exceptions where kind = 'model_turn_cap' and ref like $1`, [`${c.party_id}:%`])).toHaveLength(1);
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 20}' where key = 'model_turns'`);
  });

  it("answers that need no model are never capped", async () => {
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 0}' where key = 'model_turns'`);
    const t = flow(db, []);
    await t.customer();
    await t.text("وين صار طلبي؟");                                     // a quick intent, answered by the database
    expect(t.seen).toHaveLength(0);
    expect(outbound.map((o) => o.body.text?.body)).not.toContain(ar.fixed.handoff);
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 20}' where key = 'model_turns'`);
  });
});

describe("first-contact source (1.13)", () => {
  it("an ad click on the first message is kept on the customer and on their first order, not on the next", async () => {
    const t = flow(db, [read(ORDER), read(ORDER)]);
    await t.say({ type: "text", text: { body: "مرحبا بدي لبنة" },
      referral: { source_url: "https://fb.me/x", source_id: "120200", source_type: "ad", headline: "توصيل عالبيت", ctwa_clid: "ARAkLkA8" } });
    const c = await t.customer();
    expect((await db.one(`select first_contact from parties where id = $1`, [c.party_id])).first_contact)
      .toMatchObject({ source: "ad", ctwa_clid: "ARAkLkA8", ad_id: "120200", ad_type: "ad" });
    const o1 = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: null, p_lines: [{ product_id: ids.LABNEH, qty: 1 }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: true, p_payment: "cod", p_change_for: null, p_notes: null });
    expect((await db.one(`select acquisition from orders where id = $1`, [o1.order_id])).acquisition).toMatchObject({ source: "ad", ctwa_clid: "ARAkLkA8" });
    await db.pg.query(`update orders set status = 'closed' where id = $1`, [o1.order_id]);
    const o2 = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: null, p_lines: [{ product_id: ids.LABNEH, qty: 1 }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: true, p_payment: "cod", p_change_for: null, p_notes: null });
    expect((await db.one(`select acquisition from orders where id = $1`, [o2.order_id])).acquisition).toBeNull();
  });

  it("a QR code or a referral code in the first message is stored; a later message changes nothing", async () => {
    const t = flow(db, [read({ intent: "greeting" }), read({ intent: "greeting" })]);
    await t.text("مرحبا QR-BAAK01 و ref_sami7");
    const c = await t.customer();
    const fc = (await db.one(`select first_contact from parties where id = $1`, [c.party_id])).first_contact;
    expect(fc).toMatchObject({ source: "qr", qr_code: "BAAK01", referral_code: "SAMI7" });
    await t.say({ type: "text", text: { body: "REF-OTHER9" }, referral: { source_id: "999", ctwa_clid: "late" } });
    expect((await db.one(`select first_contact from parties where id = $1`, [c.party_id])).first_contact).toEqual(fc);
  });

  it("a customer who wrote before has no first contact: unknown, never guessed", async () => {
    const t = flow(db, [read({ intent: "greeting" })]);
    const c = await t.customer();
    await db.pg.query(`insert into wa_messages(line, direction, party_id, wa_message_id, type, status) values ('customer', 'inbound', $1, $2, 'text', 'received')`, [c.party_id, `old.${c.party_id}`]);
    await t.say({ type: "text", text: { body: "hi" }, referral: { source_id: "1", ctwa_clid: "x" } });
    expect((await db.one(`select first_contact from parties where id = $1`, [c.party_id])).first_contact).toBeNull();
  });
});

describe("voice-note policy by role, from settings, across turns (1.17)", () => {
  const audio = (bytes: number, extra: Record<string, unknown> = {}) => ({ type: "audio", audio: { id: "a1", voice: true, ...extra },
    kapso: { direction: "inbound", origin: "cloud_api", transcript: { text: "بدي علبتين لبنة ليبان ليه من فضلك" }, media_data: { url: "https://k/a", byte_size: bytes } } });
  const setLimits = (v: Record<string, number>) => db.pg.query(`update settings set value = $1 where key = 'voice_limits'`,
    [JSON.stringify({ customer: 180, merchant: 300, driver: 120, staff: 120, per_sender_seconds_per_hour: 900, ...v })]);
  afterEach(() => setLimits({}));

  it("the customer's limit comes from settings.voice_limits", async () => {
    await setLimits({ customer: 30 });
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    await t.say(audio(2100 * 60));                                      // about a minute
    expect(t.seen).toHaveLength(0);
    expect(outbound[0]!.body.text.body).toContain("التسجيل طويل");
  });

  it("the hourly budget holds across turns, not only inside one burst", async () => {
    await setLimits({ per_sender_seconds_per_hour: 20 });
    const t = flow(db, [read(ORDER), read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await t.say(audio(2100 * 15));
    expect(t.seen).toHaveLength(1);                                     // read and answered
    outbound.length = 0;
    await t.say(audio(2100 * 15));                                      // fifteen more seconds, a new turn: over the hour's 20
    expect(t.seen).toHaveLength(1);
    expect(outbound.map((o) => o.body.text?.body)).toContain("وصلني كتير تسجيلات ورا بعض. اكتبلي الطلب أو قلّي «موظف» وبيتواصل معك حدا من الفريق.");
    expect((await db.one(`select coalesce(sum(seconds), 0)::int as s from voice_usage where party_id = $1`, [c.party_id])).s).toBe(15);
  });

  it("the provider's real duration wins over the size estimate, and a retried note is counted once", async () => {
    const { audioSeconds, decideVoice } = await import("@ak/agents/voice");
    expect(audioSeconds({ id: "x", audio: { duration: 20 }, kapso: { media_data: { byte_size: 2100 * 600 } } })).toBe(20);
    expect(audioSeconds({ id: "x", kapso: { media_data: { byte_size: 2100 * 30 } } })).toBe(30);
    const t = flow(db, []);
    const c = await t.customer();
    const m = { id: `wamid.voice.${c.party_id}`, kapso: { media_data: { byte_size: 2100 * 40 } } };
    const g = { db: t.client as any, partyId: c.party_id, line: "customer" as const, role: "customer" as const };
    await decideVoice(g, m, 0, [m.id]); await decideVoice(g, m, 0, [m.id]);
    expect((await db.one(`select count(*)::int as n from voice_usage where party_id = $1`, [c.party_id])).n).toBe(1);
  });

  it("riders and staff: their own limit; within it a person listens and the rider is reminded money is buttons", async () => {
    const { voiceOnOpsLine, OPS_VOICE_TEXT } = await import("@ak/agents/voice");
    const t = flow(db, []);
    const rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'R') returning id`)).id;
    const g = { db: t.client as any, partyId: rider, line: "ops" as const, role: "driver" as const };
    const long = await voiceOnOpsLine(g, { id: `wamid.r1.${rider}`, kapso: { media_data: { byte_size: 2100 * 150 } } }, 0, []);
    expect(long).toMatchObject({ forwardToOps: false });
    expect(long.reply).toContain("التسجيل طويل");
    const short = await voiceOnOpsLine(g, { id: `wamid.r2.${rider}`, kapso: { media_data: { byte_size: 2100 * 30 } } }, 0, []);
    expect(short).toEqual({ reply: OPS_VOICE_TEXT.received, forwardToOps: true, seconds: 30 });
  });
});

describe("voice notes: Kapso first, a second provider behind a setting, the audio kept privately (1.7)", () => {
  const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 1, 1, 7, 7, 7, 7]);
  const note = (text: string, url = "https://app.kapso.ai/media/a1") => ({ type: "audio", audio: { id: "a1", voice: true },
    kapso: { direction: "inbound", origin: "cloud_api", transcript: { text }, media_url: url, media_data: { url, byte_size: 2100 * 6 } } });
  const setStt = (v: Record<string, unknown>) => db.pg.query(`update settings set value = $1 where key = 'stt'`, [JSON.stringify(v)]);
  afterEach(() => setStt({ keep_audio: true, second_provider: null }));

  it("the note is fetched through Kapso, kept in the private bucket, and Kapso's transcript is read; no second provider by default", async () => {
    outbound = recordKapso({ "https://app.kapso.ai/media/a1": { bytes: OGG, type: "audio/ogg" } });
    const stt = { name: "scribe", transcribe: vi.fn(async () => "x") };
    const t = flow(db, [read(ORDER)], { deps: { stt } });
    await pinned(db, t, ids.BAAKLINE);
    await runTurn({ ...t.deps, stt }, t.pending(note("بدي علبتين لبنة ليبان ليه")), {});
    expect(stt.transcribe).not.toHaveBeenCalled();
    const row = await db.one(`select media_path, transcript from wa_messages where type = 'audio' order by created_at desc limit 1`);
    expect(String(row.media_path), JSON.stringify(row.transcript)).toMatch(/^voice_notes\/[0-9a-f-]{36}\/[0-9a-f]{64}\.ogg$/);
    expect(row.transcript).toMatchObject({ kapso: "بدي علبتين لبنة ليبان ليه", chosen: "kapso" });
  });

  it("with the setting, the second transcript is taken too, and rescues a note Kapso heard as a loop", async () => {
    await setStt({ keep_audio: false, second_provider: "scribe" });
    outbound = recordKapso({ "https://app.kapso.ai/media/a1": { bytes: OGG, type: "audio/ogg" } });
    const stt = { name: "scribe", transcribe: vi.fn(async () => "بدي علبتين لبنة ليبان ليه") };
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const r = await runTurn({ ...t.deps, stt }, t.pending(note("لا لا لا لا لا لا لا لا لا لا")), {});
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("card");
    const row = await db.one(`select media_path, transcript from wa_messages where type = 'audio' order by created_at desc limit 1`);
    expect(row.media_path).toBeNull();                                  // keep_audio off
    expect(row.transcript).toMatchObject({ second: { provider: "scribe" }, chosen: "scribe" });
  });

  it("a raw Meta link is never fetched; the note is still read from Kapso's transcript", async () => {
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const r = await runTurn(t.deps, t.pending(note("بدي علبتين لبنة ليبان ليه", "https://lookaside.fbsbx.com/whatsapp/a1")), {});
    expect(r.outcome).toBe("card");
    expect(outbound.every((o) => !o.url.includes("fbsbx"))).toBe(true);
    const row = await db.one(`select transcript from wa_messages where type = 'audio' order by created_at desc limit 1`);
    expect(row.transcript.notes).toEqual({ audio: "no_kapso_media_url" });
  });
});

describe("one tap after delivery (2.9)", () => {
  async function delivered(t: ReturnType<typeof flow>, minutesAgo = 15) {
    const c = await pinned(db, t, ids.BAAKLINE);
    const o = await db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: ids.LABNEH, qty: 1 }],
      p_village: ids.BAAKLINE, p_place: null, p_pickup: true, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.pg.query(`update orders set status = 'delivered', delivered_at = now() - make_interval(mins => $2) where id = $1`, [o.order_id, minutesAgo]);
    return { ...c, orderId: o.order_id as string, code: (await db.one(`select short_code from orders where id = $1`, [o.order_id])).short_code as string };
  }
  const ask = async (t: ReturnType<typeof flow>) => {
    const { sendFeedbackRequests } = await import("@ak/agents/feedback");
    return sendFeedbackRequests(t.deps, async (p) => (await db.rpc("party_address", { p_party: p, p_line: "customer" })) as string);
  };

  it("a delivered order gets one card, after the delay, never twice", async () => {
    const t = flow(db, []);
    const fresh = await delivered(t, 2);                                 // too soon
    const c = await delivered(flow(db, []), 15);
    await ask(t);
    const cards = outbound.filter((o) => o.body.type === "interactive" && o.body.interactive.body.text.includes("وصلك طلبك"));
    expect(cards.map((o) => o.body.interactive.body.text)).toEqual(expect.arrayContaining([expect.stringContaining(c.code)]));
    expect(cards.map((o) => o.body.interactive.body.text).join()).not.toContain(fresh.code);
    expect(cards.find((o) => o.body.interactive.body.text.includes(c.code))!.body.interactive.action.buttons.map((b: any) => b.reply.id))
      .toEqual([`fb:fine:${c.orderId}`, `fb:problem:${c.orderId}`]);
    outbound.length = 0;
    await ask(t);
    expect(outbound.filter((o) => JSON.stringify(o.body).includes(c.code))).toEqual([]);
  });

  it("«a problem» opens a case and alerts ops; «fine» thanks once; a repeat tap does nothing", async () => {
    await db.pg.query(`insert into parties(role, display_name) values ('ops_lead', 'Ops lead 2.9')`);
    const t = flow(db, []);
    const c = await delivered(t);
    await t.tap(`fb:problem:${c.orderId}`, "في مشكلة");
    expect(outbound.map((o) => o.body.text?.body)).toContain(ar.feedback.problem(c.code));
    expect((await db.one(`select human_handoff from conversations where id = $1`, [c.conversation_id])).human_handoff).toBe(false);
    expect(await db.all(`select kind, order_id from handoffs where conversation_id = $1`, [c.conversation_id])).toEqual([{ kind: "order_problem", order_id: c.orderId }]);
    expect(await db.all(`select 1 from ops_exceptions where kind = 'delivery_problem' and ref = $1`, [c.orderId])).toHaveLength(1);
    outbound.length = 0;
    await t.tap(`fb:fine:${c.orderId}`, "وصل تمام");
    expect(outbound).toEqual([]);                                       // already answered: nothing changes, nothing sent
    expect(t.seen).toHaveLength(0);                                     // never the model

    const u = flow(db, []);
    const d = await delivered(u);
    await u.tap(`fb:fine:${d.orderId}`, "وصل تمام");
    expect(outbound.map((o) => o.body.text?.body)).toEqual([ar.feedback.fine]);
    expect((await db.one(`select verdict from order_feedback where order_id = $1`, [d.orderId])).verdict).toBe("fine");
  });

  it("nobody answers for someone else's order", async () => {
    const mine = await delivered(flow(db, []));
    const other = flow(db, []);
    await other.customer();
    await other.tap(`fb:problem:${mine.orderId}`, "في مشكلة");
    expect(await db.all(`select 1 from order_feedback where order_id = $1 and verdict is not null`, [mine.orderId])).toEqual([]);
    expect(outbound).toEqual([]);
  });
});

describe("substitute taps on the customer line (C2's request)", () => {
  it("a keep or remove tap goes to the hub's handler, never the model", async () => {
    const t = flow(db, []);
    await t.customer();
    await t.tap("sub:keep:00000000-0000-4000-8000-000000000001", "خليه");
    expect(t.rpcCalls.map((c: any) => c.fn)).toContain("answer_substitution");
    expect(t.seen).toHaveLength(0);
    // an offer that does not exist: the error line with a retry button, and an ops exception (HO1: not a hand-off)
    expect(outbound.map((o) => o.body.interactive?.body?.text)).toEqual([ar.support.buttonError]);
  });
});
