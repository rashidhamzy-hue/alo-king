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
    ["cancel my order", "cancel_order"],
    ["Please cancel the order", "cancel_order"],
    ["annuler ma commande", "cancel_order"],
    ["الغي الطلب", "cancel_order"],
    ["إلغاء الطلب", "cancel_order"],
    ["baddi elghe el talab", "cancel_order"],
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
  it("reads Change address, the web pages' link back (session 5g), in four languages", () => {
    for (const t of [
      "Change address",
      "change my address",
      "Changer d'adresse",
      "غيّر العنوان",
      "ghayer el 3enwen",
    ])
      expect(deterministicIntent(t)).toEqual({ kind: "address" });
    expect(deterministicIntent("change address to Baakline please")).toBeNull();
  });
  it("reads Explore in four languages (session 5g part B)", () => {
    for (const t of ["Explore", "explorer", "استكشف", "Shops near me"])
      expect(deterministicIntent(t)).toEqual({ kind: "explore" });
  });
  it("answers the ice breakers and the /order, /explore, /orders and /help commands (§39.15.11)", () => {
    expect(deterministicIntent("Order food")?.kind).toBe("menu");
    expect(deterministicIntent("Explore shops near me")?.kind).toBe("explore");
    expect(deterministicIntent("My orders")?.kind).toBe("track");
    expect(deterministicIntent("Talk to a person")?.kind).toBe("human");
    expect(deterministicIntent("/order")?.kind).toBe("menu");
    expect(deterministicIntent("/explore")?.kind).toBe("explore");
    expect(deterministicIntent("/orders")?.kind).toBe("track");
    expect(deterministicIntent("/help")?.kind).toBe("greeting");
  });
  it("leaves ordinary orders to the model", () => {
    for (const t of [
      "2 shawarma",
      "a person's portion",
      "cancel the falafel",
      "don't cancel my order",
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

// Session 5f part 8a (CUSTOMER-EXPERIENCE §3.1): shop links, empty messages and the website's pre-filled texts.
import { isEmptyish, shopToken, siteText, withoutShopToken } from "./intents";
import { ar as siteAr } from "../../../../src/content/ar";
import { en as siteEn } from "../../../../src/content/en";
import { fr as siteFr } from "../../../../src/content/fr";
import { fmt, withShop } from "../../../../src/lib/site";

describe("first contact: shop links (§3.1 #2)", () => {
  it("reads the slug the website puts after the shop's name, in any language and case", () => {
    expect(shopToken("Hi Alo King, I'd like to order from Eatout (shop:eatout-baakline)")).toBe(
      "eatout-baakline",
    );
    expect(shopToken("مرحبا ألو كينغ، بدي اطلب من إيت آوت (SHOP:Eatout)")).toBe("eatout");
    expect(shopToken("Bonjour, je voudrais commander chez Eatout")).toBeNull();
    expect(shopToken("shop: eatout")).toBeNull();
  });
  it("leaves the rest of the text for the language and a fallback", () => {
    expect(
      withoutShopToken("Hi Alo King, I'd like to order from Eatout (shop:eatout): 2× Wrap"),
    ).toBe("Hi Alo King, I'd like to order from Eatout : 2× Wrap");
    expect(withoutShopToken("(shop:eatout)")).toBe("");
    // A bare "shop:x" in a message is text, not a link (only the website's bracketed form is).
    expect(shopToken("my shop:eatout order")).toBeNull();
    expect(withoutShopToken("my shop:eatout order")).toBe("my shop:eatout order");
  });
});

describe("first contact: nothing to read (§3.1 #1)", () => {
  it('"?", "!!", "..." and emoji are a hello; words and digits are not', () => {
    for (const t of ["?", "??", "!!", "...", "👋", "🙂🙂", " ؟ "])
      expect(isEmptyish(t), t).toBe(true);
    for (const t of ["hi", "2", "مرحبا", "a?"]) expect(isEmptyish(t), t).toBe(false);
  });
});

describe("first contact: the website's pre-filled texts", () => {
  const all = [siteEn, siteAr, siteFr];
  it("the greeting alone, an order (in a village, for the family) and a shop, in the three languages of the site", () => {
    for (const t of all) {
      expect(siteText(t.wa.generic), t.wa.generic).toEqual({ kind: "order" });
      expect(siteText(fmt(t.wa.place, { place: "Baakline" })), t.wa.place).toEqual({
        kind: "order",
      });
      expect(siteText(t.wa.sendHome), t.wa.sendHome).toEqual({ kind: "order" });
      expect(siteText(fmt(t.wa.vendor, { vendor: "Eatout" })), t.wa.vendor).toEqual({
        kind: "shop",
        name: "Eatout",
      });
      expect(siteText(fmt(t.wa.vendorItems, { vendor: "Eatout", items: "2× Wrap" }))).toEqual({
        kind: "shop",
        name: "Eatout",
      });
    }
    expect(siteText("Hi Alo King!")).toEqual({ kind: "greeting" });
    expect(siteText("مرحبا ألو كينغ")).toEqual({ kind: "greeting" });
  });
  it("a cuisine is a search; a person or tracking is read as typed", () => {
    expect(siteText(fmt(siteEn.wa.cuisine, { cuisine: "shawarma" }))).toEqual({
      kind: "text",
      text: "shawarma",
    });
    expect(siteText(fmt(siteFr.wa.cuisine, { cuisine: "pizza" }))).toEqual({
      kind: "text",
      text: "pizza",
    });
    expect(siteText(siteEn.wa.person)).toEqual({
      kind: "text",
      text: "I need to talk to a person",
    });
    const track = siteText(siteEn.wa.track);
    expect(track?.kind === "text" && deterministicIntent(track.text)?.kind).toBe("track");
    const person = siteText(siteAr.wa.person);
    expect(person?.kind === "text" && deterministicIntent(person.text)?.kind).toBe("human");
    expect(deterministicIntent("بدي احكي مع حدا")?.kind).toBe("human");
    expect(deterministicIntent("baddi e7ke ma3 7ada")?.kind).toBe("human");
  });
  it("a typed message that does not start with the site's greeting is not a site text", () => {
    expect(siteText("hi")).toBeNull();
    expect(siteText("2 shawarma")).toBeNull();
    expect(siteText("مرحبا ألو كينغ، بدي اطلب برغر")).toEqual({ kind: "text", text: "اطلب برغر" });
  });
  it("the shop page's text carries the key the bot opens the shop with", () => {
    for (const t of all) {
      const text = fmt(t.wa.vendor, { vendor: withShop("Eatout", "eatout-baakline") });
      expect(shopToken(text), text).toBe("eatout-baakline");
    }
  });
});
