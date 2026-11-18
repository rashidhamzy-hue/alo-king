// B1e: the model never says whether we deliver to a place (evals/cases/b1e_area_claims.json; sim-021 of QA1's sim-test), and writes
// in the conversation's language. The guard alone, and the gateway's second lock with the same tool results.
import { describe, expect, it } from "vitest";
import { checkModelText } from "../src/output-guard";
import { preflight } from "@ak/wa/gateway";
import cases from "../../../evals/cases/b1e_area_claims.json";

type Case = { id: string; speech: string; areas: { names: string[]; served: boolean }[]; text: string; products?: { id: string; names: string[] }[] };
const opts = (c: Case) => ({ areas: c.areas, replyLanguage: c.speech as "ar" | "arabizi" | "en" | "fr", products: c.products ?? [] });

describe("B1e: an area claim needs a tool's answer this turn; the model's words are in the conversation's language", () => {
  it.each((cases.refused as (Case & { code: string })[]).map((c) => [c.id, c] as const))("refused: %s", (_id, c) => {
    expect(checkModelText(c.text, opts(c))?.code).toBe(c.code);
  });
  it.each((cases.allowed as Case[]).map((c) => [c.id, c] as const))("allowed: %s", (_id, c) => {
    expect(checkModelText(c.text, opts(c))).toBeNull();
  });
  it("without the options (the wording evals), nothing new is checked", () => {
    expect(checkModelText("Tamam, shu baddak kamen?")).toBeNull();
  });
});

describe("B1e: the gateway checks the same again (A2's second lock)", () => {
  const send = (text: string, authored: Record<string, unknown>) => preflight({ line: "customer", to: "x", category: "service", dedupeKey: "k-b1e",
    msg: { type: "text", text: { body: text } }, authored: { by: "model", ...authored } } as never);
  it("refuses sim-021's English area claim with no tool answer", () => {
    expect(send("Not yet: we don't deliver to Botmeh, and we're closed now until 08:00.", { areas: [], replyLanguage: "arabizi" })).toBe("model_text_area_claim");
  });
  it("lets through what the tool said", () => {
    expect(send("Ma fi tawseel la Kfarnabrakh lal2an.", { areas: [{ names: ["Kfarnabrakh"], served: false }], replyLanguage: "arabizi" })).toBeNull();
  });
});
