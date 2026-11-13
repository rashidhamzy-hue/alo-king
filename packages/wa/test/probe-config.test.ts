// The probe is staging-only, locked twice (4.10): the database setting, and PROBE_MODE in the Worker's vars. This keeps the second lock honest.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raw = readFileSync(fileURLToPath(new URL("../../../wrangler.jsonc", import.meta.url)), "utf8");
const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as { vars?: Record<string, string>; env: Record<string, { vars: Record<string, string> }> };

describe("probe mode", () => {
  it("is on in staging", () => expect(cfg.env.staging!.vars.PROBE_MODE).toBe("on"));
  it("is never set for production or the default environment", () => {
    expect(cfg.env.production!.vars.PROBE_MODE).toBeUndefined();
    expect(cfg.vars?.PROBE_MODE).toBeUndefined();
  });
});
