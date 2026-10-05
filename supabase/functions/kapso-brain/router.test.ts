import { describe, expect, it } from "vitest";
import { CHEAP_TOOL_NAMES, cheapRouterEnabled, isDeclaredTool, routeTurn } from "./router";

const ctx = { pendingCart: false, activeBaskets: 0 };

describe("cheapRouterEnabled (default OFF)", () => {
  it.each([undefined, "", "false", "0", "no", "TRUEISH", "yes", "1", " "])("%j is off", (v) => expect(cheapRouterEnabled(v as any)).toBe(false));
  it.each(["true", "TRUE", " true "])("%j is on", (v) => expect(cheapRouterEnabled(v)).toBe(true));
});

describe("routeTurn: only clearly informational, read-only turns go to the cheap model", () => {
  it.each([
    "hi", "hello", "hey there", "thanks", "thank you!", "شكرا", "مرحبا", "marhaba",
    "what's good for lunch", "what do you have", "show me the menu", "can you recommend something", "any offers today?", "what's popular", "do you deliver to Baakleen", "are you open now", "how much is delivery", "what time do you close",
    "شو في عندكم", "رشحلي شي", "شو الأفضل", "هل في توصيل لبعقلين", "كم سعر التوصيل", "متى بتسكروا",
    "shu fi 3endkon", "shou 3ndkon", "ahla", "shokran",
  ])("%s → cheap", (t) => expect(routeTurn(t, ctx)).toBe("cheap"));

  it.each([
    "I want 2 soft drinks", "add a juice", "make it 3", "remove the drink", "checkout", "yes", "confirm", "cancel my order", "no thanks cancel", "where is my order", "my order is late and cold", "I want a refund",
    "bade etneen soft drinks", "badde shawarma", "بدي مشروب", "بدي اطلب", "الغي الطلب", "وين طلبي", "تأكيد",
    "change my address to Baakleen near the church building 3", "my name is Sami", "Baakleen, main street", "the usual", "reorder", "delete my data", "talk to a person",
    "what's good for lunch? I want two of them please and also deliver to my building on the second floor tonight at 8", // too long / mixed with ordering
    "I am allergic to peanuts what do you have", "do you have gluten free", "the food was terrible, what do you recommend", "how long until it arrives", "what do you have for vegans", "i have a problem, what do you recommend", "ما عندي حساسية شو في", "شو في عندكم نباتي", "٣", "لا",
    "can I get a burger", "3", "2x burger", "sure", "ok", "",
  ])("%j → main", (t) => expect(routeTurn(t, ctx)).toBe("main"));

  it("anything while a summary is waiting or a voice note is being replayed goes to the main model", () => {
    expect(routeTurn("hello", { pendingCart: true, activeBaskets: 0 })).toBe("main");
    expect(routeTurn("what do you have", { pendingCart: false, activeBaskets: 0, fromVoice: true })).toBe("main");
  });
  it("a customer with an open basket asking an informational question is still cheap, but 'checkout'-ish words are not", () => {
    expect(routeTurn("what do you recommend", { pendingCart: false, activeBaskets: 2 })).toBe("cheap");
    expect(routeTurn("what's in my basket", { pendingCart: false, activeBaskets: 2 })).toBe("main");
  });
});

describe("cheap tool set is read-only", () => {
  it("contains no mutating tool", () => {
    for (const bad of ["basket_add", "basket_set", "basket_clear", "checkout", "confirm_order", "cancel_pending", "request_human", "prepare_order"]) expect(CHEAP_TOOL_NAMES).not.toContain(bad);
    expect(CHEAP_TOOL_NAMES).toContain("search_menu");
    expect(CHEAP_TOOL_NAMES).toContain("needs_full_assistant");
  });
});

describe("only declared tools are dispatched", () => {
  const cheap = CHEAP_TOOL_NAMES.map((name) => ({ name }));
  it("accepts a declared tool and rejects mutating or invented ones", () => {
    expect(isDeclaredTool(cheap, "search_menu")).toBe(true);
    for (const n of ["confirm_order", "checkout", "basket_add", "request_human", "made_up_tool", ""]) expect(isDeclaredTool(cheap, n)).toBe(false);
  });
});
