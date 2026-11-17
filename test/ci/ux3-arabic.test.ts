// UX3: docs/ARABIC_REVIEW.md lists every word the join pages added, word for word, for a person to read; the hub is «المستودع», never «المركز»; and no word
// rates, praises or promises (invariants 10, 14 and 17). The website's words are held equal to the dictionaries; the console's Applicants tab is read by
// test/ci/ux2b-arabic.test.ts (riders.ts is one of its files).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { joinAr, joinEn, joinFr } from "../../apps/web/src/lib/join-words";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = readFileSync(join(repo, "docs/ARABIC_REVIEW.md"), "utf8");
const section = doc.slice(doc.indexOf("## UX3, the join pages and the Applicants tab"));
const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every word of the join pages", () => {
  it("every key, in Arabic, English and French, word for word, and the three languages have the same keys", () => {
    expect(Object.keys(joinAr)).toEqual(Object.keys(joinEn)); expect(Object.keys(joinFr)).toEqual(Object.keys(joinEn));
    const listed = [...section.matchAll(/^\| `web\.(\w+)` \| (.*?) \| (.*?) \| (.*?) \| /gm)].map((m) => ({ key: m[1]!, ar: m[2]!, en: m[3]!, fr: m[4]! }));
    expect(listed.map((x) => x.key)).toEqual(Object.keys(joinEn));
    for (const row of listed) {
      expect(row.ar, row.key).toBe(cell(DICTS.ar[row.key]!)); expect(row.en, row.key).toBe(cell(DICTS.en[row.key]!)); expect(row.fr, row.key).toBe(cell(DICTS.fr[row.key]!));
    }
  });
  it("the Postgres line a sender consents with is in the table, in the words migration 0233 stores", () => {
    const sql = readFileSync(join(repo, "supabase/migrations/0233_join_applications.sql"), "utf8");
    for (const purpose of ["rider", "vendor"]) {
      const stored = new RegExp(`when '${purpose}'\\s+then '([^']+)'`).exec(sql)![1]!;
      expect(section, purpose).toContain(stored);
    }
  });
});

describe("the words keep the rules", () => {
  const all = (l: Record<string, string>) => Object.values(l).join(" \n ");
  it("the hub is «المستودع»: never «المركز»", () => {
    expect(all(joinAr)).toContain("المستودع"); expect(all(joinAr)).not.toContain("المركز");
    for (const f of ["apps/web/src/pages/join/rider.astro", "apps/web/src/pages/for-vendors.astro", "apps/console/src/pages/riders.ts"]) expect(readFileSync(join(repo, f), "utf8"), f).not.toContain("المركز");
  });
  it("no rating, praise, health, diet or income promise; no commission figure; no number typed in", () => {
    for (const [l, d] of Object.entries({ en: joinEn, ar: joinAr, fr: joinFr })) {
      const t = all(d);
      expect(t, l).not.toMatch(/\b(best|top rated|healthy|guaranteed|earn up to|per month|meilleur|sain|garanti)\b|الأفضل|صحي|مضمون/i);
      expect(t, l).not.toMatch(/\d\s?%[^\n]*commission|commission[^\n]*\d\s?%/i);
    }
    // a rider keeps the whole fee and all tips: the words say 100%
    expect(joinEn.join_fee_t).toContain("100%"); expect(joinEn.join_tips_t).toContain("100%");
  });
  it("a rider's page promises nothing about hours or income, and the vendor page says applying opens nothing", () => {
    expect(joinEn.join_pay_text).toMatch(/no hourly wage/i);
    expect(joinEn.vend_n4).toMatch(/Applying does not open your place/); expect(joinAr.vend_n4).toContain("لا يفتح مكانك"); expect(joinFr.vend_n4).toContain("n'ouvre pas votre lieu");
  });
});
