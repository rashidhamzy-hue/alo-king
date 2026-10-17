import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_B64,
  NAV,
  handleFlowRequest,
  proxySignature,
  verifyProxy,
  type FlowAppStore,
} from "./flow-app";
import { FX, fixtureStore } from "../../../scripts/flows/fixture-store";

// DECISIONS §39.15.13: the Flow app's endpoint. Every list stays within Meta's NavigationList limits, long lists page,
// images over 100 KB are left out, prices are the store's (the server's), and nothing is shown without a signed request
// and a valid token.
const req = (data: Record<string, unknown> = {}, action = "data_exchange") => ({
  version: "3.0",
  action,
  screen: "HOME",
  data,
  flow_token: FX.flowToken,
});

function checkRows(rows: any[]) {
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThanOrEqual(NAV.rows);
  expect(rows.filter((r) => r.badge).length).toBeLessThanOrEqual(1);
  for (const r of rows) {
    expect(Array.from(r["main-content"].title).length).toBeLessThanOrEqual(NAV.title);
    expect(Array.from(r["main-content"].description ?? "").length).toBeLessThanOrEqual(
      NAV.description,
    );
    expect(Array.from(r["main-content"].metadata ?? "").length).toBeLessThanOrEqual(NAV.metadata);
    expect(Array.from(r.end?.title ?? "").length).toBeLessThanOrEqual(NAV.end);
    expect((r.start?.image ?? "").length).toBeLessThanOrEqual(MAX_IMAGE_B64);
    expect(r["on-click-action"].name).toBe("data_exchange");
    for (const v of Object.values(r["on-click-action"].payload)) expect(typeof v).toBe("string");
  }
}

describe("the Flow app endpoint", () => {
  it("opens HOME with the craving categories (images), search, shops near and Popular near you", async () => {
    const r = await handleFlowRequest(fixtureStore("en"), req({}, "INIT"), { signed: true });
    expect(r.version).toBe("3.0");
    expect(r.screen).toBe("HOME");
    checkRows(r.data.cats as any[]);
    checkRows(r.data.pop as any[]);
    expect((r.data.cats as any[]).map((x) => x.id)).toEqual([
      "search",
      "near",
      "c_shawarma",
      "c_pizza",
    ]);
    expect((r.data.pop as any[])[0].end.title).toBe("$5.00");
  });

  it("refuses an unsigned request and an unknown token: the open-it-from-the-chat screen, no data", async () => {
    const s = fixtureStore("en");
    let calls = 0;
    const spy = new Proxy(s, {
      get: (o: any, k) => (k === "session" ? o[k] : (...a: any[]) => (calls++, o[k](...a))),
    }) as FlowAppStore;
    const unsigned = await handleFlowRequest(spy, req({}, "INIT"), { signed: false });
    expect(unsigned.screen).toBe("HOME");
    expect((unsigned.data.cats as any[])[0].id).toBe("closed");
    const forged = await handleFlowRequest(
      spy,
      { ...req({}, "INIT"), flow_token: "bad" },
      { signed: true },
    );
    expect((forged.data.cats as any[])[0].id).toBe("closed");
    expect(calls).toBe(0);
  });

  it("pages a long list: 19 rows and More, which answers the next page", async () => {
    const s = fixtureStore("en");
    const many = Array.from({ length: 45 }, (_, k) => ({
      vendor_id: `10000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
      slug: `shop-${k}`,
      name_en: `Shop with a really very long name number ${k}`,
      cuisine_en: "Lebanese grills and sandwiches",
      village_en: "Maasser Beit ed Dine",
      open_now: k % 2 === 0,
      fee_usd: 2,
      eta_min: 20,
      eta_max: 30,
    }));
    s.explore = async (_t, _q, _c, offset) => ({
      status: "ok",
      place: { name_en: "Baakline" },
      shops: many.slice(offset, offset + 19),
      next_offset: offset + 19 < many.length ? offset + 19 : null,
    });
    s.thumbs = async (_k, refs) =>
      Object.fromEntries(refs.map((r) => [r, "x".repeat(MAX_IMAGE_B64 + 1)]));
    const r = await handleFlowRequest(s, req({ go: "shops", cat: "", q: "", offset: "0" }), {
      signed: true,
    });
    const rows = r.data.shops as any[];
    checkRows(rows);
    expect(rows).toHaveLength(20);
    expect(rows.at(-1)["on-click-action"].payload).toMatchObject({ go: "shops", offset: "19" });
    // An image over Meta's 100 KB is left out, never sent.
    expect(rows[0].start).toBeUndefined();
    const last = await handleFlowRequest(s, req({ go: "shops", cat: "", q: "", offset: "38" }), {
      signed: true,
    });
    expect((last.data.shops as any[]).length).toBe(7);
  });

  it("an empty list stays on SHOPS (its only routes are SHOP and itself): all shops near, or a reload", async () => {
    const s = fixtureStore("en");
    s.explore = async () => ({
      status: "ok",
      place: { name_en: "Baakline" },
      shops: [],
      next_offset: null,
    });
    const searched = await handleFlowRequest(
      s,
      req({ go: "shops", cat: "", q: "zzz", offset: "0" }),
      {
        signed: true,
      },
    );
    const [a] = searched.data.shops as any[];
    checkRows([a]);
    expect(a["on-click-action"].payload).toMatchObject({ go: "shops", q: "", cat: "" });
    expect(a["main-content"].description).toBe("All shops near you");
    const none = await handleFlowRequest(s, req({ go: "shops", cat: "", q: "", offset: "0" }), {
      signed: true,
    });
    const [b] = none.data.shops as any[];
    expect(b["main-content"].title).toBe("No shop delivers here yet");
    expect(b["on-click-action"].payload.go).toBe("shops");
  });

  it("the item page: required size, add-ons with prices, nutrition estimated, allergens declared, Goes well with", async () => {
    const r = await handleFlowRequest(
      fixtureStore("en"),
      req({ go: "item", slug: "alo-test-grill", item: FX.shaw }),
      { signed: true },
    );
    expect(r.screen).toBe("ITEM");
    expect(r.data).toMatchObject({
      name: "Chicken Shawarma",
      sub: "شاورما دجاج · Alo Test Grill",
      r1_visible: true,
      r1_required: true,
      c1_visible: true,
      c1_max: 2,
      r2_visible: false,
      gw_visible: true,
      add_label: "Add · from $5.00",
      facts: "≈ 520 kcal · 32 g protein (estimated)\nContains: gluten, eggs (declared by the shop)",
    });
    expect((r.data.r1_items as any[])[1]).toEqual({
      id: FX.large,
      title: "Large",
      description: "+$1.50",
    });
    expect((r.data.gw_items as any[])[0]).toMatchObject({ id: FX.fries, description: "+$2.00" });
  });

  it("an id the Flow sends that is not well formed is never passed on", async () => {
    const s = fixtureStore("en");
    let added = 0;
    s.add = async () => (added++, { status: "added" });
    await handleFlowRequest(s, req({ go: "add", item: "x'; drop", slug: "alo-test-grill" }), {
      signed: true,
    });
    await handleFlowRequest(s, req({ go: "item", slug: "../etc", item: FX.shaw }), {
      signed: true,
    });
    expect(added).toBe(0);
  });

  it("Confirm completes with the Flow token and the basket, never a price", async () => {
    const s = fixtureStore("en");
    await s.add(FX.token, FX.fries, 1, [], null, false);
    const r = await handleFlowRequest(s, req({ go: "confirm", remove: [] }), { signed: true });
    expect(r.screen).toBe("SUCCESS");
    expect(r.data.extension_message_response).toEqual({
      params: { flow_token: FX.flowToken, app: "alo_app", basket_id: "b1" },
    });
  });

  it("Arabic: the same screens in Arabic", async () => {
    const r = await handleFlowRequest(fixtureStore("ar"), req({}, "INIT"), { signed: true });
    expect(r.data.cats_label).toBe("شو جايي عبالك؟");
    expect((r.data.pop as any[])[0]["main-content"].title).toBe("شاورما دجاج");
  });
});

describe("the proxy signature", () => {
  const key = "ab".repeat(32);
  const now = 1_760_000_000_000;
  const ts = String(now / 1000);
  it("accepts Kapso's signed request and refuses a changed body, an old timestamp or another key", async () => {
    const raw = '{"data_exchange":{"action":"INIT"}}';
    const sig = await proxySignature(key, ts, raw);
    expect(await verifyProxy(key, ts, sig, raw, now)).toBe(true);
    expect(await verifyProxy(key, ts, sig, raw.replace("INIT", "BACK"), now)).toBe(false);
    expect(await verifyProxy(key, ts, sig, raw, now + 301_000)).toBe(false);
    expect(await verifyProxy("cd".repeat(32), ts, sig, raw, now)).toBe(false);
    expect(await verifyProxy(null, ts, sig, raw, now)).toBe(false);
    expect(await verifyProxy(key, null, sig, raw, now)).toBe(false);
  });
});
