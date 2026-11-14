// docs/AUDIT-2026-11-14.md item 5 (K1): the founder's saved place says Baakline while its pin is in Khraibeh (saved on 13 Nov,
// before "the pin decides", 0074). Every saved place is re-checked against its pin once; where they disagree, the place is set
// aside (recorded in place_rechecks) and the next order asks for the pin again instead of pricing for the wrong village.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso } from "./flow-kit";
import { FIXED } from "@ak/agents/order-card";

let db: TestDb;
const v: Record<string, string> = {};
beforeAll(async () => {
  ({ db } = await openFlowDb());
  for (const n of ["Baakline", "Khraibeh"]) v[n] = (await db.one(`select id from villages where name_en = $1`, [n])).id;
}, 60_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db?.pg.close(); });

const READING = { intent: "order", fulfilment: "delivery", transcript_quality: "good", needs_clarification: [],
  lines: [{ qty: 3, raw: "3 كرتونة مي تنورين", unit: "each", query: "مي تنورين", modifiers: [], brand_hint: "تنورين", confidence: 0.9, source_hint: null }],
  address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null } };
const KHRAIBEH_PIN = { lat: 33.6490, lng: 35.6460 };     // a fake pin about 0.3 km from the Khraibeh centre (the repository is public: no real pin)

describe("saved places re-checked against their pins (audit item 5)", () => {
  it("a place whose pin is in another village is set aside, and the next order asks for the pin", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read(READING)]);
    const c = await t.customer();
    // As saved on 13 Nov: the village from the text, the pin from the map. And a second place that agrees with its pin.
    const bad = (await db.one(`insert into customer_places(party_id, village_id, lat, lng, building, last_used_at)
      values ($1, $2, $3, $4, 'بيت الاختبار', now()) returning id`, [c.party_id, v.Baakline, KHRAIBEH_PIN.lat, KHRAIBEH_PIN.lng])).id;
    const good = (await db.one(`insert into customer_places(party_id, village_id, lat, lng, last_used_at)
      values ($1, $2, 33.67739, 35.56355, now() - interval '1 day') returning id`, [c.party_id, v.Baakline])).id;

    const r = await db.rpc<any>("recheck_places");
    expect(r.set_aside).toBe(1);
    const row = await db.one(`select * from place_rechecks where place_id = $1`, [bad]);
    expect(row).toMatchObject({ old_village_id: v.Baakline, pin_village_id: v.Khraibeh, status: "located" });
    expect(await db.one(`select village_id, lat from customer_places where id = $1`, [bad])).toEqual({ village_id: null, lat: null });
    expect((await db.one(`select village_id from customer_places where id = $1`, [good])).village_id).toBe(v.Baakline);
    expect((await db.rpc<any>("recheck_places")).set_aside).toBe(0);           // once: a second run changes nothing

    // His next order: the other place (which agrees with its pin) is the usual one now; with only the bad one, the pin is asked.
    await db.pg.query(`delete from customer_places where id = $1`, [good]);
    await t.text("بدي 3 كرتونة مي تنورين");
    expect(outbound[0]!.body.interactive.type).toBe("location_request_message");
    expect(outbound[0]!.body.interactive.body.text).toBe(FIXED.askPin);
  }, 60_000);
});
