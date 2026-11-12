// The rider conversation end to end: real SQL, real handler code, WhatsApp replaced by a recorder.
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSITIONS } from "@ak/core/order-machine";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import { dispatchAndOffer } from "../../apps/gateway/src/ops-turn";

let db: TestDb; let deps: TurnDeps; let rider: string; let orderId: string; let total: number;
const outbox: { to: string; type: string; body: string; buttons: string[] }[] = [];
let n = 0;
const RIDER_PHONE = "+96171111111";

function msg(partial: Record<string, unknown>): Pending[] {
  const id = `wamid.r${++n}`;
  return [{ line: "ops", who: { phone: RIDER_PHONE }, event: { phone_number_id: "ops", conversation: { id: "c", contact_name: "Rami" },
    message: { id, timestamp: "0", kapso: { direction: "inbound" }, ...partial } } as any }];
}
const text = (body: string) => msg({ type: "text", text: { body } });
const tap = (id: string) => msg({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });
const lastButtons = () => [...outbox].reverse().find((m) => m.to === RIDER_PHONE && m.buttons.length)!.buttons;

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  const village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [village]);
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${rider}', 'ops', '${RIDER_PHONE}')`);
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-c1", p_phone: "+96170000001", p_name: "Maya" });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const prod = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: prod, qty: 12, raw: "لبنة" }],
    p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: "w1" });
  orderId = o.order_id; total = Number((await db.one(`select total_usd from orders where id = $1`, [orderId])).total_usd);

  deps = {
    db: asSupabase(db) as unknown as SupabaseClient, model: { messages: { create: async () => { throw new Error("no model on the ops line"); } } } as any, modelName: "none",
    send: async (req) => {
      if (req.dedupeKey && !(await db.rpc("outbox_claim", { p_key: req.dedupeKey, p_line: req.line, p_party: req.partyId, p_payload: req.msg }))) return { ok: true, wamid: "already_sent" };
      const m = req.msg as any;
      outbox.push({ to: req.to, type: m.type, body: m.text?.body ?? m.interactive?.body?.text ?? "", buttons: (m.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id) });
      if (req.dedupeKey) await db.rpc("outbox_mark", { p_key: req.dedupeKey, p_wamid: "out" + outbox.length });
      return { ok: true, wamid: "out" + outbox.length };
    },
  };
}, 120_000);

describe("a rider's shift over WhatsApp", () => {
  it("the TypeScript state table matches the one in the database", async () => {
    const rows = await db.all<{ from_status: string; to_status: string; actors: string }>(`select from_status, to_status, actors::text from order_transitions`);
    const fromDb: Record<string, Record<string, string[]>> = {};
    for (const r of rows) (fromDb[r.from_status] ??= {})[r.to_status] = r.actors.replace(/[{}]/g, "").split(",").sort();
    const fromTs: typeof fromDb = {};
    for (const [f, tos] of Object.entries(TRANSITIONS)) for (const [t, a] of Object.entries(tos)) (fromTs[f] ??= {})[t] = [...a!].sort();
    expect(fromTs).toEqual(fromDb);
  });

  it("starts the shift, gets the offer, accepts, picks up, delivers and reports cash in two currencies", async () => {
    await runTurn(deps, text("حاضر"), {});
    expect(outbox.at(-1)!.body).toContain("بلّش الدوام");

    expect((await dispatchAndOffer(deps, orderId)).status).toBe("offered");
    const [accept] = lastButtons();
    expect(accept).toMatch(/^job:accept:/);

    await runTurn(deps, tap(accept!), {});
    const picked = lastButtons().find((b) => b.startsWith("job:picked:"))!;
    await runTurn(deps, tap(picked), {});
    expect((await db.one(`select status from orders where id = $1`, [orderId])).status).toBe("out_for_delivery");
    expect(outbox.some((m) => m.type === "location")).toBe(true);                    // the pin opens in the rider's maps app

    // the Arrived tap is lost in a dead zone; Delivered still works
    const delivered = lastButtons().find((b) => b.startsWith("stop:delivered:"))!;
    await runTurn(deps, tap(delivered), {});
    expect(outbox.at(-1)!.body).toContain("قديش قبضت");

    await runTurn(deps, text("شو"), {});                                              // not an amount: asked again, nothing posted
    expect(Number(await db.rpc("driver_cash_usd", { p_driver: rider }))).toBe(0);

    const lbp = Math.round(((total - 5) * 89500) / 1000) * 1000;
    await runTurn(deps, text(`5$ و ${lbp / 1000} الف`), {});
    expect((await db.one(`select status from orders where id = $1`, [orderId])).status).toBe("closed");
    const cash = await db.one(`select * from driver_cash_native($1)`, [rider]);
    expect(Number(cash.usd)).toBe(5); expect(Number(cash.lbp)).toBe(lbp);
  });

  it("a redelivered message does nothing the second time", async () => {
    const before = outbox.length;
    const again = text("حاضر"); 
    await runTurn(deps, again, {}); const mid = outbox.length;
    const r = await runTurn(deps, again, {});
    expect(r.outcome).toBe("duplicate"); expect(outbox.length).toBe(mid); expect(mid).toBe(before + 1);
  });

  it("will not close the shift while the rider holds cash, and offers the two drop options", async () => {
    await runTurn(deps, text("خلصت"), {});
    expect(lastButtons()).toEqual(["shift:drop_hub", "shift:drop_omt"]);
    await runTurn(deps, tap("shift:drop_hub"), {});
    expect((await db.one(`select status from cash_drops where driver_id = $1`, [rider])).status).toBe("declared");
  });
});
