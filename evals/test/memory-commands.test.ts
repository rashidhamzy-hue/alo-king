// 1.14: "what do you know about me", "forget", "stop remembering", typed on their own. Cases in evals/cases/memory_commands.json.
import { describe, expect, it } from "vitest";
import { memoryCommand } from "@ak/agents/memory";
import cases from "../cases/memory_commands.json";

describe("memory commands (evals/cases/memory_commands.json)", () => {
  it.each(cases.cases.map((c) => [c.text, c.expect] as const))("%s -> %s", (text, expected) => {
    expect(memoryCommand(text)).toBe(expected);
  });
});
