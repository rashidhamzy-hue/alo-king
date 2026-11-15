// Session B1b (SIM1 fix 7): the message rules hold in the model's own words. Every model draft in evals/cases/sim_message_rules.json
// that broke a rule (a line over 120 characters, Arabic-Indic digits copied from the customer or a product name, an emoji outside the
// allowed set) either goes out shaped so it keeps the rules, or is refused so the model rewords it. Never sent as it was.
import { describe, expect, it } from "vitest";
import cases from "../../../evals/cases/sim_message_rules.json";
import { checkModelText, MAX_LINE_CHARS, shapeModelText } from "@ak/agents/output-guard";
import { productName } from "@ak/agents/messages";

const ALLOWED = new Set(["📍", "🛒", "🛵", "✅", "💵", "🌙", "⚠️", "📦", "🏠", "🔢"]);
const EMOJI = /\p{Extended_Pictographic}️?/gu;
/** The rules the simulator checks on a message (evals/sim/checks.ts ruleProblems), for the parts the model writes. */
function broken(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((l, i) => { if (l.length > MAX_LINE_CHARS) out.push(`line ${i + 1} has ${l.length} characters`); });
  if (/[٠-٩۰-۹]/u.test(text)) out.push("Arabic-Indic digits");
  for (const e of (text.match(EMOJI) ?? []).map((x) => (x.replace("️", "") === "⚠" ? "⚠️" : x))) if (!ALLOWED.has(e)) out.push(`emoji ${e}`);
  return out;
}

// The model's drafts that broke a rule in SIM1: the shop's message on the turn the rule was found, the model's part only (before a
// price line code appended, which starts with a product name and ends with an amount).
const drafts = cases.cases.flatMap((c: any) => c.found.map((f: any) => {
  const sent: string[] = c.shop[f.turn - 1] ?? [];
  const head = String(f.detail).split(" | ")[1]?.slice(0, 30) ?? "";
  const msg = sent.find((m) => m.includes(head.trim().slice(0, 20))) ?? sent[0] ?? "";
  return [`${c.id} turn ${f.turn}: ${String(f.detail).split(" | ")[0]}`, msg.split("\n").filter((l) => !/\$\d/.test(l)).join("\n")] as const;
})).filter(([, m]) => broken(m).length > 0 && !/^🛒|^📍|منوصّل على:/u.test(m));

describe("SIM1 fix 7: a model draft that broke a message rule is shaped or refused, never sent as it was", () => {
  it("there are such drafts to test", () => { expect(drafts.length).toBeGreaterThanOrEqual(5); });
  it.each(drafts)("%s", (_id, draft) => {
    const shaped = shapeModelText(draft);
    const v = checkModelText(shaped);
    if (v?.code === "too_long") return;                               // refused: the model rewords it (GUARD_HINT.too_long)
    expect(broken(shaped)).toEqual([]);
  });
});

describe("shapeModelText", () => {
  it("folds Arabic-Indic digits to Latin, the decimal mark too", () => {
    expect(shapeModelText("تمام، ضفت ٣ بيبسي دايت ٢٫٢٥ ل")).toBe("تمام، ضفت 3 بيبسي دايت 2.25 ل");
    expect(shapeModelText("۴ قناني")).toBe("4 قناني");
  });
  it("drops an emoji outside the allowed set, keeps an allowed one", () => {
    expect(shapeModelText("Tamam, merci 👋🙏")).toBe("Tamam, merci");
    expect(shapeModelText("📍 ابعتلي موقعك 👍")).toBe("📍 ابعتلي موقعك");
  });
  it("puts each sentence of a long line on its own line", () => {
    const long = "I'm sorry, I don't have verified halal information for the Tanmia Mortadelle Beef Aux Olives. Please check the label, or ask me for another product.";
    expect(long.length).toBeGreaterThan(MAX_LINE_CHARS);
    const s = shapeModelText(long);
    expect(s.split("\n")).toHaveLength(2);
    expect(broken(s)).toEqual([]);
    expect(checkModelText(s)).toBeNull();
  });
  it("a single sentence over the limit is refused, so the model rewords it", () => {
    const one = "We do not have verified information on whether Maxbell Sardine in Oil 125g contains eggs so please check the label on the pack before you order it";
    expect(checkModelText(shapeModelText(one))?.code).toBe("too_long");
  });
  it("a short line is left alone", () => { expect(shapeModelText("شو بدك تطلب؟")).toBe("شو بدك تطلب؟"); });
});

describe("a product name with Arabic-Indic digits is shown with Latin digits (the card, the price lines)", () => {
  it("productName folds the digits of the approved Arabic name", () => {
    expect(productName({ name: "Pepsi Diet 2.25L", name_ar: "بيبسي دايت ٢٫٢٥ ل" }, "ar")).toBe("بيبسي دايت 2.25 ل");
  });
});
