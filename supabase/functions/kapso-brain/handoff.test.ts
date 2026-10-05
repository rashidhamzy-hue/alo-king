import { describe, expect, it } from "vitest";
import { adminCommand, handoffContext, isHumanRequest, relayText, shouldRelay, HANDOFF_HOURS } from "./handoff";

describe("isHumanRequest (English, Arabic, Arabizi)", () => {
  it.each([
    "talk to a person", "I want to talk to a real person please", "Can I speak to a human?", "connect me to an agent", "let me speak with someone", "I need to talk to the manager",
    "customer service please", "I want customer support", "human please", "real person", "live agent", "transfer me to a representative",
    "بدي احكي مع شخص", "بدي اتكلم مع حدا من الفريق", "ممكن اكلم موظف", "خدمة العملاء", "بدي انسان مش بوت", "بدنا نحكي مع مسؤول", "أريد التحدث مع شخص حقيقي",
    "bade e7ki ma3 shakhs", "bade e7ki ma3 shakhs min el team", "baddi e7ki ma3 7ada", "bade kellem moazaf", "beddi ekallem insen", "bade a7ki ma3 mas2ul",
  ])("%s → human", (t) => expect(isHumanRequest(t)).toBe(true));

  it.each([
    "I want 2 soft drinks", "talk about the menu", "can you tell me about the person who delivers", "the human body", "speak arabic please", "what are your hours", "hello",
    "my friend is a real person who likes pizza", "بدي مشروب غازي", "شو في عندكم", "badde etneen soft drinks men el tahouneh", "marhaba", "",
  ])("%j is not a request for a human", (t) => expect(isHumanRequest(t)).toBe(false));
});

describe("shouldRelay: only the configured admin number, replying to a forwarded message", () => {
  it("true for the admin with a context id", () => expect(shouldRelay("96171111111", "96171111111", "wamid.X")).toBe(true));
  it("normalises phone formats", () => expect(shouldRelay("+961 71 111 111", "96171111111", "wamid.X")).toBe(true));
  it("false for any other number", () => expect(shouldRelay("96170000001", "96171111111", "wamid.X")).toBe(false));
  it("false without a quoted message, or with no admin configured", () => {
    expect(shouldRelay("96171111111", "96171111111", undefined)).toBe(false);
    expect(shouldRelay("96171111111", "96171111111", "")).toBe(false);
    expect(shouldRelay("96171111111", "", "wamid.X")).toBe(false);
    expect(shouldRelay("", "", "wamid.X")).toBe(false);
  });
});

describe("adminCommand", () => {
  it.each(["/bot", "/BOT", " /bot ", "/done", "/handback"])("%s releases the chat", (t) => expect(adminCommand(t)).toBe("release"));
  it.each(["bot", "ok thanks", "/robot", "hello customer", ""])("%j is a normal reply", (t) => expect(adminCommand(t)).toBeNull());
});

describe("relayText", () => {
  it("labels the team, keeps the reply, clamps length", () => {
    expect(relayText("Your order is on the way", false)).toBe("💬 *Alo King team*\nYour order is on the way");
    expect(relayText("x".repeat(5000), false).length).toBeLessThan(1100);
    expect(relayText("مرحبا", true)).toContain("فريق ألو كينغ");
  });
  it("strips control characters", () => expect(relayText("hi\u0000\u0007 there", false)).not.toMatch(/[\u0000-\u0008]/));
});

describe("handoffContext (what the admin sees)", () => {
  const base = { name: "Sami", maskedPhone: "+961 ••• ••• 34", lang: "en", reason: "asked for a person", recent: ["hi", "I want a pizza", "where is my order??"], baskets: 1, lastOrder: { code: "AB12", status: "accepted", totalText: "$10.00 · 895,000 LBP" } };
  it("includes name, masked phone, recent messages, order and how to reply; no full phone", () => {
    const t = handoffContext(base);
    expect(t).toContain("Sami");
    expect(t).toContain("••• 34");
    expect(t).toContain("where is my order??");
    expect(t).toContain("AB12");
    expect(t).toMatch(/reply to this message/i);
    expect(t).toContain("/bot");
    expect(t).not.toMatch(/\b9617\d{7}\b/);
  });
  it("is bounded for WhatsApp (≤ 3500 chars) even with huge messages", () => {
    const t = handoffContext({ ...base, recent: Array.from({ length: 20 }, () => "y".repeat(2000)) });
    expect(t.length).toBeLessThanOrEqual(3500);
  });
  it("copes with no name and no order", () => {
    const t = handoffContext({ ...base, name: null, lastOrder: null, baskets: 0 });
    expect(t).not.toMatch(/undefined|null/);
  });
  it("handoff window is a small number of hours", () => expect(HANDOFF_HOURS).toBeGreaterThan(0));
});
