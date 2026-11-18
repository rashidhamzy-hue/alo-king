// B1e: the kind of product a message asks for with a fact, found by code in the customer's own words when the reading gave no line
// (evals/cases/b1e_dropped_line.json). A fact alone, a fact said of the person, or a fact inside another item ("no sugar in the coffee")
// is no kind. Code only: no database, no model.
import { describe, expect, it } from "vitest";
import { kindSaid } from "@ak/agents/honest";

describe("B1e: the kind asked with a fact, in the customer's words", () => {
  it.each([
    ["protein bars with no sugar", "protein bars"],
    ["do you have protein bars with no sugar?", "protein bars"],
    ["sugar-free protein bars", "protein bars"],
    ["I want snacks with no sugar for 5 kids", "snacks"],
    ["بدي سناكس بلا سكر للولاد", "سناكس"],
    ["بدي بروتين بار بلا سكر", "بروتين بار"],
    ["bidde protein bars bala sekkar", "protein bars"],
    ["baddi snacks bala sekkar lal wled", "snacks"],
    ["des barres protéinées sans sucre", "barres protéinées"],
    ["je voudrais des biscuits sans gluten", "biscuits"],
    ["gluten free bread please", "bread"],
  ] as const)("«%s» asks for «%s»", (said, kind) => { expect(kindSaid(said)).toBe(kind); });

  it.each([
    "no sugar", "no sugar please", "No sugar.", "I'm diabetic, no sugar please", "بلا سكر", "بلا سكر لو سمحت", "bala sekkar", "sans sucre svp",
    "no sugar in the coffee", "labneh, no sugar in the coffee", "بلا سكر بالقهوة", "sans sucre dans le café", "bala sekkar bel ahwe",
    "2 khebez", "protein bars", "hi", "",
  ])("«%s» asks for no kind", (said) => { expect(kindSaid(said)).toBeNull(); });
});
