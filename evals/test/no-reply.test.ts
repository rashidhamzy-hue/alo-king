// SP2: a customer turn never ends with nothing sent. Each recorded case of evals/cases/no_reply.json is replayed through the real
// ask loop (packages/agents/src/concierge.ts) with the model's steps as recorded. Written before the fix; every case but
// `never-answers` and `extract-order-then-search-then-reply` failed on the loop before it (the turn was handed to a person with
// nothing sent).
import { describe, expect, it } from "vitest";
import { replayReplyCase, replyPasses, type ScriptedReplyCase } from "../run";
import cases from "../cases/no_reply.json";

const scripted = cases.scripted as ScriptedReplyCase[];
const byId = (id: string) => scripted.find((c) => c.id === id)!;

describe("every turn of the ask loop ends in a reply, a card or one clear question (SP2)", () => {
  it.each(scripted.filter((c) => c.expect !== "handoff").map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await replayReplyCase(c);
    expect(replyPasses(r), JSON.stringify(r.steps)).toEqual({ ok: true, why: null });
    expect(r.sent.map((s) => s.tool)).toEqual([c.expect]);
    expect(r.outcome).toBe("ok");
  });

  it("a call cut at max_tokens: the cut response is dropped, never run, and the step is asked again", async () => {
    const r = await replayReplyCase(byId("capped-mid-tool-call"));
    expect(r.refused).toEqual([]);                                  // the half-written reply ({} input) was never called
    expect(r.bodies).toHaveLength(2);
    // the cut response is not in the conversation the retry sends
    expect(r.bodies[1]!.messages).toEqual(r.bodies[0]!.messages);
    // the retry thinks less
    expect((r.bodies[1] as { output_config?: { effort?: string } }).output_config?.effort).toBe("low");
  });

  it("an ask call has room to think and still call a tool (the cap was 1024)", async () => {
    const r = await replayReplyCase(byId("capped-before-any-tool"));
    for (const b of r.bodies) expect(b.max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it("stopped twice: the next call must be the reply itself", async () => {
    const c = byId("capped-twice");
    const r = await replayReplyCase(c);
    expect(r.bodies[c.forced_reply_by_call! - 1]!.tool_choice).toEqual({ type: "tool", name: "reply" });
    expect(r.bodies[0]!.tool_choice).toBeUndefined();               // never forced on a normal step
  });

  it("extract_order in the ask loop is answered with: do not call it again, answer the customer now", async () => {
    const r = await replayReplyCase(byId("extract-order-then-silence"));
    const toolResult = (r.bodies[1]!.messages.at(-1)!.content as { type: string; content: string }[])[0]!;
    const note = JSON.parse(toolResult.content).note as string;
    expect(note).toMatch(/do not call extract_order again/i);
    expect(note).toMatch(/reply/);
    // the free text written outside a tool was not sent; the model is told so before the next call
    const nudge = r.bodies[2]!.messages.at(-1)!;
    expect(nudge.role).toBe("user");
    expect(JSON.stringify(nudge.content)).toMatch(/Nothing has reached the customer/);
  });

  it("a model that never answers: the last call is forced to reply, then a person takes it (fail closed)", async () => {
    const r = await replayReplyCase(byId("never-answers"));
    expect(r.bodies).toHaveLength(6);
    expect(r.bodies.at(-1)!.tool_choice).toEqual({ type: "tool", name: "reply" });
    expect(r.sent).toEqual([]);
    expect(r.handoff).toBe("agent_did_not_finish");
    expect(r.outcome).toBe("handoff");
  });
});
