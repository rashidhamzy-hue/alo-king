import { describe, expect, it } from "vitest";
import { detectConsentSignal } from "@ak/core/optout";
import { canTransition, TRANSITIONS } from "@ak/core/order-machine";
import { cashGate, changeDue, usdEquivalent } from "@ak/core/cash";
import { rankDrivers, learnTravelTime, type DriverState } from "@ak/core/dispatch";
import { looksLooped, judge } from "@ak/agents/stt";
import { verifySignature, unwrap, buttons } from "@ak/wa/kapso";
import { preflight } from "@ak/wa/gateway";
import { OrderIntent } from "@ak/agents/schemas";

describe("opt-out", () => {
  it("honours stop words in every script", () => {
    for (const t of ["STOP", "وقف", "إلغاء", "ما بدي رسايل", "khalas", "Arrêt", "ما تبعتولي بعد"]) expect(detectConsentSignal(t)).toBe("opt_out");
  });
  it("does not fire on orders", () => {
    for (const t of ["بدي وقف الطلب تبع الخبز وزيد لبنة على الطلبية لو سمحت بدي ياه اليوم ضروري كتير كتير", "بدي كيلو بندورة", "stop by the shop please and bring 2 pepsi and a pack of bread for the house thank you"]) expect(detectConsentSignal(t)).toBeNull();
  });
});

describe("order machine", () => {
  it("never lets the agent confirm, pay or deliver", () => {
    for (const from of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[])
      for (const to of ["confirmed", "awaiting_payment", "preparing", "delivered", "closed"] as const)
        expect(canTransition(from, to, "agent")).toBe(false);
  });
  it("lets the customer confirm and the driver deliver", () => {
    expect(canTransition("awaiting_confirmation", "confirmed", "customer")).toBe(true);
    expect(canTransition("arrived", "delivered", "driver")).toBe(true);
    expect(canTransition("ready", "delivered", "driver")).toBe(false);
  });
});

describe("cash cap", () => {
  const cap = { softUsd: 150, hardUsd: 200 };
  it("gates by projected cash", () => {
    expect(cashGate(100, 30, cap)).toBe("ok");
    expect(cashGate(160, 10, cap)).toBe("soft_cap");
    expect(cashGate(160, 0, cap)).toBe("ok");
    expect(cashGate(140, 70, cap)).toBe("hard_cap");
    expect(cashGate(200, 0, cap)).toBe("hard_cap");
  });
  it("computes mixed-currency change", () => {
    expect(usdEquivalent(5, 450000, 89500)).toBe(10.03);
    expect(changeDue(9, 20, 0, 89500)).toEqual({ usd: 11, lbp: 0, shortUsd: 0 });
    expect(changeDue(9.4, 10, 0, 89500)).toEqual({ usd: 0, lbp: 54000, shortUsd: 0 });
    expect(changeDue(9, 5, 0, 89500).shortUsd).toBe(4);
  });
});

describe("dispatch", () => {
  const t: Record<string, number> = { "hub>a": 8, "hub>b": 20, "a>hub": 8, "b>hub": 22, "a>b": 14, "b>a": 14, "hub>hub": 0, "a>a": 0, "b>b": 0 };
  const m = (x: string, y: string) => t[`${x}>${y}`];
  const rules = { cap: { softUsd: 150, hardUsd: 200 }, maxOrders: 3, maxDetourMin: 8, stalePositionPenaltyMin: 10 };
  const d = (o: Partial<DriverState> & { driverId: string }): DriverState => ({ village: "hub", positionAgeMin: 1, cashUsd: 0, openStops: [], loadedOrders: 0, departed: false, ...o });
  const job = { orderId: "o1", pickupVillage: "hub", dropVillage: "a", codUsd: 20, readyInMin: 5 };
  it("prefers the nearer free driver and skips capped ones", () => {
    const r = rankDrivers(job, [d({ driverId: "far", village: "b" }), d({ driverId: "near" }), d({ driverId: "capped", cashUsd: 190 })], m, rules);
    expect(r.map((c) => c.driverId)).toEqual(["near", "far"]);
  });
  it("batches only within the detour limit", () => {
    const loaded = d({ driverId: "loaded", openStops: ["b"], loadedOrders: 1 });
    expect(rankDrivers(job, [loaded], m, rules)).toHaveLength(1);                       // hub>a>b = 22 vs hub>b = 20: +2 min
    expect(rankDrivers({ ...job, dropVillage: "b" }, [d({ driverId: "x", openStops: ["a"], loadedOrders: 1 })], m, rules)).toHaveLength(0); // +14 min
  });
  it("learns travel times", () => { expect(learnTravelTime(20, 0, 30)).toEqual({ minutes: 30, samples: 1 }); expect(learnTravelTime(20, 4, 30).minutes).toBe(22); });
});

describe("speech checks", () => {
  it("flags looped transcripts", () => {
    expect(looksLooped("مرحبا أردت أردت أردت أردت أردت أردت أردت أردت")).toBe(true);
    expect(looksLooped("بدي تلاتة ليبانيز برغر بلا كولسلو بس كبيس وكاتشاب وبطاطا")).toBe(false);
  });
  it("falls back to the second transcript", () => {
    const v = judge({ text: "اجل اجل اجل اجل اجل اجل اجل اجل اجل", provider: "a" }, { text: "بدي ربطة خبز ولبنة نص كيلو", provider: "b" }, 6);
    expect(v.usable && v.primary.provider).toBe("b");
  });
});

describe("whatsapp layer", () => {
  it("verifies Kapso signatures", async () => {
    const body = '{"message":{"id":"wamid.1"}}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifySignature(body, sig, "s3cret")).toBe(true);
    expect(await verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(await verifySignature(body, null, "s3cret")).toBe(false);
  });
  it("unwraps batches", () => { expect(unwrap({ batch: true, data: [1, 2] })).toEqual([1, 2]); expect(unwrap({ a: 1 })).toEqual([{ a: 1 }]); });
  it("refuses audio, free-form marketing and customer-line locations", () => {
    const base = { line: "customer" as const, partyId: "p", to: "x", dedupeKey: "t:0" };
    expect(preflight({ ...base, category: "service", msg: { type: "audio" } as never })).toBe("type_not_allowed");
    expect(preflight({ ...base, category: "marketing", msg: { type: "text", text: { body: "عرض" } } })).toBe("marketing_locked_pilot");
    expect(preflight({ ...base, category: "marketing", msg: { type: "template", template: { name: "t", language: { code: "ar" } } } })).toBe("marketing_locked_pilot");
    expect(preflight({ ...base, category: "service", msg: { type: "location", location: { latitude: 1, longitude: 1 } } })).toBe("location_ops_only");
    expect(preflight({ ...base, category: "service", msg: buttons("تأكيد الطلب؟", [{ id: "confirm", title: "تأكيد" }]) })).toBeNull();
  });
});

describe("order intent contract", () => {
  it("accepts a real-shaped order", () => {
    const r = OrderIntent.safeParse({ intent: "order", language: "mixed", fulfilment: "delivery", change_for_usd: 100,
      lines: [{ raw: "تنتين تشيز برغر وحدة بلا كبيس", query: "cheeseburger", qty: 2, modifiers: ["one without pickles"], confidence: 0.8 }],
      address: { village: "الخريبة" } });
    expect(r.success).toBe(true);
  });
});
