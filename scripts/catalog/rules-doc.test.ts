// DECISIONS §39.15.4: the rules live in one file (supabase/functions/_shared/catalog-rules.json). The validator reads it,
// the doc is generated from it, and every catalog_rules upsert in the migrations, in filename order, adds up to it: the
// four can never drift apart, and a later session adds a rule with a new migration, never by editing an applied one.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG_RULES } from "../../supabase/functions/_shared/catalog-rules.ts";
import {
  DOC_FILE,
  parseSeed,
  readMigrations,
  readRules,
  renderDoc,
  rowOf,
  seededRules,
  seedSql,
  type RuleRow,
} from "./rules-doc.ts";

const rules = readRules();

describe("the catalogue rules: one JSON, the validator, the migrations and the doc agree", () => {
  it("the validator's rules are the JSON's, in all four languages", () => {
    expect(CATALOG_RULES).toEqual(rules);
    expect(rules.length).toBeGreaterThanOrEqual(19);
  });
  it("every catalog_rules upsert in supabase/migrations, read in filename order, adds up to the JSON", () => {
    const seeded = seededRules(readMigrations());
    const key = (r: RuleRow) => [
      r.code,
      r.field,
      r.source,
      r.checked_here,
      r.basis,
      r.rule_en,
      r.rule_ar,
      r.rule_fr,
      r.rule_arabizi,
    ];
    expect(seeded.map(key).sort()).toEqual(rules.map(rowOf).map(key).sort());
  });
  it("the committed doc is exactly what the generator writes from the JSON", () => {
    expect(readFileSync(DOC_FILE, "utf8")).toBe(renderDoc(rules.map(rowOf)));
  });
  it("lists every rule once, with who checks it, and each language; the header says how to add a rule", () => {
    const doc = renderDoc(rules.map(rowOf));
    for (const r of rules) {
      expect(doc.split(`\`${r.code}\``).length - 1, r.code).toBe(4); // the table and the three language lists
      expect(doc).toContain(r.rule.ar);
    }
    expect(doc).toMatch(
      /\| `image_text_overlay` \| No writing, prices or logos on the photo\. \| Meta \|/,
    );
    expect(doc).toMatch(/\| `image_too_small` \| .* \| Alo King, before sync \|/);
    expect(doc).toContain("on conflict (code) do update`; never edit an applied migration");
  });
  it("renders a JSON export of the table, learned rules included", () => {
    const learned: RuleRow = {
      code: "learned_image_has_text_overlay_1a2b3c4d",
      field: "other",
      source: "learned",
      checked_here: false,
      basis: null,
      rule_en: "Images with text | overlay are not allowed.",
      rule_ar: null,
      rule_fr: null,
      rule_arabizi: null,
      meta_error_title: "Image has text overlay",
      meta_error_type: "IMAGE_TEXT_OVERLAY",
      count: 3,
    };
    const doc = renderDoc([...rules.map(rowOf), learned], "rules.json");
    expect(doc).toContain("from rules.json");
    expect(doc).toContain("### Learned from Meta, not yet reviewed");
    expect(doc).toContain(
      "| `learned_image_has_text_overlay_1a2b3c4d` | Images with text \\| overlay are not allowed. | Meta (learned) | Meta error: IMAGE_TEXT_OVERLAY · Image has text overlay (seen 3×) |",
    );
  });
});

describe("reading catalog_rules inserts from SQL", () => {
  it("reads strings with doubled quotes, booleans and nulls, and how a statement ends", () => {
    expect(
      parseSeed(
        "insert into public.catalog_rules (code, checked_here, rule_en, rule_ar) values\n  ('a_b', true, 'It''s fine', null),\n  ('c_d', false, 'x', 'y');",
      ),
    ).toEqual([
      {
        rows: [
          { code: "a_b", checked_here: true, rule_en: "It's fine", rule_ar: null },
          { code: "c_d", checked_here: false, rule_en: "x", rule_ar: "y" },
        ],
        onConflict: "none",
      },
    ]);
    expect(parseSeed("select 1;")).toEqual([]);
    expect(() => parseSeed("insert into public.catalog_rules (a, b) values ('x');")).toThrow(
      /1 values for 2 columns/,
    );
  });
  it("a later migration's upsert rewords a rule and adds one; do nothing never overrides", () => {
    const files = [
      {
        name: "2_later.sql",
        sql: "insert into public.catalog_rules (code, rule_en) values ('a_b', 'Reworded'), ('e_f', 'New')\non conflict (code) do update set rule_en = excluded.rule_en;",
      },
      {
        name: "1_first.sql",
        sql: "insert into public.catalog_rules (code, rule_en) values ('a_b', 'First'), ('c_d', 'Kept');",
      },
      {
        name: "3_noop.sql",
        sql: "insert into public.catalog_rules (code, rule_en) values ('c_d', 'Ignored') on conflict do nothing;",
      },
    ];
    expect(seededRules(files)).toEqual([
      { code: "a_b", rule_en: "Reworded" },
      { code: "c_d", rule_en: "Kept" },
      { code: "e_f", rule_en: "New" },
    ]);
  });
  it("the --seed statement round-trips to the JSON (what a later session's migration carries)", () => {
    const st = parseSeed(seedSql(rules));
    expect(st).toHaveLength(1);
    expect(st[0].onConflict).toBe("update");
    expect(st[0].rows).toEqual(rules.map(rowOf));
  });
});
