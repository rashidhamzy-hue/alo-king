import { describe, expect, it } from "vitest";
import { handleMerchantFlows, merchantFlowRequest, parseBranchTap } from "./flows";
import { checkInteractive } from "../../_shared/meta-limits";

const V = "20000000-0000-0000-0000-00000000000a";
const OWNER = { member_id: "55000000-0000-0000-0000-0000000000a1", vendor_id: V, role: "owner" };
const CASHIER = {
  member_id: "55000000-0000-0000-0000-0000000000a2",
  vendor_id: V,
  role: "cashier",
};
const V2 = "20000000-0000-0000-0000-00000000000b";
const OWNER2 = {
  member_id: "55000000-0000-0000-0000-0000000000b1",
  vendor_id: V2,
  role: "owner",
  vendor_name: "Branch B",
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
      flow_submit: () => ({
        flow: "merchant_claim",
        status: "saved",
        menu_photos: true,
        vendor_id: V2,
        member_id: OWNER2.member_id,
      }),
    });
    await handleMerchantFlows(
      h.deps,
      { from: "+96171000001", text: null, flow: { token: TOKEN, payload: {} } },
      [OWNER, OWNER2],
    );
    // The branch the Flow was opened for, not the first membership.
    expect(h.of("onboarding_session_set")[0].args).toMatchObject({
      p_step: "menu_import",
      p_data: { vendor_id: V2, member_id: OWNER2.member_id },
    });
    expect(h.sent).toHaveLength(2);
  });
  it("an owner of two branches picks the branch first, then gets that branch's Flow", async () => {
    const h = harness({
      flow_open: () => ({ status: "ok", token: TOKEN, screen: "HOURS", data: {} }),
    });
    await handleMerchantFlows(h.deps, { from: "+96171000001", text: "hours", flow: null }, [
      OWNER,
      OWNER2,
    ]);
    expect(h.of("flow_open")).toHaveLength(0);
    expect(checkInteractive(h.sent[0])).toEqual([]);
    const id = h.sent[0].interactive.action.sections[0].rows[1].id;
    expect(parseBranchTap(id)).toEqual({ flow: "merchant_hours", memberId: OWNER2.member_id });
    await handleMerchantFlows(
      h.deps,
      { from: "+96171000001", text: null, buttonId: id, flow: null },
      [OWNER, OWNER2],
    );
    expect(h.of("flow_open")[0].args).toMatchObject({
      p_flow: "merchant_hours",
      p_member_id: OWNER2.member_id,
    });
    // A tap naming a membership the sender does not hold opens nothing.
    const x = harness();
    await handleMerchantFlows(
      x.deps,
      { from: "+96171000001", text: null, buttonId: id, flow: null },
      [OWNER],
    );
    expect(x.of("flow_open")).toHaveLength(0);
  });
  it("an expired or repeated form gets a reply, never silence", async () => {
    for (const r of [
      { flow: "merchant_hours", status: "rejected", reason: "expired" },
      { flow: "merchant_hours", status: "duplicate" },
    ]) {
      const h = harness({ flow_submit: () => r });
      await handleMerchantFlows(
        h.deps,
        { from: "+96171000001", text: null, flow: { token: TOKEN, payload: {} } },
        [OWNER],
      );
      expect(h.sent[0].text.body).toMatch(/hours/);
    }
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

// Session 5b (§39.8): "settings" opens the profile form; the menu-section Flow approves a draft section.
import { sectionPrompt } from "./menu";

describe("menu section Flow and settings (5b)", () => {
  const DRAFT = "60000000-0000-0000-0000-000000000001";
  const sec = (index: number) =>
    ({ index, name: `S${index}`, items: 2, priced: 2, sample: ["a", "b"] }) as any;
  it("'settings' opens the profile form, in three languages", () => {
    for (const t of ["settings", "إعدادات", "paramètres"])
      expect(merchantFlowRequest(t)).toBe("merchant_claim");
  });
  it("a draft section is the Flow once published, else the chat card", async () => {
    const on = harness({
      flow_open: () => ({
        status: "ok",
        token: `menu_section:${"d".repeat(32)}`,
        screen: "SECTION",
        data: { draft_id: DRAFT },
      }),
    });
    const f: any = await sectionPrompt(on.deps, "+96171000001", DRAFT, sec(0), 2, OWNER.member_id);
    expect(f.interactive.type).toBe("flow");
    expect(f.interactive.action.parameters.flow_name).toBe("alo_menu_section_ar");
    expect(on.of("flow_open")[0].args).toMatchObject({
      p_flow: "menu_section",
      p_member_id: OWNER.member_id,
      p_context: { draft_id: DRAFT, index: 0 },
    });
    const off = harness({ flow_open: () => ({ status: "off" }) });
    const card: any = await sectionPrompt(
      off.deps,
      "+96171000001",
      DRAFT,
      sec(0),
      2,
      OWNER.member_id,
    );
    expect(card.interactive.type).not.toBe("flow");
    expect(checkInteractive(card)).toEqual([]);
  });
  it("a submitted section: added, then the next section waiting", async () => {
    const h = harness({
      flow_submit: () => ({
        flow: "menu_section",
        status: "approved",
        inserted: 2,
        needs_price: [],
        member_id: OWNER.member_id,
      }),
      menu_draft_summary: () => ({
        vendor_id: V,
        sections: [
          { ...sec(0), approved: true },
          { ...sec(1), approved: false },
        ],
      }),
      flow_open: () => ({ status: "off" }),
    });
    await handleMerchantFlows(
      h.deps,
      {
        from: "+96171000001",
        text: null,
        flow: {
          token: `menu_section:${"d".repeat(32)}`,
          payload: { draft_id: DRAFT, keep: ["i1", "i2"] },
        },
      },
      [OWNER],
    );
    expect(h.sent.length).toBe(2);
    expect(JSON.stringify(h.sent[1])).toContain(DRAFT);
  });
});
