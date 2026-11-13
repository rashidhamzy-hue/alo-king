// The console writes only through SQL functions, takes "who is acting" only from the session, and sends only through the gateway.
// A careless edit that breaks any of these fails here by name.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
// src and src/pages: the console's two source folders.
const names = [...readdirSync(src).filter((f) => f.endsWith(".ts")), ...readdirSync(src + "pages/").filter((f) => f.endsWith(".ts")).map((f) => "pages/" + f)];
const all = names.map((f) => ({ f, text: readFileSync(src + f, "utf8") }));

describe("the console's limits", () => {
  it("has no insert, update, upsert or delete anywhere, and reads tables only inside db.ts", () => {
    for (const { f, text } of all) {
      expect(text, f).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
      if (f !== "db.ts") expect(text, f).not.toMatch(/(?<!Array)\.from\s*\(/);
    }
  });

  it("passes the signed-in staff member as the acting party, never a value from the browser", () => {
    let seen = 0;
    for (const { f, text } of all) {
      for (const m of text.matchAll(/\bp_(by|force_by|counted_by|set_by)\s*:\s*([^,}\n]+)/g)) {
        seen++;
        expect(m[2]!.trim(), `${f}: ${m[0]}`).toBe("c.staff.partyId");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("never calls Kapso itself: messages go through the gateway's send()", () => {
    for (const { f, text } of all) {
      expect(text, f).not.toMatch(/kapsoSend|api\.kapso|graph\.facebook/);
    }
    expect(all.find((x) => x.f === "worker.ts")!.text).toMatch(/import \{ send \} from "@ak\/wa\/gateway"/);
  });
});
