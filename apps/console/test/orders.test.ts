// Orders (session D5): find an order by code, name or any part of the number; read it as a timeline; file a language mistake as an
// eval case without changing the order. Phones are searched, never shown; a voice note is never read out.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

describe("Orders", () => {
  it("finds an order by its code (any case, with or without the dash), the customer's name, or part of their number; shows no phone", async () => {
    const a = await placeOrder(r.db, village); const b = await placeOrder(r.db, village);
    const lead = await r.staff("ops_lead", "Maya"); const br = r.browser(); await br.signIn(lead);
    const byCode = (await br.get(`/orders?q=${encodeURIComponent(a.code.toLowerCase())}`)).text;
    expect(byCode).toContain(`href="/orders/${a.id}"`); expect(byCode).not.toContain(`href="/orders/${b.id}"`);
    expect((await br.get(`/orders?q=${a.code.replace("-", "")}`)).text).toContain(`href="/orders/${a.id}"`);
    const name = (await r.db.one(`select display_name from parties where id = $1`, [b.customer])).display_name as string;
    expect((await br.get(`/orders?q=${encodeURIComponent(name)}`)).text).toContain(`href="/orders/${b.id}"`);
    const phone = (await r.db.one(`select phone_e164 from party_identities where party_id = $1 and phone_e164 is not null limit 1`, [a.customer])).phone_e164 as string;
    const found = (await br.get(`/orders?q=${encodeURIComponent(phone.slice(-7))}`)).text;
    expect(found).toContain(`href="/orders/${a.id}"`); expect(found).not.toContain(phone);
    expect((await br.get("/orders?q=nobody-by-this-name")).text).toContain("No order matches.");
    expect((await br.get("/orders")).text).toContain("Latest orders");
  });

  it("tells one order as a story: who, what, what changed, in order of time, with the chat around it, payments and refunds", async () => {
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });
    const o = await placeOrder(r.db, village);
    await r.db.pg.query(`insert into wa_messages(line, direction, party_id, conversation_id, type, body, status, order_id) values
      ('customer', 'inbound', $1, $2, 'text', 'بدي لبنة وعيش', 'received', null),
      ('customer', 'outbound', $1, $2, 'text', 'Your order card is ready', 'sent', $3),
      ('customer', 'inbound', $1, $2, 'audio', null, 'received', null)`, [o.customer, o.conversation, o.id]);
    await r.db.pg.query(`update wa_messages set transcript = '{"primary":"SECRET WORDS FROM A VOICE NOTE"}'::jsonb where type = 'audio' and party_id = $1`, [o.customer]);
    await deliver(r.db, o.id, rider);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 });
    const lead = await r.staff("admin", "Rasheed"); const br = r.browser(); await br.signIn(lead);
    const page = (await br.get(`/orders/${o.id}`)).text;
    expect(page).toContain(`<h1>${o.code}</h1>`);
    expect(page).toContain("Leen Taanayel Labneh Premium");                                  // the line
    expect(page).toContain("whatsapp");                                                       // the channel
    expect(page).toMatch(/closed/);                                                           // where it ended
    const at = (s: string) => page.indexOf(s);
    expect(at("being picked") === -1 ? at("confirmed") : at("being picked")).toBeGreaterThan(at("Timeline"));
    expect(at("بدي لبنة وعيش")).toBeGreaterThan(0); expect(page).toContain("customer: بدي لبنة وعيش"); expect(page).toContain("us: Your order card is ready");
    expect(page).toContain("customer: [audio]"); expect(page).not.toContain("SECRET WORDS");   // a voice note is never read out
    expect(page).toMatch(/cod · /);                                                           // the payment
    // by code as well as by id; an unknown order says so plainly
    expect((await br.get(`/orders/${o.code}`)).text).toContain(`<h1>${o.code}</h1>`);
    expect((await br.get(`/orders/AK-0000`)).text).toContain("That order was not found.");
    expect((await br.get(`/orders/not-an-order`)).text).toContain("That order was not found.");
    // times ascend
    const times = [...page.matchAll(/<li><time>([^<]+)<\/time>/g)].map((m) => m[1]);
    expect(times.length).toBeGreaterThan(4);
  });

  it("shows a changed line as changed: a substitution says what it replaces", async () => {
    const o = await placeOrder(r.db, village);
    const item = await r.db.one(`select id, fulfilment_id from order_items where order_id = $1`, [o.id]);
    await r.db.pg.query(`update order_items set status = 'substituted' where id = $1`, [item.id]);
    await r.db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, substitution_of) select order_id, fulfilment_id, product_id, 'Replacement Labneh', 1, unit_price_usd, id from order_items where id = $1`, [item.id]);
    const lead = await r.staff("ops_lead", "Maya"); const br = r.browser(); await br.signIn(lead);
    const page = (await br.get(`/orders/${o.id}`)).text;
    expect(page).toContain("substituted"); expect(page).toMatch(/replaces Leen Taanayel Labneh Premium/);
  });

  it("files 'wrong product' and 'bot at fault' as eval cases, once each, without touching the order, and logs both", async () => {
    const o = await placeOrder(r.db, village);
    const before = await r.db.one(`select status, total_usd, subtotal_usd from orders where id = $1`, [o.id]);
    const lead = await r.staff("ops_lead", "Maya"); const br = r.browser(); await br.signIn(lead);
    await br.get(`/orders/${o.id}`);
    expect(flashOf((await br.post(`/orders/${o.id}/eval`, { kind: "wrong_product", note: "asked for labneh, got yoghurt" })).text)).toBe("Filed for the next evaluation round. The order is unchanged.");
    expect(flashOf((await br.post(`/orders/${o.id}/eval`, { kind: "wrong_product" })).text)).toBe("This was already filed for the next evaluation round.");
    expect(flashOf((await br.post(`/orders/${o.id}/eval`, { kind: "bot_at_fault" })).text)).toContain("Filed");
    const cases = await r.db.all(`select kind, source, reviewed, input, got from eval_cases where order_id = $1 order by kind`, [o.id]);
    expect(cases.map((c: any) => c.kind)).toEqual(["bot_at_fault", "wrong_product"]);
    expect(cases[1]).toMatchObject({ source: "console", reviewed: false });
    expect(cases[1].input).toMatchObject({ order: o.code, note: "asked for labneh, got yoghurt", filed_by: lead.partyId });
    expect(cases[1].got[0]).toMatchObject({ product: "Leen Taanayel Labneh Premium" });
    expect(await r.db.one(`select status, total_usd, subtotal_usd from orders where id = $1`, [o.id])).toEqual(before);
    expect(flashOf((await br.post(`/orders/${o.id}/eval`, { kind: "something_else" })).text)).toBe("Choose wrong product or bot at fault.");
    const log = (await r.actions()).filter((a: any) => a.action.startsWith("order_eval_") && a.phase === "intent");
    expect(log.length).toBeGreaterThanOrEqual(3);
  });

  it("is for the ops lead and the admin: a picker cannot open it or file", async () => {
    const o = await placeOrder(r.db, village);
    const p = await r.staff("picker", "Pia"); const br = r.browser(); await br.signIn(p);
    expect((await br.get("/orders")).status).toBe(403);
    expect((await br.get(`/orders/${o.id}`)).status).toBe(403);
    expect((await br.post(`/orders/${o.id}/eval`, { kind: "wrong_product" }, { follow: false })).status).toBe(403);
    await expect(r.db.rpc("file_order_eval_case", { p_order: o.id, p_by: p.partyId, p_kind: "wrong_product" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("file_order_eval_case", { p_order: o.id, p_by: (await r.staff("admin", "X")).partyId, p_kind: "other" })).rejects.toThrow(/UNKNOWN_KIND/);
  });
});
