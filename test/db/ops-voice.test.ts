// B3's request, done by C3: a voice note on the ops line is never dropped in silence (invariant 18). Through the real ops-line
// turn code (runTurn -> processOpsTurn) and the real voice budget (1.17): the sender is answered, ops is told to listen, an
// over-long note gets the polite reply, a retried turn alerts once, and nothing about money or an order moves.
import { beforeAll, describe, expect, it } from "vitest";
import { OPS_VOICE_TEXT } from "@ak/agents/voice";
import { openHub, placeOrder, status, type Hub } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>;
const note = (seconds: number) => ({ type: "audio", audio: { id: "a1", voice: true }, kapso: { direction: "inbound", media_data: { byte_size: 2100 * seconds } } });

beforeAll(async () => {
  h = await openHub();
  line = opsLine(h);
  await line.text(PHONES.rider(0), "حاضر");
}, 120_000);

describe("voice notes on the ops line (B3's request)", () => {
  it("a rider's short note: the rider is told a person listens and money is buttons; ops is told who sent it and how long", async () => {
    const before = line.to(h.ops).length;
    await line.raw(line.msg(PHONES.rider(0), note(20)));
    expect(line.to(h.riders[0]!).at(-1)!.body).toBe(OPS_VOICE_TEXT.received);
    const alerts = line.to(h.ops).slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(OPS_VOICE_TEXT.opsAlert("Rider1", 20));
    expect(Number((await h.db.one(`select count(*) as n from voice_usage where party_id = $1`, [h.riders[0]])).n)).toBe(1);
  });

  it("the same turn retried sends nothing twice and counts the note once", async () => {
    const pending = line.msg(PHONES.rider(0), note(15));
    await line.raw(pending);
    const [toRider, toOps] = [line.to(h.riders[0]!).length, line.to(h.ops).length];
    await line.raw(pending);
    expect([line.to(h.riders[0]!).length, line.to(h.ops).length]).toEqual([toRider, toOps]);
    expect(Number((await h.db.one(`select count(*) as n from voice_usage where party_id = $1`, [h.riders[0]])).n)).toBe(2);
  });

  it("a note over the rider's limit gets the polite reply, and ops is not asked to listen", async () => {
    const before = line.to(h.ops).length;
    await line.raw(line.msg(PHONES.rider(0), note(600)));
    expect(line.to(h.riders[0]!).at(-1)!.body).toContain("التسجيل طويل");
    expect(line.to(h.ops).length).toBe(before);
  });

  it("a picker's note is answered the same way, and the order being picked does not move", async () => {
    const o = await placeOrder(h, [{ product_id: await h.product("Tannourine Mineral Water 2L X6"), qty: 3 }]);
    await line.tap(PHONES.picker, `pick:start:${o.orderId}`);
    const before = line.to(h.ops).length;
    await line.raw(line.msg(PHONES.picker, note(10)));
    expect(line.to(h.picker).at(-1)!.body).toBe(OPS_VOICE_TEXT.received);
    expect(line.to(h.ops).slice(before).map((m) => m.body)).toEqual([OPS_VOICE_TEXT.opsAlert("Rana", 10)]);
    expect(await status(h, o.orderId)).toBe("preparing");
  });
});
