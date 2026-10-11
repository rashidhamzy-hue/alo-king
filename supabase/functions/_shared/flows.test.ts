import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flowMessage, parseFlowReply, publishedFlowName } from "./flows";
import { checkInteractive } from "./meta-limits";

// DECISIONS §12 and §32.5: every Flow in whatsapp/flows/ passes Flowso's validator and its scenario suite
// (local journeys: completion payloads, required fields, Back). A Meta preview stays a release step.
const FLOWS = readdirSync("whatsapp/flows").filter((f) => f.endsWith(".json"));
const flowso = (args: string[]) => {
  try {
    return { ok: true, out: execFileSync("pnpm", ["exec", "flowso", ...args, "--json"], { encoding: "utf8" }) };
  } catch (e: any) {
    return { ok: false, out: String(e.stdout ?? e.message) };
  }
};

describe("Flow JSON with Flowso", () => {
  it("has the four §12 Flows in Arabic and English", () => {
    expect(FLOWS.sort()).toEqual(
      ["address_capture", "item_options", "merchant_claim", "merchant_hours"].flatMap((f) => [`${f}.ar.json`, `${f}.en.json`]),
    );
  });
  for (const f of FLOWS) {
    it(`${f} validates`, () => {
      const r = flowso(["validate", `whatsapp/flows/${f}`]);
      expect(r.ok, r.out.slice(0, 500)).toBe(true);
    }, 30_000);
    it(`${f} passes its scenarios`, () => {
      const r = flowso(["test", `whatsapp/flows/${f}`, "--scenario", `whatsapp/flows/scenarios/${f.split(".")[0]}.json`]);
      expect(r.ok, r.out.slice(0, 800)).toBe(true);
    }, 30_000);
  }
});

describe("Flow messages", () => {
  const TOKEN = `item_options:${"a".repeat(32)}`;
  it("open the published Flow by name with the server's data", () => {
    const m: any = flowMessage("+96170000001", { flow: "item_options", lang: "ar", token: TOKEN, screen: "OPTIONS", data: { item_id: "x" } });
    expect(checkInteractive(m)).toEqual([]);
    expect(m.interactive.action.parameters).toMatchObject({
      flow_name: publishedFlowName("item_options", "ar"),
      flow_token: TOKEN,
      flow_action: "navigate",
      flow_action_payload: { screen: "OPTIONS", data: { item_id: "x" } },
    });
    for (const flow of ["address_capture", "item_options", "merchant_claim", "merchant_hours"] as const)
      for (const lang of ["ar", "en"] as const)
        expect(checkInteractive(flowMessage("+1", { flow, lang, token: TOKEN, screen: "S", data: {} }))).toEqual([]);
  });
  it("read a submission's token and payload; reject anything else", () => {
    const reply = {
      type: "interactive",
      interactive: { type: "nfm_reply", nfm_reply: { response_json: JSON.stringify({ flow_token: TOKEN, g1: "o2", quantity: "2" }) } },
    };
    expect(parseFlowReply(reply)).toEqual({ token: TOKEN, payload: { g1: "o2", quantity: "2" } });
    expect(parseFlowReply({ ...reply, interactive: { type: "nfm_reply", nfm_reply: { response_json: "{bad" } } })).toBeNull();
    expect(parseFlowReply({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { response_json: '{"flow_token":"x"}' } } })).toBeNull();
    expect(parseFlowReply({ type: "text" })).toBeNull();
  });
});
