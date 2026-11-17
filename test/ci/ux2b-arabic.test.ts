// UX2b: docs/ARABIC_REVIEW.md lists every Arabic line the five rebuilt pages added (or one already read), word for word, for a person to read; and the hub
// is «المستودع», never «المركز». The pairs are read from the page files the way a reader would: pick(L, "English", "Arabic") and { en: "...", ar: "..." }.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = readFileSync(join(repo, "docs/ARABIC_REVIEW.md"), "utf8");
const FILES = ["approve", "intakeframe", "intake", "readiness", "moneyframe", "payments", "money", "refunds", "riders", "settings", "settingmeta"].map((f) => `apps/console/src/pages/${f}.ts`);

/** A string literal starting at i (double quote, single quote or backtick, with ${…} nested), or null. */
function lit(s: string, i: number): [string, number] | null {
  const q = s[i]; if (q !== '"' && q !== "'" && q !== "`") return null;
  let j = i + 1; let out = "";
  while (j < s.length) {
    const ch = s[j]!;
    if (ch === "\\") { out += s.slice(j, j + 2); j += 2; continue; }
    if (q === "`" && ch === "$" && s[j + 1] === "{") { let d = 1; out += "${"; j += 2; while (j < s.length && d > 0) { if (s[j] === "{") d++; else if (s[j] === "}") d--; out += s[j]; j++; } continue; }
    if (ch === q) return [out, j + 1];
    out += ch; j++;
  }
  return null;
}
const skip = (s: string, i: number) => { while (/\s/.test(s[i] ?? "")) i++; return i; };
const unesc = (x: string) => x.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, " ").replace(/\\\\/g, "\\");

function arabicOf(file: string): string[] {
  const s = readFileSync(join(repo, file), "utf8"); const out: string[] = [];
  for (const m of s.matchAll(/\bpick\((?:L|c\.lang),\s*/g)) {
    const en = lit(s, m.index! + m[0].length); if (!en) continue;
    let k = skip(s, en[1]); if (s[k] !== ",") continue; k = skip(s, k + 1);
    const ar = lit(s, k); if (ar) out.push(unesc(ar[0]));
  }
  for (const m of s.matchAll(/\ben:\s*/g)) {
    const en = lit(s, m.index! + m[0].length); if (!en) continue;
    let k = skip(s, en[1]); if (s[k] !== ",") continue; k = skip(s, k + 1);
    if (!s.startsWith("ar:", k)) continue; k = skip(s, k + 3);
    const ar = lit(s, k); if (ar) out.push(unesc(ar[0]));
  }
  return out.filter((x) => /[؀-ۿ]/.test(x));
}

describe("docs/ARABIC_REVIEW.md lists every line UX2b added", () => {
  for (const f of FILES) {
    it(`${f}: every Arabic pair is in the table`, () => {
      const lines = arabicOf(f);
      expect(lines.length, "the parser found Arabic pairs").toBeGreaterThan(0);
      const missing = lines.filter((x) => !doc.includes(x));
      expect(missing, `${missing.length} Arabic lines of ${f} are not in docs/ARABIC_REVIEW.md`).toEqual([]);
    });
  }
  it("the hub is «المستودع»: no page says «المركز» for it", () => {
    for (const f of FILES) expect(readFileSync(join(repo, f), "utf8"), f).not.toContain("المركز");
  });
});
