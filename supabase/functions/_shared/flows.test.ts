import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { appFlowFile } from "../../../scripts/flows/app-flow";
import { startDevEndpoint } from "../../../scripts/flows/dev-endpoint";
import { describe, expect, it } from "vitest";
import { flowMessage, parseFlowReply, publishedFlowName } from "./flows";
import { checkInteractive } from "./meta-limits";

// DECISIONS §12 and §32.5: every Flow in whatsapp/flows/ passes Flowso's validator and its scenario suite
// (local journeys: completion payloads, required fields, Back). A Meta preview stays a release step.
const FLOWS = readdirSync("whatsapp/flows").filter((f) => f.endsWith(".json"));
const flowso = (args: string[]) => {
  try {
    return {
      ok: true,
      out: execFileSync("pnpm", ["exec", "flowso", ...args, "--json"], { encoding: "utf8" }),
    };
  } catch (e: any) {
    return { ok: false, out: String(e.stdout ?? e.message) };
  }
};

describe("Flow JSON with Flowso", () => {
  it("has the §12 Flows and the 5b ones (checkout, menu section) in Arabic and English", () => {
    expect(FLOWS.sort()).toEqual(
      [
        "address_capture",
        "app",
        "checkout",
        "item_options",
        "menu_section",
        "merchant_claim",
        "merchant_hours",
      ].flatMap((f) => [`${f}.ar.json`, `${f}.en.json`]),
    );
  });
  for (const f of FLOWS.filter((x) => !x.startsWith("app."))) {
    it(`${f} validates`, () => {
      const r = flowso(["validate", `whatsapp/flows/${f}`]);
      expect(r.ok, r.out.slice(0, 500)).toBe(true);
    }, 30_000);
    it(`${f} passes its scenarios`, () => {
      const r = flowso([
        "test",
        `whatsapp/flows/${f}`,
        "--scenario",
        `whatsapp/flows/scenarios/${f.split(".")[0]}.json`,
      ]);
      expect(r.ok, r.out.slice(0, 800)).toBe(true);
    }, 30_000);
  }
});

// DECISIONS §39.15.13: the Alo King app is a dynamic Flow; its scenarios drive the real endpoint logic
// (_shared/flow-app.ts) over fixtures through a local endpoint, in each language.
describe("the Alo King Flow app with Flowso", () => {
  const run = promisify(execFile);
  for (const lang of ["ar", "en"] as const) {
    it(`app.${lang}.json is what scripts/flows/app-flow.ts writes`, () => {
      expect(readFileSync(`whatsapp/flows/app.${lang}.json`, "utf8")).toBe(appFlowFile(lang));
    });
    it(`app.${lang}.json validates and passes its scenarios against the endpoint`, async () => {
      const { server, url } = await startDevEndpoint(0, lang);
      try {
        await run("pnpm", [
          "exec",
          "flowso",
          "validate",
          `whatsapp/flows/app.${lang}.json`,
          "--json",
        ]);
        const r = await run("pnpm", [
          "exec",
          "flowso",
          "test",
          `whatsapp/flows/app.${lang}.json`,
          "--scenario",
          `whatsapp/flows/scenarios/app.${lang}.json`,
          "--endpoint",
          url,
          "--plaintext",
          "--json",
        ]).catch((e: any) => ({ stdout: String(e.stdout ?? e.message) }));
        const out = JSON.parse(r.stdout);
        expect(
          out.ok,
          JSON.stringify(out.tests?.map((t: any) => t.failure ?? t.error ?? "ok")).slice(0, 800),
        ).toBe(true);
        expect(out.tests.length).toBeGreaterThanOrEqual(4);
      } finally {
        server.close();
      }
    }, 60_000);
  }
});

describe("Flow messages", () => {
  const TOKEN = `item_options:${"a".repeat(32)}`;
  it("open the published Flow by name with the server's data", () => {
    const m: any = flowMessage("+96170000001", {
      flow: "item_options",
      lang: "ar",
      token: TOKEN,
      screen: "OPTIONS",
      data: { item_id: "x" },
    });
    expect(checkInteractive(m)).toEqual([]);
    expect(m.interactive.action.parameters).toMatchObject({
      flow_name: publishedFlowName("item_options", "ar"),
      flow_token: TOKEN,
      flow_action: "navigate",
      flow_action_payload: { screen: "OPTIONS", data: { item_id: "x" } },
    });
    for (const flow of [
      "address_capture",
      "item_options",
      "merchant_claim",
      "merchant_hours",
      "checkout",
      "menu_section",
    ] as const)
      for (const lang of ["ar", "en"] as const)
        expect(
          checkInteractive(flowMessage("+1", { flow, lang, token: TOKEN, screen: "S", data: {} })),
        ).toEqual([]);
  });
  it("read a submission's token and payload; reject anything else", () => {
    const reply = {
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: {
          response_json: JSON.stringify({ flow_token: TOKEN, g1: "o2", quantity: "2" }),
        },
      },
    };
    expect(parseFlowReply(reply)).toEqual({ token: TOKEN, payload: { g1: "o2", quantity: "2" } });
    expect(
      parseFlowReply({
        ...reply,
        interactive: { type: "nfm_reply", nfm_reply: { response_json: "{bad" } },
      }),
    ).toBeNull();
    expect(
      parseFlowReply({
        type: "interactive",
        interactive: { type: "nfm_reply", nfm_reply: { response_json: '{"flow_token":"x"}' } },
      }),
    ).toBeNull();
    expect(parseFlowReply({ type: "text" })).toBeNull();
  });
});
