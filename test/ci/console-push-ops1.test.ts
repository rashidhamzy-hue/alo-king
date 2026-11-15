// OPS1 item 1: the VAPID key script is wired into the console deploy. Keys are made once, kept across deploys (a new pair would end
// every phone's alerts), never printed, and the contact is the console's own https address (no person's email in a push header).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const wf = readFileSync(root + ".github/workflows/console.yml", "utf8");
const b64u = (s: string) => Buffer.from(s, "base64url");

describe("scripts/vapid-keys.mjs --env", () => {
  const out = execFileSync("node", [root + "apps/console/scripts/vapid-keys.mjs", "--env"], { encoding: "utf8" });
  it("prints exactly the two keys as shell exports, an uncompressed P-256 public point and a 32-byte private scalar", () => {
    const lines = out.trim().split("\n");
    expect(lines.map((l) => l.split("=")[0])).toEqual(["export VAPID_PUBLIC_KEY", "export VAPID_PRIVATE_KEY"]);
    const pub = b64u(lines[0]!.split("=")[1]!), priv = b64u(lines[1]!.split("=")[1]!);
    expect(pub.length).toBe(65); expect(pub[0]).toBe(4); expect(priv.length).toBe(32);
    expect(out).not.toMatch(/mailto:|@/);                                    // no contact address in the key output
  });
  it("makes a new pair every time", () => {
    expect(execFileSync("node", [root + "apps/console/scripts/vapid-keys.mjs", "--env"], { encoding: "utf8" })).not.toBe(out);
  });
});

describe("console.yml: the push secrets", () => {
  const step = wf.slice(wf.indexOf("- name: Worker secrets"), wf.indexOf("- name: Supabase Auth may send"));
  it("makes the key pair only when the Worker has none, so a deploy never replaces keys phones are subscribed with", () => {
    expect(step).toMatch(/grep -qx VAPID_PUBLIC_KEY[^\n]*\|\|[^\n]*grep -qx VAPID_PRIVATE_KEY|! grep -qx VAPID_PUBLIC_KEY[\s\S]{0,200}grep -qx VAPID_PRIVATE_KEY/);
    expect(step).toMatch(/vapid-keys\.mjs --env/);
  });
  it("uses the console's own https address as the contact, only when none is set", () => {
    expect(step).toMatch(/! grep -qx VAPID_SUBJECT/);
    expect(step).toMatch(/VAPID_SUBJECT="?\$\{?CONSOLE_URL/);
  });
  it("never prints a key: no echo of the values, no set -x, and the summary lists names only", () => {
    expect(step).not.toMatch(/set -x|echo [^\n]*\$VAPID_PRIVATE_KEY|echo [^\n]*\$VAPID_PUBLIC_KEY/);
    expect(step).toMatch(/Worker secrets set:/);
  });
  it("hands the deploy's address to the step", () => {
    expect(step).toMatch(/CONSOLE_URL: \$\{\{ steps\.deploy\.outputs\.url \}\}/);
  });
});
