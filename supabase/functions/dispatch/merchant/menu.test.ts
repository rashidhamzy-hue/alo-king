import { describe, expect, it } from "vitest";
import { handleMerchantMenu, type MenuDeps } from "./menu";
import { checkInteractive } from "../../_shared/meta-limits";

const V = "20000000-0000-0000-0000-00000000000a";
const D = "70000000-0000-0000-0000-000000000001";
const OWNER = { member_id: "55000000-0000-0000-0000-0000000000a1", vendor_id: V, role: "owner" };
const CASHIER = {
  member_id: "55000000-0000-0000-0000-0000000000a2",
  vendor_id: V,
  role: "cashier",
};
const ME = "+96171000001";

function harness(rpcs: Record<string, (a: any) => any> = {}, model: MenuDeps["menuModel"] = null) {
  let session: any = null;
  const calls: { fn: string; args: any }[] = [];
  const sent: any[] = [];
  const deps: MenuDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (rpcs[fn]) return rpcs[fn](args);
      if (fn === "onboarding_session_get") return session;
      if (fn === "onboarding_session_set") {
        session = args.p_step ? { step: args.p_step, data: args.p_data } : null;
        return null;
      }
      return null;
    },
    send: async (p) => {
      sent.push(p);
      return { ok: true };
    },
    menuModel: model,
    fetchMedia: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }),
  };
  const msg = (o: Partial<Parameters<typeof handleMerchantMenu>[1]>) => ({
    from: ME,
    messageId: "w1",
    text: null,
    buttonId: null,
    media: null,
    ...o,
  });
  return { deps, calls, sent, msg, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}
const summary = {
  draft_id: D,
  sections: [
    { index: 0, name: "سندويشات", items: 3, priced: 2, approved: false, preview: ["شاورما · $4"] },
    { index: 1, name: "Manakish", items: 2, priced: 2, approved: false, preview: ["Zaatar · $1"] },
  ],
};

describe("smart menu on the Merchant number", () => {
  it("leaves ordinary merchant messages to the commands", async () => {
    const h = harness();
    expect(await handleMerchantMenu(h.deps, h.msg({ text: "خلصت الكنافة" }), [OWNER])).toBe(false);
  });

  it("a pasted text menu becomes a draft without any model, then section cards", async () => {
    const h = harness({ menu_draft_create: () => summary });
    await handleMerchantMenu(h.deps, h.msg({ text: "منيو" }), [OWNER]);
    expect(h.sent[0].text.body).toMatch(/Send photos/);
    await handleMerchantMenu(
      h.deps,
      h.msg({ text: "سندويشات\nشاورما دجاج 4$\nفلافل 200,000 ل.ل\nكفتة 5" }),
      [OWNER],
    );
    const args = h.of("menu_draft_create")[0].args;
    expect(args).toMatchObject({
      p_vendor_id: V,
      p_source: "text",
      p_model: "rules",
      p_member_id: OWNER.member_id,
    });
    expect(args.p_sections[0].items[2]).toMatchObject({
      name_ar: "كفتة",
      price: 5,
      currency: null,
    });
    const card = h.sent.at(-1);
    expect(card.interactive.action.buttons[0].reply.id).toBe(`MNU|A|${D}|0`);
    for (const p of h.sent) expect(checkInteractive(p)).toEqual([]);
  });

  it("without the menu model a photo goes to Rasheed, nothing is guessed (§32.7)", async () => {
    const h = harness({ menu_draft_create: () => summary });
    await handleMerchantMenu(h.deps, h.msg({ text: "menu" }), [OWNER]);
    await handleMerchantMenu(
      h.deps,
      h.msg({ media: { id: "IMG1", url: null, mime: "image/jpeg" } }),
      [OWNER],
    );
    expect(h.of("merchant_menu_help")[0].args).toMatchObject({
      p_vendor_id: V,
      p_media_ref: "wa-media:IMG1",
    });
    expect(h.of("menu_draft_create")).toHaveLength(0);
  });

  it("with the model a photo is read into a draft through the validator", async () => {
    const model = async () =>
      JSON.stringify({
        sections: [{ name_en: "Grill", items: [{ name_en: "Tawook", price_text: "6$" }] }],
      });
    const h = harness({ menu_draft_create: () => summary }, model);
    await handleMerchantMenu(h.deps, h.msg({ text: "menu" }), [OWNER]);
    await handleMerchantMenu(
      h.deps,
      h.msg({ media: { id: "IMG1", url: null, mime: "image/jpeg" } }),
      [OWNER],
    );
    expect(h.of("menu_draft_create")[0].args).toMatchObject({
      p_source: "photo",
      p_model: "menu_model",
    });
    expect(h.of("menu_draft_create")[0].args.p_sections[0].items[0]).toMatchObject({
      price: 6,
      currency: "USD",
    });
  });

  it("approve walks the sections, then asks the two nutrition questions, then estimates and confirms", async () => {
    const h = harness({
      menu_draft_approve_section: () => ({
        status: "approved",
        inserted: 2,
        needs_price: ["كفتة"],
      }),
      menu_draft_summary: () => summary,
      menu_nutrition_estimate: () => ({
        estimated: 2,
        unknown: 1,
        items: [{ name: "Tawook", dish: "Chicken tawouk sandwich", kcal: 560, protein_g: 38 }],
      }),
      menu_nutrition_confirm: () => ({ confirmed: 2 }),
    });
    await handleMerchantMenu(h.deps, h.msg({ buttonId: `MNU|A|${D}|0` }), [OWNER]);
    expect(h.sent.at(-2).text.body).toMatch(/كفتة/);
    expect(h.sent.at(-1).interactive.action.buttons[0].reply.id).toBe(`MNU|A|${D}|1`);
    await handleMerchantMenu(h.deps, h.msg({ buttonId: `MNU|S|${D}|1` }), [OWNER]);
    expect(h.sent.at(-1).interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
      `NUT|S|${V}`,
      `NUT|M|${V}`,
      `NUT|L|${V}`,
    ]);
    await handleMerchantMenu(h.deps, h.msg({ buttonId: `NUT|M|${V}` }), [OWNER]);
    await handleMerchantMenu(h.deps, h.msg({ buttonId: `NUT|E|${V}|M|oil` }), [OWNER]);
    expect(h.of("menu_nutrition_estimate")[0].args).toMatchObject({
      p_size: "M",
      p_extras: { extra_oil_g: 10 },
    });
    expect(h.sent.at(-1).interactive.body.text).toMatch(/≈ 560 kcal · 38 g protein \(estimated\)/);
    expect(h.sent.at(-1).interactive.body.text).toMatch(/never set them/);
    await handleMerchantMenu(h.deps, h.msg({ buttonId: `NUT|C|${V}` }), [OWNER]);
    expect(h.of("menu_nutrition_confirm")[0].args).toMatchObject({
      p_vendor_id: V,
      p_member_id: OWNER.member_id,
    });
    for (const p of h.sent) expect(checkInteractive(p)).toEqual([]);
  });

  it("a cashier cannot import or approve a menu", async () => {
    const h = harness();
    expect(await handleMerchantMenu(h.deps, h.msg({ text: "menu" }), [CASHIER])).toBe(true);
    expect(h.sent[0].text.body).toMatch(/owner or a manager/);
    expect(h.of("onboarding_session_set")).toHaveLength(0);
  });
});
