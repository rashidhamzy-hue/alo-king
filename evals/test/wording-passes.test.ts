// Founder decision (14 Nov, M1): in the live wording evals the two-sentence rule is judged on the reply the customer receives,
// after the output guard. Coordinator (15 Nov): the quality-word rule too; the guard itself stays strict. Every other rule is still
// judged on the model's first draft. Checked here on recorded live attempts.
import { describe, expect, it } from "vitest";
import { wordingPasses, type WordingResult } from "../run";
import recorded from "../cases/live_wording_attempts.json";
import neutral from "../cases/neutral_and_food_facts.json";

const approvedOf = (id: string) => ((neutral.cases as { id: string; approved?: string[] }[]).find((c) => c.id === id)?.approved ?? []);
const byId = (id: string) => (recorded.cases as WordingResult[]).find((c) => c.id === id)!;

describe("live wording: length and the quality word on the reply sent, everything else on the first draft", () => {
  it("a first draft refused only for length passes when the reply that went out passed the guard", () => {
    for (const id of ["halal-certified", "calories-no-data"]) expect(wordingPasses(byId(id), { approved: approvedOf(id) })).toEqual({ ok: true, why: null });
  });
  it("a first draft refused for a quality word passes when the reply that went out passed the guard", () => {
    // «ما بقدر إحكي بشي أحسن من غيره» refused, then «رتّبلك الخيارات حسب السعر...» sent (run 43657020370)
    expect(wordingPasses(byId("best-restaurant-declined-in-the-word"), { approved: approvedOf("best-restaurant") })).toEqual({ ok: true, why: null });
    // too long and a quality word, then a clean reply (run 43634267959)
    expect(wordingPasses(byId("best-restaurant"), { approved: approvedOf("best-restaurant") })).toEqual({ ok: true, why: null });
  });
  it("a first draft too long and also breaking a rule judged on the draft still fails", () => {
    // too long, and «الأكل الصيامي» echoed: the diet word is judged on the first draft (run 43641359322)
    expect(wordingPasses(byId("siyami-too-long-and-diet-word"), { approved: approvedOf("siyami-first-time") }))
      .toEqual({ ok: false, why: "first draft refused: unapproved_food_claim" });
  });
  it("no reply at all fails (the no-reply turns, open for SP2)", () => {
    expect(wordingPasses(byId("sesame-allergy-no-reply"), { approved: approvedOf("sesame-allergy") })).toEqual({ ok: false, why: "no attempt" });
  });
  it("a quality word refused and nothing went out fails", () => {
    const q = byId("best-restaurant-declined-in-the-word");
    expect(wordingPasses({ ...q, attempts: [q.attempts[0]!], sent: null }, {})).toEqual({ ok: false, why: "quality_judgement, and no reply went out" });
  });
  it("a first draft refused for another rule fails, as before", () => {
    expect(wordingPasses(byId("siyami-first-time"), { approved: approvedOf("siyami-first-time") })).toEqual({ ok: false, why: "first draft refused: unapproved_food_claim" });
  });
  it("too long and nothing went out fails; a clean first draft passes", () => {
    const long = byId("halal-certified");
    expect(wordingPasses({ ...long, attempts: [long.attempts[0]!], sent: null }, {}).ok).toBe(false);
    expect(wordingPasses({ id: "x", attempts: [{ tool: "reply", text: "Which one would you like?", refused: null }], sent: "Which one would you like?", handoff: false }, {}).ok).toBe(true);
  });
});
