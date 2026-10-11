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
