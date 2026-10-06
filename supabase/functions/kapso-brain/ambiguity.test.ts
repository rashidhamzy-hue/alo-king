import { describe, expect, it } from "vitest";
import { eitherOrOptions, isVagueAssent, reAskCard } from "./ambiguity.ts";

describe("isVagueAssent", () => {
  it("vague agreements in three scripts", () => { for (const t of ["ok", "OK!", "deal", "yes", "Sure.", "sounds good", "either", "تمام", "ماشي", "اوكي", "طيب", "tamem", "mashi", "yalla"]) expect(isVagueAssent(t), t).toBe(true); });
  it("anything that picks something is not vague", () => { for (const t of ["the chicken", "the first one", "ok the beef", "2 chicken", "deal, chicken please", "yes the large", "ماشي الدجاج", "no"]) expect(isVagueAssent(t), t).toBe(false); });
});

describe("eitherOrOptions", () => {
  it("plain text 'A or B?'", () => {
    expect(eitherOrOptions("Do you want the chicken or the beef?")).toEqual(["the chicken", "the beef"]);
    expect(eitherOrOptions("Great pick! Chicken shawarma or beef shawarma?")).toEqual(["Chicken shawarma", "beef shawarma"]);
    expect(eitherOrOptions("بدك دجاج أو لحمة؟")).toEqual(["دجاج", "لحمة"]);
  });
  it("two-button question cards", () => {
    expect(eitherOrOptions("[interactive buttons: Add a drink with that? 🥤 Pepsi — $1 | ➕ Add drink / 🥗 Add salad]")).toEqual(["➕ Add drink", "🥗 Add salad"]);
    expect(eitherOrOptions("[interactive buttons: Which one for *shawarma*? 👇 | Chicken Shawarma / Beef Shawarma]")).toEqual(["Chicken Shawarma", "Beef Shawarma"]);
  });
  it("fixed-action cards never count: a plain yes on an order summary is the customer's own confirmation", () => {
    expect(eitherOrOptions("[interactive buttons: Order summary ... Confirm? | ✅ Confirm Order / ✏️ Edit]")).toBeNull();
    expect(eitherOrOptions("[interactive buttons: Cancel order #AB? | ❌ Yes, cancel / Keep it]")).toBeNull();
    expect(eitherOrOptions("[interactive buttons: Add a drink? | ➕ Add drink / ✅ Checkout]")).toBeNull();
  });
  it("not an either/or", () => {
    for (const t of ["What are you craving?", "Added to your basket 🧺", "[interactive menu list: Menu]", "Do you want a drink?", "Chicken or beef", "[interactive buttons: Pick | A / B / C]"]) expect(eitherOrOptions(t), t).toBeNull();
  });
});

describe("reAskCard", () => {
  it("two buttons, applies nothing, both languages, titles within 20", () => {
    for (const ar of [false, true]) {
      const c = reAskCard(["A".repeat(60), "B".repeat(60)], ar);
      expect(c.buttons).toHaveLength(2); expect(c.buttons.every((b) => b.title.length <= 20)).toBe(true); expect(c.body.length).toBeLessThan(1024);
    }
    expect(reAskCard(["Chicken", "Beef"], false).buttons.map((b) => b.title)).toEqual(["Chicken", "Beef"]);
  });
});
