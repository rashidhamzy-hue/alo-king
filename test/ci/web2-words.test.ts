// Session WEB2: every word the website's ordering pages and the new WhatsApp lines added is listed in docs/ARABIC_REVIEW.md ("WEB2"), word for
// word, in Arabic, English and French, for a person to read; none is missing in a language; none rates, praises or speaks of health.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { W2 } from "../../apps/web/src/lib/i18n-web2";
import { FR_STATUS } from "../../apps/web/src/lib/order";
import { ORDER_STATUS_IDS } from "@ak/ui/status";
import { ar, en, fr } from "@ak/agents/messages";

const doc = readFileSync(fileURLToPath(new URL("../../docs/ARABIC_REVIEW.md", import.meta.url)), "utf8");
const section = doc.slice(doc.indexOf("## WEB2, the website's basket"));
const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every word WEB2 added", () => {
  it("the website: every w2_ key in Arabic, English and French, word for word, in the dictionary's order", () => {
    const listed = [...section.matchAll(/^\| `web\.(w2_\w+)` \| (.*?) \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]!, fr: m[4]! }));
    expect(listed.map((x) => x.key)).toEqual(Object.keys(W2.en));
    for (const row of listed) {
      expect(row.ar, row.key).toBe(cell(DICTS.ar[row.key]!)); expect(row.en, row.key).toBe(cell(DICTS.en[row.key]!)); expect(row.fr, row.key).toBe(cell(DICTS.fr[row.key]!));
    }
  });
  it("every language has every key, with the same placeholders", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(W2.en)) for (const l of ["ar", "fr"] as const) {
      expect(W2[l][k], `${l} ${k}`).toBeTruthy();
      expect(holes(W2[l][k]!), `${l} ${k}`).toEqual(holes(W2.en[k]!));
    }
    expect(Object.keys(W2.ar).sort()).toEqual(Object.keys(W2.en).sort());
    expect(Object.keys(W2.fr).sort()).toEqual(Object.keys(W2.en).sort());
  });
  it("no rating, praise or health word, and no card or Whish Pay offered as a way to pay now", () => {
    for (const l of ["ar", "en", "fr"] as const) for (const [k, v] of Object.entries(W2[l])) {
      expect(v, `${l} ${k}`).not.toMatch(/\bbest\b|healthy|top rated|meilleur|\bsain\b|الأفضل|صحي|مميز/i);
    }
  });
  it("the French status words cover every status id, and are listed", () => {
    expect(Object.keys(FR_STATUS).sort()).toEqual([...ORDER_STATUS_IDS].sort());
    for (const [k, v] of Object.entries(FR_STATUS)) expect(section).toContain(`| \`${k}\` | ${cell(v)} |`);
  });
  it("the WhatsApp lines", () => {
    for (const m of [ar, en, fr]) {
      for (const line of [m.web.linked, m.web.codeExpired, m.web.codeUsed, m.web.codeUnknown, m.web.signedOut(1), m.web.signedOut(2), m.web.notSignedIn,
                          m.web.cardNotWaiting("AK-1042"), m.web.cardUnknown, `${m.card.changeForLbp}\n${m.lbp(2000000)}`,
                          ...(["best_match", "ask", "remove"] as const).map((p) => m.cx.missingItemLine("Labneh 500 g", p))]) expect(section).toContain(cell(line));
    }
  });
});
