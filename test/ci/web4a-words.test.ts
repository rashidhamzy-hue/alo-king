// Session WEB4a: every word the reference's frame and home page added to the website is listed in docs/ARABIC_REVIEW.md ("WEB4a"), word for
// word, in Arabic, English and French, for a person to read; none is missing in a language; none rates, praises, speaks of health or says
// "popular" (invariants 14 and 15: "most ordered" is a count, said as one); none names a village, a fee or a time (invariant 13).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { W4 } from "../../apps/web/src/lib/i18n-web4a";

const doc = readFileSync(fileURLToPath(new URL("../../docs/ARABIC_REVIEW.md", import.meta.url)), "utf8");
const section = doc.slice(doc.indexOf("## WEB4a, the website's frame"));
const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every word WEB4a added", () => {
  it("every w4_ key in Arabic, English and French, word for word, in the dictionary's order", () => {
    expect(doc).toContain("## WEB4a, the website's frame");
    const listed = [...section.matchAll(/^\| `web\.(w4_\w+)` \| (.*?) \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]!, fr: m[4]! }));
    expect(listed.map((x) => x.key)).toEqual(Object.keys(W4.en));
    for (const row of listed) {
      expect(row.ar, row.key).toBe(cell(DICTS.ar[row.key]!)); expect(row.en, row.key).toBe(cell(DICTS.en[row.key]!)); expect(row.fr, row.key).toBe(cell(DICTS.fr[row.key]!));
    }
  });
  it("every language has every key, with the same placeholders", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(W4.en)) for (const l of ["ar", "fr"] as const) {
      expect(W4[l][k], `${l} ${k}`).toBeTruthy();
      expect(holes(W4[l][k]!), `${l} ${k}`).toEqual(holes(W4.en[k]!));
    }
    expect(Object.keys(W4.ar).sort()).toEqual(Object.keys(W4.en).sort());
    expect(Object.keys(W4.fr).sort()).toEqual(Object.keys(W4.en).sort());
  });
  it("no rating, praise, health or 'popular' word, and no village, fee, time or hub place written in", () => {
    for (const l of ["ar", "en", "fr"] as const) for (const [k, v] of Object.entries(W4[l])) {
      expect(v, `${l} ${k}`).not.toMatch(/\bbest\b|healthy|top rated|popular|meilleur|\bsain\b|populaire|الأفضل|صحي|مميز|الأشهر|شعبي/i);
      expect(v, `${l} ${k}`).not.toMatch(/\$\s?\d|\d+\s?(min|minutes|دقيقة)\b|Baakline|Boqaata|Baqaata|بعقلين|بقعاتا/i);
    }
  });
});
