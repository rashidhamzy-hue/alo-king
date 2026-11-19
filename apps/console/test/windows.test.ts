// Windows and calendar (session D4): plans and calendar dates entered on the page become the windows customers are offered
// (open_delivery_windows, 0040); one slot is edited; an order is moved or cancelled with a reason, and the customer is told only
// when the person writes to them. Pickers are refused by the page and by the database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, openShop, rig, type Rig } from "./kit";

let r: Rig; let village: string;
let seq = 0;
afterAll(() => vi.unstubAllGlobals());       // one rig for the file: Kapso's stub stays for every test in it
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);

const ALL_DAYS = { wd_1: 1, wd_2: 1, wd_3: 1, wd_4: 1, wd_5: 1, wd_6: 1, wd_7: 1 };
const MORNING = { name: "Morning", ...ALL_DAYS, starts: "10:00", ends: "12:00", capacity: 5, order_by_min: 120, fresh_order_by_min: 720, zone: "", calendar_kind: "", active: 1 };
const offered = async () => (await r.db.rpc("open_delivery_windows", { p_village: village, p_fresh: false, p_limit: 20 })) as any[];
const tomorrow = async () => (await r.db.one(`select ((now() at time zone 'Asia/Beirut')::date + 1)::text as d`)).d as string;
const slotsOf = async (plan: string) => r.db.all(`select id, slot_date::text as d, capacity, closed from delivery_slots where plan_id = $1 and slot_date >= (now() at time zone 'Asia/Beirut')::date + 2 order by starts_at`, [plan]);

/** A confirmed order in a window, as the customer's tap leaves it, with the chat open so a message can go out. */
async function scheduled(slot: string) {
  const n = ++seq;
  const t = await r.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-w${n}`, p_phone: `+9617030000${n}`, p_name: `Window ${n}` });
  await r.db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await r.db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const prod = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  const o = await r.db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: prod, qty: 12 }],
    p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
  const w = await r.db.rpc("request_delivery_window", { p_order: o.order_id, p_slot: slot, p_party: t.party_id });
  expect(w.ok).toBe(true);
  await r.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-win-${n}` });
  await r.db.pg.query(`update conversations set last_inbound_at = now() where id = $1`, [t.conversation_id]);
  return { id: o.order_id as string, code: o.short_code as string, customer: t.party_id as string };
}
const slotOfOrder = async (order: string) => (await r.db.one(`select delivery_slot_id as s from orders where id = $1`, [order])).s as string;

describe("Windows and calendar", () => {
  it("with no window entered, the page says scheduled orders are off and customers are offered nothing", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/windows")).text;
    expect(page).toContain("No windows yet: customers cannot schedule an order until you add one.");
    expect(page).toContain("No dates entered.");
    expect(await offered()).toEqual([]);
    expect((await b.get("/")).text).toContain('href="/windows"');
  });

  it("a window entered on the page is returned by open_delivery_windows; a changed capacity reaches its slots", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/windows");
    const res = await b.post("/windows/plan", MORNING);
    expect(flashOf(res.text)).toMatch(/^Added “Morning”\. [5-8] windows ahead from it\.$/);
    expect(res.text).toContain("Mon Tue Wed Thu Fri Sat Sun");
    expect(res.text).toContain("10:00–12:00");
    const plan = await r.db.one(`select id, weekdays, capacity, created_by from delivery_window_plans where name = 'Morning'`);
    expect(plan).toMatchObject({ weekdays: [1, 2, 3, 4, 5, 6, 7], capacity: 5, created_by: lead.partyId });
    const open = await offered();
    expect(open.length).toBeGreaterThan(0);
    expect(open[0]).toMatchObject({ starts: "10:00", ends: "12:00", free: 5 });   // inside a rider shift (B1f; WEB4b 0252: the shifts start at 09:00)
    expect(res.text).toContain(`${open[0].date} 10:00–12:00`);                                // the schedule on the page shows the same window

    // change it: the slots nobody holds are rebuilt with the new capacity
    const after = await b.post("/windows/plan", { ...MORNING, plan: plan.id, capacity: 3 });
    expect(flashOf(after.text)).toMatch(/^Saved “Morning”\./);
    expect((await offered())[0].free).toBe(3);
    expect(Number((await r.db.one(`select count(*) as n from delivery_window_plans`)).n)).toBe(1);   // changed, not added again
  });

  it("refuses a plan that makes no sense, on the page and in the database", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/windows");
    const bad = (f: Record<string, unknown>) => b.post("/windows/plan", { ...MORNING, ...f } as any).then((x) => flashOf(x.text));
    expect(await bad({ starts: "09:00", ends: "08:00" })).toBe("A window must end after it starts.");
    expect(await bad({ fresh_order_by_min: 60, order_by_min: 120 })).toBe("Fresh goods must close at least as early as the rest.");
    expect(await bad({ capacity: -1 })).toBe("capacity is not a valid number.");
    expect(await bad({ capacity: "" })).toBe("Fill in capacity.");
    expect(await bad({ name: "" })).toBe("Write the plan's name.");
    expect(await bad({ starts: "" })).toBe("Fill in starts as a time.");
    expect(await bad({ wd_1: "", wd_2: "", wd_3: "", wd_4: "", wd_5: "", wd_6: "", wd_7: "" })).toBe("Tick at least one day.");
    expect(await bad({ plan: "not-a-uuid" })).toBe("That record is not valid.");
    expect(await bad({ plan: "00000000-0000-4000-8000-000000000000" })).toBe("That plan was not found.");
    expect(Number((await r.db.one(`select count(*) as n from delivery_window_plans`)).n)).toBe(1);
    // the same rules in SQL, whoever calls it
    await expect(r.db.rpc("save_window_plan", { p_by: lead.partyId, p_id: null, p_name: "x1", p_weekdays: ["8"], p_starts: "06:00", p_ends: "07:00", p_capacity: 1 })).rejects.toThrow(/WEEKDAYS_INVALID/);
    await expect(r.db.rpc("save_window_plan", { p_by: lead.partyId, p_id: null, p_name: "x1", p_weekdays: ["x"], p_starts: "06:00", p_ends: "07:00", p_capacity: 1 })).rejects.toThrow(/WEEKDAYS_INVALID/);
    await expect(r.db.rpc("save_window_plan", { p_by: lead.partyId, p_id: null, p_name: "x1", p_weekdays: ["1"], p_starts: "06:00", p_ends: "07:00", p_capacity: 1, p_calendar_kind: "birthday" })).rejects.toThrow(/CALENDAR_KIND_INVALID/);
  });

  it("a zone's own window is offered only to that zone's villages", async () => {
    const admin = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(admin);
    await b.get("/windows");
    const other = await r.db.one(`select z.id from zones z where z.id is distinct from (select zone_id from villages where id = $1) limit 1`, [village]);
    expect(flashOf((await b.post("/windows/plan", { ...MORNING, name: "Other zone only", starts: "13:00", ends: "14:00", zone: other.id })).text)).toMatch(/^Added/);
    const times = (await offered()).map((w) => w.starts);
    expect(times).toContain("10:00");
    expect(times).not.toContain("13:00");
    await r.db.pg.query(`delete from delivery_window_plans where name = 'Other zone only'`);
  });

  it("a calendar date closes the day's windows; removing it brings them back; bad dates are refused", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/windows");
    const d = await tomorrow();
    expect((await offered()).map((w) => w.date)).toContain(d);
    const added = await b.post("/windows/calendar", { kind: "holiday", name: "Test holiday", starts_on: d, ends_on: d, closed: 1, note: "no deliveries" });
    expect(flashOf(added.text)).toBe("Added “Test holiday”.");
    expect(added.text).toContain("Test holiday");
    expect((await offered()).map((w) => w.date)).not.toContain(d);
    expect(flashOf((await b.post("/windows/calendar", { kind: "holiday", name: "Backwards", starts_on: d, ends_on: "2000-01-01" })).text)).toBe("The last day is before the first.");
    expect(flashOf((await b.post("/windows/calendar", { kind: "party", name: "Odd", starts_on: d, ends_on: d })).text)).toBe("Pick the kind.");
    expect(flashOf((await b.post("/windows/calendar", { kind: "holiday", name: "Odd", starts_on: "tomorrow", ends_on: d })).text)).toBe("Fill in starts on as a date.");
    const entry = (await r.db.one(`select id, created_by from delivery_calendar where name = 'Test holiday'`));
    expect(entry.created_by).toBe(lead.partyId);
    // change it into a one-day name change, then remove it
    expect(flashOf((await b.post("/windows/calendar", { entry: entry.id, kind: "holiday", name: "Test holiday (changed)", starts_on: d, ends_on: d, closed: 1 })).text)).toBe("Saved “Test holiday (changed)”.");
    expect(flashOf((await b.post(`/windows/calendar/${entry.id}/remove`)).text)).toBe("Removed from the calendar.");
    expect(flashOf((await b.post(`/windows/calendar/${entry.id}/remove`)).text)).toBe("It was already removed.");
    expect((await offered()).map((w) => w.date)).toContain(d);
  });

  it("one slot's edit: capacity and closing; a closed window is not offered; the edit survives a plan change", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const plan = (await r.db.one(`select id from delivery_window_plans where name = 'Morning'`)).id;
    const [first, second] = await slotsOf(plan);
    const page = (await b.get("/windows")).text;
    expect(page).toContain(`action="/windows/slot/${first.id}"`);
    expect(flashOf((await b.post(`/windows/slot/${first.id}`, { capacity: 1, state: "", note: "small van" })).text)).toBe("Saved: capacity 1, open, 0 held.");
    expect(flashOf((await b.post(`/windows/slot/${second.id}`, { capacity: 3, state: "closed", note: "" })).text)).toBe("Saved: capacity 3, closed, 0 held.");
    const open = await offered();
    expect(open.find((w) => w.slot_id === first.id)).toMatchObject({ free: 1 });
    expect(open.find((w) => w.slot_id === second.id)).toBeUndefined();
    expect(await r.db.one(`select edited_by, note from delivery_slots where id = $1`, [first.id])).toEqual({ edited_by: lead.partyId, note: "small van" });
    // a plan change leaves an edited slot as the person set it
    await b.get("/windows");
    await b.post("/windows/plan", { ...MORNING, plan, capacity: 4 });
    expect((await r.db.one(`select capacity, closed from delivery_slots where id = $1`, [first.id]))).toEqual({ capacity: 1, closed: false });
    expect((await r.db.one(`select capacity, closed from delivery_slots where id = $1`, [second.id]))).toEqual({ capacity: 3, closed: true });
    expect(flashOf((await b.post(`/windows/slot/${first.id}`, { capacity: "abc", state: "" })).text)).toBe("capacity is not a valid number.");
    expect(flashOf((await b.post(`/windows/slot/00000000-0000-4000-8000-000000000000`, { capacity: 2, state: "" })).text)).toBe("That window was not found.");
    await b.post(`/windows/slot/${second.id}`, { capacity: 4, state: "open", note: "" });
  });

  it("moves an order to another window with a reason, tells the customer once if the person writes to them; a full window is refused", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const plan = (await r.db.one(`select id from delivery_window_plans where name = 'Morning'`)).id;
    const [, , c, d, e] = await slotsOf(plan);   // five slots: two days from now and the four after
    await r.db.pg.query(`update delivery_slots set capacity = 2, closed = false where id = any($1::uuid[])`, [[c.id, d.id, e.id]]);
    const o = await scheduled(c.id);
    const page = (await b.get("/windows")).text;
    expect(page).toContain(`/windows/order/${o.id}/reschedule`);
    expect(page).toContain(`<summary>${o.code} <span class="muted">confirmed</span></summary>`);

    expect(flashOf((await b.post(`/windows/order/${o.id}/reschedule`, { slot: d.id, reason: "" })).text)).toBe("Write the reason for the move.");
    expect(await slotOfOrder(o.id)).toBe(c.id);
    const moved = await b.post(`/windows/order/${o.id}/reschedule`, { slot: d.id, reason: "van is late", tell: "مرحبا، نقلنا طلبك إلى موعد آخر", _key: "move-key-0001" });
    expect(flashOf(moved.text)).toMatch(new RegExp(`^${o.code} moved to \\w{3} ${d.d} 10:00–12:00\\. The customer was told\\.$`));
    expect(await slotOfOrder(o.id)).toBe(d.id);
    expect(await r.db.one(`select actor, actor_id, reason from slot_changes where order_id = $1`, [o.id])).toEqual({ actor: "ops", actor_id: lead.partyId, reason: "van is late" });
    const sent = r.kapso.filter((k) => k.url.includes("PN_CUSTOMER") && k.body?.text?.body === "مرحبا، نقلنا طلبك إلى موعد آخر");
    expect(sent).toHaveLength(1);
    expect(r.kapso.some((k) => k.url.includes("PN_OPS") && k.body?.text?.body === "مرحبا، نقلنا طلبك إلى موعد آخر")).toBe(false);      // never from the ops number
    // a second tap on the same window: nothing moves, nothing is sent again
    const again = await b.post(`/windows/order/${o.id}/reschedule`, { slot: d.id, reason: "van is late", tell: "مرحبا، نقلنا طلبك إلى موعد آخر", _key: "move-key-0001" });
    expect(flashOf(again.text)).toBe(`${o.code} is already in that window.`);
    expect(r.kapso.filter((k) => k.body?.text?.body === "مرحبا، نقلنا طلبك إلى موعد آخر")).toHaveLength(1);
    expect(Number((await r.db.one(`select count(*) as n from slot_changes where order_id = $1`, [o.id])).n)).toBe(1);

    // a window with no room is refused: raise its capacity first
    await r.db.pg.query(`update delivery_slots set capacity = 0 where id = $1`, [e.id]);
    expect(flashOf((await b.post(`/windows/order/${o.id}/reschedule`, { slot: e.id, reason: "try" })).text)).toBe("That window is full: raise its capacity first, on purpose.");
    expect(await slotOfOrder(o.id)).toBe(d.id);
    await r.db.pg.query(`update delivery_slots set closed = true, capacity = 2 where id = $1`, [e.id]);
    expect(flashOf((await b.post(`/windows/order/${o.id}/reschedule`, { slot: e.id, reason: "try" })).text)).toBe("That window is closed.");
    // moved with no message: the page says the customer was not told
    expect(flashOf((await b.post(`/windows/order/${o.id}/reschedule`, { slot: c.id, reason: "back again" })).text))
      .toMatch(/The customer was not told: write to them from Exceptions and chats if they should know\.$/);
  });

  it("if the message cannot be sent the order is still moved, and the page says so instead of saying nothing changed", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const plan = (await r.db.one(`select id from delivery_window_plans where name = 'Morning'`)).id;
    const [, , c, d] = await slotsOf(plan);
    await r.db.pg.query(`update delivery_slots set capacity = 3, closed = false where id = any($1::uuid[])`, [[c.id, d.id]]);
    const o = await scheduled(c.id);
    await b.get("/windows");
    const working = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    try {
      const res = await b.post(`/windows/order/${o.id}/reschedule`, { slot: d.id, reason: "van is late", tell: "نقلنا طلبك" });
      expect(flashOf(res.text)).toBe(`${o.code} moved to ${flashOf(res.text).split(" moved to ")[1]!.split(".")[0]}. The customer was not told: the message could not be sent just now. The order itself was changed; tell them another way.`);
    } finally { vi.stubGlobal("fetch", working); }
    expect(await slotOfOrder(o.id)).toBe(d.id);
  });

  it("a message the 24-hour window does not allow is reported, not hidden; cancelling needs a reason and is done once", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const plan = (await r.db.one(`select id from delivery_window_plans where name = 'Morning'`)).id;
    const slot = (await slotsOf(plan))[2];
    await r.db.pg.query(`update delivery_slots set capacity = 3, closed = false where id = $1`, [slot.id]);
    const o = await scheduled(slot.id);
    await r.db.pg.query(`update conversations set last_inbound_at = now() - interval '2 days' where party_id = $1`, [o.customer]);
    await b.get("/windows");
    expect(flashOf((await b.post(`/windows/order/${o.id}/cancel`, { reason: "" })).text)).toBe("Write the reason for cancelling.");
    const sentBefore = r.kapso.length;
    const done = flashOf((await b.post(`/windows/order/${o.id}/cancel`, { reason: "customer phoned", tell: "تم إلغاء الطلب" })).text);
    expect(done).toBe(`${o.code} cancelled. The customer was not told: the 24-hour window is closed, tell them another way.`);
    expect(r.kapso.length).toBe(sentBefore);
    expect((await r.db.one(`select status from orders where id = $1`, [o.id])).status).toBe("cancelled");
    expect(Number((await r.db.one(`select count(*) as n from slot_holds where order_id = $1`, [o.id])).n)).toBe(0);
    expect(flashOf((await b.post(`/windows/order/${o.id}/cancel`, { reason: "customer phoned" })).text)).toBe(`${o.code} was already cancelled.`);
  });

  it("pickers are refused by the page and by the database; every change is in the action log with who made it", async () => {
    const picker = await r.staff("picker", "Pia");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/windows")).status).toBe(403);
    expect((await p.get("/")).text).not.toContain('href="/windows"');
    expect((await p.post("/windows/plan", MORNING, { follow: false })).status).toBe(403);
    const plan = (await r.db.one(`select id from delivery_window_plans where name = 'Morning'`)).id;
    const slot = (await slotsOf(plan))[0];
    await expect(r.db.rpc("save_window_plan", { p_by: picker.partyId, p_id: null, p_name: "Picker's", p_weekdays: ["1"], p_starts: "06:00", p_ends: "07:00", p_capacity: 1 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("save_calendar_entry", { p_by: picker.partyId, p_id: null, p_kind: "holiday", p_name: "Picker's", p_starts_on: "2027-01-01", p_ends_on: "2027-01-01" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("remove_calendar_entry", { p_by: picker.partyId, p_id: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("edit_delivery_slot", { p_slot: slot.id, p_by: picker.partyId, p_capacity: 99 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("save_window_plan", { p_by: null, p_id: null, p_name: "Nobody", p_weekdays: ["1"], p_starts: "06:00", p_ends: "07:00", p_capacity: 1 })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(Number((await r.db.one(`select count(*) as n from delivery_window_plans where name like 'Picker%' or name = 'Nobody'`)).n)).toBe(0);

    const log = (await r.actions()).filter((a) => /^(window_|calendar_|slot_|order_)/.test(a.action));
    expect(new Set(log.map((a) => a.action))).toEqual(new Set(["window_plan_add", "window_plan_change", "calendar_add", "calendar_change", "calendar_remove", "slot_edit", "order_reschedule", "order_cancel_scheduled"]));
    expect(log.every((a) => a.party_id !== null && a.role === "ops_lead" || a.role === "admin")).toBe(true);
    // what a person wrote to a customer is never in the log: only its length
    expect(JSON.stringify(log)).not.toContain("نقلنا طلبك");
    expect(log.find((a) => a.action === "order_reschedule" && a.phase === "intent" && a.args.told > 0)).toBeTruthy();
  });
});
