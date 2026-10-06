import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offTopic, scopeReply } from "./scope.ts";

// The bot only helps with ordering and vendor questions. Clear off-topic requests are answered with a fixed redirect and NO model call;
// anything ambiguous goes to the model, whose prompt has the same scope rule. The classifier must never block a real food question.
const OFF = [
  // English
  "write me a poem about the sea", "Can you write a song for my mother?", "compose an essay on climate change", "write python code to sort a list", "tell me a joke", "tell me a story",
  "what's the capital of France", "who won the world cup", "what is the weather in Beirut", "solve 2x + 3 = 7", "what is 15*12", "help me with my homework",
  "give me medical advice for my headache", "what medicine for a cough", "should I invest in gold", "who should I vote for", "I need a lawyer", "send me nudes",
  // Arabic
  "اكتب لي قصيدة عن الوطن", "احكيلي نكتة", "شو عاصمة فرنسا", "مين ربح كاس العالم", "شو الطقس اليوم", "ساعدني بالواجب المدرسي", "اكتبلي كود بايثون", "شو الدوا للصداع",
  // Arabizi
  "ahkili nokte", "ktoub li 2asside", "sa3dne bel wajeb el madrase",
  // French
  "raconte-moi une blague", "écris-moi un poème", "quelle est la capitale du Liban",
];
const ON = [
  "what's your best pizza", "do you have a vegan burger", "is the shawarma halal", "what time does Al Tahouneh close", "where is my order", "how do I pay",
  "I have a headache can I get a soup", "translate the menu to English", "write a note on the order: no onions", "can you write my address down", "tell me about Al Mamlaka restaurant",
  "Joker burger please", "Capital Burger menu", "is delivery working in the rain", "promo code for the order", "what is the delivery fee", "recommend something for dinner for 10 people",
  "weather permitting can I order for tomorrow", "I'm allergic to nuts, what is safe", "give me the number of the restaurant", "what is in the kibbeh", "send me the menu in Arabic",
  "شو في ع المنيو", "كم سعر التوصيل", "بدي اطلب شاورما", "اكتب على الطلب بدون بصل", "شو احلى حلو عندكم", "وين طلبي", "في عندكم مناقيش", "عندي حساسية من الفول",
  "badde etneen shawarma", "shu fi lal ghada", "bonjour, je voudrais commander une pizza", "quelle est votre meilleure pizza",
  // real messages that contain a word an off-topic pattern could want (found by review): all must reach the normal flow
  "send 2 pizzas, I have an exam", "I have an exam, send fries and a chicken wrap", "wings for the exam", "what is 2*3 pizzas", "what is the dollar rate for LBP", "what's the exchange rate for LBP", "what is the exchange rate you use",
  "كم سعر الدولار اليوم عندكم", "كم صرف الدولار", "calculate the total", "the bill is wrong, calculate again", "what is 2+3 items", "what's the weather, will the driver come", "what is the temperature of the fries",
  "where is the weather station building", "near the weather station", "building next to the bank", "write down my code 1234", "write code on the box: 1234", "write the address: script street", "write a letter to the driver",
  "write an email to the owner", "اكتب رساله للسواق", "عطيني كود الخصم", "قل لي كود الخصم", "عطيني برنامج الدوام", "شو الطقس، السواق جاي؟", "should i take a combo", "should I take the 2 pizzas", "dosage? no", "طبيب", "I live near the debug street",
  "my html address", "dating cafe menu", "css cafe", "sql burger", "diagnosis pizza", "translate the menu please", "translate this: poulet", "what's the bitcoin price",
  "Hi", "thanks!", "ok", "1x2, 3", "yes", "", "Poem Cafe open?", "Java Coffee price",
];

describe("offTopic: clear off-topic requests are caught", () => {
  it.each(OFF)("%s", (t) => expect(offTopic(t)).toBe(true));
});
describe("offTopic: real food and vendor questions are never blocked", () => {
  it.each(ON)("'%s'", (t) => expect(offTopic(t)).toBe(false));
  it("a very long message is left to the model, and non-strings never throw", () => {
    expect(offTopic("write me a poem " + "very ".repeat(60))).toBe(false);
    for (const v of [null, undefined, 5, {}]) expect(offTopic(v as any)).toBe(false);
  });
});
describe("scopeReply", () => {
  it("one short redirect in the customer's language that says what the bot does and asks about food; no Meta or internal talk", () => {
    const en = scopeReply(false), ar = scopeReply(true);
    expect(en).toMatch(/order/i); expect(en).toMatch(/\?/); expect(en.length).toBeLessThan(220);
    expect(ar).toMatch(/[؀-ۿ]/); expect(ar).toMatch(/؟/); expect(ar.length).toBeLessThan(220);
    expect(en).not.toMatch(/model|prompt|instruction|AI/i);
  });
});

describe("wiring and prompts", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  it("the off-topic check runs on plain text turns BEFORE search-first, the deterministic order path and the model (so it costs no model call)", () => {
    const i = src.indexOf("offTopic(userText)");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf("resolveMessage(phone, userText)"));
    expect(i).toBeLessThan(src.indexOf("searchFirst(c, phone, userText, prof)"));
    expect(i).toBeLessThan(src.indexOf("const guard = await aiGuard"));
    expect(src.slice(i - 60, i + 20)).toMatch(/!reply && !loc/);
  });
  it("the customer prompt has a SCOPE section: only ordering and vendor questions, one-sentence decline, role-change requests are off-topic, no medical advice", () => {
    const c = src.slice(src.indexOf("const CSYSTEM"), src.indexOf("async function lastOrder"));
    expect(c).toMatch(/\nSCOPE\n/);
    for (const re of [/only help with ordering/i, /one short friendly sentence/i, /ignore these rules|change your role/i, /never give medical/i, /general knowledge/i]) expect(c).toMatch(re);
  });
  it("the owner prompt is scoped to running the restaurant", () => {
    const a = src.slice(src.indexOf("const ASYSTEM"), src.indexOf("const ASYSTEM") + 6000);
    expect(a).toMatch(/\nSCOPE\n/); expect(a).toMatch(/only help the owner run/i);
  });
});
