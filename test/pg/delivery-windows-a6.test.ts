// Session A6: supabase/seed/delivery_windows.sql, loaded by scripts/ci/load-seeds.sh on a real Postgres the way a deploy loads it.
// The founder's four windows a day and the 2026-2027 calendar load once; open_delivery_windows offers the windows for tomorrow and a
// closed date offers none; a later edit on /windows survives every later deploy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg, sql: postgres.Sql;
const seeds = () => execFileSync("bash", ["scripts/ci/load-seeds.sh"], { cwd: repo, env: { ...process.env, DATABASE_URL: pg.url }, stdio: "pipe" }).toString();
const slots = async (day: string) => (await sql`select to_char(starts, 'HH24:MI') s, to_char(ends, 'HH24:MI') e, capacity, order_by_min, fresh_order_by_min from window_plans_for(${day}::date) order by starts`);

run("delivery_windows seed", () => {
  beforeAll(async () => { pg = await startRealPostgres({ seeds: false }); sql = pg.connect(2); }, 180_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); }, 30_000);

  it("loads once: four windows on every weekday and every zone, 4 orders each, the founder's cut-offs", async () => {
    const first = seeds();
    expect(first).toContain("seed delivery_windows");
    const plans = await sql`select weekdays, to_char(starts, 'HH24:MI') s, to_char(ends, 'HH24:MI') e, capacity, order_by_min, fresh_order_by_min, calendar_kind, zone_id, active
                              from delivery_window_plans order by starts`;
    expect(plans.map((p) => [p.s, p.e, p.capacity, p.order_by_min, p.fresh_order_by_min])).toEqual([
      ["09:00", "11:00", 4, 60, 720], ["12:00", "14:00", 4, 60, 240], ["16:00", "18:00", 4, 60, 240], ["19:00", "21:00", 4, 60, 240]]);
    for (const p of plans) expect([p.weekdays, p.calendar_kind, p.zone_id, p.active]).toEqual([[1, 2, 3, 4, 5, 6, 7], null, null, true]);
    expect(first).toMatch(/window plans: 4, calendar entries: \d+ \(closed: 6\)/);
  });

  it("the calendar: the founder's closed days, the labels, every row with a source note, nothing after 31 December 2027", async () => {
    const closed = await sql`select to_char(starts_on, 'YYYY-MM-DD') d, name from delivery_calendar where closed order by starts_on`;
    expect(closed.map((r) => r.d)).toEqual(["2026-12-25", "2027-01-01", "2027-03-28", "2027-05-02", "2027-05-16", "2027-12-25"].sort());
    const [k] = await sql`select count(*) filter (where kind = 'lent' and not closed)::int lent, count(*) filter (where kind = 'ramadan' and not closed)::int ramadan,
                                 count(*) filter (where kind = 'holiday' and not closed)::int holidays,
                                 count(*) filter (where note is null or length(note) < 20)::int no_note,
                                 count(*) filter (where ends_on > date '2027-12-31' or starts_on < date '2026-11-14')::int out_of_range from delivery_calendar`;
    expect(k).toMatchObject({ lent: 2, ramadan: 1, no_note: 0, out_of_range: 0 });
    expect(k!.holidays).toBeGreaterThan(15);
    const lent = await sql`select to_char(starts_on, 'YYYY-MM-DD') a, to_char(ends_on, 'YYYY-MM-DD') b from delivery_calendar where kind = 'lent' order by starts_on`;
    expect(lent.map((r) => [r.a, r.b])).toEqual([["2027-02-10", "2027-03-27"], ["2027-03-15", "2027-05-01"]]);
    // every Islamic date and the Eids say they are expected
    const unsure = await sql`select count(*)::int n from delivery_calendar where (name ~ 'Eid|Ramadan|Hijri|Ashoura|Mawlid') and note !~ 'confirm when the decree is published'`;
    expect(unsure[0]!.n).toBe(0);
  });

  it("a closed date has no windows, a day in Lent, Ramadan or a holiday keeps the four windows (the labels have no plan of their own)", async () => {
    for (const d of ["2026-12-25", "2027-01-01", "2027-03-28", "2027-05-02", "2027-05-16", "2027-12-25"]) expect(await slots(d), d).toEqual([]);
    for (const d of ["2026-12-26", "2027-02-10", "2027-02-20", "2027-03-15", "2027-03-25", "2027-05-17", "2027-12-24"]) expect((await slots(d)).map((r) => r.s), d).toEqual(["09:00", "12:00", "16:00", "19:00"]);
  });

  it("open_delivery_windows offers tomorrow's windows (none when tomorrow is a closed date), never a window of a closed date", async () => {
    const [t] = await sql`select ((now() at time zone scheduling_tz())::date + 1) as tomorrow, to_char((now() at time zone scheduling_tz())::date + 1, 'YYYY-MM-DD') as d`;
    const [c] = await sql`select exists (select 1 from delivery_calendar where closed and ${t!.d}::date between starts_on and ends_on) as closed`;
    const w = (await sql`select jsonb_array_elements(open_delivery_windows(null, false, 100)) as w`).map((r) => r.w as { date: string; starts: string });
    const tomorrow = w.filter((x) => x.date === t!.d).map((x) => x.starts);
    expect(tomorrow).toEqual(c!.closed ? [] : ["09:00", "12:00", "16:00", "19:00"]);
    const closedDays = new Set((await sql`select to_char(d, 'YYYY-MM-DD') d from delivery_calendar c, generate_series(starts_on, ends_on, '1 day') d where closed`).map((r) => r.d as string));
    expect(w.filter((x) => closedDays.has(x.date))).toEqual([]);
  });

  it("a later edit on /windows is never put back: a changed capacity and a removed day survive two more deploys", async () => {
    await sql`update delivery_window_plans set capacity = 9 where starts = '12:00'`;
    await sql`delete from delivery_calendar where name = 'Christmas Day 2026'`;
    const second = seeds(), third = seeds();
    expect(second).toContain("seed delivery_windows skipped");
    expect(third).toContain("seed delivery_windows skipped");
    expect((await slots("2026-12-25")).length).toBe(4);
    expect((await slots("2026-12-26")).map((r) => r.capacity)).toEqual([4, 9, 4, 4]);
    expect((await sql`select count(*)::int n from delivery_window_plans`)[0]!.n).toBe(4);
  });

  it("a database where a person already entered windows is not doubled when the marker is missing", async () => {
    await sql`delete from settings where key = 'seed_applied:delivery_windows'`;
    expect(seeds()).toContain("seed delivery_windows (");
    expect((await sql`select count(*)::int n from delivery_window_plans`)[0]!.n).toBe(4);
    expect((await sql`select count(*)::int n from delivery_calendar where name = 'Christmas Day 2026'`)[0]!.n).toBe(1);   // only the missing row came back
    expect((await slots("2026-12-26")).map((r) => r.capacity)).toEqual([4, 9, 4, 4]);
  });
});
