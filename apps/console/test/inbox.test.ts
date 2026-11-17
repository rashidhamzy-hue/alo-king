// HO1 (docs/strategy/05 section D): the plain Inbox. The open cases by timer; one case's chat, order and a drafted reply (code,
// from the read-only case_context; no model); send through the gateway in one tap (renews the pause), claim, give back, resolve.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { flashOf, openShop, placeOrder, rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());

describe("Inbox", () => {
  it("lists open cases oldest first; claim, send the drafted reply, give back, resolve with the closing line", async () => {
    const r = await rig();
    const village = await openShop(r.db);
    const a = await placeOrder(r.db, village), b2 = await placeOrder(r.db, village);
    await r.db.pg.query(`update conversations set last_inbound_at = now() where id = any($1::uuid[])`, [`{${a.conversation},${b2.conversation}}`]);
    const older = (await r.db.rpc("open_case", { p_conversation: a.conversation, p_kind: "complaint", p_topic: "spoiled milk", p_order: a.id, p_source: "model" })).case_id;
    const newer = (await r.db.rpc("open_case", { p_conversation: b2.conversation, p_kind: "person_requested", p_topic: null, p_order: null, p_source: "customer_words" })).case_id;
    await r.db.pg.query(`update handoffs set ladder_from = now() - interval '7 minutes', late = false where id = $1`, [older]);
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/inbox")).text;
    expect(page.indexOf(older)).toBeGreaterThan(-1);
    expect(page.indexOf(older)).toBeLessThan(page.indexOf(newer));       // the longest wait first
    expect(page).toContain("7 min"); expect(page).toContain("Complaint"); expect(page).toContain("Asked for a person");

    const one = (await b.get(`/inbox/${older}`)).text;
    const code = a.code;
    expect(one).toContain(ar.support.draft("complaint", code));         // drafted by code from the case, never sent by itself
    expect(r.kapso.filter((k) => k.url.includes("PN_CUSTOMER"))).toHaveLength(0);

    expect(flashOf((await b.post(`/inbox/${older}/claim`)).text)).toBe("Claimed. The bot steps back while you answer.");
    expect((await r.db.one(`select bot_paused_until > now() as p from conversations where id = $1`, [a.conversation])).p).toBe(true);
    const sent = await b.post(`/inbox/${older}/reply`, { text: "مرحبا، معك مايا. منبدّلك الحليب اليوم.", _key: "inbox-key-0001" });
    expect(flashOf(sent.text)).toBe("Sent. The bot stays back while you answer.");
    const out = r.kapso.filter((k) => k.url.includes("PN_CUSTOMER"));
    expect(out.map((k) => k.body.text.body)).toEqual(["مرحبا، معك مايا. منبدّلك الحليب اليوم."]);
    expect(r.kapso.some((k) => k.url.includes("PN_OPS"))).toBe(false);   // never from the ops number
    expect((await r.db.one(`select first_staff_reply_at is not null as r from handoffs where id = $1`, [older])).r).toBe(true);
    expect(flashOf((await b.post(`/inbox/${older}/reply`, { text: "مرحبا، معك مايا. منبدّلك الحليب اليوم.", _key: "inbox-key-0001" })).text)).toBe("Already sent.");

    expect(flashOf((await b.post(`/inbox/${older}/release`)).text)).toBe("The bot answers this customer again. The case stays yours.");
    expect((await r.db.one(`select bot_paused_until from conversations where id = $1`, [a.conversation])).bot_paused_until).toBeNull();

    expect(flashOf((await b.post(`/inbox/${older}/resolve`, { outcome: "x" })).text)).toBe("Say what was done (a few words).");
    expect(flashOf((await b.post(`/inbox/${older}/resolve`, { outcome: "milk replaced on the next order" })).text)).toBe("Resolved, and the customer was told.");
    expect(r.kapso.filter((k) => k.url.includes("PN_CUSTOMER")).map((k) => k.body.text.body).at(-1)).toBe(ar.support.resolved);
    expect(await r.db.one(`select state, outcome, resolved_by from handoffs where id = $1`, [older])).toEqual({ state: "resolved", outcome: "milk replaced on the next order", resolved_by: lead.partyId });
    const after = (await b.get("/inbox")).text;
    expect(after).not.toContain(older); expect(after).toContain(newer);
    const logged = r.media.audit().find((x) => x.action === "case_reply" && x.phase === "intent")!;
    expect(logged.args).toEqual({ case: older, characters: 38 });       // the action log keeps the length, not the words
  });

  // QA1: the gateway records a message that is not plain text as its whole WhatsApp body (packages/wa/src/gateway.ts: JSON.stringify(msg));
  // on staging 110 of 158 bot messages in two days were buttons, cards or templates, and the Inbox showed them as raw JSON.
  it("shows a bot message with buttons, a template or a location as words, never as raw JSON, in the list and in the case", async () => {
    const r = await rig();
    const village = await openShop(r.db);
    const a = await placeOrder(r.db, village);
    const caseId = (await r.db.rpc("open_case", { p_conversation: a.conversation, p_kind: "person_requested", p_topic: null, p_order: null, p_source: "customer_words" })).case_id;
    const party = (await r.db.one(`select party_id from conversations where id = $1`, [a.conversation])).party_id;
    const put = (type: string, body: unknown, at: string) => r.db.pg.query(
      `insert into wa_messages(line, direction, party_id, type, body, created_at) values ('customer', 'outbound', $1, $2, $3, now() - $4::interval)`, [party, type, JSON.stringify(body), at]);
    await put("location", { type: "location", location: { latitude: 33.677, longitude: 35.564, name: "Alo King" } }, "3 minutes");
    await put("template", { type: "template", template: { name: "ak_payment_received_v1", language: { code: "ar" }, components: [] } }, "2 minutes");
    await put("interactive", { type: "interactive", interactive: { type: "button", body: { text: "وصلك طلبك؟ إذا في شي ناقص دقّ «في مشكلة»." },
      action: { buttons: [{ type: "reply", reply: { id: "fb:ok:1", title: "تمام" } }, { type: "reply", reply: { id: "fb:problem:1", title: "في مشكلة" } }] } } }, "1 minute");
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const list = (await b.get("/inbox")).text, one = (await b.get(`/inbox/${caseId}`)).text;
    for (const t of [list, one]) {
      expect(t).not.toContain("&quot;type&quot;"); expect(t).not.toContain('{"type"');
      expect(t).toContain("وصلك طلبك؟ إذا في شي ناقص دقّ «في مشكلة».");
    }
    expect(one).toContain("[تمام | في مشكلة]");
    expect(one).toContain("[template: ak_payment_received_v1]");
    expect(one).toContain("[location]");
    const drawer = (await b.get(`/orders/${a.id}`)).text;                                     // the order's story shows the same words
    expect(drawer).not.toContain("&quot;type&quot;"); expect(drawer).toContain("وصلك طلبك؟ إذا في شي ناقص دقّ «في مشكلة».");
  });

  it("is for the ops lead and the admin only, and the database refuses anyone else too", async () => {
    const r = await rig();
    const village = await openShop(r.db);
    const a = await placeOrder(r.db, village);
    const c = (await r.db.rpc("open_case", { p_conversation: a.conversation, p_kind: "refund", p_topic: null, p_order: a.id, p_source: "model" })).case_id;
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/inbox")).status).not.toBe(200);
    await expect(r.db.rpc("cases_inbox", { p_staff: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("case_context", { p_case: c, p_staff: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
