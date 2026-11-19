// AST1: the console assistant's read-only tools (0261) and its digest, settings, cost and log (0262), against the invented day of
// evals/assistant/world.ts. And the proof that "read-only" is enforced by Postgres, not promised: every assistant_* function belongs to
// assistant_reader, which holds SELECT only, and a write as that role is refused.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { DAY, NOW, seedWorld } from "../../evals/assistant/world";

let db: TestDb;
const now = NOW.toISOString();
beforeAll(async () => { db = await openTestDb(); await seedWorld(db); }, 120_000);

describe("the tools answer from the data (0261)", () => {
  it("orders: counts, the late ones against their promise, and the slowest stage", async () => {
    const o = await db.rpc("assistant_orders", { p_day: DAY, p_now: now });
    expect(o).toMatchObject({ orders: 7, cancelled: 2, grocery: 5, food: 2, delivered: 5, delivered_on_time: 2, delivered_late: 3, late_now: 1, late_total: 4,
      test_orders_left_out: 1, waiting_for_confirm_tap: 1, now: "15:00" });
    const late = Object.fromEntries((o.late as any[]).map((x) => [x.code, x]));
    expect(late["AK-2006"]).toMatchObject({ minutes_late: 30, still_open: true, slowest_stage: "ride", promised: "14:30" });
    expect(late["AK-2002"]).toMatchObject({ minutes_late: 22, slowest_stage: "picking", stages_min: { picking: 35 } });
    expect(late["AK-2003"]).toMatchObject({ minutes_late: 20, slowest_stage: "waiting_for_rider" });
    expect(late["AK-2004"]).toMatchObject({ minutes_late: 10, slowest_stage: "restaurant", place: "Test Grill", stages_min: { place_answer: 22 } });
    expect(o.late.map((x: any) => x.code)).not.toContain("PRB-77");            // a test order is never counted
    expect(JSON.stringify(o)).not.toMatch(/subtotal|total_usd|sales/);         // no money in the orders tool (an ops lead reads it)
  });
  it("food places: answer times, refusals, closures, prices to confirm", async () => {
    const p = await db.rpc("assistant_places", { p_day: DAY, p_now: now });
    expect(p).toMatchObject({ slowest_place: "Test Grill", slowest_place_avg_answer_min: 22, calls: 3, accepted: 2, closed_today: ["Test Grill"], prices_to_confirm: 2 });
    const grill = p.places.find((x: any) => x.place === "Test Grill");
    expect(grill).toMatchObject({ calls: 2, accepted: 1, refused_closed: 1, closed_today: true });
  });
  it("riders: on shift, cash against the caps, late pickups", async () => {
    const r = await db.rpc("assistant_riders", { p_day: DAY, p_now: now });
    expect(r).toMatchObject({ on_shift: 2, over_hard_cap: 1, late_pickups_total: 1, cash_cap_soft_usd: 100, cash_cap_hard_usd: 150 });
    const rami = r.riders.find((x: any) => x.rider === "Rami Test");
    expect(rami).toMatchObject({ cash_usd: 120, cash_and_pending_usd: 152, cap_state: "over_hard_cap", deliveries_today: 3, shift_started: "09:00", late_pickups: [{ code: "AK-2003", wait_min: 35 }] });
  });
  it("stock: out, low, expiring, receiving, the fridge log", async () => {
    const s = await db.rpc("assistant_stock", { p_now: now });
    expect(s).toMatchObject({ out_of_stock: 2, low: 1, expired: 1, expiring: 1, receiving_short_units: 4, receiving_damaged_units: 1, temperature_missed_last_7_days: 1 });
    expect(s.temperature_missed).toEqual([{ day: "2026-11-17", zone: "chilled", slot: "evening", due_by: "20:00" }]);
    expect(s.temperature_out_of_range).toEqual([{ day: DAY, zone: "chilled", reading_c: 7.2 }]);
  });
  it("products: not sellable and why, searches that found nothing", async () => {
    const p = await db.rpc("assistant_products", { p_now: now, p_days: 7, p_limit: 5 });
    expect(p.active).toBe(291);
    expect(p.not_sellable).toBe(p.active - p.sellable);
    expect(p.not_sellable_list).toHaveLength(5);
    expect(p.searches_found_nothing[0]).toMatchObject({ said: "protein bars", asks: 3, customers: 2 });
  });
  it("customers: hand-offs, complaints, honest answers, feedback; phones masked", async () => {
    const c = await db.rpc("assistant_customers", { p_day: DAY, p_now: now });
    expect(c).toMatchObject({ handoffs: 2, handoffs_open_now: 1, handoffs_late_now: 1, complaints: 1, feedback_fine: 2, feedback_problem: 1, avg_first_reply_min: 4 });
    expect(c.complaints_open[0]).toMatchObject({ order: "AK-2002", kind: "late", customer: "•••12" });
    expect(JSON.stringify(c)).not.toMatch(/\+?96170000\d{3}|invented detail/);   // no phone in full, never the customer's own words
  });
  it("approvals waiting by kind; money and model spend (the console offers these two to the admin only)", async () => {
    const a = await db.rpc("assistant_approvals", { p_now: now });
    expect(a.waiting).toMatchObject({ names: 282, dishes: 2, refunds: 1 });
    const m = await db.rpc("assistant_money", { p_day: DAY, p_now: now });
    expect(m).toMatchObject({ sales_goods_usd: 101, cash_to_collect_usd: 42, cash_to_collect_orders: 2, delivery_fees_for_riders_usd: 14, cash_held_by_riders_usd: 120, ledger_unbalanced_transactions_30_days: 0 });
    const s = await db.rpc("assistant_model_spend", { p_now: now });
    expect(s).toMatchObject({ workflows_total_usd: 0.5286, workflows_usd: { "sim-test": 0.4, assistant: 0.12, "menu-read": 0.0086 }, sim_test_monthly_cap_usd: 55 });
  });
});

describe("read-only, enforced by Postgres", () => {
  it("every assistant_* function belongs to assistant_reader, runs as its owner with a fixed path, and only the service role may call it", async () => {
    const fns = await db.all<any>(`select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg
                                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'assistant\\_%'`);
    expect(fns.length).toBeGreaterThanOrEqual(16);
    for (const f of fns) {
      expect(f.owner, f.proname).toBe("assistant_reader");
      expect(f.prosecdef, f.proname).toBe(true);
      expect(f.provolatile, f.proname).toBe("s");
      expect(f.cfg, f.proname).toMatch(/search_path=public, pg_temp/);
    }
  });
  it("assistant_reader holds no write privilege anywhere and no attribute", async () => {
    const w = await db.one<any>(`select count(*)::int as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m')
      and (has_table_privilege('assistant_reader', c.oid, 'insert') or has_table_privilege('assistant_reader', c.oid, 'update')
        or has_table_privilege('assistant_reader', c.oid, 'delete') or has_table_privilege('assistant_reader', c.oid, 'truncate'))`);
    expect(w.n).toBe(0);
    const r = await db.one<any>(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles where rolname = 'assistant_reader'`);
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false });
    const create = await db.one<any>(`select has_schema_privilege('assistant_reader', 'public', 'create') as c`);
    expect(create.c).toBe(false);
  });
  it("a write as assistant_reader is refused: an order, a payment, stock, the ledger, a setting", async () => {
    for (const sql of [`update orders set status = 'cancelled'`, `delete from payments`, `update stock_levels set on_hand = 0`,
                       `insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv) values (gen_random_uuid(), gen_random_uuid(), 1, 'USD', 1)`,
                       `update settings set value = '{}' where key = 'assistant'`, `select ast_turn_log(null, 'admin', 'en', 'q', 'a', '[]', null, 0, 'answered')`]) {
      await db.pg.exec("set role assistant_reader");
      try { await expect(db.pg.query(sql), sql).rejects.toThrow(/permission denied/); }
      finally { await db.pg.exec("reset role"); }
    }
  });
  it("a function written to write, given to assistant_reader, cannot (the ownership is the guard)", async () => {
    await db.pg.exec(`create function assistant_try_write() returns int language sql security definer set search_path = public, pg_temp as $$ update orders set cancel_reason = 'x'; select 1 $$`);
    await db.pg.exec(`alter function assistant_try_write() owner to assistant_reader`);
    await expect(db.pg.query(`select assistant_try_write()`)).rejects.toThrow(/permission denied/);
    await db.pg.exec(`drop function assistant_try_write()`);
  });
});

describe("digest, settings, cost and log (0262)", () => {
  it("settings.assistant: off by default here, caps 0.50 a day and 10 a month, editable on the Settings page", async () => {
    const s = await db.rpc("ast_spend", { p_now: now });
    expect(s).toMatchObject({ daily_cap_usd: 0.5, monthly_cap_usd: 10, model: "claude-sonnet-5-5", digest_model: "claude-haiku-5-5", max_tool_rounds: 4 });
    const fields = await db.all<any>(`select field from editable_settings where key = 'assistant' order by field`);
    expect(fields.map((f) => f.field)).toEqual(["daily_cap_usd", "enabled", "monthly_cap_usd"]);
  });
  it("a call is priced from model_prices and counted against the caps; over a cap, no more", async () => {
    await db.pg.exec(`update settings set value = value || '{"enabled": true, "daily_cap_usd": 0.02}'::jsonb where key = 'assistant'`);
    try {
      const usd = Number(await db.rpc("ast_record_cost", { p_workflow: "assistant", p_model: "claude-sonnet-5-5", p_step: "answer", p_in: 1000, p_out: 500, p_cache_read: 10000, p_cache_write: 2000 }));
      expect(usd).toBeCloseTo((1000 * 2 + 500 * 10 + 10000 * 0.1 + 2000 * 2.5) / 1e6, 6);
      const s1 = await db.rpc("ast_spend", {});
      expect(s1).toMatchObject({ allowed: true, enabled: true });
      await db.rpc("ast_record_cost", { p_workflow: "assistant", p_model: "claude-sonnet-5-5", p_step: "answer", p_in: 5000, p_out: 1000, p_cache_read: 0, p_cache_write: 0 });
      expect(await db.rpc("ast_spend", {})).toMatchObject({ allowed: false, reason: "daily_cap" });
      await expect(db.rpc("ast_record_cost", { p_workflow: "assistant", p_model: "no-such-model", p_step: "x", p_in: 1, p_out: 1, p_cache_read: 0, p_cache_write: 0 })).rejects.toThrow(/NO_PRICE/);
      await expect(db.rpc("ast_record_cost", { p_workflow: "language-pack", p_model: "claude-sonnet-5-5", p_step: "x", p_in: 1, p_out: 1, p_cache_read: 0, p_cache_write: 0 })).rejects.toThrow(/AST_WORKFLOW/);
    } finally {
      await db.pg.exec(`update settings set value = value || '{"enabled": false, "daily_cap_usd": 0.5}'::jsonb where key = 'assistant'; delete from model_costs where workflow = 'assistant' and run_id <> '2026-11-17'`);
    }
  });
  it("the digest's facts come from the tools; the candidates to fix are in a fixed order, each with its figure and page", async () => {
    const f = await db.rpc("assistant_digest_facts", { p_day: DAY, p_now: now });
    expect(f.orders).toMatchObject({ orders: 7, late_total: 4 });
    expect(f.fix_candidates.map((x: any) => x.what).slice(0, 4)).toEqual(["late orders", "slow food place", "temperature readings missed", "expired lots on the shelf"]);
    expect(f.fix_candidates[1]).toMatchObject({ place: "Test Grill", avg_answer_min: 22, page: "/food" });
    expect(JSON.stringify(f)).not.toMatch(/sales|subtotal/);                  // the digest is shown to ops leads: no money totals
    const d = await db.rpc("assistant_digests", { p_from: "2026-11-12", p_to: DAY, p_now: now });
    expect(d.digests.map((x: any) => x.day)).toEqual(["2026-11-17"]);
    const none = await db.rpc("assistant_digests", { p_from: "2026-10-01", p_to: "2026-10-07", p_now: now });
    expect(none.note).toBe("no digest was written for these days");
  });
  it("the assistant's log keeps the question, the answer, the tools and the cost; a person's own recent turns come back", async () => {
    const party = (await db.one<any>(`select id from parties where display_name = 'Lead Test'`)).id;
    await db.rpc("ast_turn_log", { p_party: party, p_role: "ops_lead", p_lang: "en", p_question: "What's late?", p_answer: "AK-2006", p_tools: [{ name: "orders" }], p_model: "claude-sonnet-5-5", p_usd: 0.012, p_outcome: "answered" });
    const t = await db.rpc("ast_turns_recent", { p_party: party, p_limit: 5 });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ question: "What's late?", answer: "AK-2006", outcome: "answered" });
  });
});
