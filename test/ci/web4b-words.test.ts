// Session WEB4b: every word the food pages added to the website is listed in docs/ARABIC_REVIEW.md ("WEB4b"), word for word, in Arabic,
// English and French, for a person to read; none is missing in a language; none rates, praises, speaks of health or says "safe" (invariants
// 14 and 15: a fact is "declared by the place" or "not confirmed yet: ask us"); none names a village, a fee, a time or a place (invariant 13).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { FACT_CODES, W4B } from "../../apps/web/src/lib/i18n-web4b";

const doc = readFileSync(fileURLToPath(new URL("../../docs/ARABIC_REVIEW.md", import.meta.url)), "utf8");
const section = doc.slice(doc.indexOf("## WEB4b, the website's food pages"));
const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every word WEB4b added", () => {
  it("every w4b_ key in Arabic, English and French, word for word, in the dictionary's order", () => {
    expect(doc).toContain("## WEB4b, the website's food pages");
    const listed = [...section.matchAll(/^\| `web\.(w4b_\w+)` \| (.*?) \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]!, fr: m[4]! }));
    expect(listed.map((x) => x.key)).toEqual(Object.keys(W4B.en));
    for (const row of listed) {
      expect(row.ar, row.key).toBe(cell(DICTS.ar[row.key]!)); expect(row.en, row.key).toBe(cell(DICTS.en[row.key]!)); expect(row.fr, row.key).toBe(cell(DICTS.fr[row.key]!));
    }
  });
  it("every language has every key, with the same placeholders; every food fact has its word", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(W4B.en)) for (const l of ["ar", "fr"] as const) {
      expect(W4B[l][k], `${l} ${k}`).toBeTruthy();
      expect(holes(W4B[l][k]!), `${l} ${k}`).toEqual(holes(W4B.en[k]!));
    }
    expect(Object.keys(W4B.ar).sort()).toEqual(Object.keys(W4B.en).sort());
    expect(Object.keys(W4B.fr).sort()).toEqual(Object.keys(W4B.en).sort());
    for (const c of FACT_CODES) expect(W4B.en[`w4b_fact_${c}`], c).toBeTruthy();
  });
  it("no rating, praise, health, 'safe' or 'popular' word, and no village, fee, time or place written in", () => {
    for (const l of ["ar", "en", "fr"] as const) for (const [k, v] of Object.entries(W4B[l])) {
      expect(v, `${l} ${k}`).not.toMatch(/\bsafe\b|\bbest\b|healthy|delicious|tasty|top rated|popular|recommended|meilleur|\bsain\b|sans danger|délicieux|populaire|آمن|الأفضل|صحي|لذيذ|مميز|الأشهر|شعبي/i);
      expect(v, `${l} ${k}`).not.toMatch(/\$\s?\d|\d+\s?(min|minutes|دقيقة)\b|\d\d:\d\d|Baakline|Boqaata|Baqaata|بعقلين|بقعاتا|test kitchen/i);
    }
  });
});
