import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The inputs below are copied from the doc (section 1.2b), so this checks the doc's internal arithmetic, not the inputs themselves: change them in both places.
// Recomputes the pack margin table in docs/merchant-products-spec.md section 1.2 from its stated inputs, so the table cannot drift from the arithmetic.
const DOC = readFileSync(resolve(__dirname, "../../../docs/merchant-products-spec.md"), "utf8");
const SVC = 0.0112, AI_BROWSE = 0.02, AI_ORDER = 0.04, MSGS_BROWSE = 4, MSGS_ORDER = 11, LBP = 89_500;
const perReplier = (convert: number) => (1 - convert) * (MSGS_BROWSE * SVC + AI_BROWSE) + convert * (MSGS_ORDER * SVC + AI_ORDER);
const replyPerMsg = { A: 0, C: 0.10 * perReplier(0.5), D: 0.20 * perReplier(0.5) };
const margin = (n: number, price: number, meta: number, reply: number) => { const rev = n * price, cost = n * meta + n * reply + 0.30 + 0.10 * Math.max(1, n / 100); return { m: rev - cost, pct: (rev - cost) / rev * 100 }; };
const cell = (n: number, price: number, meta: number, col: "A" | "C" | "D") => { const r = margin(n, price, meta, replyPerMsg[col]); return `$${r.m.toFixed(2)} (${Math.round(r.pct)}%)`; };
const row = (name: string) => DOC.split("\n").find((l) => l.startsWith(`| ${name}`)) ?? "";

describe("section 1.2 pack margins", () => {
  it.each([["Starter 100", 100, 0.085, "$8.50", "760,750"], ["Growth 300", 300, 0.08, "$24.00", "2,148,000"], ["Pro 1,000", 1000, 0.075, "$75.00", "6,712,500"]] as const)("%s: price, LBP and every margin cell", (name, n, price, usd, lbp) => {
    const r = row(name);
    expect(r, `row ${name} missing`).not.toBe("");
    expect(r).toContain(`**${usd}**`); expect(r).toContain(lbp);
    expect(n * price * LBP).toBe(Number(lbp.replace(/,/g, "")));
    for (const col of ["A", "C", "D"] as const) expect(r).toContain(`${cell(n, price, 0.0421, col)} / ${cell(n, price, 0.0471, col)}`);
  });
  it("the reply cost per delivered message in 1.2b (10% / 50% and 20% / 50%)", () => {
    expect(replyPerMsg.C.toFixed(4)).toBe("0.0114"); expect(replyPerMsg.D.toFixed(4)).toBe("0.0228");
    expect(DOC).toContain("**$0.0114**"); expect(DOC).toContain("$0.0228");
  });
  it("the minimum viable pack and the floor stay positive in the stress case for packs of 300 or more", () => {
    expect(margin(50, 0.09, 0.0421, replyPerMsg.C).pct).toBeGreaterThan(25);
    for (const meta of [0.0421, 0.0471]) for (const [n, p] of [[300, 0.08], [1000, 0.075]] as const) expect(margin(n, p, meta, replyPerMsg.D).m).toBeGreaterThan(0);
    expect(DOC).toContain("never below $0.07");
  });
});
