import { describe, expect, it } from "vitest";
import { deletionConfirmation, forgetScope, privacyNotice } from "./privacy";

describe("forgetScope: delete / forget commands in English, Arabic and Arabizi", () => {
  it.each([
    "delete my data", "Delete my data please", "please delete all my data", "erase my data", "remove my personal information", "delete my account",
    "forget me", "wipe my data!", "Delete my information.",
    "احذف بياناتي", "امسح بياناتي", "من فضلك احذف كل بياناتي", "ازل معلوماتي", "احذفني", "انسني", "إحذف بياناتي",
    "e7zef bayanati", "emsa7 bayanati", "emse7 kel bayanati", "7ezef ma3lomati", "a7zefni", "ensani", "emsah bayanet",
  ])("%s → all", (t) => expect(forgetScope(t)).toBe("all"));

  it.each([
    "forget my address", "Delete my address", "remove my saved addresses", "delete my location", "clear my saved address please", "erase my pin",
    "احذف عنواني", "امسح عنواني", "انسى عنواني", "احذف عناويني", "امسح موقعي", "من فضلك انسي عنواني",
    "e7zef 3enwani", "emsa7 3enwani", "nsa 3enwani", "emse7 3enwane", "shil 3enwani",
  ])("%s → address", (t) => expect(forgetScope(t)).toBe("address"));

  it.each([
    "delete the last item", "I want to delete my order", "remove the drink", "what is my address", "can you forget the soft drinks", "my address is Baakleen near the church",
    "save my address", "hello", "", "احذف الصنف", "بدي اطلب", "e7zef el sandwich", "badde etneen soft drinks", "delete my data and also order a pizza",
  ])("%j is not a deletion request", (t) => expect(forgetScope(t)).toBeNull());
});

describe("messages", () => {
  it("one-line privacy notice in both languages tells the customer how to delete", () => {
    const en = privacyNotice(false), ar = privacyNotice(true);
    expect(en.split("\n")).toHaveLength(1);
    expect(en).toMatch(/delete my data/i);
    expect(ar.split("\n")).toHaveLength(1);
    expect(ar).toContain("احذف بياناتي");
    expect(en.length).toBeLessThan(200);
  });
  const counts = { addresses: 2, pins: 1, name: true, baskets: 1, voice: 3, chats: 12, carts: 1, ordersAnonymised: 4, openOrders: 1, offersOff: true };
  it("confirms exactly what was deleted and what is kept (all)", () => {
    const t = deletionConfirmation("all", counts, false);
    expect(t).toMatch(/2 saved address/i);
    expect(t).toMatch(/name/i);
    expect(t).toMatch(/4 past order/i);
    expect(t).toMatch(/accounting/i);
    expect(t).toMatch(/1 open order/i);
    expect(t).toMatch(/offers/i);
  });
  it("address scope does not claim the name was deleted", () => {
    const t = deletionConfirmation("address", { ...counts, name: false, ordersAnonymised: 0, offersOff: false }, false);
    expect(t).toMatch(/address/i);
    expect(t).not.toMatch(/your name/i);
    expect(t).not.toMatch(/offers/i);
  });
  it("Arabic confirmation", () => {
    const t = deletionConfirmation("all", counts, true);
    expect(t).toMatch(/[؀-ۿ]/);
    expect(t).toContain("2");
  });
  it("zero counts say nothing was stored rather than inventing deletions", () => {
    const t = deletionConfirmation("address", { addresses: 0, pins: 0, name: false, baskets: 0, voice: 0, chats: 0, carts: 0, ordersAnonymised: 0, openOrders: 0, offersOff: false }, false);
    expect(t).toMatch(/no saved address/i);
  });
});
