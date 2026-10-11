import { describe, expect, it } from "vitest";
import { handleMerchantFlows, merchantFlowRequest } from "./flows";
import { checkInteractive } from "../../_shared/meta-limits";

const V = "20000000-0000-0000-0000-00000000000a";
const OWNER = { member_id: "55000000-0000-0000-0000-0000000000a1", vendor_id: V, role: "owner" };
const CASHIER = {
  member_id: "55000000-0000-0000-0000-0000000000a2",
  vendor_id: V,
  role: "cashier",
};
const TOKEN = `merchant_hours:${"c".repeat(32)}`;

function harness(rpcs: Record<string, (a: any) => any> = {}) {
  const calls: { fn: string; args: any }[] = [];
  const sent: any[] = [];
  return {
    deps: {
      rpc: async (fn: string, args: any) => {
        calls.push({ fn, args });
        return rpcs[fn]?.(args) ?? null;
      },
      send: async (p: any) => {
        sent.push(p);
        return { ok: true as const };
      },
    },
    calls,
    sent,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
  };
}

describe("merchant Flows", () => {
  it("recognises hours and profile requests only as whole messages", () => {
    expect(merchantFlowRequest("ساعات الدوام")).toBe("merchant_hours");
    expect(merchantFlowRequest("profile")).toBe("merchant_claim");
    expect(merchantFlowRequest("closed 2 hours")).toBeNull();
  });
  it("an owner gets the hours Flow; a cashier does not", async () => {
    const h = harness({
      flow_open: () => ({ status: "ok", token: TOKEN, screen: "HOURS", data: { vendor_id: V } }),
    });
    await handleMerchantFlows(h.deps, { from: "+96171000001", text: "hours", flow: null }, [OWNER]);
    expect(h.of("flow_open")[0].args).toMatchObject({
      p_flow: "merchant_hours",
      p_member_id: OWNER.member_id,
    });
    expect(h.sent[0].interactive.type).toBe("flow");
    expect(checkInteractive(h.sent[0])).toEqual([]);
    const c = harness();
    await handleMerchantFlows(c.deps, { from: "+96171000002", text: "hours", flow: null }, [
      CASHIER,
    ]);
    expect(c.of("flow_open")).toHaveLength(0);
  });
  it("with Flows off the request gets the text path", async () => {
    const h = harness({ flow_open: () => ({ status: "off" }) });
    await handleMerchantFlows(h.deps, { from: "+96171000001", text: "دوام", flow: null }, [OWNER]);
    expect(h.sent[0].text.body).toMatch(/closed till 6/);
  });
  it("a merchant_claim submission that asks for menu photos starts the menu import", async () => {
    const h = harness({
      flow_submit: () => ({ flow: "merchant_claim", status: "saved", menu_photos: true }),
    });
    await handleMerchantFlows(
      h.deps,
      { from: "+96171000001", text: null, flow: { token: TOKEN, payload: {} } },
      [OWNER],
    );
    expect(h.of("onboarding_session_set")[0].args).toMatchObject({
      p_step: "menu_import",
      p_data: { vendor_id: V },
    });
    expect(h.sent).toHaveLength(2);
  });
  it("ordinary messages are not Flow business", async () => {
    const h = harness();
    expect(
      await handleMerchantFlows(
        h.deps,
        { from: "+96171000001", text: "خلصت الكنافة", flow: null },
        [OWNER],
      ),
    ).toBe(false);
  });
});
