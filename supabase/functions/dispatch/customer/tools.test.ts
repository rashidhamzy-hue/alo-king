// Every tool schema sent to Anthropic is checked against the rules the API enforces (session T, DECISIONS §34).
// A schema the API rejects makes every model turn fail ("Enum value 'restaurant' does not match declared type
// ['string','null']"), so the rules live here and run on every PR, with no network and no API credit.

import { describe, expect, it } from "vitest";
import { TOOL_CONTRACT, TOOLS } from "./tools.ts";

type Schema = Record<string, any>;

// Keywords strict tool schemas do not take (Anthropic structured-outputs limits): value limits, string
// limits, array sizes, patterns and formats. The server enforces limits itself (turn.ts validate()).
const UNSUPPORTED = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "default",
  "const",
] as const;

const JSON_TYPES = ["string", "number", "integer", "boolean", "array", "object", "null"];
const valueMatches = (v: unknown, t: string) =>
  t === "string"
    ? typeof v === "string"
    : t === "number"
      ? typeof v === "number"
      : t === "integer"
        ? Number.isInteger(v)
        : t === "boolean"
          ? typeof v === "boolean"
          : t === "null"
            ? v === null
            : false;

/** Returns every rule a schema breaks, each as "path: problem". An empty list means the API accepts it. */
export function schemaProblems(s: Schema, path = "$"): string[] {
  const out: string[] = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return [`${path}: not an object`];
  for (const k of UNSUPPORTED)
    if (k in s) out.push(`${path}: "${k}" is not allowed in a strict schema`);
  if (Array.isArray(s.type)) out.push(`${path}: type is a list; use anyOf [T, {type: "null"}]`);
  if ("anyOf" in s) {
    if (!Array.isArray(s.anyOf) || s.anyOf.length < 2)
      out.push(`${path}: anyOf needs two or more schemas`);
    else
      s.anyOf.forEach((x: Schema, i: number) =>
        out.push(...schemaProblems(x, `${path}.anyOf[${i}]`)),
      );
    if ("type" in s || "enum" in s || "properties" in s || "items" in s)
      out.push(`${path}: anyOf must stand alone (only description beside it)`);
    return out;
  }
  if (typeof s.type !== "string" || !JSON_TYPES.includes(s.type)) {
    out.push(`${path}: needs one type`);
    return out;
  }
  if ("enum" in s) {
    if (!Array.isArray(s.enum) || !s.enum.length) out.push(`${path}: empty enum`);
    else {
      for (const v of s.enum)
        if (!valueMatches(v, s.type))
          out.push(`${path}: enum value ${JSON.stringify(v)} does not match type ${s.type}`);
      if (new Set(s.enum).size !== s.enum.length) out.push(`${path}: duplicate enum values`);
    }
  }
  if (s.type === "object") {
    const props = s.properties ?? {};
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const required: string[] = s.required ?? [];
    for (const k of Object.keys(props))
      if (!required.includes(k)) out.push(`${path}: property "${k}" must be listed in required`);
    for (const k of required)
      if (!(k in props)) out.push(`${path}: required "${k}" is not a property`);
    for (const [k, v] of Object.entries(props))
      out.push(...schemaProblems(v as Schema, `${path}.${k}`));
  }
  if (s.type === "array") {
    if (!s.items) out.push(`${path}: array needs items`);
    else out.push(...schemaProblems(s.items, `${path}[]`));
  }
  return out;
}

describe("tool schemas", () => {
  it("every tool has a valid name, a description, an object input schema and strict mode", () => {
    for (const t of TOOLS as Schema[]) {
      expect(t.name, t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(String(t.description).length, `${t.name} description`).toBeGreaterThan(10);
      expect(t.input_schema?.type, `${t.name} input_schema`).toBe("object");
      expect(t.strict, `${t.name} strict`).toBe(true);
    }
    expect(new Set((TOOLS as Schema[]).map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("every tool schema obeys the rules the API enforces", () => {
    for (const t of TOOLS as Schema[]) expect(schemaProblems(t.input_schema), t.name).toEqual([]);
  });

  it("every tool has a contract and every contract has a tool", () => {
    expect((TOOLS as Schema[]).map((t) => t.name).sort()).toEqual(
      Object.keys(TOOL_CONTRACT).sort(),
    );
  });

  it("a nullable enum lists its values under anyOf, never beside a type list", () => {
    const search = (TOOLS as Schema[]).find((t) => t.name === "search_vendors")!;
    const bt = search.input_schema.properties.business_type;
    expect(bt.anyOf).toEqual([
      expect.objectContaining({ type: "string", enum: expect.arrayContaining(["restaurant"]) }),
      { type: "null" },
    ]);
    const checkout = (TOOLS as Schema[]).find((t) => t.name === "checkout")!;
    expect(checkout.input_schema.properties.fulfilment.anyOf[0].enum).toEqual([
      "delivery",
      "pickup",
    ]);
  });

  describe("the checker itself", () => {
    it("rejects the shape that broke production", () => {
      const bad = {
        type: "object",
        properties: { business_type: { type: ["string", "null"], enum: ["restaurant", null] } },
        required: ["business_type"],
        additionalProperties: false,
      };
      expect(schemaProblems(bad).join("\n")).toMatch(/type is a list/);
    });
    it("rejects an enum value of the wrong type", () => {
      const bad = {
        type: "object",
        properties: { x: { type: "string", enum: ["a", null] } },
        required: ["x"],
        additionalProperties: false,
      };
      expect(schemaProblems(bad).join("\n")).toMatch(/does not match type string/);
    });
    it("rejects value limits, optional properties and open objects", () => {
      const bad = {
        type: "object",
        properties: { n: { type: "integer", minimum: 1 }, m: { type: "string" } },
        required: ["n"],
      };
      const p = schemaProblems(bad).join("\n");
      expect(p).toMatch(/"minimum" is not allowed/);
      expect(p).toMatch(/must be listed in required/);
      expect(p).toMatch(/additionalProperties must be false/);
    });
    it("accepts a nullable enum written with anyOf", () => {
      const good = {
        type: "object",
        properties: { x: { anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] } },
        required: ["x"],
        additionalProperties: false,
      };
      expect(schemaProblems(good)).toEqual([]);
    });
  });
});
