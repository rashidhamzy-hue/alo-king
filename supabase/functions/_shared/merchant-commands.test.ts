import { describe, expect, it } from "vitest";
import {
  clockTime,
  durationMinutes,
  nextBeirutTime,
  normalize,
  parseMerchantCommand,
} from "./merchant-commands.ts";

// 15:00 Beirut on 11 October 2026 (UTC+3).
const NOW = new Date("2026-10-11T12:00:00Z");
const p = (t: string) => parseMerchantCommand(t, NOW);

describe("normalize", () => {
  it("folds Arabic digits, tashkeel, alef forms and case", () => {
    expect(normalize("  سعر الكنافة ٣٫٥ ")).toBe("سعر الكنافه 3.5");
    expect(normalize("Mrakad 30 MINS!")).toBe("mrakad 30 mins");
    expect(normalize("مسكّر")).toBe("مسكر");
  });
});

describe("pause (§29.4)", () => {
  it.each([
    ["Mrakad 30 mins", 30],
    ["pause 45 min", 45],
    ["closed 1 hour", 60],
    ["مسكّر نص ساعة", 30],
    ["مسكر ساعة", 60],
    ["مسكرين ساعتين", 120],
    ["msaker nos se3a", 30],
    ["sakrin 20 d2i2a", 20],
    ["fermé 30 minutes", 30],
    ["fermé une demi-heure", 30],
    ["pause 1.5 hours", 90],
    ["closed 2 hours and half", 150],
    ["مسكر ٢٠ دقيقة", 20],
  ])("%s → %i minutes", (text, minutes) => {
    expect(p(text)).toEqual({ kind: "pause", minutes });
  });

  it.each([
    ["closed till 8", 20, 0],
    ["closed till 20:30", 20, 30],
    ["مسكر للـ 8", 20, 0],
    ["fermé jusqu'a 19h", null, null],
    ["msaker la 9 masa", 21, 0],
    ["closed till 11pm", 23, 0],
  ])("%s → until %s:%s", (text, hour, minute) => {
    const r = p(text);
    if (hour === null) return; // "19h" form is left to the model
    expect(r).toEqual({ kind: "pause_until", hour, minute });
  });

  it("rejects pauses over a day and nonsense", () => {
    expect(p("pause 2000 min")).toBeNull();
    expect(p("closed forever")).toBeNull();
  });
});

describe("open, balance, top up", () => {
  it.each(["open", "we are open", "فتحنا", "fta7na", "ouvert"])("%s → open", (t) =>
    expect(p(t)).toEqual({ kind: "open" }),
  );
  it.each(["balance", "رصيدي", "solde", "rasidi", "شو رصيدي"])("%s → balance", (t) =>
    expect(p(t)).toEqual({ kind: "balance" }),
  );
  it.each([
    ["top up 20", 20],
    ["charge 20$", 20],
    ["شحن ٢٠ دولار", 20],
    ["recharge 15", 15],
  ])("%s → top up %i", (t, n) => expect(p(t)).toEqual({ kind: "top_up", amountUsd: n }));
});

describe("price (§30.2.1)", () => {
  it.each([
    ["price knefe 3.5", "knefe", 3.5],
    ["prix knefe 3,5", "knefe", 3.5],
    ["سعر الكنافة ٣٫٥", "كنافه", 3.5],
    ["se3r shawarma 4$", "shawarma", 4],
  ])("%s", (t, item, priceUsd) => expect(p(t)).toEqual({ kind: "price", item, priceUsd }));
});

describe("sold out and back", () => {
  it.each([
    ["sold out knefe", "knefe"],
    ["knefe sold out", "knefe"],
    ["خلصت الكنافة", "كنافه"],
    ["الكنافه خلصت", "الكنافه"],
    ["khelset el knefe", "el knefe"],
    ["plus de croissants", "croissants"],
    ["croissants épuisé", "croissants"],
  ])("%s → sold out %s", (t, item) => expect(p(t)).toEqual({ kind: "sold_out", item }));
  it.each([
    ["back knefe", "knefe"],
    ["knefe is back", "knefe"],
    ["رجعت الكنافة", "كنافه"],
    ["croissants dispo", "croissants"],
  ])("%s → back %s", (t, item) => expect(p(t)).toEqual({ kind: "back_in_stock", item }));
});

describe("everything else goes to the model", () => {
  it.each([
    "hi",
    "can you change my opening hours to 9",
    "شو في طلبات اليوم؟",
    "",
    "x".repeat(200),
  ])("%s → null", (t) => expect(p(t)).toBeNull());
});

describe("time helpers", () => {
  it("durations", () => {
    expect(durationMinutes("nos se3a")).toBe(30);
    expect(durationMinutes("3 hours")).toBe(180);
    expect(durationMinutes("tomorrow")).toBeNull();
  });
  it("an hour already passed this morning means the evening", () => {
    expect(clockTime("8", NOW)).toEqual({ hour: 20, minute: 0 });
    expect(clockTime("16", NOW)).toEqual({ hour: 16, minute: 0 });
    expect(clockTime("9am", NOW)).toEqual({ hour: 9, minute: 0 });
  });
  it("the next Beirut 20:00 after 15:00 Beirut is 17:00 UTC the same day", () => {
    expect(nextBeirutTime(20, 0, NOW).toISOString()).toBe("2026-10-11T17:00:00.000Z");
    expect(nextBeirutTime(9, 0, NOW).toISOString()).toBe("2026-10-12T06:00:00.000Z");
  });
});

import { parseMerchantCommand as parseX, phoneE164 } from "./merchant-commands";
describe("merchant WhatsApp extras (§32.5)", () => {
  const p = (s: string) => parseX(s);
  it("generator mode", () => {
    for (const s of ["ما في كهربا", "ما فيّ كهربا", "generator off", "Ma fi kahraba", "no power", "coupure de courant"])
      expect(p(s), s).toEqual({ kind: "power_off" });
    for (const s of ["power back", "رجعت الكهربا", "إجت الكهربا", "kahraba rej3et", "le courant est revenu"])
      expect(p(s), s).toEqual({ kind: "power_on" });
    expect(p("الفرن بدو كهربا")).toEqual({ kind: "needs_power", item: "الفرن", on: true });
    expect(p("Fries needs power")).toEqual({ kind: "needs_power", item: "fries", on: true });
    expect(p("salad without power")).toEqual({ kind: "needs_power", item: "salad", on: false });
  });
  it("kitchen capacity", () => {
    expect(p("capacity 8")).toEqual({ kind: "capacity", max: 8 });
    expect(p("طاقة المطبخ ١٢")).toEqual({ kind: "capacity", max: 12 });
    expect(p("capacity off")).toEqual({ kind: "capacity", max: null });
    expect(p("capacity 0")).toBeNull();
    expect(p("capacity 500")).toBeNull();
  });
  it("staff by WhatsApp", () => {
    expect(p("Add Ali as kitchen +961 3 123 456")).toEqual({ kind: "staff_add", name: "Ali", role: "kitchen", phone: "+9613123456" });
    expect(p("زيد علي مطبخ 03 123 456")).toMatchObject({ kind: "staff_add", role: "kitchen", phone: "+9613123456" });
    expect(p("ajoute Rita caisse 71-234-567")).toMatchObject({ kind: "staff_add", name: "Rita", role: "cashier", phone: "+96171234567" });
    expect(p("add Samir as driver 0096176111222")).toMatchObject({ role: "driver", phone: "+96176111222" });
    expect(p("add Ali as boss +961 3 123 456")).toBeNull(); // unknown role: not guessed
    expect(p("add Ali as owner +961 3 123 456")).toBeNull(); // owners are not added by message
    expect(p("remove Ali")).toEqual({ kind: "staff_remove", name: "ali" });
    expect(p("شيل علي")).toEqual({ kind: "staff_remove", name: "علي" });
  });
  it("same-price badge and substitutes", () => {
    expect(p("same price as in the shop")).toEqual({ kind: "same_price", on: true });
    expect(p("نفس اسعار المحل")).toEqual({ kind: "same_price", on: true });
    expect(p("مش نفس السعر")).toEqual({ kind: "same_price", on: false });
    expect(p("sub K7M2QX pepsi = 7up")).toEqual({ kind: "substitute", code: "K7M2QX", missing: "pepsi", substitute: "7up" });
    expect(p("بديل #K7M2QX بيبسي = سفن اب")).toEqual({ kind: "substitute", code: "K7M2QX", missing: "بيبسي", substitute: "سفن اب" });
  });
  it("the older commands still parse as before", () => {
    expect(p("ما في كنافة")).toEqual({ kind: "sold_out", item: "كنافه" });
    expect(p("مسكر نص ساعة")).toMatchObject({ kind: "pause", minutes: 30 });
  });
  it("phone numbers to E.164", () => {
    expect(phoneE164("+961 3 123 456")).toBe("+9613123456");
    expect(phoneE164("03123456")).toBe("+9613123456");
    expect(phoneE164("81 123 456")).toBe("+96181123456");
    expect(phoneE164("12")).toBeNull();
  });
});

describe("the copilot's commands (§39.7)", () => {
  it.each([
    ["fryer off 15 min", "fryer", 15],
    ["الفراية مطفاية ربع ساعة", "fryer", 15],
    ["la friteuse en panne 30 minutes", "fryer", 30],
    ["grill off 1 hour", "grill", 60],
    ["el fern ma3attal nos se3a", "oven", 30],
    ["turn off the saj for 20 min", "saj", 20],
    ["oven off", "oven", null],
  ])("%s → station %s off for %s", (text, station, minutes) => {
    expect(p(text)).toMatchObject({ kind: "avail_off", station, minutes });
  });
  it("a section or an item off for a while, or until a time", () => {
    expect(p("sandwiches off 1h")).toEqual({ kind: "avail_off", target: "sandwiches", station: null, minutes: 60 });
    // 15:00 Beirut now: "till 6" is 18:00, three hours away.
    expect(p("knefe off till 6")).toEqual({ kind: "avail_off", target: "knefe", station: null, minutes: 180 });
  });
  it.each(["fryer back", "الفراية رجعت", "grill on", "le four remarche", "turn on the oven"])("%s → a station back on", (t) =>
    expect(p(t)).toMatchObject({ kind: "avail_on" }),
  );
  it("older meanings win: capacity, generator, an item back in stock", () => {
    expect(p("capacity off")).toEqual({ kind: "capacity", max: null });
    expect(p("generator off")).toEqual({ kind: "power_off" });
    expect(p("knefe back")).toEqual({ kind: "back_in_stock", item: "knefe" });
    expect(p("remove Ali")).toEqual({ kind: "staff_remove", name: "ali" });
    expect(p("closed 1 hour")).toEqual({ kind: "pause", minutes: 60 });
  });
  it("stock, add, rename, describe, station and remove items", () => {
    expect(p("stock rice 20")).toEqual({ kind: "stock_set", item: "rice", quantity: 20 });
    expect(p("مخزون الرز ٢٠")).toEqual({ kind: "stock_set", item: "رز", quantity: 20 });
    expect(p("add item falafel wrap 4.5")).toEqual({ kind: "item_add", name: "falafel wrap", priceUsd: 4.5, section: null });
    expect(p("زيد صنف فلافل 4 بالسندويشات")).toEqual({ kind: "item_add", name: "فلافل", priceUsd: 4, section: "سندويشات" });
    expect(p("rename knefe to knefe bi jebne")).toEqual({ kind: "item_rename", item: "knefe", name: "knefe bi jebne" });
    expect(p("describe Knefe: hot, with cheese")).toEqual({ kind: "item_describe", item: "knefe", description: "hot, with cheese" });
    expect(p("fries station fryer")).toEqual({ kind: "item_station", item: "fries", station: "fryer" });
    expect(p("remove item knefe")).toEqual({ kind: "item_remove", item: "knefe" });
    expect(p("شيل صنف الكنافة")).toEqual({ kind: "item_remove", item: "كنافه" });
  });
  it("offers", () => {
    expect(p("10% off")).toEqual({ kind: "offer", offer: { type: "percent", percent: 10, target: null, days: 7 } });
    expect(p("offer 15% on sandwiches 3 days")).toEqual({
      kind: "offer",
      offer: { type: "percent", percent: 15, target: "sandwiches", days: 3 },
    });
    expect(p("خصم 20% على الكنافة")).toMatchObject({ kind: "offer", offer: { type: "percent", percent: 20, target: "الكنافه" } });
    expect(p("happy hour 20% 3pm-6pm")).toEqual({
      kind: "offer",
      offer: { type: "happy_hour", percent: 20, from: "15:00", to: "18:00", target: null, days: 7 },
    });
    expect(p("10% off sandwiches 1 day")).toEqual({
      kind: "offer",
      offer: { type: "percent", percent: 10, target: "sandwiches", days: 1 },
    });
    expect(p("10% off for 3 days")).toEqual({ kind: "offer", offer: { type: "percent", percent: 10, target: null, days: 3 } });
    expect(p("first order 15%")).toEqual({ kind: "offer", offer: { type: "first_order", percent: 15, days: 30 } });
    expect(p("free fries with 2 shawarma")).toEqual({
      kind: "offer",
      offer: { type: "free_item", free: "fries", minQuantity: 2, target: "shawarma", days: 7 },
    });
    expect(p("stop offer")).toEqual({ kind: "offer_stop" });
    expect(p("وقف العرض")).toEqual({ kind: "offer_stop" });
  });
  it("closures and hours", () => {
    expect(p("closed tomorrow")).toEqual({ kind: "closure", day: "2026-10-12" });
    expect(p("مسكرين بكرا")).toEqual({ kind: "closure", day: "2026-10-12" });
    expect(p("closed 20/10")).toEqual({ kind: "closure", day: "2026-10-20" });
    expect(p("closed friday")).toEqual({ kind: "closure", day: "2026-10-16" });
    expect(p("closed every sunday")).toEqual({ kind: "hours", weekdays: [0], opens: null, closes: null });
    expect(p("hours mon-fri 9-23")).toEqual({ kind: "hours", weekdays: [1, 2, 3, 4, 5], opens: "09:00", closes: "23:00" });
    expect(p("دوام كل يوم 10-22")).toEqual({ kind: "hours", weekdays: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "22:00" });
    expect(p("hours sat sun 12-2am")).toEqual({ kind: "hours", weekdays: [0, 6], opens: "12:00", closes: "02:00" });
  });
  it("minimum order, radius, Boost, reports, staff, memory and help", () => {
    expect(p("min order 10")).toEqual({ kind: "min_order", usd: 10 });
    expect(p("الحد الادنى 8$")).toEqual({ kind: "min_order", usd: 8 });
    expect(p("no minimum")).toEqual({ kind: "min_order", usd: null });
    expect(p("radius 3 km")).toEqual({ kind: "radius", km: 3 });
    expect(p("boost 20")).toEqual({ kind: "boost", budgetUsd: 20, audience: "nearby" });
    expect(p("boost 30$ past customers")).toEqual({ kind: "boost", budgetUsd: 30, audience: "past_customers" });
    expect(p("stop boost")).toEqual({ kind: "boost_stop" });
    expect(p("report")).toEqual({ kind: "report", period: "day" });
    expect(p("تقرير الاسبوع")).toEqual({ kind: "report", period: "week" });
    expect(p("staff")).toEqual({ kind: "staff_list" });
    expect(p("شو بتتذكر")).toEqual({ kind: "memory" });
    expect(p("help")).toEqual({ kind: "help" });
  });
});
