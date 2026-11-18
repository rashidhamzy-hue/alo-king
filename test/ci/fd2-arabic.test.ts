// FD2: docs/ARABIC_REVIEW.md lists every Arabic line the Food page added, word for word, for a person to read (the same reading as FD1's test:
// pick(L, "English", "Arabic")). No line rates, praises or makes a health claim (invariant 14), and the hub is never «المركز».
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = readFileSync(join(repo, "docs/ARABIC_REVIEW.md"), "utf8");
const from = doc.indexOf("## FD2, the Food page");
const next = doc.indexOf("\n## ", from + 5);
const section = from < 0 ? "" : doc.slice(from, next === -1 ? undefined : next);
const FILE = "apps/console/src/pages/food.ts";

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
function pairsOf(s: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of s.matchAll(/\bpick\((?:L|c\.lang),\s*/g)) {
    const en = lit(s, m.index! + m[0].length); if (!en) continue;
    let k = skip(s, en[1]); if (s[k] !== ",") continue; k = skip(s, k + 1);
    const ar = lit(s, k); if (ar && /[؀-ۿ]/.test(ar[0])) out.push([unesc(en[0]), unesc(ar[0])]);
  }
  return out;
}

describe("docs/ARABIC_REVIEW.md lists every line FD2's Food page added", () => {
  it("has its section", () => { expect(section.length).toBeGreaterThan(100); });
  it("every Arabic line of the page is in the section", () => {
    const lines = pairsOf(readFileSync(join(repo, FILE), "utf8")).map(([, ar]) => ar);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.filter((x) => !section.includes(x.replace(/\|/g, "\\|")) && !section.includes(x))).toEqual([]);
  });
  it("no line praises, rates or makes a health claim, and the hub is never «المركز»", () => {
    const s = readFileSync(join(repo, FILE), "utf8");
    expect(s).not.toContain("المركز");
    for (const [en, ar] of pairsOf(s)) expect(`${en} ${ar}`, en).not.toMatch(/\b(best|tasty|delicious|top rated|healthy)\b|أطيب|لذيذ|الأفضل|صحي/i);
  });
});
