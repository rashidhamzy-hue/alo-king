import { describe, expect, it } from "vitest";
import { META, checkInteractive, clampInteractive } from "./meta-limits";

const btn = (titles: string[], body = "hi") => ({
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: {
      buttons: titles.map((t, k) => ({ type: "reply", reply: { id: `ID${k}`, title: t } })),
    },
  },
});
const list = (rows: any[], extra: any = {}) => ({
  type: "interactive",
  interactive: {
    type: "list",
    body: { text: "pick" },
    action: { button: "Choose", sections: [{ title: "Menu", rows }] },
    ...extra,
  },
});
const row = (k: number, o: any = {}) => ({ id: `R${k}`, title: `Row ${k}`, ...o });

describe("checkInteractive: the checker itself", () => {
  it("accepts a valid button message and a valid list", () => {
    expect(checkInteractive(btn(["Yes", "No", "More"]))).toEqual([]);
    expect(checkInteractive(list(Array.from({ length: 10 }, (_, k) => row(k))))).toEqual([]);
  });
  it("ignores text and template payloads", () => {
    expect(checkInteractive({ type: "text", text: { body: "x".repeat(5000) } })).toEqual([]);
    expect(checkInteractive({ type: "template", template: { name: "x" } })).toEqual([]);
  });
  it("fails more than 3 buttons", () =>
    expect(checkInteractive(btn(["a", "b", "c", "d"])).join()).toMatch(/4 buttons/));
  it("fails a button title over 20 characters (and counts emoji as one)", () => {
    expect(checkInteractive(btn(["x".repeat(21)])).join()).toMatch(/button title/);
    expect(checkInteractive(btn(["x".repeat(20)]))).toEqual([]);
    expect(checkInteractive(btn(["✅ " + "x".repeat(18)]))).toEqual([]); // 20 characters with the emoji
  });
  it("fails more than 10 list rows, rows over 24 characters, descriptions over 72", () => {
    expect(checkInteractive(list(Array.from({ length: 11 }, (_, k) => row(k)))).join()).toMatch(
      /11 rows/,
    );
    expect(checkInteractive(list([row(1, { title: "y".repeat(25) })])).join()).toMatch(/row title/);
    expect(checkInteractive(list([row(1, { title: "y".repeat(24) })]))).toEqual([]);
    expect(checkInteractive(list([row(1, { description: "d".repeat(73) })])).join()).toMatch(
      /description/,
    );
  });
  it("fails a body over 1024 characters", () => {
    expect(checkInteractive(btn(["a"], "b".repeat(1025))).join()).toMatch(/body/);
    expect(checkInteractive(btn(["a"], "b".repeat(1024)))).toEqual([]);
  });
  it("also catches empty/duplicate titles, oversized ids, long headers/footers/list buttons", () => {
    expect(checkInteractive(btn(["a", "a"])).join()).toMatch(/duplicate button title/);
    expect(checkInteractive(btn([""])).join()).toMatch(/empty button title/);
    expect(checkInteractive(list([row(1), row(1)])).join()).toMatch(/duplicate row id/);
    expect(
      checkInteractive(list([row(1)], { header: { type: "text", text: "h".repeat(61) } })).join(),
    ).toMatch(/header/);
    const longBtn = list([row(1)]);
    (longBtn.interactive as any).action.button = "z".repeat(21);
    expect(checkInteractive(longBtn).join()).toMatch(/list button/);
  });
  it("limits are the documented numbers", () => {
    expect([META.maxButtons, META.buttonTitle, META.listRows, META.rowTitle, META.body]).toEqual([
      3, 20, 10, 24, 1024,
    ]);
  });
});

describe("clampInteractive: whatever a builder produces, what is sent passes the checker", () => {
  it("fixes every kind of overflow", () => {
    const bad = btn(["x".repeat(40), "y", "z", "w"], "b".repeat(3000));
    expect(checkInteractive(bad).length).toBeGreaterThan(0);
    expect(checkInteractive(clampInteractive(bad))).toEqual([]);
    const badList: any = list(
      Array.from({ length: 25 }, (_, k) =>
        row(k, { title: "t".repeat(60), description: "d".repeat(200) }),
      ),
      { header: { type: "text", text: "h".repeat(200) }, footer: { text: "f".repeat(200) } },
    );
    badList.interactive.action.button = "b".repeat(50);
    badList.interactive.action.sections[0].title = "s".repeat(50);
    expect(checkInteractive(badList).length).toBeGreaterThan(0);
    expect(checkInteractive(clampInteractive(badList))).toEqual([]);
  });
  it("leaves valid payloads and non-interactive payloads untouched", () => {
    const ok = btn(["Yes", "No"]);
    expect(clampInteractive(ok)).toEqual(ok);
    const txt = { type: "text", text: { body: "x".repeat(3000) } };
    expect(clampInteractive(txt)).toBe(txt);
  });
  it("does not mutate its input and keeps emoji intact", () => {
    const p = btn(["✅ " + "x".repeat(30)]);
    const before = JSON.stringify(p);
    const out: any = clampInteractive(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(out.interactive.action.buttons[0].reply.title.startsWith("✅ ")).toBe(true);
  });
});

// Every merchant and driver card builder (session 3) stays inside Meta's limits, in both languages, with a
// long order (CLAUDE.md: add every new card builder here).
import * as cards from "./merchant-cards";

describe("merchant-cards: every builder passes the checker", () => {
  const U = "11111111-2222-3333-4444-555555555555";
  const order: cards.OrderCardData = {
    order_id: U,
    code: "AB3CD9",
    fulfilment: "delivery",
    payment_method: "cod",
    total_usd: 148.5,
    total_lbp: 13290750,
    usd_lbp_rate: 89500,
    estimated: true,
    is_new_customer: true,
    customer_note: "بلا بصل، والصوص على جنب ".repeat(8),
    area_ar: "بعقلين",
    area_en: "Baakline",
    items: Array.from({ length: 25 }, (_, k) => ({
      name: `صنف رقم ${k} مع اسم طويل`,
      name_en: `Item number ${k} with a long name`,
      quantity: 2,
      options: ["كبير", "حار"],
      kg: k % 3 === 0 ? 1.5 : null,
      has_empty: k % 4 === 0 ? false : null,
      note: "بلا ملح",
    })),
  };
  for (const lang of ["ar", "en"] as const) {
    it(`builds valid cards in ${lang}`, () => {
      const built: any[] = [
        cards.orderCard("+96171000001", order, lang),
        cards.orderCard("+96171000001", { ...order, demo: true }, lang),
        cards.rejectReasonList("+96171000001", U, "AB3CD9", lang),
        cards.readyCheckCard("+96171000001", U, "AB3CD9", lang),
        cards.needDriverCard("+96171000001", U, "AB3CD9", lang),
        cards.deliveredCard("+96171000001", U, "AB3CD9", lang),
        cards.lowStockCard("+96171000001", U, "كرواسان بالزعتر والجبنة", 3, lang),
        cards.reactivateCard("+96171000001", U, 3, lang),
        cards.proposalCard("+96171000001", U, "أوقف استقبال الطلبات لمدة 30 دقيقة؟", lang),
        ...cards.driverJobCard("+96171000009", order, "+96170000001", "علي", "مطعم الضيعة", lang),
      ];
      for (const p of built)
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 80)).toEqual([]);
    });
  }
  it("the order card shows both totals and the locked rate, never a phone", () => {
    const p: any = cards.orderCard("+96171000001", order, "en");
    expect(p.interactive.body.text).toContain(
      "$148.50 = 13,290,750 LBP (rate 89,500, locked at order)",
    );
    expect(JSON.stringify(p.interactive)).not.toMatch(/\+?9617\d{6}/);
  });
  it("a demo shop's order card says Demo first, in both languages (DECISIONS §39.12)", () => {
    const en: any = cards.orderCard("+96171000001", { ...order, demo: true }, "en");
    const ar: any = cards.orderCard("+96171000001", { ...order, demo: true }, "ar");
    expect(en.interactive.body.text.split("\n")[0]).toBe(
      "🧪 Demo order: the real shop is never told",
    );
    expect(ar.interactive.body.text.split("\n")[0]).toContain("Demo");
    expect(
      (cards.orderCard("+96171000001", order, "en") as any).interactive.body.text,
    ).not.toContain("Demo");
  });
  it("button ids round-trip through parseMerchantAction", () => {
    const p: any = cards.orderCard("+96171000001", order, "ar");
    expect(cards.parseMerchantAction(p.interactive.action.buttons[0].reply.id)).toEqual({
      a: "accept",
      orderId: U,
      prep: 15,
    });
    expect(cards.parseMerchantAction(`rjr:${U}:busy`)).toEqual({
      a: "reject",
      orderId: U,
      reason: "busy",
    });
    expect(cards.parseMerchantAction(`stk:${U}:20`)).toEqual({
      a: "stock_add",
      itemId: U,
      add: 20,
    });
    expect(cards.parseMerchantAction(`acc:${U}:999`)).toBeNull();
    expect(cards.parseMerchantAction(`rjr:${U}:drop_table`)).toBeNull();
    expect(cards.parseMerchantAction("acc:not-a-uuid:15")).toBeNull();
  });
});

// Every customer message builder (session 4) in all four languages, with long names and every kind.
import * as cc from "./customer-cards";

describe("customer-cards: every builder passes the checker", () => {
  const U = "11111111-2222-3333-4444-555555555555";
  const card = {
    order_id: U,
    code: "AB3CD9",
    vendor_name: "مطعم الضيعة ".repeat(6),
    fulfilment: "delivery",
    total_usd: 148.5,
    total_lbp: 13290750,
    usd_lbp_rate: 89500,
  };
  const kinds = [
    { kind: "accepted", eta: { min: 25, max: 35 } },
    { kind: "rejected", reason: "busy" },
    { kind: "cancelled", reason: "merchant_unreachable" },
    { kind: "on_the_way", eta: { min: 12, max: 22 }, driver_phone: "+96171000009" },
    { kind: "on_the_way", eta: { min: 12, max: 22 } },
    { kind: "near_drop", driver_phone: "+96171000009", door_confirmed: false },
    { kind: "near_drop", door_confirmed: true },
    { kind: "arrived_wait", driver_phone: "+96171000009" },
    { kind: "ready_for_pickup" },
    { kind: "delivered" },
    { kind: "weight_confirm", total_usd: 23.1, estimated_total_usd: 20, total_lbp: 2067450 },
    { kind: "cancel_refused" },
    { kind: "rating", ask_delivery: true },
    { kind: "rating", ask_delivery: false },
    {
      kind: "basket_reminder",
      basket: { vendor: "محل", vendor_en: "Shop", subtotal_usd: 12, lines: [{}] },
    },
  ];
  for (const lang of cc.LANGS) {
    it(`builds valid customer messages in ${lang}`, () => {
      for (const p of kinds) {
        const out = cc.customerStatusMessages("+96170000001", { ...p, lang }, card, {
          deliveryCode: "1234",
          afterSunset: true,
        });
        expect(out.length, `${lang} ${p.kind}`).toBeGreaterThan(0);
        for (const m of out) expect(checkInteractive(m), `${lang} ${p.kind}`).toEqual([]);
      }
      for (const m of [
        cc.locationRequest("+96170000001", cc.T[lang].nearDrop),
        cc.ratingList("+96170000001", U, "x".repeat(300), true, lang),
      ])
        expect(checkInteractive(m)).toEqual([]);
    });
  }
  it("cta_url labels and urls are checked", () => {
    expect(
      checkInteractive(cc.ctaUrl("+1", "b", "x".repeat(21), "https://wa.me/1")).join(),
    ).toMatch(/cta label/);
    expect(checkInteractive(cc.ctaUrl("+1", "b", "ok", "http://evil")).join()).toMatch(/https/);
  });
});

// Merchant onboarding (session 5, §18.1): every builder, in all three languages, with long names.
import * as ob from "./onboarding-cards";

describe("onboarding-cards: every builder passes the checker", () => {
  const U = "11111111-2222-3333-4444-555555555555";
  const matches = Array.from({ length: 14 }, (_, k) => ({
    vendor_id: U,
    name: `مطعم الضيعة الكبير رقم ${k} مع اسم طويل جدا`,
    branch_label: "فرع بعقلين الرئيسي على الطريق العام",
    town: "جديدة الشوف",
    claim_status: k % 2 ? "claimed" : "unclaimed",
  })).map((m, k) => ({ ...m, vendor_id: U.replace(/5$/, String(k % 10)) }));
  for (const lang of ["ar", "en", "fr"] as const) {
    it(`builds valid onboarding messages in ${lang}`, () => {
      const built: any[] = [
        ob.claimSearchList("+96171000001", matches, lang),
        ob.notListedButtons("+96171000001", lang),
        ob.notListedButtons("+96171000001", lang, true),
        ob.codeSentCard("+96171000001", U, "…56", "whatsapp", lang),
        ob.codeSentCard("+96171000001", U, "…56", "voice", lang),
        ob.documentsAsk("+96171000001", ["registration", "sign_photo"], lang),
        ob.documentsAsk("+96171000001", ["registration"], lang, {
          homeKitchen: true,
          claimId: U,
          prefix: "x".repeat(400),
        }),
        ob.documentsAsk("+96171000001", ["company"], lang, { next: true }),
        ob.businessTypeList("+96171000001", lang),
        ob.homeKitchenButtons("+96171000001", lang),
        ob.pinRequest("+96171000001", lang),
        ob.claimCodeText("+96170123456", "482913"),
        ob.joinConfirm("+96171000001", lang),
      ];
      for (const p of built)
        expect(checkInteractive(clampInteractive(p)), JSON.stringify(p).slice(0, 80)).toEqual([]);
      // Builders that need no clamping: all except the search list, whose names come from data.
      for (const p of built.slice(1))
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 80)).toEqual([]);
    });
  }
  it("tap ids round-trip", () => {
    const l: any = ob.claimSearchList("+1", matches.slice(0, 2), "en");
    expect(ob.parseOnboardingTap(l.interactive.action.sections[0].rows[0].id)).toEqual({
      a: "vendor",
      vendorId: matches[0].vendor_id,
    });
    const t: any = ob.businessTypeList("+1", "ar");
    for (const r of t.interactive.action.sections[0].rows)
      expect(ob.parseOnboardingTap(r.id)?.a).toBe("type");
  });
});

// Smart menu and nutrition cards (session 5, §18.3, §32.3).
import * as mc from "./menu-cards";

describe("menu-cards: every builder passes the checker", () => {
  const U = "11111111-2222-3333-4444-555555555555";
  it("builds valid cards with long names", () => {
    const long = "سندويش شاورما دجاج مع بطاطا وكبيس وتوم إضافي ".repeat(4);
    const built: any[] = [
      mc.menuImportHelp("+96171000001", true),
      mc.menuImportHelp("+96171000001", false),
      mc.draftSectionCard(
        "+96171000001",
        U,
        { index: 3, name: long, items: 40, priced: 31, preview: Array(12).fill(long) },
        12,
      ),
      mc.sectionAddedText("+96171000001", 12, Array(30).fill(long)),
      mc.portionQuestion("+96171000001", U),
      mc.extrasQuestion("+96171000001", U, "M"),
      mc.estimateCard("+96171000001", U, {
        estimated: 40,
        unknown: 7,
        items: Array(12).fill({ name: long, kcal: 612.4, protein_g: 37.6 }),
      }),
    ];
    for (const p of built) expect(checkInteractive(p), JSON.stringify(p).slice(0, 80)).toEqual([]);
  });
  it("tap ids round-trip", () => {
    const p: any = mc.draftSectionCard("+1", U, { index: 2, name: "x", items: 1, priced: 1 }, 3);
    expect(mc.parseMenuTap(p.interactive.action.buttons[0].reply.id)).toEqual({
      a: "approve",
      draftId: U,
      index: 2,
    });
    const e: any = mc.extrasQuestion("+1", U, "L");
    expect(mc.parseMenuTap(e.interactive.action.buttons[2].reply.id)).toEqual({
      a: "extras",
      vendorId: U,
      size: "L",
      extra: "sauce",
    });
    expect(mc.parseMenuTap("NUT|E|x|M|butter")).toBeNull();
  });
});

// Customer dietary list (session 5, §32.3).
import { dietaryList } from "../dispatch/customer/render";
describe("dietaryList passes the checker", () => {
  it("in all languages, with estimates and the allergen note", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      const rows = Array.from({ length: 12 }, (_, k) => ({
        ref: `i${k}`,
        name_ar: "صحن طاووق مع رز وسلطة وصلصة ".repeat(3),
        name_en: "Tawook plate with rice and salad ".repeat(3),
        price_usd: 9.5,
        orderable: true,
        kcal: 812.3,
        protein_g: 61.2,
        nutrition_source: k % 2 ? "estimated" : "merchant_verified",
      }));
      for (const p of dietaryList("+96170000001", lang, "مطعم", rows, { allergens: true }))
        expect(checkInteractive(p)).toEqual([]);
    }
  });
});

// WhatsApp Flows and the catalogue (session 5, §12, §30.1.2).
import { flowMessage } from "./flows";
import { productListMessage, type DesiredProduct } from "./catalog";
import { branchPicker } from "../dispatch/merchant/flows";
describe("Flow, product list and branch picker builders pass the checker", () => {
  const TOKEN = `item_options:${"b".repeat(32)}`;
  it("every Flow in both languages", () => {
    for (const flow of [
      "address_capture",
      "item_options",
      "merchant_claim",
      "merchant_hours",
      "checkout",
      "menu_section",
    ] as const)
      for (const lang of ["ar", "en"] as const)
        expect(
          checkInteractive(
            flowMessage("+96170000001", { flow, lang, token: TOKEN, screen: "S", data: { x: 1 } }),
          ),
        ).toEqual([]);
  });
  it("a product list with more items and sections than Meta allows is clamped to pass", () => {
    const products: DesiredProduct[] = Array.from({ length: 45 }, (_, k) => ({
      retailer_id: `5300000${k}`,
      name: `صنف ${k}`,
      price_minor: 500,
      currency: "USD",
      availability: "in stock",
      product_set: "v",
      section: `قسم ${k % 14} ${"طويل ".repeat(8)}`,
    }));
    expect(
      checkInteractive(productListMessage("+96170000001", "cat1", "المنيو", "اختار", products)),
    ).toEqual([]);
  });
  it("the branch picker for owners of many branches", () => {
    const editors = Array.from({ length: 13 }, (_, k) => ({
      member_id: `00000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
      vendor_id: "v",
      role: "owner",
      vendor_name: `فرع ${k} ${"الأشرفية ".repeat(4)}`,
    }));
    for (const f of ["merchant_hours", "merchant_claim"] as const)
      expect(checkInteractive(branchPicker("+96170000001", f, editors))).toEqual([]);
  });
  it("clampInteractive fixes an over-long Flow label and an oversized product list", () => {
    const flow: any = flowMessage("+1", {
      flow: "item_options",
      lang: "en",
      token: TOKEN,
      screen: "S",
      data: {},
    });
    flow.interactive.action.parameters.flow_cta = "x".repeat(40);
    expect(checkInteractive(flow).join()).toMatch(/flow cta/);
    expect(checkInteractive(clampInteractive(flow))).toEqual([]);
    const pl = {
      type: "interactive",
      interactive: {
        type: "product_list",
        header: { type: "text", text: "Menu" },
        body: { text: "pick" },
        action: {
          catalog_id: "c",
          sections: Array.from({ length: 12 }, (_, s) => ({
            title: `Section ${s} ${"x".repeat(30)}`,
            product_items: Array.from({ length: 4 }, (_, k) => ({
              product_retailer_id: `${s}-${k}`,
            })),
          })),
        },
      },
    };
    expect(checkInteractive(pl).length).toBeGreaterThan(0);
    expect(checkInteractive(clampInteractive(pl))).toEqual([]);
  });
});

// Merchant WhatsApp extras (session 5, §32.5).
import { shiftHandoverText, proposalCard } from "./merchant-cards";
import { customerStatusMessages } from "./customer-cards";
import { menuList, substitutionAsk } from "../dispatch/customer/render";
describe("merchant extras builders pass the checker", () => {
  const SUB = "00000000-0000-0000-0000-0000000000c1";
  it("substitution offer and checkout question in every language", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      const msgs = customerStatusMessages(
        "+96170000001",
        {
          kind: "substitution",
          lang,
          substitution_id: SUB,
          from_ar: "بيبسي ".repeat(20),
          from_en: "Pepsi ".repeat(20),
          to_ar: "سفن اب ".repeat(20),
          to_en: "7up ".repeat(20),
          diff_usd: 0.25,
          diff_lbp: 22375,
          new_total_usd: 12.75,
          new_total_lbp: 1141125,
          usd_lbp_rate: 89500,
        },
        { order_id: SUB, code: "K7M2QX" },
      );
      expect(msgs).toHaveLength(1);
      for (const m of msgs) expect(checkInteractive(m)).toEqual([]);
      for (const max of [2, 2.5, 10])
        expect(checkInteractive(substitutionAsk("+96170000001", lang, max))).toEqual([]);
      for (const p of menuList(
        "+96170000001",
        lang,
        "سوبرماركت",
        [
          {
            ref: "i1",
            item_id: "x",
            name_ar: "حليب",
            name_en: "Milk",
            price_usd: 1,
            orderable: true,
          } as any,
        ],
        null,
        true,
      ))
        expect(checkInteractive(p)).toEqual([]);
    }
    expect(
      customerStatusMessages("+1", { kind: "substitution", substitution_id: "bad" }, null),
    ).toEqual([]);
  });
  it("shift handover and the extras' proposal cards", () => {
    const h = shiftHandoverText("+96171000001", {
      vendor_name: "فرن",
      pending: Array.from({ length: 10 }, (_, k) => ({
        code: `ABC12${k}`,
        status: "accepted",
        minutes: k,
      })),
      pending_count: 14,
      sold_out: Array.from({ length: 10 }, (_, k) => `صنف ${k}`),
      complaints: 2,
    });
    expect(h.text.body).toMatch(/14/);
    expect(h.text.body.length).toBeLessThanOrEqual(4096);
    const summary = "👨‍🍳 المطبخ بياخد 200 طلبات سوا؟ ".repeat(30);
    expect(checkInteractive(proposalCard("+96171000001", SUB, summary, "ar"))).toEqual([]);
  });
});

// The button-driven ordering path (session T, DECISIONS §34): main menu, handoff card, sections, quantity,
// cash currency and a paged section list stay inside Meta's limits in all four languages.
import {
  cashAsk,
  handoffWaitCard,
  mainMenu,
  menuList as sectionMenuList,
  noDeliveryCard,
  notOnAloKingCard,
  qtyList,
  vendorChoices,
  sectionList,
  summaryMessage,
} from "../dispatch/customer/render";

describe("the button path builders (session T)", () => {
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`builds valid messages in ${lang}`, () => {
      const to = "+96171000001";
      const sections = Array.from({ length: 12 }, (_, k) => ({
        ref: `s${k + 1}`,
        name_ar: `قسم طويل جداً رقم ${k}`,
        name_en: `A very long section name number ${k}`,
        items: 99,
      }));
      const rows = Array.from({ length: 10 }, (_, k) => ({
        ref: `i${k + 1}`,
        name_ar: `صنف طويل الاسم جداً رقم ${k}`,
        name_en: `A very long item name number ${k}`,
        name_fr: `Un article au nom très long numéro ${k}`,
        price_usd: 12.5,
        orderable: true,
        total_count: 25,
      }));
      const built: any[] = [
        mainMenu(to, lang),
        mainMenu(to, lang, "aiOff"),
        mainMenu(to, lang, "tapFailed"),
        handoffWaitCard(to, lang),
        noDeliveryCard(to, lang),
        ...vendorChoices(
          to,
          lang,
          [
            {
              ref: "v1",
              name_en: "A restaurant with a rather long name",
              is_open: true,
              straight_km: 8.2,
            },
          ],
          null,
          "pickPickup",
        ),
        ...vendorChoices(
          to,
          lang,
          Array.from({ length: 6 }, (_, k) => ({
            ref: `v${k + 1}`,
            name_ar: `محل طويل الاسم جداً رقم ${k}`,
            is_open: k % 2 === 0,
            straight_km: 9.5,
          })),
          null,
          "pickPickup",
        ),
        sectionList(to, lang, "A restaurant with a rather long name", sections),
        qtyList(to, lang, "A very long item name number 3", "i3"),
        cashAsk(to, lang, ["USD", "LBP"]),
        cashAsk(to, lang, ["LBP"]),
        ...sectionMenuList(to, lang, "A restaurant with a rather long name", rows, null, false, {
          title: "A very long section name",
          more: { ref: "s2", offset: 9 },
        }),
        ...summaryMessage(
          to,
          lang,
          {
            status: "ok",
            basket: {
              basket_id: "11111111-2222-3333-4444-555555555555",
              vendor: "مطعم",
              subtotal_usd: 5,
              menu_version: 3,
              lines: [{ name: "فلافل", quantity: 2, line_total_usd: 5 }],
            },
            subtotal_usd: 5,
            delivery_fee_usd: 2,
            total_usd: 7,
            total_lbp: 626500,
            usd_lbp_rate: 89500,
            address: { place: "بعقلين", place_en: "Baakline" },
          },
          true,
          "LBP",
        ),
      ];
      for (const p of built)
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 90)).toEqual([]);
    });
  }
  it("a section page with more items has nine items and a More row", () => {
    const rows = Array.from({ length: 10 }, (_, k) => ({
      ref: `i${k + 1}`,
      name_en: `Item ${k}`,
      price_usd: 1,
      orderable: true,
      total_count: 25,
    }));
    const [p]: any[] = sectionMenuList("+96171000001", "en", "Shop", rows, null, false, {
      title: "Grills",
      more: { ref: "s2", offset: 9 },
    });
    const ids = p.interactive.action.sections[0].rows.map((r: any) => r.id);
    expect(ids.length).toBe(10);
    expect(ids[9]).toBe("mo:s2:9");
    expect(ids.slice(0, 9).every((i: string) => i.startsWith("pi:i"))).toBe(true);
  });
});

import { trackMessage, cancelAsk, fulfilmentAsk } from "../dispatch/customer/render";
describe("the track card with its cancel button (staging simulator finding)", () => {
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`passes the checker in ${lang}, with a button only while the order can still be cancelled`, () => {
      const t = {
        order_id: "0b9d7b53-1f0a-4a8e-9a4d-0c3d2f7a1b11",
        code: "ABC123",
        status: "accepted",
        vendor: "ألو",
        vendor_en: "Alo",
        eta: { min: 15, max: 25 },
        delivery_code: "4821",
      };
      const [m]: any = trackMessage("+96170000001", lang, t);
      expect(checkInteractive(m)).toEqual([]);
      expect(m.interactive.action.buttons[0].reply.id).toBe("c:cancel");
      expect(checkInteractive(cancelAsk("+96170000001", lang, t) as any)).toEqual([]);
      const [done]: any = trackMessage("+96170000001", lang, { ...t, status: "out_for_delivery" });
      expect(done.type).toBe("text");
    });
  }
});

describe("Delivery / Pickup card (session 6a, DECISIONS §37.6)", () => {
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`passes the checker in ${lang} with exactly two buttons`, () => {
      const m: any = fulfilmentAsk("+96170000001", lang);
      expect(checkInteractive(m)).toEqual([]);
      expect(m.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
        "c:delivery",
        "c:pickup",
      ]);
    });
  }
});

describe("the track card on a pickup order says shop, never driver (session 6a, DECISIONS §37.6)", () => {
  const t = {
    order_id: "0b9d7b53-1f0a-4a8e-9a4d-0c3d2f7a1b11",
    code: "ABC123",
    status: "ready",
    vendor: "ألو",
    vendor_en: "Alo",
    delivery_code: "4821",
  };
  const bodyOf = (m: any) => m.interactive?.body?.text ?? m.text?.body ?? "";
  it("pickup: the code goes to the shop", () => {
    const [m]: any = trackMessage("+96170000001", "en", { ...t, fulfilment: "pickup" });
    expect(bodyOf(m)).toContain("Pickup code: 4821");
    expect(bodyOf(m)).toContain("shop");
    expect(bodyOf(m)).not.toMatch(/driver/i);
    expect(checkInteractive(m)).toEqual([]);
  });
  it("pickup in French, Arabic and Arabizi names the shop too", () => {
    for (const [lang, word] of [
      ["fr", "magasin"],
      ["ar", "للمحل"],
      ["arabizi", "mahal"],
    ] as const) {
      const [m]: any = trackMessage("+96170000001", lang, { ...t, fulfilment: "pickup" });
      expect(bodyOf(m)).toContain(word);
      expect(bodyOf(m)).not.toMatch(/driver|livreur|للسايق|SAYEQ/i);
    }
  });
  it("delivery keeps the driver wording", () => {
    const [m]: any = trackMessage("+96170000001", "en", { ...t, fulfilment: "delivery" });
    expect(bodyOf(m)).toContain("driver");
  });
});

describe('"Not on Alo King yet" and the places instead (DECISIONS §39.3)', () => {
  const long = {
    name_ar: "مطعم ومشاوي وحلويات بإسم طويل جداً جداً جداً جداً لتجربة الحدود",
    name_en: "A restaurant, grill and sweets shop with a very very long name to test the limits",
    place_ar: "معاصر بيت الدين",
    place_en: "Maasser Beit ed Dine",
    ask_url: "https://aloking.com/ar/ask/a-restaurant-grill-and-sweets-shop?ch=bot",
  };
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`builds a valid ask card and alternatives in ${lang}`, () => {
      const card: any = notOnAloKingCard("+96171000001", lang, long);
      expect(card.interactive.type).toBe("cta_url");
      expect(card.interactive.action.parameters.url).toBe(long.ask_url);
      const built: any[] = [
        card,
        notOnAloKingCard("+96171000001", lang, { ...long, ask_url: null }),
        ...vendorChoices(
          "+96171000001",
          lang,
          Array.from({ length: 3 }, (_, k) => ({
            ref: `v${k + 1}`,
            name_ar: `محل رقم ${k}`,
            name_en: `Shop number ${k}`,
            is_open: true,
            straight_km: 2.5,
          })),
          null,
          "pickInstead",
        ),
      ];
      for (const p of built)
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 90)).toEqual([]);
    });
  }
  it("never puts a non-https link in the card", () => {
    const p: any = notOnAloKingCard("+96171000001", "en", {
      ...long,
      ask_url: "javascript:alert(1)",
    });
    expect(p.type).toBe("text");
  });
});

import {
  addressConfirmCard,
  catalogList,
  consentAsk,
  forWhomCard,
  memoryCard,
  problemLinesList,
  problemQtyList,
  belowMinimumMessage,
  problemList,
  welcomeBack,
} from "../dispatch/customer/render";
import { alternativesCard, deliveredRateList } from "./customer-cards";
describe("session 5c customer agent cards (DECISIONS §38.3, §39.6)", () => {
  const to = "+96171000001";
  const UUID = "0b9d7b53-1f0a-4a8e-9a4d-0c3d2f7a1b11";
  const longName = "مطعم ومشاوي وحلويات بإسم طويل جداً جداً جداً جداً لتجربة الحدود القصوى";
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`every new card passes the checker in ${lang}`, () => {
      const items = Array.from({ length: 12 }, (_, k) => ({
        ref: `i${k + 1}`,
        name_ar: longName,
        name_en: "A very long item name that goes well beyond any WhatsApp row limit",
        price_usd: 12.5,
        vendor_ar: longName,
        vendor_en: "Vendor with a really long name for testing",
        hint: ["sesame", "eggs", "gluten"],
      }));
      const built: any[] = [
        catalogList(
          to,
          lang,
          "manoushe kishk with extra cheese and a very long request text indeed",
          items,
          2,
        ),
        ...memoryCard(
          to,
          lang,
          {
            name: "Rami",
            language: "arabizi",
            addresses: Array.from({ length: 5 }, (_, k) => ({
              address_id: UUID,
              label: `Home number ${k} with a long label`,
              place_ar: "بعقلين",
              place_en: "Baakline",
            })),
            usual: [{ name: "شاورما", name_en: "Shawarma" }],
            orders: 4,
            facts: [
              { key: "vegetarian", value: "yes", since: "2026-10-14T10:00:00Z" },
              {
                key: "allergy",
                value: "nuts and sesame and something very long",
                since: "2026-10-14T10:00:00Z",
                health: true,
              },
              { key: "gluten_free", value: "yes", since: "2026-10-14T10:00:00Z", health: true },
              { key: "note", value: "no onions please", since: "2026-10-14T10:00:00Z" },
            ],
          },
          ["a1", "a2", "a3", "a4", "a5"],
        ),
        consentAsk(to, lang, "allergy", "nuts and sesame"),
        welcomeBack(
          to,
          lang,
          {
            vendor: longName,
            vendor_en: "Vendor",
            items: "2× Shawarma, 1× Fries",
            items_ar: "٢× شاورما",
          },
          "Rami",
        ),
        addressConfirmCard(
          to,
          lang,
          { ref: "a1", where: "Home – Baakline, Building with a long name" },
          [],
        ),
        addressConfirmCard(
          to,
          lang,
          { ref: "a1", where: "Home – Baakline" },
          Array.from({ length: 9 }, (_, k) => ({
            ref: `a${k + 2}`,
            where: `Teta's house number ${k} – Deir el Qamar`,
          })),
        ),
        forWhomCard(to, lang, "Baakline, Building Saint Elias, near the church with a long name"),
        problemList(to, lang, "ABC123"),
        belowMinimumMessage(to, lang, {
          status: "below_minimum",
          min_order_usd: 500,
          missing_usd: 499.5,
        }),
        problemLinesList(
          to,
          lang,
          "missing_item",
          Array.from({ length: 12 }, (_, k) => ({
            order_item_id: UUID.slice(0, -2) + String(10 + k),
            name_ar: longName,
            name_en: longName,
            quantity: 2,
          })),
        ),
        problemQtyList(to, lang, "wrong_item", {
          order_item_id: UUID,
          name_ar: longName,
          name_en: longName,
          quantity: 40,
        }),
        mainMenu(to, lang, "medicine"),
        mainMenu(to, lang, "offTopic"),
        mainMenu(to, lang, "voiceOff"),
        mainMenu(to, lang, "catalogNone", { q: "sushi" }),
        deliveredRateList(to, UUID, true, lang, "ABC123"),
        alternativesCard(
          to,
          "Cancelled",
          [
            { ref: "v1", name_ar: longName, name_en: longName },
            { ref: "v2", name_en: "B" },
          ],
          lang,
        ),
        ...summaryMessage(
          to,
          lang,
          {
            status: "ok",
            basket: {
              basket_id: UUID,
              vendor: "ألو",
              vendor_en: "Alo",
              subtotal_usd: 10,
              lines: [{ name: "x", quantity: 1, line_total_usd: 10 }],
            },
            subtotal_usd: 10,
            delivery_fee_usd: 2,
            credit_usd: 5,
            offer_usd: 1,
            offer: { kind: "percent", percent: 10 },
            total_usd: 7,
            total_lbp: 626500,
            usd_lbp_rate: 89500,
            is_gift: true,
            recipient_name: "Mom",
            allergy_note: "nuts",
            address: { place: "بعقلين", place_en: "Baakline" },
          },
          false,
          "USD",
        ),
        ...customerStatusMessages(
          to,
          {
            kind: "gift_request",
            lang,
            gift_id: UUID,
            sender: "Rami",
            vendor: longName,
            vendor_en: "Vendor",
            lines: Array.from({ length: 20 }, () => ({ q: 2, name: longName, name_en: "Item" })),
            total_usd: 20,
            total_lbp: 1790000,
            usd_lbp_rate: 89500,
            place: "بعقلين",
            place_en: "Baakline",
          },
          null,
        ),
        ...customerStatusMessages(
          to,
          { kind: "delivered", lang, ask_delivery: true },
          { order_id: UUID, code: "ABC123" },
        ),
        ...customerStatusMessages(
          to,
          {
            kind: "on_the_way",
            lang,
            track_url: "https://aloking.com/t/abc",
            driver_phone: "+96171000009",
          },
          { order_id: UUID, code: "ABC123" },
        ),
        ...customerStatusMessages(to, { kind: "gift_expired", lang, recipient_name: "Mom" }, null),
        ...customerStatusMessages(
          to,
          { kind: "gift_failed", lang, recipient_name: longName, reason: "changed" },
          null,
        ),
      ];
      for (const p of built)
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 120)).toEqual([]);
    });
  }
  it("the delivered message carries the rating and the problem row, never a separate Received button", () => {
    const [m]: any = customerStatusMessages(
      to,
      { kind: "delivered", lang: "en", ask_delivery: false },
      { order_id: UUID, code: "ABC123" },
    );
    const ids = m.interactive.action.sections.flatMap((s: any) => s.rows.map((r: any) => r.id));
    expect(ids).toContain(`rate:${UUID}:f5`);
    expect(ids).toContain(`rcv:${UUID}:no`);
    expect(ids).not.toContain(`rcv:${UUID}:ok`);
  });
  it("a gift request without a valid id sends nothing", () => {
    expect(
      customerStatusMessages(to, { kind: "gift_request", lang: "en", gift_id: "x" }, null),
    ).toEqual([]);
  });
});

// Session 5b: templates are not interactive messages, but they have limits of their own (body 1024, footer 60, quick
// replies of 25 characters, at most 3 here); every template, in every language, built for sending and for Meta.
import { TEMPLATES, TEMPLATE_LANGS, checkTemplate, templateMessage } from "./whatsapp-templates";
import { templatePayload } from "../dispatch/templates";

describe("WhatsApp templates (DECISIONS §39.8)", () => {
  for (const t of TEMPLATES)
    it(`${t.name} stays inside Meta's template limits and builds in ar, en and fr`, () => {
      expect(checkTemplate(t)).toEqual([]);
      for (const lang of TEMPLATE_LANGS) {
        const n = t.category === "AUTHENTICATION" ? 0 : (t.buttons?.[lang]?.length ?? 0);
        const msg: any = templateMessage(
          "+96170000001",
          t,
          lang,
          t.example,
          Array.from({ length: n }, (_, i) => `p${i}`),
        );
        expect(msg.type).toBe("template");
        expect(checkInteractive(msg)).toEqual([]);
        for (const b of msg.template.components.filter((c: any) => c.sub_type === "quick_reply"))
          expect(String(b.parameters[0].payload).length).toBeLessThanOrEqual(META.buttonId);
      }
    });
  it("the dispatch filler builds a sendable template for every message it covers", () => {
    const UUID = "11111111-2222-3333-4444-555555555555";
    const card = {
      order_id: UUID,
      code: "ABC123",
      vendor_name: "V",
      total_usd: 1,
      total_lbp: 89500,
      items: [{ name: "Wrap", quantity: 1 }],
    };
    for (const [key, purpose, payload] of [
      ["accepted", "customer_message", { kind: "accepted", eta: { min: 20, max: 30 } }],
      ["on_the_way", "customer_message", { kind: "on_the_way", eta: { min: 5 } }],
      ["delivered", "customer_message", { kind: "delivered" }],
      [
        "gift_accepted",
        "customer_message",
        { kind: "gift_accepted", code: "ABC123", recipient_name: "M" },
      ],
      [
        "gift_request",
        "customer_message",
        {
          kind: "gift_request",
          gift_id: UUID,
          sender: "R",
          vendor: "V",
          total_usd: 1,
          total_lbp: 1,
        },
      ],
      ["new_order", "new_order", {}],
      ["proposal", "proposal", { proposal_id: UUID, summary: "s", vendor_name: "V" }],
      [
        "merchant_weekly",
        "reply",
        {
          kind: "merchant_weekly",
          shop: "V",
          orders: "1",
          delivered: "1",
          sales: "$1.00",
          rating: "5",
        },
      ],
    ] as const) {
      const t = TEMPLATES.find((x) => x.key === key)!;
      for (const lang of TEMPLATE_LANGS) {
        const msg = templatePayload({ name: t.name, lang }, key, {
          order_id: UUID,
          target: "+96170000001",
          purpose,
          payload,
          card,
        });
        expect(msg, `${key}/${lang}`).not.toBeNull();
      }
    }
  });
});

// Session 5b ops console (§32.1): the WhatsApp admin confirm card and the support messages.
import { handleAdmin } from "../dispatch/admin";

describe("admin and support messages (5b)", () => {
  it("the admin confirm card stays inside the button limits, with a long question", async () => {
    const sent: any[] = [];
    await handleAdmin(
      {
        rpc: async (fn: string, a: any) =>
          fn === "ops_action_propose"
            ? "6a000000-0000-0000-0000-000000000001"
            : fn === "app_reply"
              ? sent.push(a)
              : null,
      },
      { from: "+96170009999", messageId: "m" },
      { user_id: "u", role: "admin", name: "R" },
      null,
      { kind: "reply", text: "x".repeat(1500) },
    );
    expect(
      checkInteractive({ type: "interactive", interactive: sent[0].p_payload.interactive }),
    ).toEqual([]);
  });
  it("support replies and the closing note are plain text", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"]) {
      const [r]: any = customerStatusMessages(
        "+96170000001",
        { kind: "support_reply", lang, name: "Rasheed", text: "On its way" },
        null,
      );
      expect(r.text.body).toBe("👤 Rasheed, Alo King:\nOn its way");
      const [c]: any = customerStatusMessages(
        "+96170000001",
        { kind: "support_closed", lang },
        null,
      );
      expect(c.text.body.length).toBeGreaterThan(10);
    }
  });
});

// The Meta catalogue and the native cart (session 5d, DECISIONS §39.12).
import { productMessage } from "./catalog";
import { buttons as cartButtons } from "./customer-cards";

describe("catalogue and cart builders (session 5d, §39.12)", () => {
  const products = Array.from({ length: 45 }, (_, k) => ({
    retailer_id: `53000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
    name_en: `Dish ${k}`,
    section: `قسم طويل جداً رقم ${k % 12} مع اسم طويل`,
    section_en: `A very long section name number ${k % 12}`,
  }));
  it("a multi-product message of a big shop, in every language, stays within 30 items, 10 sections and the title limits", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      const m = productListMessage(
        "+96170000001",
        "1234567890",
        "مطعم باسم طويل جداً يتجاوز الستين حرفاً في العنوان مرة واحدة",
        "x".repeat(1100),
        products,
        {
          lang,
          footer: "y".repeat(80),
        },
      );
      expect(checkInteractive(m), lang).toEqual([]);
    }
  });
  it("a single-product message passes, with and without a footer", () => {
    expect(
      checkInteractive(
        productMessage(
          "+96170000001",
          "1234567890",
          products[0].retailer_id,
          "b".repeat(1100),
          "f".repeat(80),
        ),
      ),
    ).toEqual([]);
    expect(
      checkInteractive(
        productMessage("+96170000001", "1234567890", products[0].retailer_id, "Found it"),
      ),
    ).toEqual([]);
  });
  it("the cart from another shop card (Use the new cart / Keep basket) passes in every language", () => {
    const titles: Record<string, [string, string]> = {
      ar: ["خود السلّة الجديدة", "خلّي السلّة"],
      en: ["Use the new cart", "Keep basket"],
      fr: ["Prendre le nouveau", "Garder"],
      arabizi: ["Esta3mel el jdide", "Khalle el salle"],
    };
    for (const [lang, [a, b]] of Object.entries(titles))
      expect(
        checkInteractive(
          cartButtons("+96170000001", "x".repeat(900), [
            ["c:cart_replace", a],
            ["c:keep", b],
          ]),
        ),
        lang,
      ).toEqual([]);
  });
});

import {
  cravingList,
  moreSectionsList,
  sectionNextButton,
  shopList,
} from "../dispatch/customer/render";
import { image } from "./customer-cards";
import { packShopMenu } from "./catalog";
describe("session 5e browsing cards", () => {
  const to = "+96171000001";
  const longName = "مطعم ومشاوي وحلويات بإسم طويل جداً جداً جداً جداً لتجربة الحدود القصوى";
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`every browsing card passes the checker in ${lang}`, () => {
      const cats = Array.from({ length: 14 }, (_, k) => ({
        key: `cat_${k}`,
        emoji: "🍔",
        name: `Category with a very long name ${k}`,
        shops: k + 1,
      }));
      const shops = Array.from({ length: 14 }, (_, k) => ({
        ref: `v${k + 1}`,
        name_ar: longName,
        name_en: "A shop with a really long name for testing the row limit",
        is_open: k % 3 !== 0,
        km: 12.345 + k,
        fee_usd: 4.5,
        village_ar: "معاصر بيت الدين",
        village_en: "Maasser Beit ed Dine with a long village name",
      }));
      const secs = Array.from({ length: 14 }, (_, k) => ({
        ref: `s${(k % 10) + 1}`,
        name_ar: longName,
        name_en: "A section with a very long name indeed",
        items: 120,
      }));
      const built: any[] = [
        cravingList(to, lang, cats, 29, "Maasser Beit ed Dine with a long village name"),
        cravingList(to, lang, cats, 29, null, 8),
        cravingList(to, lang, [], 1, null),
        cravingList(
          to,
          lang,
          cats,
          29,
          "Maasser Beit ed Dine with a long village name",
          0,
          "✅ Address saved: " + "Maasser Beit ed Dine, near the long landmark name ".repeat(3),
        ),
        shopList(to, lang, "🍔 Burgers: pick a shop.", shops),
        moreSectionsList(to, lang, longName, secs, 9),
        moreSectionsList(to, lang, longName, secs.slice(0, 3), null),
        sectionNextButton(to, lang, longName, "s1", 30, 30, 75),
      ];
      for (const m of built)
        expect(checkInteractive(m), JSON.stringify(m).slice(0, 200)).toEqual([]);
      expect(image(to, "https://x/y.jpg", "c".repeat(2000)).image.caption).toHaveLength(1024);
    });
  }

  it("a shop's first product message stays within 30 items and 10 sections", () => {
    const sections = Array.from({ length: 27 }, (_, k) => ({
      section_id: `s${k}`,
      name_ar: `قسم ${k}`,
      name_en: `Section ${k}`,
      total: 40,
      products: Array.from({ length: 40 }, (_, j) => ({ retailer_id: `${k}-${j}` })),
    }));
    const { products, rest } = packShopMenu(sections, { perSection: 6 });
    expect(products).toHaveLength(30);
    expect(new Set(products.map((p) => p.section_en)).size).toBe(5);
    expect(rest).toHaveLength(27);
    const msg = productListMessage(to, "1234567890", "Deli", "Tap", products);
    expect(checkInteractive(msg)).toEqual([]);
    // Two small sections are shown in full, with nothing left for the list.
    const two = packShopMenu(
      sections.slice(0, 2).map((s) => ({ ...s, total: 8, products: s.products.slice(0, 8) })),
      {
        perSection: 6,
      },
    );
    expect(two.products).toHaveLength(16);
    expect(two.rest).toHaveLength(0);
  });
});

// Every error carries a way forward (session 5f, DECISIONS §39.15.1): each error string with its buttons, four languages.
import { ERROR_WAYS, errorCard } from "../dispatch/customer/render";

describe("error cards (session 5f)", () => {
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`every error card is a valid button message in ${lang}`, () => {
      for (const key of Object.keys(ERROR_WAYS)) {
        const m = errorCard("+96171000001", lang, key, {
          vendor: "A restaurant with a rather long name",
          item: "A very long item name number 9",
          name: "Teta",
          code: "AB3CD9",
          days: 3,
        });
        expect(checkInteractive(m), `${key} in ${lang}`).toEqual([]);
      }
    });
  }
});

// Carts from several shops (session 5f, §39.15.2): the split list and its buttons.
import { splitCartList, otherVendorCard, savedCartOfferCard } from "../dispatch/customer/render";
describe("splitCartList passes the checker", () => {
  it("in all languages, with long names, shops that do not deliver and their alternatives, capped at 10 rows", () => {
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      const shops = Array.from({ length: 8 }, (_, k) => ({
        saved_cart_id: `5c000000-0000-0000-0000-00000000000${k}`,
        vendor: "مطعم الضيعة والمشاوي اللبنانية الأصيلة ".repeat(2),
        vendor_en: "The Village Grill and Authentic Lebanese Mezze House ".repeat(2),
        items: 12,
        subtotal_usd: 123.456,
        delivers: k % 2 === 0 ? false : true,
        alternative:
          k % 2 === 0
            ? {
                item_id: `5c000000-0000-0000-0000-0000000000a${k}`,
                vendor: "محل بعيد شوي بس بيوصّل ".repeat(2),
                vendor_en: "A shop a little further that delivers ".repeat(2),
                item: "سندويش فلافل مع طحينة وخضرة ".repeat(2),
                item_en: "Falafel sandwich with tahini and greens ".repeat(2),
                price_usd: 4.5,
              }
            : null,
      }));
      const p = splitCartList(
        "+96170000001",
        lang,
        shops,
        "Maasser Beit ed Dine with a long village name",
      );
      expect(checkInteractive(p)).toEqual([]);
      expect(p.interactive.action.sections[0].rows.length).toBeLessThanOrEqual(10);
      // Fifteen shops that all miss the pin and share one alternative: still unique ids, still 10 rows, paused note too.
      const same = Array.from({ length: 15 }, (_, k) => ({
        ...shops[0],
        saved_cart_id: `5c000000-0000-0000-0000-0000000002${String(k).padStart(2, "0")}`,
        alternative: { ...shops[0].alternative!, quantity: 50 },
      }));
      const q = splitCartList("+96170000001", lang, same, null, true);
      expect(checkInteractive(q)).toEqual([]);
      const ids = q.interactive.action.sections[0].rows.map((r: any) => r.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
    }
  });
  it("the Switch / Keep / Do both card and the next saved cart's offer, in all languages, with long names", () => {
    const long = "The Village Grill and Authentic Lebanese Mezze House مطعم الضيعة ".repeat(3);
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      expect(checkInteractive(otherVendorCard("+96170000001", lang, long, long))).toEqual([]);
      expect(
        checkInteractive(
          savedCartOfferCard("+96170000001", lang, {
            saved_cart_id: "5c000000-0000-0000-0000-000000000001",
            vendor: long,
            vendor_en: long,
            items: 30,
          }),
        ),
      ).toEqual([]);
    }
  });
});

// Demo testers (session 5f part 6, DECISIONS §39.15.3): the demo addresses card and the "test is full" menu.
import { demoAddressCard, testerFullMenu } from "../dispatch/customer/render";
import { parseCustomerAction as parseTap } from "./customer-cards";
describe("demo tester cards pass the checker", () => {
  const long = {
    key: "a_very_long_place_key",
    name_en: "Maasser Beit ed Dine with a very long name",
    name_ar: "معاصر بيت الدين مع اسم طويل جداً جداً",
    name_fr: "Maasser Beit ed Dine avec un nom très long",
  };
  const choices = [
    { key: "baakleen", name_en: "Baakleen", name_ar: "بعقلين", name_fr: "Baakline" },
    {
      key: "deir_el_qamar",
      name_en: "Deir el Qamar",
      name_ar: "دير القمر",
      name_fr: "Deir el Qamar",
    },
    { key: "beiteddine", name_en: "Beiteddine", name_ar: "بيت الدين", name_fr: "Beiteddine" },
    long,
  ];
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`in ${lang}, with long names and more than three choices`, () => {
      const card: any = demoAddressCard("+447700900001", lang, choices);
      expect(checkInteractive(card)).toEqual([]);
      expect(card.interactive.action.buttons).toHaveLength(3);
      for (const b of card.interactive.action.buttons)
        expect(parseTap(b.reply.id)?.a, b.reply.id).toBe("demo_address");
      const twice: any = demoAddressCard("+447700900001", lang, [long, long]);
      expect(checkInteractive(twice)).toEqual([]);
      expect(twice.interactive.action.buttons).toHaveLength(1);
      expect(checkInteractive(testerFullMenu("+447700900001", lang))).toEqual([]);
      // Change address during the test (session 5g part 0f): the same card with its own body.
      expect(
        checkInteractive(demoAddressCard("+447700900001", lang, choices, "demoChange")),
      ).toEqual([]);
    });
  }
  it("a key that is not one is left out", () => {
    const card: any = demoAddressCard("+447700900001", "en", [
      { key: "Bad Key!", name_en: "X" },
      choices[0],
    ]);
    expect(card.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(["da:baakleen"]);
    expect(parseTap("da:Bad")).toBeNull();
  });
});

// Session 5f part 7: the chat after the native cart and at checkout (#25, #26, #35, #38) and the product carousel (§39.15.2).
import {
  basketMessage,
  changeAsk,
  choiceAsk,
  extrasList,
  noteLinesList,
  notePrompt,
  summaryMessage as summaryWithExtras,
  tipAfterCard,
  tipConfirmCard,
  tipRow,
} from "../dispatch/customer/render";
import { productCarouselMessage } from "./catalog";
import { parseCustomerAction as parseP7 } from "./customer-cards";
describe("session 5f part 7 cards pass the checker", () => {
  const to = "+96170000001";
  const U = (k: number) => `5f700000-0000-0000-0000-${String(k).padStart(12, "0")}`;
  const longAr = "صوص الثوم الخاص بالمطعم مع حبق وليمون ";
  const longEn = "The house garlic sauce with basil and lemon ";
  const opts = (n: number) =>
    Array.from({ length: n }, (_, k) => ({
      option_id: U(k + 1),
      name: longAr.repeat(2),
      name_en: longEn.repeat(2),
      price_delta_usd: k % 2 ? 12.5 : 0,
    }));
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`every new card is valid in ${lang}, with long names and many options`, () => {
      const group = { name: longAr, name_en: longEn, min: 2, max: 3, room: 3, options: opts(14) };
      const lines = Array.from({ length: 13 }, (_, k) => ({
        line_id: U(100 + k),
        name: longAr,
        name_en: longEn,
        quantity: 50,
        note: "ب".repeat(80),
      }));
      const basket = {
        basket_id: U(200),
        vendor: longAr,
        vendor_en: longEn,
        subtotal_usd: 999.99,
        menu_version: 3,
        lines: lines.map((l) => ({ ...l, line_total_usd: 99.5, options: ["كبير", "حار"] })),
      };
      const built: any[] = [
        choiceAsk(to, lang, longEn.repeat(3), group, opts(2), 1),
        choiceAsk(to, lang, longEn.repeat(3), group, opts(3), 2),
        choiceAsk(to, lang, longEn.repeat(3), group, opts(14), 1),
        // Two options whose button titles would be the same: a list instead.
        choiceAsk(to, lang, "x", group, [opts(1)[0], { ...opts(1)[0], option_id: U(99) }], 1),
        extrasList(to, lang, longEn, [group, { ...group, name_en: "Sauces", options: opts(6) }]),
        extrasList(to, lang, longEn, [{ ...group, options: opts(2) }], true),
        extrasList(
          to,
          lang,
          longEn,
          [group, { ...group, name_en: "Sauces", options: opts(6) }],
          false,
          true,
        ),
        extrasList(to, lang, longEn, [{ ...group, options: opts(1) }], true, true),
        noteLinesList(to, lang, lines),
        notePrompt(to, lang, longEn.repeat(4), 80),
        notePrompt(to, lang, longEn.repeat(4), null),
        changeAsk(to, lang, "USD", 12.25, [20, 50, 100]),
        changeAsk(to, lang, "USD", 12.25, [50, 100]),
        changeAsk(to, lang, "LBP", 13290750, [20000000, 50000000, 100000000, 5000000000]),
        // The total in both currencies (the longer body).
        changeAsk(to, lang, "LBP", 90170355, [100000000, 5000000000], {
          total_usd: 1007.49,
          total_lbp: 90170355,
          usd_lbp_rate: 89500,
        }),
        tipRow(to, lang, [1, 2, 3], 0),
        tipRow(to, lang, [1, 2, 3], 2),
        tipRow(to, lang, [0.5, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30], 2),
        tipAfterCard(to, lang, U(300), [1, 2], "thanksRating"),
        tipAfterCard(to, lang, U(300), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "glad"),
        // The AI's tip_order: the customer confirms with a tap (amounts up to the 6-digit cents the tap id carries).
        tipConfirmCard(to, lang, U(300), 50),
        tipConfirmCard(to, lang, U(300), 999999),
        ...basketMessage(to, lang, basket),
        ...summaryWithExtras(
          to,
          lang,
          {
            status: "ok",
            basket,
            subtotal_usd: 999.99,
            delivery_fee_usd: 4.5,
            total_usd: 1004.49,
            total_lbp: 89901855,
            usd_lbp_rate: 89500,
            address: { place: longAr, place_en: longEn, building: longEn },
          },
          true,
          "LBP",
          {
            tip_usd: 3,
            total_usd: 1007.49,
            total_lbp: 90170355,
            usd_lbp_rate: 89500,
            change: { status: "set", currency: "LBP", change_for: 100000000, change_due: 9829645 },
          },
        ),
      ];
      for (const m of built)
        expect(checkInteractive(m), JSON.stringify(m).slice(0, 160)).toEqual([]);
      // A long basket keeps its totals whole: the item lines give way ("+N more items"), never the total.
      const sum = built[built.length - 1].interactive.body.text;
      expect(sum).toContain("$1007.49");
      expect(sum).toMatch(/\+\d+ /);
      expect(built[built.length - 2].interactive.body.text).toContain("$999.99");
      // Every tap these cards carry is one the bot understands.
      for (const m of built)
        for (const id of [
          ...(m.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id),
          ...(m.interactive?.action?.sections ?? []).flatMap((s: any) =>
            s.rows.map((r: any) => r.id),
          ),
        ])
          if (!/^(cfm|c):/.test(id)) expect(parseP7(id), id).not.toBeNull();
    });
  }

  it("the product carousel: 2 to 10 product cards of one catalogue, a body, no header", () => {
    const ids = Array.from({ length: 12 }, (_, k) => U(k + 1));
    const ok = productCarouselMessage(to, "1234567890", "🔥 ".repeat(600), ids.slice(0, 10));
    expect(checkInteractive(ok)).toEqual([]);
    expect(ok.interactive.action.cards).toHaveLength(10);
    expect(ok.interactive.action.cards[9]).toEqual({
      card_index: 9,
      type: "product",
      action: { product_retailer_id: ids[9], catalog_id: "1234567890" },
    });
    // The builder keeps 10 distinct ids; the checker catches what a hand-made payload gets wrong.
    expect(
      productCarouselMessage(to, "1", "b", [...ids, ids[0]]).interactive.action.cards,
    ).toHaveLength(10);
    const one = productCarouselMessage(to, "1", "b", ids.slice(0, 1));
    expect(checkInteractive(one).join()).toMatch(/1 cards < 2/);
    const eleven: any = productCarouselMessage(to, "1", "b", ids.slice(0, 2));
    eleven.interactive.action.cards = ids.slice(0, 11).map((id, k) => ({
      card_index: k,
      type: "product",
      action: { product_retailer_id: id, catalog_id: k === 3 ? "2" : "1" },
    }));
    const bad = checkInteractive(eleven).join();
    expect(bad).toMatch(/11 cards > 10/);
    expect(bad).toMatch(/same catalogue/);
    expect(checkInteractive(clampInteractive(eleven)).join()).not.toMatch(/cards >/);
    const headed: any = productCarouselMessage(to, "1", "b", ids.slice(0, 2));
    headed.interactive.header = { type: "text", text: "x" };
    headed.interactive.action.cards[1].card_index = 5;
    expect(checkInteractive(headed).join()).toMatch(
      /no header.*card 1 has card_index 5|card 1 has card_index 5.*no header|no header/,
    );
    expect(META.carouselMaxCards).toBe(10);
  });

  it("the merchant's and the driver's cards carry the tip, what to collect and the change, in both languages", () => {
    const d: cards.OrderCardData = {
      order_id: U(1),
      code: "AB3CD9",
      fulfilment: "delivery",
      payment_method: "cod",
      total_usd: 12.25,
      total_lbp: 1096375,
      usd_lbp_rate: 89500,
      items: [
        { name: "برغر", name_en: "Burger", quantity: 1, options: ["كبير"], note: "no onions" },
      ],
      tip_usd: 2,
      collect_usd: 14.25,
      collect_lbp: 1275375,
      cash_change_for: 20,
      cash_change_currency: "USD",
      change_due: 5.75,
    };
    const en: any = cards.orderCard("+96171000001", d, "en");
    expect(en.interactive.body.text).toContain(
      "🙏 Tip $2.00 for whoever delivers · collect $14.25 = 1,275,375 LBP",
    );
    expect(en.interactive.body.text).toContain("💵 Pays with $20.00: bring $5.75 change");
    expect(en.interactive.body.text).toContain("1× Burger (كبير) · no onions");
    const [job]: any[] = cards.driverJobCard(
      "+96171000009",
      d,
      "+96170000001",
      "Ali",
      "Shop",
      "en",
    );
    expect(job.interactive.body.text).toContain("collect $14.25");
    expect(job.interactive.body.text).toContain("bring $5.75 change");
    const lbpCard: any = cards.orderCard(
      "+96171000001",
      {
        ...d,
        tip_usd: 0,
        cash_change_for: 2000000,
        cash_change_currency: "LBP",
        change_due: 903625,
      },
      "ar",
    );
    expect(lbpCard.interactive.body.text).toContain("2,000,000 LBP");
    expect(lbpCard.interactive.body.text).toContain("903,625 LBP");
    expect(lbpCard.interactive.body.text).not.toContain("🙏");
    const exact: any = cards.orderCard("+96171000001", { ...d, cash_change_for: null }, "en");
    expect(exact.interactive.body.text).toContain("Exact cash");
    // A promised tip goes to whoever delivered with "Got it": the only tap that books it (both sources, both languages).
    const tips: any[] = (["ar", "en"] as const).flatMap((l) => [
      cards.tipCard("+96171000001", U(1), "AB3CD9", 2, "after_delivery", l),
      cards.tipCard("+96171000001", U(1), "AB3CD9", "4.50", "checkout", l),
    ]);
    expect(tips[2].interactive.body.text).toBe(
      "🙏 The customer added a $2.00 tip on order #AB3CD9. It's 100% yours; tap when you have it.",
    );
    expect(tips[3].interactive.body.text).toContain("came with a $4.50 tip in the cash");
    expect(tips[2].interactive.action.buttons[0].reply).toEqual({
      id: `tip:${U(1)}`,
      title: "✅ Got it",
    });
    expect(cards.parseMerchantAction(`tip:${U(1)}`)).toEqual({ a: "tip_got", orderId: U(1) });
    expect(cards.parseMerchantAction(`tip:${U(1)}:5`)).toBeNull();
    for (const p of [en, job, lbpCard, exact, ...tips]) expect(checkInteractive(p)).toEqual([]);
    // What the customer is told on acceptance includes the tip they chose.
    const acc: any = customerStatusMessages(
      "+96170000001",
      { kind: "accepted", lang: "en" },
      {
        order_id: U(1),
        code: "AB3CD9",
        total_usd: 12.25,
        total_lbp: 1096375,
        usd_lbp_rate: 89500,
        collect_usd: 14.25,
        collect_lbp: 1275375,
      },
    )[0];
    expect(acc.text.body).toContain("$14.25 = 1,275,375 LBP");
  });

  it("the new tap ids parse, and nothing else does", () => {
    expect(parseP7("ext:none")).toEqual({ a: "extra", optionId: null });
    expect(parseP7("ext:rest")).toEqual({ a: "extra", optionId: null, rest: true });
    expect(parseP7(`ext:${U(1)}`)).toEqual({ a: "extra", optionId: U(1) });
    expect(parseP7("note:add")).toEqual({ a: "note", lineId: null });
    expect(parseP7(`note:${U(2)}`)).toEqual({ a: "note", lineId: U(2) });
    expect(parseP7("chg:USD:exact")).toEqual({ a: "change", currency: "USD", amount: null });
    expect(parseP7("chg:LBP:2000000")).toEqual({ a: "change", currency: "LBP", amount: 2000000 });
    expect(parseP7("tpc:250")).toEqual({ a: "tip", cents: 250 });
    expect(parseP7("tpc:0")).toEqual({ a: "tip", cents: 0 });
    expect(parseP7(`tpo:${U(3)}:other`)).toEqual({ a: "tip_after", orderId: U(3), cents: null });
    expect(parseP7(`tpo:${U(3)}:100`)).toEqual({ a: "tip_after", orderId: U(3), cents: 100 });
    expect(parseP7(`tpo:${U(3)}:300:o`)).toEqual({
      a: "tip_after",
      orderId: U(3),
      cents: 300,
      other: true,
    });
    expect(parseP7(`tpo:${U(3)}:other:o`)).toEqual({ a: "tip_after", orderId: U(3), cents: null });
    for (const bad of [
      "ext:x",
      "note:",
      "chg:EUR:20",
      "chg:USD:-5",
      "chg:USD:0",
      "tpc:-1",
      "tpc:1.5",
      `tpo:${U(3)}:0`,
      "tpo:x:100",
    ])
      expect(parseP7(bad), bad).toBeNull();
  });
});

// The merchant's item photo confirm card (session 5f part 9 review, §39.15.4).
import { itemPhotoCard, parseItemPhotoTap } from "../dispatch/merchant/photo";

describe("item photo confirm card: passes the checker in all four languages", () => {
  const U = "11111111-2222-3333-4444-555555555555";
  it("one button, a long item name, every language", () => {
    const long = "منقوشة كشك مع جبنة وبندورة ونعنع وزيتون وبصل ".repeat(8);
    for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
      const p: any = itemPhotoCard("+96171000001", U, long, lang);
      expect(checkInteractive(p), lang).toEqual([]);
      expect(p.interactive.action.buttons).toHaveLength(1);
      expect(parseItemPhotoTap(p.interactive.action.buttons[0].reply.id)).toBe(U);
    }
    expect(parseItemPhotoTap("IPH|nope")).toBeNull();
    expect(parseItemPhotoTap(`acc:${U}:15`)).toBeNull();
  });
});

// Session 5f part 8a: first contact (CUSTOMER-EXPERIENCE §3.1 #1-7, §3.2 #11, §3.3 #21).
import {
  closedNearCard,
  outsideAreaCard,
  photoCard,
  shopClosedCard,
  shopLinkPin,
  voiceOffCard,
  welcomeMenu,
  whenText,
} from "../dispatch/customer/render";
describe("session 5f part 8a cards pass the checker", () => {
  const to = "+96170000001";
  const V = "5f8a0000-0000-0000-0000-000000000001";
  const longAr = "مطعم الضيعة للمشاوي والمناقيش على الصاج ".repeat(2);
  const longEn = "The Village Grill and Saj Manakish House ".repeat(2);
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`every new card is valid in ${lang}, with long names`, () => {
      const when = whenText(lang, { hm: "12:00", in_days: 3, dow: 1 });
      const built: any[] = [
        welcomeMenu(to, lang),
        voiceOffCard(to, lang),
        photoCard(to, lang),
        closedNearCard(to, lang, { vendor_id: V, name: longEn }, when),
        closedNearCard(to, lang, null, null),
        shopClosedCard(to, lang, { vendorId: V, ref: "v1", name: longAr }, when),
        shopClosedCard(to, lang, { vendorId: V, ref: "v1", name: longAr }, null),
        outsideAreaCard(to, lang, longAr, true),
        outsideAreaCard(to, lang, longEn, false),
        outsideAreaCard(to, lang, null, true),
        shopLinkPin(to, lang, longEn),
        ...customerStatusMessages(
          to,
          { kind: "shop_open", lang, vendor_id: V, vendor: longAr, vendor_en: longEn },
          null,
        ),
        ...customerStatusMessages(to, { kind: "shop_open", lang, vendor_id: null }, null),
        ...customerStatusMessages(
          to,
          { kind: "waitlist_open", lang, place: longAr, place_en: longEn, place_fr: longEn },
          null,
        ),
      ];
      expect(built.length).toBeGreaterThanOrEqual(14);
      for (const m of built)
        expect(checkInteractive(m), JSON.stringify(m).slice(0, 160)).toEqual([]);
    });
  }
});

// Session 5f part 8b (spec §3.5 #28-29, §3.7 #41 and #45, §3.8 #49): every new card, four languages, long names.
import {
  gapItemsMessage,
  otherShopCard,
  problemPhotoAsk,
  shopNoteConfirm,
} from "../dispatch/customer/render";
import { customerStatusMessages as statusMessages, sameDishCard } from "./customer-cards";
import { customerNoteCard } from "./merchant-cards";
describe("session 5f part 8b cards pass the checker", () => {
  const to = "+96171000001";
  const U1 = "8b000000-0000-0000-0000-0000000000a1";
  const longAr = "مطعم ومشاوي وحلويات بإسم طويل جداً جداً جداً جداً لتجربة الحدود القصوى";
  const longEn = "The Village Grill and Authentic Lebanese Mezze House of the Shouf";
  const items = Array.from({ length: 5 }, (_, k) => ({
    item_id: `8b000000-0000-0000-0000-0000000000c${k}`,
    name_ar: longAr,
    name_en: longEn,
    price_usd: 123.456,
  }));
  const alts = Array.from({ length: 5 }, (_, k) => ({
    ref: `v${k + 1}`,
    vendor_id: `8b000000-0000-0000-0000-0000000000b${k}`,
    name_ar: longAr,
    name_en: longEn,
    same_dish: true,
  }));
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`in ${lang}`, () => {
      const built: any[] = [
        otherShopCard(to, lang, longEn, longAr, U1, 99),
        otherShopCard(to, lang, "", "", U1, 1),
        gapItemsMessage(to, lang, longEn, 499.99, items),
        gapItemsMessage(to, lang, longEn, 2.5, items.slice(0, 1)),
        gapItemsMessage(to, lang, longEn, 2.5, []),
        problemPhotoAsk(to, lang),
        shopNoteConfirm(to, lang, longAr, "AB3CD9", "no onions please ".repeat(40)),
        sameDishCard(to, "x".repeat(900), alts, U1, lang),
        ...statusMessages(
          to,
          { kind: "rejected", lang, reason: "menu_or_price_issue", alternatives: alts },
          {
            order_id: U1,
            code: "AB3CD9",
            vendor_name: longAr,
          },
        ),
        ...statusMessages(
          to,
          { kind: "cancelled", lang, reason: "merchant_unreachable", alternatives: alts },
          {
            order_id: U1,
            code: "AB3CD9",
            vendor_name: longEn,
          },
        ),
      ];
      for (const m of built)
        expect(checkInteractive(m), JSON.stringify(m).slice(0, 160)).toEqual([]);
      // Two item buttons at most and Empty basket; the same long name twice still gives two different titles.
      expect(built[2].interactive.action.buttons).toHaveLength(3);
      expect(new Set(built[2].interactive.action.buttons.map((b: any) => b.reply.title)).size).toBe(
        3,
      );
      expect(built[3].interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
        `gap:${items[0].item_id}`,
        "c:menu",
        "c:clear",
      ]);
      expect(built[7].interactive.action.buttons).toHaveLength(3);
    });
  }
  it("the merchant's note card is a short text: the code and the words, nothing else", () => {
    for (const lang of ["ar", "en"] as const) {
      const m: any = customerNoteCard("+96171000005", "AB3CD9", "no onions ".repeat(100), lang);
      expect(m.type).toBe("text");
      expect([...m.text.body].length).toBeLessThan(450);
      expect(m.text.body).toContain("no onions ".repeat(29).trim());
      expect(m.text.body).toContain("#AB3CD9");
    }
  });
});

// DECISIONS §39.15.13: the web menu only as the last "Full menu" row of a shop's section list, and its CTA-URL message.
import { fullMenuCard, withFullMenuRow } from "../dispatch/customer/render";

describe("the Full menu row and card (§39.15.13)", () => {
  const url =
    "https://alo-king.vercel.app/ar/m/a-very-long-shop-slug-for-the-limits?t=Ab3_-Ab3_-Ab3_-Ab3_-Ab3_";
  const secs = Array.from({ length: 12 }, (_, k) => ({
    ref: `s${k + 1}`,
    name_ar: `قسم رقم ${k + 1} بإسم طويل جداً جداً`,
    name_en: `Section number ${k + 1} with a long name`,
    items: 40,
  }));
  for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
    it(`builds valid section lists with Full menu last, and the Full menu card, in ${lang}`, () => {
      const paged: any = moreSectionsList("+96171000001", lang, "A".repeat(80), secs, 8, true);
      const rows = paged.interactive.action.sections[0].rows;
      expect(rows).toHaveLength(10);
      expect(rows.at(-1).id).toBe("fm");
      expect(rows.at(-2).id).toBe("sp:8");
      const short: any = moreSectionsList(
        "+96171000001",
        lang,
        "Shop",
        secs.slice(0, 3),
        null,
        true,
      );
      expect(short.interactive.action.sections[0].rows.map((r: any) => r.id)).toEqual([
        "ps:s1",
        "ps:s2",
        "ps:s3",
        "fm",
      ]);
      const thin: any = withFullMenuRow(
        sectionList("+96171000001", lang, "Shop", secs.slice(0, 4)),
        lang,
      );
      expect(thin.interactive.action.sections[0].rows.at(-1).id).toBe("fm");
      // A full list keeps its sections: no row is dropped for Full menu.
      const full: any = withFullMenuRow(sectionList("+96171000001", lang, "Shop", secs), lang);
      expect(full.interactive.action.sections[0].rows.some((r: any) => r.id === "fm")).toBe(false);
      const card: any = fullMenuCard("+96171000001", lang, "A".repeat(80), url);
      expect(card.interactive.type).toBe("cta_url");
      for (const p of [paged, short, thin, full, card])
        expect(checkInteractive(p), JSON.stringify(p).slice(0, 90)).toEqual([]);
    });
  }
});

// Session 5g (DECISIONS §39.15.11): the number's ice breakers and commands.
import { checkConversational } from "./meta-limits";
import conversational from "../../../whatsapp/conversational.json";

describe("conversational components (ice breakers and commands)", () => {
  it("the ones we set are inside Meta's limits", () => {
    expect(checkConversational(conversational)).toEqual([]);
    expect(conversational.prompts).toHaveLength(4);
    expect(conversational.commands.map((c) => c.command_name)).toEqual([
      "order",
      "explore",
      "orders",
      "help",
    ]);
  });
  it("catches too many, too long, a slash in a name and duplicates", () => {
    expect(checkConversational({ prompts: ["a", "b", "c", "d", "e"] }).join()).toMatch(
      /5 ice breakers/,
    );
    expect(checkConversational({ prompts: ["x".repeat(81)] }).join()).toMatch(/ice breaker/);
    expect(
      checkConversational({
        commands: [{ command_name: "/order", command_description: "x" }],
      }).join(),
    ).toMatch(/bad command name/);
    expect(
      checkConversational({
        commands: [
          { command_name: "a", command_description: "x" },
          { command_name: "a", command_description: "y" },
        ],
      }).join(),
    ).toMatch(/duplicate command/);
  });
});

// DECISIONS §39.15.13: the message that opens the Alo King Flow app.
import { appFlowMessage } from "./flows";

describe("the Alo King app's Flow message (§39.15.13)", () => {
  for (const lang of ["ar", "en"] as const)
    it(`is a valid data-exchange Flow message in ${lang}`, () => {
      const m: any = appFlowMessage("+96171000001", lang, `${"A".repeat(24)}.${"b".repeat(43)}`);
      expect(m.interactive.action.parameters).toMatchObject({
        flow_name: `alo_app_${lang}`,
        flow_action: "data_exchange",
      });
      expect(checkInteractive(m)).toEqual([]);
    });
});
