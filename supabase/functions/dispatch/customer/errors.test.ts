// DECISIONS §39.15.1: every error message in the bot carries at least one button; a reply that ends a path without a
// way forward is a bug. Every key turn.ts passes to say() is classified (an error with its buttons, or not an error),
// and no error string is ever built as plain text.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCustomerAction } from "../../_shared/customer-cards";
import { ERROR_WAYS, INFO_KEYS, errorCard, sayMessage } from "./render";

const turnSrc = readFileSync(resolve(__dirname, "turn.ts"), "utf8");
const renderSrc = readFileSync(resolve(__dirname, "render.ts"), "utf8");
const saidKeys = [...turnSrc.matchAll(/\bsay\(\s*c,\s*"(\w+)"/g)].map((m) => m[1]);

describe("every error carries a way forward (§39.15.1)", () => {
  it("turn.ts says only classified keys", () => {
    expect(saidKeys.length).toBeGreaterThan(30);
    const unclassified = [...new Set(saidKeys)].filter((k) => !ERROR_WAYS[k] && !INFO_KEYS.has(k));
    expect(unclassified).toEqual([]);
  });

  it("no key is both an error and not one", () => {
    expect(Object.keys(ERROR_WAYS).filter((k) => INFO_KEYS.has(k))).toEqual([]);
  });

  it("every error string the bot says goes out with buttons, in every language", () => {
    for (const key of Object.keys(ERROR_WAYS))
      for (const lang of ["ar", "en", "fr", "arabizi"] as const) {
        const m: any = sayMessage("+96171000001", lang, key, {});
        expect(m.type, `${key} ${lang}`).toBe("interactive");
        expect(m.interactive.action.buttons.length, key).toBeGreaterThan(0);
        expect(m.interactive.body.text.length, `${key} ${lang} has words`).toBeGreaterThan(5);
      }
  });

  it("every error button is a tap the bot understands", () => {
    for (const key of Object.keys(ERROR_WAYS)) {
      const m: any = errorCard("+96171000001", "en", key);
      for (const b of m.interactive.action.buttons)
        expect(parseCustomerAction(b.reply.id), `${key}: ${b.reply.id}`).not.toBeNull();
    }
  });

  it("no error string is built as plain text anywhere in turn.ts or render.ts", () => {
    const plain = [
      ...`${turnSrc}\n${renderSrc}`.matchAll(/\btext\([^()]*?,\s*tr\([^,()]+,\s*"(\w+)"/g),
    ].map((m) => m[1]);
    expect(plain.filter((k) => ERROR_WAYS[k])).toEqual([]);
  });

  it("the routing error offers Try again, Change address and Help", () => {
    const m: any = errorCard("+96171000001", "en", "noRoute");
    expect(m.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual([
      "🔄 Try again",
      "📍 Change address",
      "🙋 Help",
    ]);
  });
});
