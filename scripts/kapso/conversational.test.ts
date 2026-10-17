import { describe, expect, it } from "vitest";
import { automationBody, sameAutomation } from "./conversational";
import c from "../../whatsapp/conversational.json";

describe("kapso conversational components (DECISIONS §39.15.11)", () => {
  it("sends the ice breakers and commands, with the welcome message off", () => {
    const b = automationBody(c);
    expect(b.enable_welcome_message).toBe(false);
    expect(b.prompts).toEqual([
      "Order food",
      "Explore shops near me",
      "My orders",
      "Talk to a person",
    ]);
    expect(b.commands.map((x) => x.command_name)).toEqual(["order", "explore", "orders", "help"]);
  });
  it("reads back what Meta holds, in any order", () => {
    const got = {
      conversational_automation: {
        prompts: [...c.prompts].reverse(),
        commands: [...c.commands].reverse(),
      },
    };
    expect(sameAutomation(c, got)).toBe(true);
    expect(
      sameAutomation(c, { conversational_automation: { prompts: c.prompts, commands: [] } }),
    ).toBe(false);
    expect(sameAutomation(c, {})).toBe(false);
  });
});
