import { describe, expect, it } from "vitest";
import { adminTap, handleAdmin, parseAdminCommand } from "./admin";
import { runDispatch } from "./handler";
import { checkInteractive } from "../_shared/meta-limits";

const OP = { user_id: "00000000-0000-0000-0000-00000000000b", role: "operator", name: "Rasheed" };
const ACTION = "6a000000-0000-0000-0000-000000000001";

function harness(rpcs: Record<string, (a: any) => any> = {}) {
  const calls: { fn: string; args: any }[] = [];
  return {
    deps: {
      rpc: async (fn: string, args: any) => {
        calls.push({ fn, args });
        return rpcs[fn]?.(args) ?? null;
      },
    },
    calls,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
  };
}

describe("WhatsApp admin commands (DECISIONS §32.1)", () => {
  it("reads the limited command set, nothing else", () => {
    expect(parseAdminCommand("status")).toEqual({ kind: "status" });
    expect(parseAdminCommand("pause Alo Test Grill 30")).toEqual({
      kind: "pause",
      merchant: "Alo Test Grill",
      minutes: 30,
    });
    expect(parseAdminCommand("resume grill")).toEqual({ kind: "resume", merchant: "grill" });
    expect(parseAdminCommand("approve 3f2a")).toEqual({ kind: "approve", claim: "3f2a" });
    expect(parseAdminCommand("reply: the driver is 5 min away")).toEqual({
      kind: "reply",
      text: "the driver is 5 min away",
    });
    expect(parseAdminCommand("refund #ab3cd9 12.5")).toEqual({
      kind: "refund",
      code: "AB3CD9",
      amount: 12.5,
    });
    for (const t of ["2 shawarma please", "pause", "refund everything", "hi"])
      expect(parseAdminCommand(t)).toBeNull();
    expect(adminTap(`adm:${ACTION}:y`)).toEqual({ actionId: ACTION, confirm: true });
    expect(adminTap("acc:x:15")).toBeNull();
  });
  it("a change is proposed with a Confirm / Cancel card; nothing happens before the tap", async () => {
    const h = harness({
      ops_merchant: () => [{ vendor_id: "v1", name: "Alo Test Grill" }],
      ops_action_propose: () => ACTION,
    });
    await handleAdmin(h.deps, { from: "+96170009999", messageId: "w1" }, OP, null, {
      kind: "pause",
      merchant: "grill",
      minutes: 30,
    });
    expect(h.of("ops_action_propose")[0].args).toEqual({
      p_actor_id: OP.user_id,
      p_action: "merchant_pause",
      p_args: { vendor_id: "v1", minutes: 30 },
    });
    const card = h.of("app_reply")[0].args.p_payload;
    expect(checkInteractive({ type: "interactive", interactive: card.interactive })).toEqual([]);
    expect(card.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
      `adm:${ACTION}:y`,
      `adm:${ACTION}:n`,
    ]);
    expect(h.of("ops_merchant_pause")).toHaveLength(0);
  });
  it("the tap decides it as the same operator, and a refusal says why", async () => {
    const h = harness({
      ops_action_decide: () => ({
        status: "refused",
        error: "refunds by WhatsApp are at most $20",
      }),
    });
    await handleAdmin(
      h.deps,
      { from: "+96170009999", messageId: "w2" },
      OP,
      { actionId: ACTION, confirm: true },
      null,
    );
    expect(h.of("ops_action_decide")[0].args).toEqual({
      p_action_id: ACTION,
      p_actor_id: OP.user_id,
      p_confirm: true,
    });
    expect(h.of("app_reply")[0].args.p_payload.text).toMatch(
      /Refused: refunds by WhatsApp are at most \$20/,
    );
  });
  it("in dispatch, only an operator's number reaches it; a customer typing 'status' is a customer", async () => {
    const run = async (operator: boolean) => {
      const calls: any[] = [];
      let events = [
        {
          msg_id: 1,
          event_id: 2,
          event_type: "whatsapp.message.received",
          phone_number_id: "PN",
          payload: {
            message: {
              id: "w",
              type: "text",
              text: { body: "status" },
              kapso: { direction: "inbound" },
            },
            conversation: { phone_number: "+96170009999" },
          },
        },
      ];
      await runDispatch({
        rpc: async (fn, args) => {
          calls.push({ fn, args });
          if (fn === "webhook_claim") {
            const e = events;
            events = [];
            return e;
          }
          if (fn === "ops_operator") return operator ? OP : null;
          if (fn === "ops_status")
            return {
              orders_today: 3,
              active: 1,
              exceptions_open: 0,
              cases_open: 1,
              claims_waiting: 2,
            };
          return null;
        },
        whatsapp: async () => ({ ok: true }),
        call: null,
        budgetMs: 60_000,
      });
      return calls;
    };
    const asOp = await run(true);
    expect(asOp.find((c) => c.fn === "app_reply")?.args.p_payload.text).toMatch(
      /3 orders, 1 active/,
    );
    const asCustomer = await run(false);
    expect(asCustomer.some((c) => c.fn === "ops_status")).toBe(false);
  });
});

describe("'open' outside the set hours (session 5 leftover)", () => {
  it("the confirmation says the hours check will close the shop again", async () => {
    const PID = "6b000000-0000-0000-0000-000000000001";
    const calls: any[] = [];
    let events = [
      {
        msg_id: 1,
        event_id: 2,
        event_type: "whatsapp.message.received",
        phone_number_id: "PN",
        payload: {
          message: {
            id: "w",
            type: "interactive",
            interactive: { button_reply: { id: `pyes:${PID}` } },
            kapso: { direction: "inbound" },
          },
          conversation: { phone_number: "+96171000001" },
        },
      },
    ];
    await runDispatch({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "webhook_claim") {
          const e = events;
          events = [];
          return e;
        }
        if (fn === "merchant_members_by_phone")
          return [{ member_id: "m1", vendor_id: "v1", role: "owner" }];
        if (fn === "merchant_member_for") return "m1";
        if (fn === "merchant_proposal_decide") return { status: "confirmed", kind: "resume" };
        if (fn === "vendor_hours_after_resume") return { has_hours: true, open_now: false };
        return null;
      },
      whatsapp: async () => ({ ok: true }),
      call: null,
      budgetMs: 60_000,
    });
    expect(calls.find((c) => c.fn === "app_reply")?.args.p_payload.text).toMatch(
      /hours check will close you again/,
    );
  });
  it("reply: with several open cases the operator names one, and the card says who receives it", async () => {
    const cases = [
      { id: "ab12aaaa-0000-0000-0000-000000000001", short: "ab12aa", name: "Maya" },
      { id: "cd34aaaa-0000-0000-0000-000000000002", short: "cd34aa", name: "Karim" },
    ];
    const h = harness({
      ops_status: () => ({ open_cases: cases }),
      ops_action_propose: () => ACTION,
    });
    await handleAdmin(h.deps, { from: "+96170009999", messageId: "w1" }, OP, null, {
      kind: "reply",
      text: "on its way",
    });
    expect(h.of("ops_action_propose")).toHaveLength(0);
    expect(h.of("app_reply")[0].args.p_payload.text).toMatch(/ab12aa Maya[\s\S]*cd34aa Karim/);
    await handleAdmin(h.deps, { from: "+96170009999", messageId: "w2" }, OP, null, {
      kind: "reply",
      text: "cd34aa on its way",
    });
    expect(h.of("ops_action_propose")[0].args.p_args).toEqual({
      case_id: cases[1].id,
      text: "on its way",
    });
    expect(JSON.stringify(h.of("app_reply")[1].args.p_payload)).toContain("Karim (case cd34aa)");
  });
});
