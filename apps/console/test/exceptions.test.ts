// 3.5 Exceptions and handoffs: the queue, and replies that go through the gateway on the customer line.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());

async function handedOver(r: Rig, village: string) {
  const o = await placeOrder(r.db, village);
  await r.db.pg.query(`update conversations set human_handoff = true, last_inbound_at = now() where id = $1`, [o.conversation]);
  await r.db.pg.query(`insert into handoffs(conversation_id, reason) values ($1, 'customer asked for a person')`, [o.conversation]);
  return o;
}

describe("Exceptions and chats", () => {
  it("acknowledges and resolves an exception, recording who", async () => {
    const r = await rig();
    const exc = await r.db.rpc("raise_ops_exception", { p_kind: "no_rider", p_ref: "AK-0001", p_detail: { minutes: 12 } });
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/exceptions")).text;
    expect(page).toContain("no_rider");
    expect(page).toContain("minutes: 12");
    page = (await b.post(`/exceptions/${exc}/acknowledged`)).text;
    expect(flashOf(page)).toBe("Marked as being handled.");
    page = (await b.post(`/exceptions/${exc}/resolved`)).text;
    expect(flashOf(page)).toBe("Marked resolved.");
    expect(page).not.toContain("no_rider");
    expect(await r.db.one(`select status, resolved_by from ops_exceptions where id = $1`, [exc])).toMatchObject({ status: "resolved", resolved_by: lead.partyId });
    expect((await b.post(`/exceptions/${exc}/deleted`)).text).toContain("Unknown status");
  });

  it("a reply goes out once from the customer number through the gateway; a closed window is refused", async () => {
    const r = await rig({ without: ["release_handoff"] });
    const village = await openShop(r.db);
    const o = await handedOver(r, village);
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/exceptions")).text;
    expect(page).toContain("customer asked for a person");
    expect(page).toContain("needs release_handoff()");          // a database without 0045 (staging can lag): the page says so

    const res = await b.post(`/chats/${o.conversation}/reply`, { text: "مرحبا، معك مايا من ألو كينغ", _key: "fixed-key-123" });
    expect(flashOf(res.text)).toBe("Reply sent.");
    const sent = r.kapso.filter((k) => k.url.includes("PN_CUSTOMER"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text.body).toBe("مرحبا، معك مايا من ألو كينغ");
    expect(r.kapso.some((k) => k.url.includes("PN_OPS"))).toBe(false);     // customers are never messaged from the ops number
    expect(flashOf((await b.post(`/chats/${o.conversation}/reply`, { text: "مرحبا، معك مايا من ألو كينغ", _key: "fixed-key-123" })).text)).toBe("Already sent.");
    expect(r.kapso.filter((k) => k.url.includes("PN_CUSTOMER"))).toHaveLength(1);
    const logged = r.media.audit().find((a) => a.action === "chat_reply" && a.phase === "intent")!;
    expect(logged.args).toEqual({ conversation: o.conversation, characters: 27 });   // the action log keeps the length, not the words

    await r.db.pg.query(`update conversations set last_inbound_at = now() - interval '2 days' where id = $1`, [o.conversation]);
    expect(flashOf((await b.post(`/chats/${o.conversation}/reply`, { text: "still there?" })).text)).toBe("Not sent: the 24-hour window is closed.");
    expect(flashOf((await b.post(`/chats/${o.conversation}/release`)).text)).toMatch(/^Not available yet: the database has no release_handoff\(\)/);
  });

  it("with release_handoff() in the database, a chat goes back to the Concierge", async () => {
    const r = await rig();
    const village = await openShop(r.db);
    const o = await handedOver(r, village);
    const lead = await r.staff("admin");
    const b = r.browser();
    await b.signIn(lead);
    expect((await b.get("/exceptions")).text).toContain("Hand back to the Concierge");
    expect(flashOf((await b.post(`/chats/${o.conversation}/release`)).text)).toBe("Handed back to the Concierge.");
    expect((await r.db.one(`select human_handoff from conversations where id = $1`, [o.conversation])).human_handoff).toBe(false);
    expect((await r.db.one(`select status from handoffs where conversation_id = $1`, [o.conversation])).status).toBe("resolved");
    const picker = await r.staff("picker");
    await expect(r.db.rpc("release_handoff", { p_conversation: o.conversation, p_by: picker.partyId })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});
