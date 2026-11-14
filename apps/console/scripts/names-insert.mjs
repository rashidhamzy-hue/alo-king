// Prints the INSERT that loads data/proposals/names.json into product_name_proposals (migration 0110, session D4).
// Run:  node apps/console/scripts/names-insert.mjs > /tmp/names-insert.sql   (the migration's last statement is this output).
// Only the proposals are loaded; the nine items the checks refused (`rejected` in the file) keep their names and have no row.
import { readFileSync } from "node:fs";

const file = JSON.parse(readFileSync(new URL("../../../data/proposals/names.json", import.meta.url), "utf8"));
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => (a.length ? `array[${a.map(q).join(", ")}]::text[]` : "'{}'::text[]");
const rows = file.proposals.map((p) =>
  `(${q(p.sku)}, ${q(p.current.name_en)}, ${q(p.current.name_ar)}, ${q(p.current.brand)}, ${q(p.current.sell_unit)}, ` +
  `${q(p.proposed.name_en)}, ${q(p.proposed.name_ar)}, ${q(p.proposed.size_en)}, ${q(p.proposed.size_ar)}, ${q(p.ar_source)}, ${arr(p.added_words)}, ` +
  `${p.off_hint ? q(JSON.stringify(p.off_hint)) + "::jsonb" : "null"})`);
console.log(`-- ${rows.length} proposals from data/proposals/names.json (run ${file.run_id}, ${file.generated_at}).`);
console.log("insert into product_name_proposals(sku, current_name_en, current_name_ar, current_brand, current_sell_unit, name_en, name_ar, size_en, size_ar, ar_source, added_words, off_hint)");
console.log("values\n" + rows.join(",\n"));
console.log("on conflict (sku) do nothing;");
