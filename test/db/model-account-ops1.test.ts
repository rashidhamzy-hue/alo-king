// OPS1, item 7, on the real schema (0140): the model_account exception. One open exception per reason; pushed at once;
// neither the push nor the WhatsApp ops alert repeats it more often than every 30 minutes; resolved when the model works again.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
const ago = (min: number) => `now() - interval '${min} minutes'`;
const claim = async (kind = "model_account") => (await db.all(`select id, kind, ref from claim_alert_pushes()`)).filter((x) => x.kind === kind);
const due = async () => (await db.all(`select id, kind from ops_exceptions_due()`));

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);

describe("model_account: one kind for refusals about the account", () => {
  it("opens once per reason, however many calls are refused, and counts them", async () => {
    const a = await db.rpc("raise_model_account", { p_reason: "usage_limit", p_detail: { message: "You have reached your specified API usage limits." } });
    const b = await db.rpc("raise_model_account", { p_reason: "usage_limit", p_detail: {} });
    expect(b).toBe(a);
    const row = await db.one(`select kind, ref, status, detail from ops_exceptions where id = $1`, [a]);
    expect(row).toMatchObject({ kind: "model_account", ref: "usage_limit", status: "open" });
    expect(row.detail).toMatchObject({ reason: "usage_limit", refusals: 2 });
    const other = await db.rpc("raise_model_account", { p_reason: "billing", p_detail: {} });
    expect(other).not.toBe(a);
    await expect(db.rpc("raise_model_account", { p_reason: "banana", p_detail: {} })).rejects.toThrow(/UNKNOWN_REASON/);
    await db.pg.exec(`update ops_exceptions set status = 'resolved' where ref = 'billing'`);
  });

  it("is high priority: pushed at once, and not again for 30 minutes", async () => {
    const first = await claim();
    expect(first.map((x) => x.kind)).toEqual(["model_account"]);
    expect(await claim()).toEqual([]);                                             // the next minute: nothing
    await db.pg.exec(`update exception_pushes set last_pushed_at = ${ago(29)}`);
    expect(await claim()).toEqual([]);                                             // 29 minutes: still nothing
    await db.pg.exec(`update exception_pushes set last_pushed_at = ${ago(31)}`);
    expect((await claim()).map((x) => x.kind)).toEqual(["model_account"]);        // 31 minutes: again
    expect(await claim()).toEqual([]);
    expect((await db.one(`select pushes from exception_pushes`)).pushes).toBe(2);
  });

  it("the WhatsApp ops alert follows the same 30 minutes, while another kind keeps its ten", async () => {
    await db.pg.exec(`update ops_exceptions set last_alert_at = null`);
    await db.rpc("raise_ops_exception", { p_kind: "turn_failed", p_ref: "t1", p_detail: {} });
    expect((await due()).map((x) => x.kind).sort()).toEqual(["model_account", "turn_failed"]);
    expect(await due()).toEqual([]);
    await db.pg.exec(`update ops_exceptions set last_alert_at = ${ago(11)}`);
    expect((await due()).map((x) => x.kind)).toEqual(["turn_failed"]);              // ten minutes for the old kind
    await db.pg.exec(`update ops_exceptions set last_alert_at = ${ago(31)} where kind = 'model_account'`);
    expect((await due()).map((x) => x.kind)).toEqual(["model_account"]);
  });

  it("someone who has seen it keeps the page quiet: acknowledged is not pushed or alerted again", async () => {
    await db.pg.exec(`update ops_exceptions set status = 'acknowledged' where kind = 'model_account' and ref = 'usage_limit'; update exception_pushes set last_pushed_at = ${ago(90)}`);
    expect(await claim()).toEqual([]);
    expect((await due()).filter((x) => x.kind === "model_account")).toEqual([]);
    await db.pg.exec(`update ops_exceptions set status = 'open' where kind = 'model_account' and ref = 'usage_limit'`);
  });

  it("an old exception that was never pushed (push was off) is still pushed, because it is still open", async () => {
    await db.pg.exec(`delete from exception_pushes; update ops_exceptions set created_at = ${ago(600)} where kind = 'model_account'`);
    expect((await claim()).map((x) => x.kind)).toEqual(["model_account"]);
    // while a plain old exception of another kind is not announced a day late
    await db.rpc("raise_ops_exception", { p_kind: "pick_empty", p_ref: "p1", p_detail: {} });
    await db.pg.exec(`update ops_exceptions set created_at = ${ago(600)} where kind = 'pick_empty'`);
    expect(await claim("pick_empty")).toEqual([]);
  });

  it("is resolved by the cron only after the model has worked again", async () => {
    await db.pg.exec(`update ops_exceptions set detail = detail || jsonb_build_object('last_refused_at', now()) where kind = 'model_account'`);
    expect(await db.rpc("resolve_model_account")).toBe(0);                          // nothing since the refusal
    await db.pg.exec(`insert into agent_runs(agent, model, input_tokens, output_tokens, outcome, created_at) values ('concierge', 'm', 0, 0, 'ok', now() + interval '1 minute')`);
    expect(await db.rpc("resolve_model_account")).toBe(0);                          // a run that never called the model does not count
    await db.pg.exec(`insert into agent_runs(agent, model, input_tokens, output_tokens, outcome, created_at) values ('concierge', 'm', 900, 40, 'handoff', now() + interval '1 minute')`);
    expect(await db.rpc("resolve_model_account")).toBe(0);                          // nor one that ended in a hand-off
    await db.pg.exec(`insert into agent_runs(agent, model, input_tokens, output_tokens, outcome, created_at) values ('concierge', 'm', 900, 40, 'ok', now() + interval '1 minute')`);
    expect(await db.rpc("resolve_model_account")).toBe(1);
    expect(await db.one(`select status, detail->>'cleared_by' by from ops_exceptions where kind = 'model_account' and ref = 'usage_limit'`)).toEqual({ status: "resolved", by: "model_ok" });
    // and a new refusal opens a fresh one, pushed again at once
    await db.rpc("raise_model_account", { p_reason: "usage_limit", p_detail: {} });
    expect((await claim()).map((x) => x.kind)).toEqual(["model_account"]);
  });

  it("the old once-only claim of 0158 still works as it did", async () => {
    // either migration order ends with both functions
    expect((await db.all(`select proname from pg_proc where proname in ('claim_exception_pushes', 'claim_alert_pushes') order by 1`)).map((r) => r.proname)).toEqual(["claim_alert_pushes", "claim_exception_pushes"]);
    expect((await db.one(`select value->'high_priority_kinds' @> '"model_account"' as ok from settings where key = 'push_alerts'`)).ok).toBe(true);
  });
});

import { exceptionAlertText } from "../../apps/gateway/src/index";
describe("what ops reads", () => {
  it("the model account alert says nothing is answering customers and carries the provider's own words and date", () => {
    const t = exceptionAlertText({ id: "x", kind: "model_account", ref: "usage_limit", detail: { message: "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC." } });
    expect(t).toContain("وصلنا حدّ الاستخدام");
    expect(t).toContain("2026-12-01");
    expect(exceptionAlertText({ id: "y", kind: "turn_failed", ref: "abc" })).toBe("🧯 حالة مفتوحة بحاجة لشخص: turn_failed (abc)");
  });
});
