// HO1: "I want a person" and "is anyone there?" recognised by code before any model (evals/cases/person_request.json).
import { describe, expect, it } from "vitest";
import { personSignal } from "@ak/agents/person-request";
import cases from "../cases/person_request.json";

describe("person requests and chases (evals/cases/person_request.json)", () => {
  it.each(cases.cases.map((c) => [c.text, c.expect] as const))("%s -> %s", (text, expected) => {
    expect(personSignal(text)).toBe(expected);
  });
});
