import { describe, expect, it } from "vitest";
import { parseCashMessage, suggestChangeLbp } from "@ak/core/cash-parse";

describe("what a rider types after a delivery", () => {
  const cases: [string, Partial<NonNullable<ReturnType<typeof parseCashMessage>>> | null][] = [
    ["20$", { usd: 20, lbp: 0 }],
    ["20", { usd: 20, lbp: 0 }],
    ["١٥ دولار", { usd: 15, lbp: 0 }],
    ["1,800,000", { usd: 0, lbp: 1_800_000 }],
    ["١٬٨٠٠٬٠٠٠ ليرة", { usd: 0, lbp: 1_800_000 }],
    ["450 الف", { usd: 0, lbp: 450_000 }],
    ["10$ و 900 الف", { usd: 10, lbp: 900_000 }],
    ["2 مليون", { usd: 0, lbp: 2_000_000 }],
    ["20 usd rajja3t 200 alf", { usd: 20, lbp: 0, changeUsd: 0, changeLbp: 200_000 }],
    ["50$ رجعت 30$", { usd: 50, changeUsd: 30 }],
    ["تمام", { exact: true }],
    ["tamem", { exact: true }],
    ["وصلت عالبيت", null],
    ["", null],
  ];
  for (const [text, want] of cases) {
    it(JSON.stringify(text), () => {
      const got = parseCashMessage(text);
      if (want === null) expect(got).toBeNull(); else expect(got).toMatchObject(want);
    });
  }
  it("suggests change in lira rounded to the thousand", () => {
    expect(suggestChangeLbp(17.4, 20, 0, 89500)).toBe(233_000);
    expect(suggestChangeLbp(17.4, 10, 0, 89500)).toBe(0);
  });
});
