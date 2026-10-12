// Session T2: the owner's first live test on staging (12 October, 07:45-07:50 Beirut), replayed message by
// message against an in-memory server that behaves like the database functions it stands in for. The fixes:
//   1. the pickup tap is deterministic and works (it used to answer "Sorry, I'm a bit slow");
//   2. Checkout a second time answers like the first (it hit the same failure);
//   3. delivery is checked right after the pin: only places that deliver there, else pickup is offered
//      before any basket exists;
//   4. no tap ever reaches the model or gets the "slow" message, and free text without credit gets the buttons;
//   5. a handoff left over from the day before ends on any tap, "Order" or "Menu";
//   6. (staging fixture, tested in supabase/tests/99_t2_live_test_fixes.sql) a 30 km radius for Alo Test Grill.
import { describe, expect, it } from "vitest";
import { checkInteractive } from "../../_shared/meta-limits";
import { handleCustomerTurn, type CustomerDeps, type CustomerInbound } from "./turn";

const CUST = "10000000-0000-0000-0000-000000000001";
const VENDOR = "20000000-0000-0000-0000-00000000000a";
const SEC1 = "70000000-0000-0000-0000-000000000001";
const SEC2 = "70000000-0000-0000-0000-000000000002";
const ADDR = "90000000-0000-0000-0000-000000000001";
const BASKET = "60000000-0000-0000-0000-000000000001";
const FALAFEL = "51000000-0000-0000-0000-000000000003";
const PHONE = "+96176000001";
const ROAD_KM = 12.64; // the owner's pin to Alo Test Grill, by road

const GRILL = {
  vendor_id: VENDOR,
  name_ar: "ألو تست غريل",
  name_en: "Alo Test Grill",
  is_open: true,
  straight_km: 8.16,
  vendor_lat: 33.677,
  vendor_lon: 35.564,
  matched: "nearby",
};
const ITEMS = [
  {
    item_id: "51000000-0000-0000-0000-000000000001",
    name_en: "Chicken Shawarma",
    price_usd: 4.5,
    orderable: true,
    total_count: 3,
  },
  {
    item_id: "51000000-0000-0000-0000-000000000002",
    name_en: "Beef Shawarma",
    price_usd: 5.5,
    orderable: true,
    total_count: 3,
  },
  {
    item_id: FALAFEL,
    name_en: "Falafel Sandwich",
    price_usd: 2.5,
    orderable: true,
    total_count: 3,
  },
];

/** One phone talking to the bot, with the server state the real database keeps between messages. */
function phone(opts: {
  radiusKm: number;
  staleHandoff: boolean;
  failQuote?: boolean;
  routeDown?: boolean;
  withModel?: boolean;
}) {
  const st = {
    session: {
      lang: "en",
      focus_vendor_id: null as any,
      pending: {} as any,
      refs: {} as any,
      history: [] as any[],
      low_confidence: 0,
    },
    handoff: opts.staleHandoff,
    address: null as null | { lat: number; lon: number },
    routeKnown: false,
    fulfilment: "delivery",
    cash: null as null | string,
    lines: [] as { item_id: string; name_en: string; quantity: number; price: number }[],
    placed: [] as any[],
    modelCalls: 0,
    rpcs: [] as { fn: string; args: any }[],
  };
  const view = () =>
    st.lines.length
      ? {
          basket_id: BASKET,
          vendor_id: VENDOR,
          vendor: GRILL.name_ar,
          vendor_en: GRILL.name_en,
          menu_version: 7,
          subtotal_usd: st.lines.reduce((n, l) => n + l.quantity * l.price, 0),
          lines: st.lines.map((l, k) => ({
            line_id: `61000000-0000-0000-0000-00000000000${k + 1}`,
            item_id: l.item_id,
            name: l.name_en,
            name_en: l.name_en,
            quantity: l.quantity,
            line_total_usd: l.quantity * l.price,
          })),
        }
      : null;
  const rpc = async (fn: string, a: any) => {
    st.rpcs.push({ fn, args: a });
    switch (fn) {
      case "customer_turn_begin":
        return {
          duplicate: false,
          first_contact: false,
          customer: { id: CUST, language: "en", blocked: false },
          session: { ...st.session, handoff: st.handoff },
          basket: view(),
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
        };
      case "customer_turn_end":
        // Only what the real customer_turn_end stores.
        for (const k of [
          "lang",
          "focus_vendor_id",
          "pending",
          "refs",
          "history",
          "low_confidence",
        ] as const)
          (st.session as any)[k] = JSON.parse(JSON.stringify(a.p_session[k]));
        return null;
      case "customer_handoff_end":
        st.handoff = false;
        return null;
      case "address_save_pin":
        st.address = { lat: a.p_lat, lon: a.p_lon };
        return {
          status: "saved",
          address: { id: ADDR, building: "x", place: "بعقلين", place_en: "Baakline" },
        };
      case "customer_search_point":
        return st.address ? { ...st.address, address_id: ADDR } : null;
      case "vendor_search":
        return [GRILL];
      case "customer_delivery_check":
        if (!st.address) return { status: "no_address", vendors: [] };
        if (!st.routeKnown)
          return {
            status: "ok",
            vendors: [
              {
                vendor_id: VENDOR,
                status: "no_route",
                origin: { lat: 33.677, lon: 35.564 },
                dest: { lat: 33.645, lon: 35.643 },
              },
            ],
          };
        return {
          status: "ok",
          vendors: [
            ROAD_KM <= opts.radiusKm
              ? {
                  vendor_id: VENDOR,
                  status: "ok",
                  road_km: ROAD_KM,
                  limit_km: opts.radiusKm,
                  fee_usd: 6,
                }
              : {
                  vendor_id: VENDOR,
                  status: "beyond_radius",
                  road_km: ROAD_KM,
                  limit_km: opts.radiusKm,
                },
          ],
        };
      case "vendor_search_pickup":
        return st.address ? [GRILL] : [];
      case "vendor_sections":
        return {
          sections: [
            { section_id: SEC1, name_ar: "سندويشات", name_en: "Sandwiches", items: 3 },
            { section_id: SEC2, name_ar: "مشاوي", name_en: "Grills", items: 4 },
          ],
          unsectioned: 0,
        };
      case "vendor_menu":
        return ITEMS;
      case "menu_item_options":
        return [];
      case "basket_add_item": {
        const it = ITEMS.find((x) => x.item_id === a.p_item_id)!;
        st.lines.push({
          item_id: it.item_id,
          name_en: it.name_en,
          quantity: a.p_quantity,
          price: it.price_usd,
        });
        return { status: "added", basket: view() };
      }
      case "basket_set_checkout":
        if (a.p_fulfilment) st.fulfilment = a.p_fulfilment;
        return { status: "updated", basket: view() };
      case "basket_quote": {
        if (opts.failQuote) throw new Error('record "v_route" is not assigned yet');
        const b = view();
        if (!b) return { status: "no_basket" };
        if (st.fulfilment === "pickup")
          return {
            status: "ok",
            basket: b,
            subtotal_usd: b.subtotal_usd,
            delivery_fee_usd: 0,
            total_usd: b.subtotal_usd,
            total_lbp: b.subtotal_usd * 89500,
            usd_lbp_rate: 89500,
            address: null,
            road_km: null,
          };
        if (ROAD_KM > opts.radiusKm)
          return {
            status: "beyond_radius",
            basket: b,
            limit_km: opts.radiusKm,
            road_km: ROAD_KM,
            pickup_enabled: true,
          };
        return {
          status: "ok",
          basket: b,
          subtotal_usd: b.subtotal_usd,
          delivery_fee_usd: 6,
          total_usd: b.subtotal_usd + 6,
          total_lbp: (b.subtotal_usd + 6) * 89500,
          usd_lbp_rate: 89500,
          address: { place: "بعقلين", place_en: "Baakline" },
        };
      }
      case "basket_substitution_needed":
        return { needed: false };
      case "basket_cash_state":
        return { status: "ok", cash_currency: st.cash, allowed: ["USD", "LBP"] };
      case "basket_set_cash_currency":
        st.cash = a.p_currency;
        return { status: "ok", cash_currency: st.cash };
      case "ai_quota_take":
        return { ok: true, call_id: 1 };
      case "ai_call_finish":
        return 0;
      case "basket_upsell":
        return null;
      case "order_place":
        st.placed.push(a);
        st.lines = [];
        return { status: "placed", code: "T2-1", order_id: "o1" };
      default:
        return null;
    }
  };
  let sent: any[] = [];
  const deps: CustomerDeps = {
    rpc,
    send: async (p) => {
      sent.push(p);
      return { ok: true, id: `wamid.out.${sent.length}` };
    },
    // No API credit (null), or a model that counts every call and fails like an empty account would.
    model: opts.withModel
      ? async () => {
          st.modelCalls++;
          throw new Error("credit balance is too low");
        }
      : null,
    transcribe: null,
    fetchMedia: async () => null,
    route: async () => {
      if (opts.routeDown) return null;
      st.routeKnown = true;
      return {};
    },
    config: {
      customerModel: "haiku",
      escalationModel: "sonnet",
      transcriptionModel: "gpt-4o-transcribe",
      maxCalls: 2,
      turnMs: 8000,
      lowConfidenceHandoff: 2,
      voiceMaxBytes: 5_000_000,
    },
    now: () => new Date("2026-10-12T04:45:00Z"),
  };
  let n = 0;
  const base = (): CustomerInbound => ({
    from: PHONE,
    messageId: `wamid.in.${++n}`,
    type: "text",
    text: null,
    buttonId: null,
    location: null,
    audio: null,
    name: "Rasheed",
  });
  const say = async (o: Partial<CustomerInbound>) => {
    sent = [];
    await handleCustomerTurn(deps, { ...base(), ...o });
    return sent;
  };
  return {
    st,
    text: (t: string) => say({ type: "text", text: t }),
    tap: (id: string) => say({ type: "interactive", buttonId: id }),
    pin: (lat: number, lon: number) => say({ type: "location", location: { lat, lon } }),
  };
}

const body = (p: any) => p?.text?.body ?? p?.interactive?.body?.text ?? "";
const ids = (p: any): string[] => [
  ...(p?.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id),
  ...(p?.interactive?.action?.sections ?? []).flatMap((s: any) => s.rows.map((r: any) => r.id)),
];
const rowIdOf = (p: any, title: string): string =>
  p.interactive.action.sections.flatMap((s: any) => s.rows).find((r: any) => r.title === title).id;
const SLOW = /slow|بطيء|ضغط|ralenti|daghet/i;

describe("the live test of 12 October 07:45-07:50, replayed (session T2)", () => {
  it("handles the whole conversation on the buttons, with no model call and no 'slow' message", async () => {
    // The pin is 12.64 road km from Alo Test Grill, whose radius was 10 km that morning.
    const p = phone({ radiusKm: 10, staleHandoff: true });
    const all: any[] = [];
    const turn = async (sent: any[]) => {
      all.push(...sent);
      return sent;
    };

    // 07:45:58 a message while yesterday's handoff is still open: acknowledged, with a way out.
    let out = await turn(await p.text("Hello?"));
    expect(out).toHaveLength(1);
    expect(body(out[0])).toContain("Rasheed will reply");
    expect(ids(out[0])).toEqual(["c:order", "c:track"]);
    expect(p.st.handoff).toBe(true);

    // 07:46:08 "🍽️ Menu" ends it and asks for the pin.
    out = await turn(await p.tap("c:order"));
    expect(p.st.handoff).toBe(false);
    expect(out[0].interactive.type).toBe("location_request_message");

    // 07:46:33 the pin. Delivery is checked on the road now: nothing delivers, so pickup is offered and no
    // menu, section list or basket appears.
    out = await turn(await p.pin(33.645385742188, 35.64342880249));
    const card = out[out.length - 1];
    expect(ids(card)).toEqual(["c:pickup_list", "c:address_list"]);
    expect(body(card)).toContain("No open place delivers to this pin");
    expect(out.some((m) => ids(m).some((i) => i.startsWith("ps:")))).toBe(false);
    expect(p.st.rpcs.some((r) => r.fn === "basket_add_item")).toBe(false);
    expect(p.st.routeKnown).toBe(true); // the missing road route was fetched, not guessed

    // "🛍️ Pick up": the places that take pickup near the pin; one place opens its sections.
    out = await turn(await p.tap("c:pickup_list"));
    expect(ids(out[out.length - 1])).toEqual(["ps:s1", "ps:s2"]);
    expect(p.st.session.refs.fx?.id).toBe("pickup");

    // 07:46:57 Sandwiches, Falafel Sandwich, 5 of them.
    out = await turn(await p.tap("ps:s1"));
    out = await turn(await p.tap(rowIdOf(out[0], "Falafel Sandwich")));
    expect(ids(out[0])).toHaveLength(10);
    out = await turn(await p.tap(ids(out[0])[4])); // quantity 5
    expect(body(out[0])).toContain("5× Falafel Sandwich");
    expect(ids(out[0])).toEqual(["c:checkout", "c:menu", "c:clear"]);

    // 07:47:57 "✅ Checkout": pickup basket, cash currency first.
    out = await turn(await p.tap("c:checkout"));
    expect(ids(out[0])).toEqual(["cur:USD", "cur:LBP"]);
    expect(p.st.fulfilment).toBe("pickup");
    // 07:50:16 the second Checkout (it used to say "slow"): the same answer.
    out = await turn(await p.tap("c:checkout"));
    expect(ids(out[0])).toEqual(["cur:USD", "cur:LBP"]);

    out = await turn(await p.tap("cur:USD"));
    expect(body(out[0])).toContain("Pickup from the shop");
    expect(body(out[0])).not.toContain("Delivery fee");
    expect(body(out[0])).toContain("$12.50");
    const confirm = ids(out[0])[0];
    expect(confirm).toBe(`cfm:${BASKET}:7`);

    // 07:48:22 free text with no credit: the button menu, never an error.
    out = await turn(await p.text("I want a pizza"));
    expect(out).toHaveLength(1);
    expect(ids(out[0])).toEqual(["c:order", "c:track", "c:human"]);
    // 07:49:07 "📦 My order".
    out = await turn(await p.tap("c:track"));
    expect(out.length).toBeGreaterThan(0);
    // Checkout again after all that, and the Confirm tap places a pickup order.
    out = await turn(await p.tap("c:checkout"));
    expect(ids(out[0])[0]).toBe(confirm);
    out = await turn(await p.tap(confirm));
    expect(body(out[0])).toContain("T2-1");
    expect(p.st.placed).toHaveLength(1);
    expect(p.st.session.refs.fx).toBeUndefined();

    // Through all of it: no model call, no "slow", and every message inside Meta's limits.
    expect(p.st.modelCalls).toBe(0);
    for (const m of all) {
      expect(body(m)).not.toMatch(SLOW);
      expect(checkInteractive(m)).toEqual([]);
    }
  });

  it("the old way out still works: the pickup button on the 'does not deliver' card", async () => {
    // A basket built before the road check existed (or for a place added later): Checkout finds it too far.
    const p = phone({ radiusKm: 10, staleHandoff: false });
    await p.pin(33.645385742188, 35.64342880249);
    p.st.lines.push({ item_id: FALAFEL, name_en: "Falafel Sandwich", quantity: 5, price: 2.5 });
    let out = await p.tap("c:checkout");
    expect(ids(out[0])).toEqual(["c:pickup", "c:find"]);
    expect(body(out[0])).toContain("doesn't deliver");
    out = await p.tap("c:pickup"); // "🛍️ I'll pick up" went to the failure path before
    expect(p.st.fulfilment).toBe("pickup");
    expect(ids(out[0])).toEqual(["cur:USD", "cur:LBP"]);
    out = await p.tap("c:checkout");
    expect(ids(out[0])).toEqual(["cur:USD", "cur:LBP"]);
    for (const m of out) expect(body(m)).not.toMatch(SLOW);
  });

  it("with the 30 km radius the same pin lists Alo Test Grill and delivery works", async () => {
    const p = phone({ radiusKm: 30, staleHandoff: false });
    const out = await p.pin(33.645385742188, 35.64342880249);
    expect(ids(out[out.length - 1])).toEqual(["ps:s1", "ps:s2"]);
    expect(p.st.session.refs.fx).toBeUndefined();
  });

  it("if the road route cannot be fetched the place is kept (not a guess), and Checkout checks it again", async () => {
    const p = phone({ radiusKm: 10, staleHandoff: false, routeDown: true });
    const out = await p.pin(33.645385742188, 35.64342880249);
    expect(ids(out[out.length - 1])).toEqual(["ps:s1", "ps:s2"]);
    expect(p.st.rpcs.filter((r) => r.fn === "customer_delivery_check")).toHaveLength(2);
  });

  it("a failure on our side during a tap shows the buttons, never 'slow'", async () => {
    const p = phone({ radiusKm: 30, staleHandoff: false, failQuote: true });
    await p.pin(33.645385742188, 35.64342880249);
    p.st.lines.push({ item_id: FALAFEL, name_en: "Falafel Sandwich", quantity: 1, price: 2.5 });
    for (const id of ["c:checkout", "c:pickup", "c:delivery"]) {
      const out = await p.tap(id);
      expect(out).toHaveLength(1);
      expect(ids(out[0])).toEqual(["c:order", "c:track", "c:human"]);
      expect(body(out[0])).not.toMatch(SLOW);
    }
    expect(p.st.modelCalls).toBe(0);
  });

  it("a handoff from the day before ends on 'Order', 'Menu' or any button", async () => {
    for (const act of [
      (p: any) => p.text("Order"),
      (p: any) => p.text("menu"),
      (p: any) => p.tap("c:track"),
      (p: any) => p.tap("c:human"),
    ]) {
      const p = phone({ radiusKm: 10, staleHandoff: true });
      const out = await act(p);
      expect(p.st.handoff).toBe(false);
      expect(out.length).toBeGreaterThan(0);
      for (const m of out) expect(body(m)).not.toContain("Rasheed will reply");
    }
  });

  it("no button tap ever reaches the model, even when one is configured; free text falls back to the buttons", async () => {
    const p = phone({ radiusKm: 30, staleHandoff: false, withModel: true });
    await p.pin(33.645385742188, 35.64342880249);
    await p.tap("pv:v1");
    for (const id of [
      "c:order",
      "c:menu",
      "c:track",
      "c:basket",
      "c:checkout",
      "c:pickup",
      "c:pickup_list",
      "c:delivery",
      "c:find",
      "c:usual",
      "c:address_list",
      "c:no_upsell",
      "c:clear",
      "ps:s1",
      "pi:i1",
      "qt:i1:2",
      "mo:s1:9",
      "cur:USD",
      "cfm:x:1",
      "opt:zz",
    ]) {
      const out = await p.tap(id);
      expect(out.length, id).toBeGreaterThan(0);
      for (const m of out) expect(body(m), id).not.toMatch(SLOW);
    }
    expect(p.st.modelCalls).toBe(0);
    // Free text does try the model, which fails for lack of credit: the buttons, not "slow".
    const out = await p.text("I would like something spicy");
    expect(p.st.modelCalls).toBeGreaterThan(0);
    expect(out).toHaveLength(1);
    expect(ids(out[0])).toEqual(["c:order", "c:track", "c:human"]);
  });
});
