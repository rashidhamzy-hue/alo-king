// docs/catalog/META-CATALOG-RULES.md from the catalogue rules (DECISIONS §39.15.4). The rules live in one file,
// supabase/functions/_shared/catalog-rules.json: the validator (catalog-rules.ts) reads it through catalog-rules.data.ts,
// a TypeScript copy this script writes (the edge runtime then imports no JSON module), this script renders the doc from
// it, and the seed of public.catalog_rules is written from it (--seed prints the statement for a new migration).
// rules-doc.test.ts keeps the four equal: the validator's rules are the JSON's, every catalog_rules upsert in
// supabase/migrations (read in filename order) adds up to the JSON, and the committed doc is this script's output.
// Usage:
//   node --experimental-strip-types scripts/catalog/rules-doc.ts            writes the doc and the validator's copy
//   node --experimental-strip-types scripts/catalog/rules-doc.ts --check    fails when either committed file differs
//   node --experimental-strip-types scripts/catalog/rules-doc.ts --seed     prints insert … on conflict (code) do update
//   node --experimental-strip-types scripts/catalog/rules-doc.ts rules.json renders a JSON export of the table instead:
//     select json_agg(r order by r.source desc, r.field, r.code) from public.catalog_rules r;
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

export const RULES_FILE = "supabase/functions/_shared/catalog-rules.json";
export const DOC_FILE = "docs/catalog/META-CATALOG-RULES.md";
export const DATA_FILE = "supabase/functions/_shared/catalog-rules.data.ts";
export const MIGRATIONS_DIR = "supabase/migrations";

type Words = { ar: string; en: string; fr: string; arabizi: string };
export type JsonRule = {
  code: string;
  field: string;
  checkedHere: boolean;
  basis: string;
  rule: Words;
  problem: Words;
  fix: Words;
};

/** A row of public.catalog_rules, as the seed writes it or a JSON export of the table gives it. */
export type RuleRow = {
  code: string;
  field: string;
  source: string;
  checked_here: boolean;
  basis: string | null;
  rule_en: string;
  rule_ar: string | null;
  rule_fr: string | null;
  rule_arabizi: string | null;
  meta_error_title?: string | null;
  meta_error_type?: string | null;
  count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

export const readRules = (file = RULES_FILE): JsonRule[] =>
  (JSON.parse(readFileSync(file, "utf8")) as { rules: JsonRule[] }).rules;

/** The table row a published rule is seeded as. */
export const rowOf = (r: JsonRule): RuleRow => ({
  code: r.code,
  field: r.field,
  source: "meta_published",
  checked_here: r.checkedHere,
  basis: r.basis,
  rule_en: r.rule.en,
  rule_ar: r.rule.ar,
  rule_fr: r.rule.fr,
  rule_arabizi: r.rule.arabizi,
});

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The statement a new migration carries to add or reword rules (all of them, so the table equals the JSON). */
export function seedSql(rules: JsonRule[]): string {
  const rows = rules.map(
    (r) =>
      `  (${q(r.code)}, ${q(r.field)}, 'meta_published', ${r.checkedHere},\n   ${q(r.basis)},\n   ${q(r.rule.en)},\n   ${q(r.rule.ar)},\n   ${q(r.rule.fr)},\n   ${q(r.rule.arabizi)})`,
  );
  return [
    "insert into public.catalog_rules (code, field, source, checked_here, basis, rule_en, rule_ar, rule_fr, rule_arabizi) values",
    rows.join(",\n"),
    "on conflict (code) do update set field = excluded.field, source = excluded.source, checked_here = excluded.checked_here,",
    "  basis = excluded.basis, rule_en = excluded.rule_en, rule_ar = excluded.rule_ar, rule_fr = excluded.rule_fr,",
    "  rule_arabizi = excluded.rule_arabizi;",
  ].join("\n");
}

/** The values of one SQL tuple: 'strings' (with '' for a quote), true, false, null and numbers. */
function tupleValues(
  src: string,
  at: number,
): { values: (string | boolean | number | null)[]; end: number } {
  const values: (string | boolean | number | null)[] = [];
  let i = at;
  if (src[i] !== "(") throw new Error(`expected ( at ${i}`);
  i++;
  for (;;) {
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === "'") {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new Error("unterminated string in a catalog_rules insert");
        if (src[i] === "'" && src[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (src[i] === "'") {
          i++;
          break;
        } else s += src[i++];
      }
      values.push(s);
    } else {
      const m = /^(true|false|null|-?\d+(?:\.\d+)?)/i.exec(src.slice(i));
      if (!m) throw new Error(`unexpected value at ${i}: ${src.slice(i, i + 20)}`);
      const v = m[1].toLowerCase();
      values.push(v === "true" ? true : v === "false" ? false : v === "null" ? null : Number(v));
      i += m[1].length;
    }
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === ")") return { values, end: i + 1 };
    throw new Error(`expected , or ) at ${i}`);
  }
}

export type SeedStatement = { rows: RuleRow[]; onConflict: "none" | "nothing" | "update" };

/** Every `insert into public.catalog_rules (...) values (...), ...` statement of one SQL file, in order. */
export function parseSeed(sql: string): SeedStatement[] {
  const out: SeedStatement[] = [];
  const head = /insert into public\.catalog_rules\s*\(([^)]*)\)\s*values\s*/gi;
  let h: RegExpExecArray | null;
  while ((h = head.exec(sql))) {
    const cols = h[1].split(",").map((c) => c.trim());
    const rows: RuleRow[] = [];
    let i = h.index + h[0].length;
    for (;;) {
      const { values, end } = tupleValues(sql, i);
      if (values.length !== cols.length)
        throw new Error(
          `a catalog_rules row has ${values.length} values for ${cols.length} columns`,
        );
      rows.push(Object.fromEntries(cols.map((c, k) => [c, values[k]])) as unknown as RuleRow);
      i = end;
      while (/\s/.test(sql[i] ?? "")) i++;
      if (sql[i] === ",") {
        i++;
        while (/\s/.test(sql[i] ?? "")) i++;
        continue;
      }
      break;
    }
    const tail = sql.slice(i, sql.indexOf(";", i) + 1);
    const onConflict = /^on conflict\s*(\(\s*code\s*\))?\s*do nothing/i.test(tail)
      ? "nothing"
      : /^on conflict\s*\(\s*code\s*\)\s*do update/i.test(tail)
        ? "update"
        : /^;/.test(tail)
          ? "none"
          : null;
    if (!onConflict)
      throw new Error(`a catalog_rules insert ends unexpectedly: ${tail.slice(0, 60)}`);
    out.push({ rows, onConflict });
    head.lastIndex = i;
  }
  return out;
}

/**
 * The published rules the migrations leave in the table, in order of first appearance: every catalog_rules insert of
 * every migration, read in filename order; "do update" and plain inserts set a rule, "do nothing" only adds a new one.
 */
export function seededRules(files: { name: string; sql: string }[]): RuleRow[] {
  const rules = new Map<string, RuleRow>();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name)))
    for (const st of parseSeed(f.sql))
      for (const r of st.rows)
        if (st.onConflict !== "nothing" || !rules.has(r.code))
          rules.set(r.code, { ...rules.get(r.code), ...r });
  return [...rules.values()];
}

export const readMigrations = (dir = MIGRATIONS_DIR) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, "utf8") }));

const FIELDS: [string, string][] = [
  ["image", "Photo"],
  ["title", "Name (title)"],
  ["price", "Price"],
  ["description", "Description"],
  ["policy", "Commerce policy"],
  ["other", "Learned from Meta, not yet reviewed"],
];

const cell = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");

/** The validator's copy of the JSON, as a TypeScript module (deployed edge functions import no JSON module). */
export function renderData(json: string): string {
  return [
    "// Generated by scripts/catalog/rules-doc.ts from catalog-rules.json, the one source of the catalogue rules",
    "// (DECISIONS §39.15.4). Do not edit by hand: edit the JSON and run the script (rules-doc.test.ts checks this copy).",
    "// prettier-ignore",
    `const RULES = ${JSON.stringify(JSON.parse(json), null, 2)};`,
    "export default RULES;",
    "",
  ].join("\n");
}

/** The markdown page. Only data from the rows goes in, so the same rows always give the same page. */
export function renderDoc(rows: RuleRow[], from: string = RULES_FILE): string {
  const out: string[] = [
    "# Meta catalogue rules",
    "",
    `<!-- Generated by scripts/catalog/rules-doc.ts from ${from}. Do not edit by hand. -->`,
    "",
    "What WhatsApp's product catalogue (Meta) accepts, in plain words, as Alo King applies it (DECISIONS §39.15.4).",
    "",
    "- **Where the rules live.** One file, `supabase/functions/_shared/catalog-rules.json`: the validator reads it (through",
    "  the generated `catalog-rules.data.ts`), this page is generated from it, and `public.catalog_rules` is seeded from",
    "  it. To add or reword a rule, edit the JSON, add",
    "  a new migration with the statement `node --experimental-strip-types scripts/catalog/rules-doc.ts --seed` prints",
    "  (`insert into public.catalog_rules … on conflict (code) do update`; never edit an applied migration), and run the",
    "  script without arguments to rewrite this page. `scripts/catalog/rules-doc.test.ts` checks that every catalog_rules",
    "  upsert in `supabase/migrations`, read in filename order, adds up to the JSON, and that this page is up to date.",
    "- **Before Meta sees it.** `validateCatalogItem()` (supabase/functions/_shared/catalog-rules.ts) checks every rule",
    "  marked *Alo King* below. The catalogue sync holds back an item that fails: it is never sent (and hidden if it was",
    "  shown), it stays orderable through the chat lists and the web menu, and `catalog_status_report()` counts it as",
    "  *held* with its commonest reason. The demo photo pipeline runs it before saving a photo, and the merchant copilot",
    "  runs it when a merchant adds or edits an item or sends an item photo, and says what Meta would refuse and how to",
    "  fix it, in the merchant's language.",
    "- **Meta's review decides the rest.** Writing on a photo, a watermark or a collage cannot be seen without a vision",
    "  model, so those rules are marked *Meta* and Meta's own review applies them.",
    "- **The learning loop.** Every Meta refusal the status read stores whose error type and title no rule knows becomes a",
    "  `learned` rule in `public.catalog_rules`, with Meta's words, an example item and a count. The next build session",
    "  reviews learned rules (writes the other languages, links each to a rule here or turns it into a check, through the",
    "  JSON and a new migration). Target: zero rejected among synced items.",
    "",
  ];
  const known = new Set(FIELDS.map(([f]) => f));
  const fields = [
    ...FIELDS,
    ...[...new Set(rows.map((r) => r.field))]
      .filter((f) => !known.has(f))
      .map((f) => [f, f] as [string, string]),
  ];
  out.push("## Rules", "");
  for (const [field, title] of fields) {
    const group = rows.filter((r) => r.field === field);
    if (!group.length) continue;
    out.push(`### ${title}`, "", "| Code | Rule | Checked by | Basis |", "|---|---|---|---|");
    for (const r of group) {
      const by =
        r.source === "learned"
          ? "Meta (learned)"
          : r.checked_here
            ? "Alo King, before sync"
            : "Meta";
      const basis =
        r.source === "learned"
          ? `Meta error: ${[r.meta_error_type, r.meta_error_title].filter(Boolean).join(" · ")}${r.count ? ` (seen ${r.count}×)` : ""}`
          : r.basis;
      out.push(`| \`${r.code}\` | ${cell(r.rule_en)} | ${by} | ${cell(basis)} |`);
    }
    out.push("");
  }
  for (const [lang, title, key] of [
    ["ar", "العربية", "rule_ar"],
    ["fr", "Français", "rule_fr"],
    ["arabizi", "Arabizi", "rule_arabizi"],
  ] as const) {
    const listed = rows.filter((r) => r[key]);
    if (!listed.length) continue;
    out.push(`## ${title} (${lang})`, "");
    for (const r of listed) out.push(`- \`${r.code}\`: ${r[key]}`);
    out.push("");
  }
  return out.join("\n");
}

function main(argv: string[]) {
  const json = argv.find((a) => a.endsWith(".json"));
  if (json) {
    process.stdout.write(renderDoc(JSON.parse(readFileSync(json, "utf8")) as RuleRow[], json));
    return;
  }
  const rules = readRules();
  if (argv.includes("--seed")) {
    console.log(seedSql(rules));
    return;
  }
  const files: [string, string][] = [
    [DOC_FILE, renderDoc(rules.map(rowOf))],
    [DATA_FILE, renderData(readFileSync(RULES_FILE, "utf8"))],
  ];
  if (argv.includes("--check")) {
    const stale = files.filter(([f, body]) => readFileSync(f, "utf8") !== body).map(([f]) => f);
    if (stale.length) {
      console.error(
        `${stale.join(", ")} out of date: run node --experimental-strip-types scripts/catalog/rules-doc.ts`,
      );
      process.exit(1);
    }
    console.log(`${files.map(([f]) => f).join(" and ")} up to date`);
    return;
  }
  for (const [f, body] of files) {
    writeFileSync(f, body);
    console.log(`wrote ${f}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
