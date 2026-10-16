// Session 5c (DECISIONS §38.3, §39.6): the customer agent's flows, without network, database or model. The model side is
// replayed from recorded answers (evals/customer/fixtures/model-turns.json); the server side is a fake RPC layer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  handleCustomerTurn,
  type CustomerDeps,
  type CustomerInbound,
  type ModelResponse,
} from "./turn";
import {
  FACT_RE,
  isMedicineRequest,
  isMemoryQuestion,
  isOffTopic,
  mentionsSomeoneElse,
} from "./intents";
import { customerStatusMessages, parseCustomerAction } from "../../_shared/customer-cards";

const CUST = "10000000-0000-0000-0000-000000000001";
const VENDOR = "20000000-0000-0000-0000-00000000000a";
const ITEM = "51000000-0000-0000-0000-000000000001";
const ITEM2 = "51000000-0000-0000-0000-000000000002";
const BASKET = "60000000-0000-0000-0000-000000000001";
const ADDR = "70000000-0000-0000-0000-000000000001";
const ADDR2 = "70000000-0000-0000-0000-000000000002";
const ORDER = "80000000-0000-0000-0000-000000000001";
const LINE1 = "81000000-0000-0000-0000-000000000001";
const LINE2 = "81000000-0000-0000-0000-000000000002";
const GIFT = "90000000-0000-0000-0000-000000000001";

const basket = {
  basket_id: BASKET,
  vendor_id: VENDOR,
  vendor: "مطعم أ",
  vendor_en: "Vendor A",
  subtotal_usd: 5,
  menu_version: 7,
  lines: [
    {
      line_id: "61000000-0000-0000-0000-000000000001",
      item_id: ITEM,
      name: "منقوشة كشك",
      name_en: "Kishk manoushe",
      quantity: 2,
      line_total_usd: 5,
    },
  ],
};
const address = { address_id: ADDR, place: "بعقلين", place_en: "Baakline" };
const quoteOk = {
  status: "ok",
  basket,
  subtotal_usd: 5,
  delivery_fee_usd: 2,
  deposit_usd: 0,
  stairs_fee_usd: 0,
  credit_usd: 0,
  total_usd: 7,
  total_lbp: 626500,
  usd_lbp_rate: 89500,
  cod_cap_usd: 50,
  over_cod_cap: false,
  address,
};
const catalogItems = [
  {
    item_id: ITEM,
    vendor_id: VENDOR,
    name_ar: "منقوشة كشك",
    name_en: "Kishk manoushe",
    price_usd: 2.5,
    vendor_ar: "مطعم أ",
    vendor_en: "Vendor A",
    is_open: true,
  },
  {
    item_id: ITEM2,
    vendor_id: VENDOR,
    name_ar: "منقوشة زعتر",
    name_en: "Zaatar manoushe",
    price_usd: 1.5,
    vendor_ar: "مطعم أ",
    vendor_en: "Vendor A",
    is_open: true,
  },
];

function fake(opts: {
  begin?: any;
  rpcs?: Record<string, (a: any) => any>;
  model?: ((req: any) => ModelResponse) | null;
  freeText?: boolean;
  voice?: boolean;
  transcribe?: CustomerDeps["transcribe"];
}) {
  const calls: { fn: string; args: any }[] = [];
  const sent: any[] = [];
  const begin = {
    duplicate: false,
    first_contact: false,
    customer: { id: CUST, language: "en", blocked: false },
    session: { lang: "en", pending: {}, refs: {}, history: [], low_confidence: 0, handoff: false },
    basket: null,
    orders: [],
    profile: {
      delivered_orders: 0,
      usual_vendors: [],
      usual_items: [],
      addresses: [],
      preferences: {},
    },
    bot_enabled: true,
    support_open: true,
    ...opts.begin,
  };
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (opts.rpcs?.[fn]) return opts.rpcs[fn](args);
    switch (fn) {
      case "customer_turn_begin":
        return begin;
      case "ai_quota_take":
        return { ok: true, call_id: calls.length };
      case "ai_call_finish":
        return 0.001;
      case "catalog_search":
        return { status: "ok", items: catalogItems };
      case "menu_item_hints":
        return { [ITEM]: { may_contain: ["sesame"] } };
      case "customer_handoff":
        return { status: "handed_off", support_open: true };
      default:
        return null;
    }
  };
  const deps: CustomerDeps = {
    rpc,
    send: async (p) => {
      sent.push(p);
      return { ok: true, id: `wamid.${sent.length}` };
    },
    model: opts.model === null || opts.model === undefined ? null : async (req) => opts.model!(req),
    transcribe: opts.transcribe ?? null,
    fetchMedia: async () => ({ bytes: new Uint8Array([1]), mime: "audio/ogg" }),
    route: async () => null,
    config: {
      customerModel: "haiku",
      escalationModel: "sonnet",
      transcriptionModel: "gpt-4o-transcribe",
      maxCalls: 2,
      turnMs: 8000,
      lowConfidenceHandoff: 2,
      voiceMaxBytes: 5_000_000,
      joinFunctionUrl: null,
      freeText: opts.freeText ?? false,
      voice: opts.voice ?? false,
    },
    now: () => new Date("2026-10-15T12:00:00Z"),
  };
  return {
    deps,
    calls,
    sent,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
    fns: () => calls.map((c) => c.fn),
  };
}
const msg = (o: Partial<CustomerInbound>): CustomerInbound => ({
  from: "+96176000001",
  messageId: "wamid.in.1",
  type: "text",
  text: null,
  buttonId: null,
  location: null,
  audio: null,
  name: null,
  ...o,
});
const tap = (id: string) => msg({ type: "interactive", buttonId: id });
const sess = (s: any) => ({
  session: {
    lang: "en",
    pending: {},
    refs: {},
    history: [],
    low_confidence: 0,
    handoff: false,
    ...s,
  },
});
const bodyOf = (p: any) => p?.text?.body ?? p?.interactive?.body?.text ?? "";
const ids = (p: any): string[] =>
  p?.interactive?.action?.buttons?.map((b: any) => b.reply.id) ??
  p?.interactive?.action?.sections?.flatMap((s: any) => s.rows.map((r: any) => r.id)) ??
  [];
const endSession = (f: ReturnType<typeof fake>) => f.of("customer_turn_end")[0]?.args.p_session;

describe("intents for the agent (§38.3)", () => {
  it("refuses medicine in four languages", () => {
    for (const t of [
      "I need panadol",
      "بدي دوا للراس",
      "baddi dawa",
      "je cherche une pharmacie",
      "عندكن صيدلية؟",
      "antibiotics please",
      // A claim with no food next to it stays a request (§39.15.4 review).
      "I have no antibiotics left, can you bring some",
      "antibiotics free delivery please",
      "cough syrup",
      "painkillers",
      "medications pack",
      "بدي دواء سعال",
      // A food in another clause does not make the claim about it.
      "no antibiotics at home, and 2 chicken shawarma",
      "antibiotics free delivery with my chicken order",
      "sirop contre la toux",
      "no antibiotics, 2 chicken",
      "بدي الدوا",
      "جيبلي الدواء",
      "بدي مضادات حيوية",
    ])
      expect(isMedicineRequest(t), t).toBe(true);
    for (const t of [
      "دوار",
      "shawarma",
      "manoushe kishk",
      "I want a drink",
      "antibiotic-free chicken breast",
      "2 kg djej no antibiotics",
      "دجاج بدون مضادات حيوية",
      "date syrup",
      "chicken with no antibiotics",
      "Antibiotic-free poultry",
      "Antibiotic free salmon",
      "œufs sans antibiotiques",
      "eggs from hens raised without antibiotics",
      "chicken w/o antibiotics",
      // Handmade, Bedouin and "they want" are not medicine.
      "بدي بطاطا يدوية",
      "قهوة بدوية",
      "بدوا شاورما",
    ])
      expect(isMedicineRequest(t), t).toBe(false);
  });
  it("knows the memory question in four languages", () => {
    for (const t of [
      "What do you remember about me?",
      "شو بتعرف عني",
      "shu bta3ref 3anne",
      "qu'est-ce que tu sais sur moi",
    ])
      expect(isMemoryQuestion(t), t).toBe(true);
    expect(isMemoryQuestion("what do you have for lunch")).toBe(false);
  });
  it("spots off-topic chat and orders for someone else", () => {
    expect(isOffTopic("what's the weather tomorrow")).toBe(true);
    expect(isOffTopic("2 shawarma")).toBe(false);
    for (const t of ["it's for my mom", "pour ma mère", "la emme", "لامي"])
      expect(mentionsSomeoneElse(t), t).toBe(true);
    expect(mentionsSomeoneElse("for me please")).toBe(false);
  });
  it("the fact guard catches times, distances and policies a model may not state", () => {
    for (const t of [
      "Delivery takes 30 minutes",
      "It's 5 km away",
      "We'll refund you",
      "التوصيل ١٥ دقيقة",
      "livraison gratuite",
    ])
      expect(FACT_RE.test(t), t).toBe(true);
    expect(FACT_RE.test("Which shop would you like?")).toBe(false);
  });
  it("parses every new button id and nothing else", () => {
    expect(parseCustomerAction(`gft:${GIFT}:y`)).toEqual({ a: "gift", giftId: GIFT, accept: true });
    expect(parseCustomerAction("mem:all")).toEqual({ a: "memory_delete", part: "all" });
    expect(parseCustomerAction("mem:f:allergy")).toEqual({
      a: "memory_delete",
      part: "fact",
      ref: "allergy",
    });
    expect(parseCustomerAction("mem:a:a2")).toEqual({
      a: "memory_delete",
      part: "address",
      ref: "a2",
    });
    expect(parseCustomerAction("mok:allergy")).toEqual({ a: "consent", key: "allergy", ok: true });
    expect(parseCustomerAction("mok:vegetarian")).toBeNull();
    expect(parseCustomerAction("adr:a1")).toEqual({ a: "address", ref: "a1" });
    expect(parseCustomerAction("fw:other")).toEqual({ a: "for_whom", what: "other" });
    expect(parseCustomerAction("dpk:cold_food")).toEqual({ a: "problem_kind", kind: "cold_food" });
    expect(parseCustomerAction(`dpl:${LINE1}:m`)).toEqual({
      a: "problem_line",
      itemId: LINE1,
      kind: "missing_item",
    });
    expect(parseCustomerAction("mem:f:'; drop table")).toBeNull();
  });
});

describe("free text without the model: the catalogue search (§32.4, §39.6)", () => {
  it("'2 man2oushe kishk' searches every shop and remembers the quantity; one tap adds two", async () => {
    const f = fake({});
    await handleCustomerTurn(f.deps, msg({ text: "2 man2oushe kishk" }));
    expect(f.of("catalog_search")[0].args.p_query).toBe("man2oushe kishk");
    expect(f.calls.some((c) => c.fn === "ai_quota_take")).toBe(false);
    expect(ids(f.sent[0])).toEqual(["pi:i1", "pi:i2"]);
    expect(JSON.stringify(f.sent[0])).toContain("$2.50");
    // Written in Arabizi, answered in Arabizi: the sesame hint and the shared-kitchen footer (§38.3).
    expect(JSON.stringify(f.sent[0])).toContain("momken fi semsom");
    expect(f.sent[0].interactive.footer.text).toMatch(/Matbakh moshtarak/);
    const s = endSession(f);
    expect(s.pending).toEqual({ kind: "qty_hint", qty: 2 });
    const g = fake({
      begin: sess({ pending: s.pending, refs: s.refs }),
      rpcs: { menu_item_options: () => [], basket_add_item: () => ({ status: "added", basket }) },
    });
    await handleCustomerTurn(g.deps, tap("pi:i1"));
    expect(g.of("basket_add_item")[0].args).toMatchObject({ p_item_id: ITEM, p_quantity: 2 });
    expect(ids(g.sent[0])).toContain("c:checkout");
  });
  it("nothing found: an unclaimed shop's name gets the 'not on Alo King yet' answer, else the buttons", async () => {
    const f = fake({
      rpcs: {
        catalog_search: () => ({ status: "none", items: [] }),
        vendor_search: () => [],
        vendor_search_unclaimed: () => [
          { vendor_id: "x", slug: "abou-fadi", name_en: "Abou Fadi", business_type: "restaurant" },
        ],
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "Abou Fadi" }));
    expect(bodyOf(f.sent[0])).toMatch(/Abou Fadi/);
    const g = fake({
      rpcs: {
        catalog_search: () => ({ status: "none", items: [] }),
        vendor_search: () => [],
        vendor_search_unclaimed: () => [],
      },
    });
    await handleCustomerTurn(g.deps, msg({ text: "sushi omakase" }));
    expect(ids(g.sent[0])).toEqual(["c:order", "c:track", "c:human"]);
    expect(bodyOf(g.sent[0])).toMatch(/couldn't find "sushi omakase"/);
  });
  it("a voice note gets the buttons while voice is off, with no download, transcription or model", async () => {
    let transcribed = false;
    const f = fake({
      transcribe: async () => {
        transcribed = true;
        return { text: "x", model: "m" };
      },
    });
    await handleCustomerTurn(
      f.deps,
      msg({
        type: "audio",
        audio: { url: null, id: "a1", mime: "audio/ogg", bytes: 1000, transcript: "2 shawarma" },
      }),
    );
    expect(transcribed).toBe(false);
    expect(f.calls.some((c) => c.fn === "ai_quota_take")).toBe(false);
    expect(bodyOf(f.sent[0])).toMatch(/voice notes/);
  });
});

describe("refusals and scope (§38.3)", () => {
  it("medicine is refused before any search or model, in the customer's language", async () => {
    const f = fake({
      model: () => ({
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: "end_turn",
      }),
      freeText: true,
    });
    await handleCustomerTurn(f.deps, msg({ text: "بدي دوا للراس" }));
    expect(f.calls.some((c) => ["catalog_search", "ai_quota_take"].includes(c.fn))).toBe(false);
    expect(bodyOf(f.sent[0])).toMatch(/صيدلية/);
  });
  it("off-topic chat gets one fixed line and the buttons", async () => {
    const f = fake({});
    await handleCustomerTurn(f.deps, msg({ text: "what's the weather tomorrow?" }));
    expect(bodyOf(f.sent[0])).toMatch(/only help with food/);
  });
});

describe("the 2-tap greeting for a returning customer (§38.3)", () => {
  it("offers the last order again or a new one", async () => {
    const f = fake({
      begin: {
        profile: {
          delivered_orders: 3,
          name: "Rami",
          last_order: {
            order_id: ORDER,
            vendor: "مطعم أ",
            vendor_en: "Vendor A",
            items: "2× Shawarma",
            items_ar: "2× شاورما",
          },
          addresses: [],
          preferences: {},
        },
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "hi" }));
    expect(ids(f.sent[0])).toEqual(["c:usual", "c:order", "c:human"]);
    expect(bodyOf(f.sent[0])).toMatch(/2× Shawarma from Vendor A/);
  });
  it("a new customer gets the main menu", async () => {
    const f = fake({});
    await handleCustomerTurn(f.deps, msg({ text: "hi" }));
    expect(ids(f.sent[0])).toEqual(["c:order", "c:track", "c:human"]);
  });
});

describe("memory: see it, delete it, consent for health (§39.6)", () => {
  const memory = {
    name: "Rami",
    language: "arabizi",
    addresses: [{ address_id: ADDR, label: "Home", place_ar: "بعقلين", place_en: "Baakline" }],
    usual: [{ name: "شاورما", name_en: "Shawarma" }],
    orders: 3,
    facts: [
      { key: "vegetarian", value: "yes", since: "2026-10-14T10:00:00Z", health: false },
      { key: "allergy", value: "nuts", since: "2026-10-14T10:00:00Z", health: true },
    ],
  };
  it("'what do you remember about me?' shows every fact and one-tap delete rows, with no model", async () => {
    const f = fake({ rpcs: { customer_memory: () => memory } });
    await handleCustomerTurn(f.deps, msg({ text: "What do you remember about me?" }));
    const body = bodyOf(f.sent[0]);
    expect(body).toMatch(/never for ads/);
    expect(body).toMatch(/You asked for vegetarian/);
    expect(body).toMatch(/allergy: nuts/);
    expect(ids(f.sent[0])).toEqual([
      "mem:a:a1",
      "mem:f:vegetarian",
      "mem:f:allergy",
      "mem:name",
      "mem:orders",
      "mem:lang",
      "mem:all",
    ]);
    expect(endSession(f).refs.a1.id).toBe(ADDR);
  });
  it("one tap deletes one fact, an address by its ref, or everything", async () => {
    const f = fake({ rpcs: { customer_memory: () => memory } });
    await handleCustomerTurn(f.deps, tap("mem:f:allergy"));
    expect(f.of("customer_memory_forget")[0].args).toMatchObject({
      p_part: "fact",
      p_ref: "allergy",
    });
    expect(bodyOf(f.sent[0])).toMatch(/Deleted/);
    const g = fake({
      begin: sess({ refs: { a1: { id: ADDR, label: "Home" } } }),
      rpcs: { customer_memory: () => memory },
    });
    await handleCustomerTurn(g.deps, tap("mem:a:a1"));
    expect(g.of("customer_memory_forget")[0].args).toMatchObject({
      p_part: "address",
      p_ref: ADDR,
    });
    const h = fake({});
    await handleCustomerTurn(h.deps, tap("mem:all"));
    expect(h.of("customer_memory_forget")[0].args).toMatchObject({ p_part: "all" });
    expect(endSession(h).refs).toEqual({});
  });
  it("an allergy is kept only after the consent tap", async () => {
    const f = fake({
      model: () => ({
        content: [
          {
            type: "tool_use",
            id: "t",
            name: "set_preference",
            input: { key: "allergy", value: "nuts" },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      }),
      freeText: true,
      rpcs: {
        customer_fact_set: (a) =>
          a.p_consent
            ? { status: "saved" }
            : { status: "needs_consent", key: "allergy", value: "nuts" },
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "I'm allergic to nuts" }));
    expect(f.of("customer_fact_set")[0].args.p_consent).toBe(false);
    expect(ids(f.sent[0])).toEqual(["mok:allergy", "mno"]);
    const s = endSession(f);
    const g = fake({
      begin: sess({ refs: s.refs }),
      rpcs: { customer_fact_set: () => ({ status: "saved" }) },
    });
    await handleCustomerTurn(g.deps, tap("mok:allergy"));
    expect(g.of("customer_fact_set")[0].args).toMatchObject({
      p_key: "allergy",
      p_value: "nuts",
      p_consent: true,
    });
    const h = fake({ begin: sess({ refs: s.refs }) });
    await handleCustomerTurn(h.deps, tap("mno"));
    expect(h.of("customer_fact_set")).toHaveLength(0);
  });
});

describe("the address on every order and who it is for (§22.1, §39.6)", () => {
  const checkoutRpcs = (state: any) => ({
    basket_fulfilment_options: () => ({ status: "ok", delivery: true, pickup: false }),
    basket_address_state: () => state,
    basket_quote: () => quoteOk,
    basket_substitution_needed: () => ({ needed: false }),
    basket_cash_state: () => ({ status: "ok", cash_currency: "USD", allowed: ["USD"] }),
  });
  it("the shop's offer is a line on the summary; under the minimum order says what is missing (§39.7)", async () => {
    const f = fake({
      begin: { basket },
      rpcs: {
        ...checkoutRpcs({ status: "ok", gift: false, address_id: ADDR, address }),
        basket_quote: () => ({
          ...quoteOk,
          offer_usd: 0.5,
          offer: { kind: "percent", percent: 10 },
          total_usd: 6.5,
        }),
      },
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(bodyOf(f.sent[0])).toMatch(/Shop offer 10%: −\$0\.50/);
    const g = fake({
      begin: { basket },
      rpcs: {
        ...checkoutRpcs({ status: "ok", gift: false, address_id: ADDR, address }),
        basket_quote: () => ({
          status: "below_minimum",
          basket,
          min_order_usd: 10,
          missing_usd: 5,
        }),
      },
    });
    await handleCustomerTurn(g.deps, tap("c:checkout"));
    expect(bodyOf(g.sent[0])).toMatch(/minimum order is \$10\.00 of food\. Add \$5\.00 more/);
    expect(ids(g.sent[0])).toEqual(["c:basket", "c:clear"]);
  });
  it("a saved address is confirmed every time: deliver here or somewhere else", async () => {
    const f = fake({
      begin: { basket },
      rpcs: checkoutRpcs({
        status: "confirm",
        address_id: ADDR,
        label: "Home",
        address,
        others: [],
      }),
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(ids(f.sent[0])).toEqual(["adr:a1", "c:new_address"]);
    expect(bodyOf(f.sent[0])).toMatch(/Deliver to Home – Baakline, or somewhere else today\?/);
    expect(f.of("basket_quote")).toHaveLength(0);
    const g = fake({
      begin: { basket, ...sess({ refs: endSession(f).refs }) },
      rpcs: { ...checkoutRpcs({ status: "ok" }) },
    });
    await handleCustomerTurn(g.deps, tap("adr:a1"));
    expect(g.of("basket_confirm_address")[0].args.p_address_id).toBe(ADDR);
    expect(ids(g.sent[0])[0]).toMatch(/^cfm:/);
  });
  it("several saved addresses are a list, with a new place at the end", async () => {
    const f = fake({
      begin: { basket },
      rpcs: checkoutRpcs({
        status: "confirm",
        address_id: ADDR,
        label: "Home",
        address,
        others: [{ address_id: ADDR2, label: "Teta", card: { place_en: "Deir el Qamar" } }],
      }),
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(ids(f.sent[0])).toEqual(["adr:a1", "adr:a2", "c:new_address"]);
  });
  it("a new address asks once; someone else asks who; their name and number make it a gift", async () => {
    const f = fake({
      begin: { basket },
      rpcs: checkoutRpcs({ status: "for_whom", address_id: ADDR2, address }),
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(ids(f.sent[0])).toEqual(["fw:self_save", "fw:self_once", "fw:other"]);
    const s1 = endSession(f);
    const g = fake({ begin: { basket, ...sess({ pending: s1.pending }) } });
    await handleCustomerTurn(g.deps, tap("fw:other"));
    expect(g.of("address_set_for_whom")[0].args).toMatchObject({
      p_address_id: ADDR2,
      p_for_whom: "other",
      p_save: false,
    });
    expect(bodyOf(g.sent[0])).toMatch(/Who is it for/);
    const s2 = endSession(g);
    const h = fake({
      begin: { basket, ...sess({ pending: s2.pending }) },
      rpcs: {
        ...checkoutRpcs({ status: "ok", gift: true, recipient_name: "Mom" }),
        address_set_recipient: () => ({ status: "saved", name: "Mom" }),
      },
    });
    await handleCustomerTurn(h.deps, msg({ text: "Mom 70 123 456" }));
    expect(h.of("address_set_recipient")[0].args).toMatchObject({
      p_name: "Mom",
      p_phone: "+96170123456",
    });
    expect(bodyOf(h.sent[0])).toMatch(/For Mom/);
  });
  it("a recipient without a number is asked again, never guessed", async () => {
    const f = fake({
      begin: { basket, ...sess({ pending: { kind: "recipient", address_id: ADDR2 } }) },
    });
    await handleCustomerTurn(f.deps, msg({ text: "my mother" }));
    expect(f.of("address_set_recipient")).toHaveLength(0);
    expect(bodyOf(f.sent[0])).toMatch(/name and a WhatsApp number/);
  });
  it("'for my mom' on the customer's own address asks who the order is for", async () => {
    const f = fake({
      begin: { basket, ...sess({ refs: { xe: { id: "someone_else", label: "someone_else" } } }) },
      rpcs: checkoutRpcs({ status: "ok", gift: false, address_id: ADDR, address }),
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(ids(f.sent[0])).toEqual(["fw:self_save", "fw:self_once", "fw:other"]);
  });
  it("the server's allergy note (consented, not on a gift) is on the summary", async () => {
    const f = fake({
      begin: {
        basket,
        profile: { delivered_orders: 1, addresses: [], preferences: { allergy: "nuts" } },
      },
      rpcs: {
        ...checkoutRpcs({ status: "ok" }),
        basket_quote: () => ({ ...quoteOk, allergy_note: "nuts" }),
      },
    });
    await handleCustomerTurn(f.deps, tap("c:checkout"));
    expect(f.of("basket_set_allergy_note")).toHaveLength(0); // the server fills it from the consented fact
    expect(bodyOf(f.sent[0])).toMatch(/Kitchen note: allergy, nuts/);
  });
});

describe("gift orders (§22.2 scenario 7)", () => {
  it("the sender's Confirm asks the recipient; nothing is ordered", async () => {
    const f = fake({
      begin: { basket },
      rpcs: {
        order_place: () => ({ status: "gift_needs_recipient" }),
        gift_request_create: () => ({ status: "asked", recipient_name: "Mom", minutes: 30 }),
      },
    });
    await handleCustomerTurn(f.deps, tap(`cfm:${BASKET}:7`));
    expect(f.of("gift_request_create")[0].args).toMatchObject({
      p_basket_id: BASKET,
      p_menu_version: 7,
    });
    expect(bodyOf(f.sent[0])).toMatch(/We sent the order to Mom to accept/);
  });
  it("outside the 24-hour window the sender is told how to reach the recipient", async () => {
    const f = fake({
      begin: { basket },
      rpcs: {
        order_place: () => ({ status: "gift_needs_recipient" }),
        gift_request_create: () => ({ status: "unreachable", recipient_name: "Mom" }),
      },
    });
    await handleCustomerTurn(f.deps, tap(`cfm:${BASKET}:7`));
    expect(bodyOf(f.sent[0])).toMatch(/Ask Mom to send "hi"/);
  });
  it("a sender who already asked one number three times today is told to wait", async () => {
    const f = fake({
      begin: { basket },
      rpcs: {
        order_place: () => ({ status: "gift_needs_recipient" }),
        gift_request_create: () => ({ status: "too_many", recipient_name: "Mom" }),
      },
    });
    await handleCustomerTurn(f.deps, tap(`cfm:${BASKET}:7`));
    expect(bodyOf(f.sent[0])).toMatch(/already asked Mom several times today/);
  });
  it("the sender hears that a basket changed after asking was not ordered", () => {
    const [m]: any = customerStatusMessages(
      "+96176000001",
      { kind: "gift_failed", lang: "en", recipient_name: "Mom", reason: "changed" },
      null,
    );
    expect(JSON.stringify(m)).toMatch(/your basket changed after we asked them/);
  });
  it("the recipient's tap accepts with their own number", async () => {
    const f = fake({
      rpcs: { gift_respond: () => ({ status: "placed", code: "ABC123", sender: "Rami" }) },
    });
    await handleCustomerTurn(f.deps, tap(`gft:${GIFT}:y`));
    expect(f.of("gift_respond")[0].args).toEqual({
      p_phone_e164: "+96176000001",
      p_gift_id: GIFT,
      p_accept: true,
    });
    expect(bodyOf(f.sent[0])).toMatch(/Order #ABC123 is with the shop. We'll keep Rami updated/);
  });
});

describe("problems and refunds: the server decides (§20.1, §38.3)", () => {
  const lines = [
    { order_item_id: LINE1, name_en: "Kishk manoushe", quantity: 2, line_total_usd: 5 },
    { order_item_id: LINE2, name_en: "Fries", quantity: 1, line_total_usd: 3 },
  ];
  it("'Problem' on the delivered message lists what can go wrong; a missing line gets the server's credit", async () => {
    const f = fake({ rpcs: { order_track: () => ({ code: "ABC123" }) } });
    await handleCustomerTurn(f.deps, tap(`rcv:${ORDER}:no`));
    expect(ids(f.sent[0])).toEqual([
      "dpk:missing_item",
      "dpk:wrong_item",
      "dpk:cold_food",
      "dpk:late",
      "dpk:damaged",
      "dpk:other",
    ]);
    const s = endSession(f);
    const g = fake({
      begin: sess({ refs: s.refs }),
      rpcs: { order_lines_for_customer: () => lines },
    });
    await handleCustomerTurn(g.deps, tap("dpk:missing_item"));
    expect(ids(g.sent[0])).toEqual([`dpl:${LINE1}:m`, `dpl:${LINE2}:m`]);
    const h = fake({
      begin: sess({ refs: s.refs }),
      rpcs: {
        dispute_open: () => ({
          status: "auto_credit",
          amount_usd: 3,
          amount_lbp: 268500,
          credit_days: 60,
        }),
      },
    });
    await handleCustomerTurn(h.deps, tap(`dpl:${LINE2}:m`));
    expect(h.of("dispute_open")[0].args).toEqual({
      p_customer_id: CUST,
      p_order_id: ORDER,
      p_kind: "missing_item",
      p_order_item_id: LINE2,
      p_quantity: 1,
    });
    expect(bodyOf(h.sent[0])).toMatch(
      /\$3\.00 \(268,500 LBP\) is credited to your next order \(valid 60 days\)/,
    );
  });
  it("a line of three asks how many were missing; the answer goes to the server", async () => {
    const refs = { xd: { id: ORDER, label: "ABC123" } };
    const three = [{ order_item_id: LINE1, name_en: "Manoushe", quantity: 3, line_total_usd: 6 }];
    const f = fake({ begin: sess({ refs }), rpcs: { order_lines_for_customer: () => three } });
    await handleCustomerTurn(f.deps, tap("dpk:missing_item"));
    expect(ids(f.sent[0])).toEqual([`dpl:${LINE1}:m:1`, `dpl:${LINE1}:m:2`, `dpl:${LINE1}:m:3`]);
    expect(bodyOf(f.sent[0])).toMatch(/How many Manoushe/);
    expect(f.of("dispute_open")).toHaveLength(0);
    const g = fake({
      begin: sess({ refs }),
      rpcs: {
        dispute_open: () => ({
          status: "auto_credit",
          amount_usd: 4,
          amount_lbp: 358000,
          credit_days: 60,
        }),
      },
    });
    await handleCustomerTurn(g.deps, tap(`dpl:${LINE1}:m:2`));
    expect(g.of("dispute_open")[0].args).toMatchObject({ p_order_item_id: LINE1, p_quantity: 2 });
  });
  it("a case the rules cannot settle goes to a person, with the conversation handed over", async () => {
    const f = fake({
      begin: sess({ refs: { xd: { id: ORDER, label: "ABC123" } } }),
      rpcs: { dispute_open: () => ({ status: "review", rule: "damaged: photo needed" }) },
    });
    await handleCustomerTurn(f.deps, tap("dpk:damaged"));
    expect(f.of("customer_handoff")).toHaveLength(1);
    expect(bodyOf(f.sent[0])).toMatch(/send a photo/);
  });
  it("a rating tap also records that the order arrived", async () => {
    const f = fake({});
    await handleCustomerTurn(f.deps, tap(`rate:${ORDER}:f5`));
    expect(f.of("order_customer_feedback")[0].args).toMatchObject({
      p_order_id: ORDER,
      p_ok: true,
    });
    expect(f.of("order_rate")[0].args).toMatchObject({ p_food_score: 5 });
  });
});

describe("the agent reaches a split cart's choices (§39.14 rule 1, §39.15.2)", () => {
  const SC = "5c000000-0000-0000-0000-000000000001";
  const said = (name: string, input: any) => () => ({
    content: [{ type: "tool_use" as const, id: "t", name, input }],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: "tool_use" as const,
  });
  it('"Deli Dough first" takes that shop\'s saved cart, by its ref from the session', async () => {
    const f = fake({
      model: said("saved_cart", { action: "take", cart_ref: "c1", item_ref: null, quantity: null }),
      freeText: true,
      begin: sess({ refs: { c1: { id: SC, label: "Deli Dough" } } }),
      rpcs: {
        saved_cart_take: () => ({ status: "ok", lines: [{ item_id: ITEM, quantity: 1 }] }),
        cart_merge: () => ({
          status: "ok",
          added: 1,
          skipped: [],
          needs_options: [],
          diffs: [],
          basket: null,
        }),
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "Deli Dough first", messageId: "wamid.dd" }));
    expect(f.of("saved_cart_take")[0].args).toEqual({
      p_customer_id: CUST,
      p_saved_cart_id: SC,
      p_message_id: "wamid.dd",
    });
  });
  it("a ref that is not a saved cart, or a choice without its waiting cart, does nothing", async () => {
    const f = fake({
      model: said("saved_cart", { action: "take", cart_ref: "v1", item_ref: null, quantity: null }),
      freeText: true,
      begin: sess({ refs: { v1: { id: SC, label: "Deli Dough" } } }),
    });
    await handleCustomerTurn(f.deps, msg({ text: "that one" }));
    expect(f.of("saved_cart_take")).toHaveLength(0);
    const g = fake({
      model: said("saved_cart", { action: "both", cart_ref: null, item_ref: null, quantity: null }),
      freeText: true,
    });
    await handleCustomerTurn(g.deps, msg({ text: "do both" }));
    expect(g.of("saved_cart_save")).toHaveLength(0);
  });
  it("the alternative offered for a shop that doesn't deliver, by its refs and quantity", async () => {
    const ALT = "5c000000-0000-0000-0000-0000000000a1";
    const f = fake({
      model: said("saved_cart", {
        action: "alternative",
        cart_ref: "c1",
        item_ref: "i1",
        quantity: 2,
      }),
      freeText: true,
      begin: sess({
        refs: {
          c1: { id: SC, label: "Split Burger (doesn't deliver to the customer)" },
          i1: { id: ALT, label: "Beef Burger x2 from Near Burger" },
        },
      }),
      rpcs: {
        menu_item_options: () => [],
        basket_add_item: () => ({ status: "added", basket: null }),
        saved_cart_swap: (a: any) => (a.p_check_only ? { ok: true } : null),
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "ok the closer one" }));
    expect(f.of("basket_add_item")[0].args).toMatchObject({ p_item_id: ALT, p_quantity: 2 });
    expect(f.of("saved_cart_swap")[1].args).toMatchObject({
      p_customer_id: CUST,
      p_saved_cart_id: SC,
      p_item_id: ALT,
    });
  });
  it("keep answers only a waiting cart; another pending question stays", async () => {
    const f = fake({
      model: said("saved_cart", { action: "keep", cart_ref: null, item_ref: null, quantity: null }),
      freeText: true,
      begin: sess({ pending: { kind: "confirm", basket_id: "b", version: 1 } }),
    });
    await handleCustomerTurn(f.deps, msg({ text: "keep it" }));
    expect(endSession(f).pending).toEqual({ kind: "confirm", basket_id: "b", version: 1 });
  });
  it('"do both" keeps the waiting cart for after the basket\'s order', async () => {
    const f = fake({
      model: said("saved_cart", { action: "both", cart_ref: null, item_ref: null, quantity: null }),
      freeText: true,
      begin: sess({
        pending: { kind: "cart", lines: [{ i: ITEM, q: 2, p: null }], basket: "A", cart: "B" },
      }),
      rpcs: {
        saved_cart_save: () => ({
          status: "saved",
          saved_cart_id: SC,
          vendor: "B",
          vendor_en: "B",
        }),
      },
    });
    await handleCustomerTurn(f.deps, msg({ text: "do both", messageId: "wamid.both2" }));
    expect(f.of("saved_cart_save")[0].args).toMatchObject({
      p_customer_id: CUST,
      p_message_id: "both:wamid.both2",
    });
  });
});

describe("recorded model answers, replayed (evals/customer/fixtures/model-turns.json)", () => {
  const fx = JSON.parse(readFileSync("evals/customer/fixtures/model-turns.json", "utf8"));
  for (const c of fx.cases) {
    it(`${c.id} ${c.lang}: "${c.text}"`, async () => {
      const f = fake({
        model: () => ({
          content: c.response.map((r: any, k: number) => ({
            type: "tool_use",
            id: `t${k}`,
            name: r.name,
            input: r.input,
          })),
          usage: { input_tokens: 100, output_tokens: 20 },
          stop_reason: "tool_use",
        }),
        freeText: true,
        begin: { customer: { id: CUST, language: c.lang, blocked: false } },
        rpcs: {
          customer_last_delivered: () => ({ order_id: ORDER, code: "ABC123" }),
          order_lines_for_customer: () => [
            { order_item_id: LINE1, name_en: "Manoushe", quantity: 1 },
            { order_item_id: LINE2, name_en: "Fries", quantity: 1 },
          ],
          customer_fact_set: () => ({ status: "needs_consent", key: "allergy", value: "nuts" }),
          customer_memory: () => ({ name: "Rami", facts: [{ key: "vegetarian", value: "yes" }] }),
        },
      });
      await handleCustomerTurn(f.deps, msg({ text: c.text }));
      for (const fn of c.expect.rpc) expect(f.fns(), fn).toContain(fn);
      for (const fn of c.expect.never ?? []) expect(f.fns(), fn).not.toContain(fn);
      for (const [fn, args] of Object.entries(c.expect.args ?? {}))
        expect(f.of(fn)[0].args).toMatchObject(args as object);
      const all = f.sent.flatMap(ids);
      if (c.expect.first_id)
        expect(
          all.some((x: string) => x.startsWith(c.expect.first_id)),
          JSON.stringify(all),
        ).toBe(true);
      if (c.expect.dropped) {
        // A fact the model invented never reaches the customer.
        expect(f.sent.map(bodyOf).join(" ")).not.toMatch(/30 minutes|refund you/);
      }
    });
  }
});

// Session 5f part 7, §39.14 rule 1: every after-cart button path can also be asked for in words, through typed tools whose
// RPCs carry the session's customer id (never one from the model) and whose refs resolve only within the session.
import { validate } from "./turn";
describe("the after-cart flows through the AI's typed tools (session 5f part 7)", () => {
  const LINE = basket.lines[0].line_id;
  const CHEESE = "82000000-0000-0000-0000-000000000001";
  const toolTurn = async (name: string, input: any, rpcs: Record<string, (a: any) => any> = {}) => {
    const f = fake({
      model: () => ({
        content: [{ type: "tool_use", id: "t1", name, input }],
        usage: { input_tokens: 100, output_tokens: 20 },
        stop_reason: "tool_use",
      }),
      freeText: true,
      begin: { basket: { ...basket, note_max: 80 } },
      rpcs: { basket_quote: () => quoteOk, ...rpcs },
    });
    await handleCustomerTurn(f.deps, msg({ text: "please" }));
    return f;
  };

  it("set_item_note: the line ref from the context, the session's customer, the server's note rule", async () => {
    const f = await toolTurn(
      "set_item_note",
      { line_ref: "l1", note: "no onions" },
      { basket_line_note: () => ({ status: "saved", note: "no onions", basket }) },
    );
    expect(f.of("basket_line_note")[0].args).toEqual({
      p_customer_id: CUST,
      p_line_id: LINE,
      p_note: "no onions",
    });
    expect(ids(f.sent[0])).toContain("note:add");
  });

  it("a bad or unknown line ref is refused: no note is written", async () => {
    for (const ref of ["l9", "x1", "l1; drop"]) {
      const f = await toolTurn("set_item_note", { line_ref: ref, note: "no onions" });
      expect(f.of("basket_line_note"), ref).toHaveLength(0);
    }
    // A runaway note is refused before the server; a long one goes to the server, which says it is too long.
    const runaway = await toolTurn("set_item_note", { line_ref: "l1", note: "x".repeat(201) });
    expect(runaway.of("basket_line_note")).toHaveLength(0);
    const long = await toolTurn(
      "set_item_note",
      { line_ref: "l1", note: "x".repeat(81) },
      { basket_line_note: () => ({ status: "too_long", length: 81, max: 80 }) },
    );
    expect(long.of("basket_line_note")).toHaveLength(1);
  });

  it("add_item_extras: the extras said are matched on the server's options and added at its price", async () => {
    const f = await toolTurn(
      "add_item_extras",
      { line_ref: "l1", options: ["cheese"] },
      {
        item_choice_groups: () => ({
          item_id: ITEM,
          groups: [
            {
              name_en: "Extras",
              min: 0,
              max: 2,
              options: [
                { option_id: CHEESE, name: "جبنة", name_en: "Cheese", price_delta_usd: 0.75 },
              ],
            },
          ],
        }),
        basket_line_add_options: () => ({ status: "added", basket, extras: [] }),
      },
    );
    expect(f.of("item_choice_groups")[0].args).toEqual({ p_item_id: ITEM });
    expect(f.of("basket_line_add_options")[0].args).toEqual({
      p_customer_id: CUST,
      p_line_id: LINE,
      p_option_ids: [CHEESE],
    });
    // Nothing matches: the line's extras list, as the tap path shows it; nothing is added.
    const g = await toolTurn(
      "add_item_extras",
      { line_ref: "l1", options: ["truffle"] },
      {
        item_choice_groups: () => ({
          item_id: ITEM,
          groups: [
            {
              name_en: "Extras",
              min: 0,
              max: 2,
              options: [{ option_id: CHEESE, name_en: "Cheese" }],
            },
          ],
        }),
      },
    );
    expect(g.of("basket_line_add_options")).toHaveLength(0);
    expect(ids(g.sent[0])).toEqual([`ext:${CHEESE}`, "ext:none"]);
    // Its "No extras" ends at the basket: no checkout, and the order's one "Goes well with" is kept for a cart.
    const s = endSession(g);
    expect(s.pending).toMatchObject({ kind: "cart_opts", agent: true });
    const h = fake({
      begin: { basket, ...sess({ pending: s.pending, refs: s.refs }) },
      rpcs: { basket_quote: () => quoteOk },
    });
    await handleCustomerTurn(h.deps, tap("ext:none"));
    expect(h.of("basket_goes_well")).toHaveLength(0);
    expect(h.of("basket_quote")).toHaveLength(0);
    expect(ids(h.sent[0])).toContain("c:checkout");
    expect(endSession(h).pending).toEqual({});
  });

  it("set_cash_change and set_tip reach the server with the session's customer; the server checks the amounts", async () => {
    const f = await toolTurn(
      "set_cash_change",
      { currency: "USD", amount: 50, customer_id: "someone-else" },
      { basket_set_cash_change: () => ({ status: "ok" }) },
    );
    // A field the schema does not have (a customer id) fails validation: nothing is called with it.
    expect(f.of("basket_set_cash_change")).toHaveLength(0);
    const g = await toolTurn(
      "set_cash_change",
      { currency: "USD", amount: 50 },
      { basket_set_cash_change: () => ({ status: "ok" }) },
    );
    expect(g.of("basket_set_cash_change")[0].args).toEqual({
      p_customer_id: CUST,
      p_currency: "USD",
      p_amount: 50,
    });
    const exact = await toolTurn("set_cash_change", { currency: "LBP", amount: null });
    expect(exact.of("basket_set_cash_change")[0].args.p_amount).toBeNull();
    const h = await toolTurn(
      "set_tip",
      { amount_usd: 2 },
      { basket_set_tip: () => ({ status: "ok" }) },
    );
    expect(h.of("basket_set_tip")[0].args).toEqual({ p_customer_id: CUST, p_amount: 2 });
    const none = await toolTurn("set_tip", { amount_usd: null });
    expect(none.of("basket_set_tip")[0].args.p_amount).toBe(0);
  });

  it("tip_order: the model only proposes; the customer's tap on the confirm card sets the tip (promised, never booked here)", async () => {
    const f = await toolTurn(
      "tip_order",
      { amount_usd: 3 },
      {
        customer_last_delivered: () => ({ order_id: ORDER, code: "ABC123" }),
        order_tip_offer: () => ({ status: "offer", amounts: [1, 2, 3], max_usd: 10 }),
        order_tip_set: () => ({ status: "promised", tip_usd: 3 }),
      },
    );
    expect(f.of("customer_last_delivered")[0].args).toEqual({ p_customer_id: CUST });
    expect(f.of("order_tip_offer")[0].args).toMatchObject({
      p_customer_id: CUST,
      p_order_id: ORDER,
      p_mark: false,
    });
    expect(f.of("order_tip_set")).toHaveLength(0);
    expect(ids(f.sent[0])).toEqual([`tpo:${ORDER}:300:o`, "c:no_upsell"]);
    expect(bodyOf(f.sent[0])).toMatch(/Tip \$3\.00 to whoever delivered/);
    // Over the server's maximum: no card, the reason with its buttons.
    const big = await toolTurn(
      "tip_order",
      { amount_usd: 50 },
      {
        customer_last_delivered: () => ({ order_id: ORDER, code: "ABC123" }),
        order_tip_offer: () => ({ status: "offer", amounts: [1, 2, 3], max_usd: 10 }),
      },
    );
    expect(ids(big.sent[0])).not.toContain(`tpo:${ORDER}:5000:o`);
    // The customer's tap: the named amount, checked by the server against tip_max_usd.
    const g = fake({
      rpcs: { order_tip_set: () => ({ status: "promised", tip_usd: 3, told: true }) },
    });
    await handleCustomerTurn(g.deps, tap(`tpo:${ORDER}:300:o`));
    expect(g.of("order_tip_set")[0].args).toEqual({
      p_customer_id: CUST,
      p_order_id: ORDER,
      p_amount: 3,
      p_other: true,
    });
    expect(bodyOf(g.sent[0])).toContain("We told whoever delivered");
    // No channel reached whoever delivered: the thanks never claims we told them.
    const q = fake({
      rpcs: { order_tip_set: () => ({ status: "promised", tip_usd: 3, told: false }) },
    });
    await handleCustomerTurn(q.deps, tap(`tpo:${ORDER}:300:o`));
    expect(bodyOf(q.sent[0])).not.toContain("We told");
    const none = await toolTurn(
      "tip_order",
      { amount_usd: 3 },
      { customer_last_delivered: () => null },
    );
    expect(none.of("order_tip_set")).toHaveLength(0);
    expect(ids(none.sent[0]).length).toBeGreaterThan(0);
  });

  it("validate() refuses what the server would never accept", () => {
    expect(validate("set_tip", { amount_usd: -1 })).toBe(false);
    expect(validate("set_tip", { amount_usd: 5000 })).toBe(false);
    expect(validate("tip_order", { amount_usd: 0 })).toBe(false);
    expect(validate("set_cash_change", { currency: "EUR", amount: 20 })).toBe(false);
    expect(validate("set_cash_change", { currency: "USD", amount: 20.5 })).toBe(false);
    expect(validate("add_item_extras", { line_ref: "l1", options: [] })).toBe(false);
    expect(validate("add_item_extras", { line_ref: "i1", options: ["x"] })).toBe(false);
    expect(validate("set_item_note", { line_ref: "l1", note: "x".repeat(201) })).toBe(false);
    expect(validate("set_item_note", { line_ref: "l1", note: "x".repeat(81) })).toBe(true);
    // An AI note on a new line is cut by the server (basket_add_item), never refused; only an absurd one is.
    const addWithNote = (note: string) =>
      validate("add_items", {
        vendor_ref: null,
        items: [{ item_ref: "i1", name: null, quantity: 1, options: [], note }],
      });
    expect(addWithNote("x".repeat(201))).toBe(false);
    expect(addWithNote("x".repeat(81))).toBe(true);
    expect(validate("set_item_note", { line_ref: "l1", note: "no onions" })).toBe(true);
  });
});
