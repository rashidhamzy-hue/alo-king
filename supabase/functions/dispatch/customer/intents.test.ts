import { describe, expect, it } from "vitest";
import { deterministicIntent, detectLang, looksLikeComplaint, PRICE_RE } from "./intents";

describe("detectLang", () => {
  it.each([
    ["بدي ٢ شاورما", "ar"],
    ["بدي pizza مع frites", "ar"], // Arabic script dominates a mixed message
    ["I want two shawarma please", "en"],
    ["Je voudrais une pizza svp", "fr"],
    ["bade 2 shawarma w 3elbe pepsi", "arabizi"],
    ["shu fi akel tayeb", "arabizi"],
    ["kifak, badde manousheh", "arabizi"],
  ])("%s → %s", (t, lang) => expect(detectLang(t)).toBe(lang));
  it("keeps the previous language for an empty or digit-only message", () => {
    expect(detectLang("  ", "fr")).toBe("fr");
    expect(detectLang("2", "en")).toBe("en");
  });
});

describe("deterministicIntent", () => {
  it.each([
    ["menu", "menu"],
    ["Order", "menu"],
    ["اطلب", "menu"],
    ["القائمة", "menu"],
    ["Commander", "menu"],
    ["badde otlob", "menu"],
    ["STOP", "stop"],
    ["وقف", "stop"],
    ["Arrêter", "stop"],
    ["delete my data", "delete_data"],
    ["امحوا معلوماتي", "delete_data"],
    ["supprimer mes données", "delete_data"],
    ["forget my history", "forget_history"],
    ["انسوا طلباتي", "forget_history"],
    ["I want to talk to a person", "human"],
    ["a person", "human"],
    ["Person", "human"],
    ["I need a person", "human"],
    ["somebody", "human"],
    ["human being", "human"],
    ["I want someone please", "human"],
    ["بدي احكي حدا", "human"],
    ["baddi e7ke 7ada", "human"],
    ["where is my order", "track"],
    ["وين الطلب", "track"],
    ["où est ma commande ?", "track"],
    ["the usual", "usual"],
    ["متل العادة", "usual"],
    ["yes", "yes"],
    ["ايه", "yes"],
    ["oui merci", "yes"],
    ["la2", "no"],
    ["مرحبا", "greeting"],
  ])("%s → %s", (t, kind) => expect(deterministicIntent(t)?.kind).toBe(kind));
  it("leaves ordinary orders to the model", () => {
    for (const t of [
      "2 shawarma",
      "a person's portion",
      "two persons",
      "I want a person's portion",
      "can I get someone's usual",
      "بدي شي طيب بالشوف",
      "une pizza margherita",
      "stop the onions on my shawarma",
    ])
      expect(deterministicIntent(t), t).toBeNull();
  });
});

describe("guards", () => {
  it("spots prices in any currency or script", () => {
    for (const t of ["$5", "5 $", "it costs 3 dollars", "89,500 LBP", "١٢ دولار", "500 الف"])
      expect(PRICE_RE.test(t), t).toBe(true);
    for (const t of ["2 shawarma", "Baakline", "3rd floor"])
      expect(PRICE_RE.test(t), t).toBe(false);
  });
  it("spots complaints", () => {
    expect(looksLikeComplaint("the order was wrong")).toBe(true);
    expect(looksLikeComplaint("الاكل وصل بارد")).toBe(true);
    expect(looksLikeComplaint("2 shawarma please")).toBe(false);
  });
});

// The deterministic half of the customer eval set (evals/customer/cases.jsonl) runs on every PR.
import { readFileSync } from "node:fs";
describe("customer eval set: deterministic cases", () => {
  const cases = readFileSync("evals/customer/cases.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  it("has all four languages and both kinds of case", () => {
    expect(new Set(cases.map((c) => c.lang))).toEqual(new Set(["ar", "en", "fr", "arabizi"]));
    expect(cases.filter((c) => c.expect.tool).length).toBeGreaterThanOrEqual(50);
  });
  for (const c of cases.filter((x) => x.expect.intent))
    it(`${c.id} ${c.text} → ${c.expect.intent}`, () =>
      expect(deterministicIntent(c.text)?.kind).toBe(c.expect.intent));
  it("no model case is caught by a deterministic rule", () => {
    for (const c of cases.filter((x) => x.expect.tool))
      expect(deterministicIntent(c.text), c.text).toBeNull();
  });
});
