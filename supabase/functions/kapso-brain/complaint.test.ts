import { describe, expect, it } from "vitest";
import { complaintApology, isComplaint } from "./complaint.ts";
import { decideGuard, parseCap } from "./usage.ts";

describe("isComplaint", () => {
  it("English complaints and frustration", () => {
    for (const t of ["my order was cold", "The food arrived late", "wrong order!", "you sent the wrong item", "it never arrived", "still waiting", "where is my order", "this is the worst", "I want a refund", "stupid bot", "you don't understand", "not what I ordered", "been waiting for 90 minutes", "missing items", "this is unacceptable"]) expect(isComplaint(t), t).toBe(true);
  });
  it("Arabic", () => {
    for (const t of ["طلبي بارد", "الأكل وصل متأخر", "طلب غلط", "وين طلبي", "ما وصل الطلب", "مش معقول", "بدي استرداد", "بوت غبي", "استنيت ساعة", "حرام عليكم"]) expect(isComplaint(t), t).toBe(true);
  });
  it("Arabizi", () => {
    for (const t of ["ma wasal talabi", "el akel bared", "wayn talabi", "ghalat", "zeft", "mish ma2oul"]) expect(isComplaint(t), t).toBe(true);
  });
  it("ordinary messages are not complaints", () => {
    for (const t of ["something cold to drink", "cold drinks", "I'm late for work, quick lunch", "late night menu", "2 shawarma", "hi", "wrong turn? no, I mean where is the nearest cafe", "a burger please", "بدي شي بارد", "عصير بارد", "طلب شاورما", "badde pizza", "where can I order pizza", "3asir barde", "bade 3asir barde", "بدي الاكل مع عصير بارد", "بدي الطلب متاخر", "the burger is not bad", "my order is not late", "I told you my address is near the church", "I'll be waiting 10 minutes at the door", "what's your refund policy", "can I see the refund policy"]) expect(isComplaint(t), t).toBe(false);
  });
  it("very long messages are left to the normal flow", () => expect(isComplaint("worst ".repeat(100))).toBe(false));
});

describe("apology", () => {
  it("apologises in both languages and names the order when known", () => {
    expect(complaintApology(false)).toMatch(/sorry/i);
    expect(complaintApology(true)).toMatch(/آسفين/);
    expect(complaintApology(false, { code: "AB12", status: "pending" })).toContain("#AB12");
  });
});

describe("per-phone cap level", () => {
  it("defaults to a sensible 60 calls per hour (about 25 chat turns)", () => expect(parseCap(undefined)).toBe(60));
  it("the secret still overrides it", () => expect(parseCap("100")).toBe(100));
  it("a real conversation of 20 turns is no longer capped", () => expect(decideGuard({ phoneCalls: 45, cap: parseCap(undefined), spentToday: 0, budget: 5 })).toBe("ok"));
  it("the cap still stops a flood", () => expect(decideGuard({ phoneCalls: 60, cap: 60, spentToday: 0, budget: 5 })).toBe("phone_cap"));
});
