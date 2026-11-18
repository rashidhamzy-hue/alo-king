// B1f: the model never promises a delivery time no tool returned this turn, and never a time outside the hours (evals/cases/b1f_time_claims.json).
// The guard alone, and the gateway's second lock with the same tool results.
import { describe, expect, it } from "vitest";
import { checkModelText } from "../src/output-guard";
import { preflight } from "@ak/wa/gateway";
import cases from "../../../evals/cases/b1f_time_claims.json";

type Case = { id: string; quoted: boolean; text: string };
const opts = (c: Case) => ({ times: { quoted: c.quoted, hours: cases.hours } });

describe("B1f: a delivery time needs a tool's answer this turn, and the hours", () => {
  it.each((cases.refused as Case[]).map((c) => [c.id, c] as const))("refused: %s", (_id, c) => {
    expect(checkModelText(c.text, opts(c))?.code).toBe("time_claim");
  });
  it.each((cases.allowed as Case[]).map((c) => [c.id, c] as const))("allowed: %s", (_id, c) => {
    expect(checkModelText(c.text, opts(c))).toBeNull();
  });
  it("without the option (the wording evals), nothing new is checked", () => {
    expect(checkModelText("Your order will arrive in 30 minutes.")).toBeNull();
  });
});

describe("B1f: the gateway checks the same again (A2's second lock)", () => {
  const send = (text: string, authored: Record<string, unknown>) => preflight({ line: "customer", to: "x", category: "service", dedupeKey: "k-b1f",
    msg: { type: "text", text: { body: text } }, authored: { by: "model", ...authored } } as never);
  it("refuses sim-015's time with no tool answer", () => {
    expect(send("Ma 3andi wa2t tawseel bokra.", { times: { quoted: false, hours: cases.hours } })).toBe("model_text_time_claim");
  });
  it("lets through a quoted time inside the hours", () => {
    expect(send("It will arrive in about 30 minutes.", { times: { quoted: true, hours: cases.hours } })).toBeNull();
  });
});
