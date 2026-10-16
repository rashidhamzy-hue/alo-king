import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { handleOpsSlack, runAction, verifySlack, type OpsSlackDeps } from "./handler";

const SECRET = "test-signing-secret";
const NOW = 1_760_000_000;
const sign = (body: string, ts = String(NOW)) =>
  `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;
const req = (
  body: string,
  type = "application/x-www-form-urlencoded",
  headers: Record<string, string> = {},
) =>
  new Request("https://x/functions/v1/ops-slack", {
    method: "POST",
    headers: {
      "content-type": type,
      "x-slack-request-timestamp": String(NOW),
      "x-slack-signature": sign(body),
      ...headers,
    },
    body,
  });
const OP = "00000000-0000-0000-0000-00000000000b";

function deps(rpcs: Record<string, (a: any) => any> = {}, modal = true) {
  const calls: { fn: string; args: any }[] = [];
  const modals: any[] = [];
  const d: OpsSlackDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "ops_operator")
        return args.p_slack_user_id === "U0OPERATOR"
          ? { user_id: OP, role: "operator", name: "Op" }
          : null;
      return rpcs[fn]?.(args) ?? null;
    },
    signingSecret: SECRET,
    openModal: modal ? async (_t, v) => (modals.push(v), true) : null,
    now: () => NOW * 1000,
  };
  return { d, calls, modals, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}
const slash = (text: string, user = "U0OPERATOR") =>
  new URLSearchParams({ command: "/ak", text, user_id: user, trigger_id: "trig.1" }).toString();

describe("Slack request signature (DECISIONS §32.1)", () => {
  it("accepts Slack's v0 signature and refuses a wrong, missing or stale one", async () => {
    expect(await verifySlack(SECRET, String(NOW), sign("a=1"), "a=1", NOW)).toBe(true);
    expect(await verifySlack(SECRET, String(NOW), sign("a=2"), "a=1", NOW)).toBe(false);
    expect(await verifySlack(SECRET, null, sign("a=1"), "a=1", NOW)).toBe(false);
    expect(
      await verifySlack(SECRET, String(NOW - 400), sign("a=1", String(NOW - 400)), "a=1", NOW),
    ).toBe(false);
  });
  it("an unsigned request, or no signing secret configured, gets 401 and touches nothing", async () => {
    const h = deps();
    const r = await handleOpsSlack(
      h.d,
      new Request("https://x", { method: "POST", body: slash("finance") }),
    );
    expect(r.status).toBe(401);
    const n = deps();
    expect(
      (await handleOpsSlack({ ...n.d, signingSecret: null }, req(slash("finance")))).status,
    ).toBe(401);
    expect(h.calls.length + n.calls.length).toBe(0);
  });
});

describe("/ak commands", () => {
  it("a Slack user who is not an operator gets nothing", async () => {
    const h = deps({ ops_finance: () => ({}) });
    const r = await handleOpsSlack(h.d, req(slash("finance", "U0STRANGER")));
    expect((await r.json()).text).toMatch(/not an Alo King operator/);
    expect(h.of("ops_finance")).toHaveLength(0);
  });
  it("order: lifecycle for the operator, through the server function with the operator's id", async () => {
    const h = deps({
      ops_order: () => ({
        status: "ok",
        code: "AB3CD9",
        order_status: "accepted",
        vendor: "V",
        fulfilment: "delivery",
        payment: "cod",
        total_usd: 12.5,
        total_lbp: 1118750,
        events: [{ at: "2026-10-15T10:00:00Z", from: null, to: "placed", by: "customer" }],
        exceptions: [],
      }),
    });
    const r = await (await handleOpsSlack(h.d, req(slash("order ab3cd9")))).json();
    expect(r.response_type).toBe("ephemeral");
    expect(r.text).toMatch(/#AB3CD9\* accepted · V · delivery · cod · \$12.50 \/ 1,118,750 LBP/);
    expect(h.of("ops_order")[0].args).toEqual({ p_actor_id: OP, p_code: "ab3cd9" });
  });
  it("refund always opens a confirm modal with the exact effect; nothing is booked before Confirm", async () => {
    const h = deps();
    const r = await handleOpsSlack(h.d, req(slash("refund AB3CD9 5")));
    expect(r.status).toBe(200);
    expect(h.modals[0].blocks[0].text.text).toMatch(/\$5.00\*.*#AB3CD9/);
    expect(h.modals[0].blocks[0].text.text).toMatch(/Paid by \*Alo King\*/);
    expect(JSON.parse(h.modals[0].private_metadata)).toEqual({
      do: "refund",
      code: "AB3CD9",
      amount: 5,
      payer: "alo_king",
    });
    expect(h.of("ops_refund")).toHaveLength(0);
    // "shop": the shop caused it and pays (§20.1).
    await handleOpsSlack(h.d, req(slash("refund AB3CD9 5 shop")));
    expect(h.modals[1].blocks[0].text.text).toMatch(/Paid by \*the shop\*/);
    expect(JSON.parse(h.modals[1].private_metadata).payer).toBe("merchant");
  });
  it("a credit confirmed twice (Slack retries a slow submit) is keyed by the modal's view id", async () => {
    const h = deps({ ops_credit: () => ({ status: "credited", amount_usd: 30 }) });
    const payload = {
      type: "view_submission",
      user: { id: "U0OPERATOR" },
      view: {
        id: "V0MODAL1",
        callback_id: "ak_confirm",
        private_metadata: JSON.stringify({
          do: "credit",
          vendor_id: "v1",
          name: "Grill",
          amount: 30,
          reason: "launch",
        }),
      },
    };
    await handleOpsSlack(
      h.d,
      req(new URLSearchParams({ payload: JSON.stringify(payload) }).toString()),
    );
    expect(h.of("ops_credit")[0].args.p_key).toBe("V0MODAL1");
  });
  it("the modal's Confirm runs it, and a server refusal is shown in the server's words", async () => {
    const h = deps({
      ops_refund: () => {
        throw new Error("ERROR:  not allowed: only the admin");
      },
    });
    const payload = {
      type: "view_submission",
      user: { id: "U0OPERATOR" },
      view: {
        callback_id: "ak_confirm",
        private_metadata: JSON.stringify({ do: "refund", code: "AB3CD9", amount: 25 }),
      },
    };
    const r = await (
      await handleOpsSlack(
        h.d,
        req(new URLSearchParams({ payload: JSON.stringify(payload) }).toString()),
      )
    ).json();
    expect(r.view.blocks[0].text.text).toBe("⚠️ Refused: not allowed: only the admin");
    expect(h.of("ops_refund")[0].args).toMatchObject({
      p_actor_id: OP,
      p_code: "AB3CD9",
      p_amount_usd: 25,
    });
  });
  it("a small merchant credit runs at once; above the limit it confirms first", async () => {
    const h = deps({
      ops_merchant: () => [{ vendor_id: "v1", name: "Grill" }],
      config_value: () => 20,
      ops_credit: (a) => ({ status: "credited", amount_usd: a.p_amount_usd }),
    });
    const small = await (
      await handleOpsSlack(h.d, req(slash("credit grill 5 late payout")))
    ).json();
    expect(small.text).toMatch(/\$5.00 Alo King Credit for Grill/);
    await handleOpsSlack(h.d, req(slash("credit grill 50 launch compensation")));
    expect(h.modals).toHaveLength(1);
    expect(h.of("ops_credit")).toHaveLength(1);
  });
  it("broadcast pause is the kill switch", async () => {
    const h = deps();
    const r = await (await handleOpsSlack(h.d, req(slash("broadcast pause")))).json();
    expect(r.text).toMatch(/Broadcasts are off/);
    expect(h.of("broadcasts_pause")[0].args).toEqual({ p_actor_id: OP });
  });
  it("anything else gets the help", async () => {
    const h = deps();
    expect((await (await handleOpsSlack(h.d, req(slash("")))).json()).text).toMatch(
      /\/ak\* commands/,
    );
  });
});

describe("buttons and thread replies", () => {
  it("Resolve on a case thread resolves it as the operator", async () => {
    const h = deps({ support_resolve: () => ({ status: "resolved" }) });
    const payload = {
      type: "block_actions",
      user: { id: "U0OPERATOR" },
      actions: [{ action_id: "case_resolve", value: "c-1" }],
    };
    const r = await (
      await handleOpsSlack(
        h.d,
        req(new URLSearchParams({ payload: JSON.stringify(payload) }).toString()),
      )
    ).json();
    expect(r.text).toMatch(/Resolved/);
    expect(h.of("support_resolve")[0].args).toEqual({ p_case_id: "c-1", p_actor_id: OP });
  });
  it("a reply in a #support thread goes to the customer through support_reply, keyed by Slack's event_id; bots and edits do not", async () => {
    const h = deps({
      support_case_for_thread: () => "c-1",
      support_reply: () => ({ status: "queued" }),
    });
    const ev = (e: any) =>
      JSON.stringify({
        type: "event_callback",
        event_id: "Ev01",
        event: {
          type: "message",
          ts: "2.0",
          thread_ts: "1.0",
          user: "U0OPERATOR",
          text: "On its way",
          ...e,
        },
      });
    await handleOpsSlack(h.d, req(ev({}), "application/json"));
    expect(h.of("support_reply")[0].args).toEqual({
      p_case_id: "c-1",
      p_actor_id: OP,
      p_text: "On its way",
      p_source: "slack",
      p_ref: "slack:Ev01",
    });
    await handleOpsSlack(h.d, req(ev({ bot_id: "B1" }), "application/json"));
    await handleOpsSlack(h.d, req(ev({ subtype: "message_changed" }), "application/json"));
    await handleOpsSlack(h.d, req(ev({ user: "U0STRANGER" }), "application/json"));
    expect(h.of("support_reply")).toHaveLength(1);
    // A retry is passed on with the same event_id: the server recognises one that went through, delivers one that did not.
    await handleOpsSlack(h.d, req(ev({}), "application/json", { "x-slack-retry-num": "1" }));
    expect(h.of("support_reply")).toHaveLength(2);
    expect(h.of("support_reply")[1].args.p_ref).toBe("slack:Ev01");
  });
  it("answers Slack's URL check", async () => {
    const h = deps();
    const r = await (
      await handleOpsSlack(
        h.d,
        req(JSON.stringify({ type: "url_verification", challenge: "abc" }), "application/json"),
      )
    ).json();
    expect(r).toEqual({ challenge: "abc" });
  });
  it("runAction refuses an unknown action", async () => {
    expect(await runAction(async () => null, OP, { do: "drop_tables" })).toBe("Unknown action.");
  });
});

describe("/ak testers and /ak tester remove (demo testers, DECISIONS §39.15.3)", () => {
  it("lists the active testers as the server masks them, with the cap and the switches", async () => {
    const h = deps({
      ops_demo_testers: () => ({
        demo_on: true,
        autopilot: true,
        max: 30,
        days: 14,
        testers: [
          {
            phone: "+447••••••001",
            name: "UK",
            enrolled_at: "2026-10-16T11:00:00Z",
            expires_at: "2026-10-30T11:00:00Z",
            orders: 2,
          },
        ],
      }),
    });
    const r = await (await handleOpsSlack(h.d, req(slash("testers")))).json();
    expect(h.of("ops_demo_testers")[0].args).toEqual({ p_actor_id: OP });
    expect(r.text).toContain("*Demo testers* 1/30 (14 days) · demo mode on · autopilot on");
    expect(r.text).toContain("• +447••••••001 (UK): until 2026-10-30, 2 orders");
    expect(r.text).not.toMatch(/\+447700900001/);
  });
  it("says when there is nobody", async () => {
    const h = deps({
      ops_demo_testers: () => ({
        demo_on: false,
        autopilot: false,
        max: 30,
        days: 14,
        testers: [],
      }),
    });
    const r = await (await handleOpsSlack(h.d, req(slash("testers")))).json();
    expect(r.text).toMatch(/demo mode off · autopilot off\nNo active tester\./);
  });
  it("removes one by number, through the server with the operator's id, and echoes it masked", async () => {
    const h = deps({ ops_demo_tester_remove: () => ({ status: "removed" }) });
    const r = await (await handleOpsSlack(h.d, req(slash("tester remove +44 7700 900001")))).json();
    expect(h.of("ops_demo_tester_remove")[0].args).toEqual({
      p_actor_id: OP,
      p_phone_e164: "+447700900001",
    });
    expect(r.text).toBe("🧪 +447••••••001 is no longer a demo tester.");
  });
  it("an unknown number, or none, is said so and nothing else runs", async () => {
    const h = deps({ ops_demo_tester_remove: () => ({ status: "not_found" }) });
    expect(
      (await (await handleOpsSlack(h.d, req(slash("tester remove +33600000000")))).json()).text,
    ).toBe("No demo tester has +336•••••000.");
    expect((await (await handleOpsSlack(h.d, req(slash("tester remove")))).json()).text).toMatch(
      /Usage: `\/ak tester remove/,
    );
    expect(h.of("ops_demo_tester_remove")).toHaveLength(1);
  });
  it("a Slack user who is not an operator gets nothing", async () => {
    const h = deps({ ops_demo_testers: () => ({}) });
    const r = await (await handleOpsSlack(h.d, req(slash("testers", "U0STRANGER")))).json();
    expect(r.text).toMatch(/not an Alo King operator/);
    expect(h.of("ops_demo_testers")).toHaveLength(0);
  });
  it("the help lists them", async () => {
    const h = deps();
    const r = await (await handleOpsSlack(h.d, req(slash("help")))).json();
    expect(r.text).toContain("`testers` · `tester remove +<number>`");
  });
});
