// 1.5: no free-text model reply may state a price, fee or total. The cases are in evals/cases/money_guard.json.
import { describe, expect, it } from "vitest";
import { moneyInText } from "@ak/agents/output-guard";
import cases from "../cases/money_guard.json";

describe("money guard (evals/cases/money_guard.json)", () => {
  it.each(cases.cases.map((c) => [c.text, c.blocked] as const))("%s -> blocked: %s", (text, blocked) => {
    expect(moneyInText(text) !== null).toBe(blocked);
  });
});
