// What the scenario generator knows about the shop: the repository's catalogue file (supabase/seed/catalog.csv, the list staging
// was loaded from) and the draft villages (supabase/seed/villages.sql). Products are named by SKU, which the staging copy shares,
// so a scenario written here finds its product in the copy. Read only; nothing here touches a database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface CatalogItem { sku: string; name_en: string; name_ar: string | null; brand: string; category: string; sub_type: string; unit: string; price: number }
export interface VillageRow { zone: string; name_en: string; name_ar: string; aliases: string[] }

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Every catalogue line with a reference price (the ones staging sells). Sorted by SKU, so the order never depends on the file. */
export function loadCatalog(): CatalogItem[] {
  const rows = parseCsv(readFileSync(repo("supabase/seed/catalog.csv"), "utf8"));
  const head = rows[0]!;
  const col = (name: string) => head.indexOf(name);
  const out: CatalogItem[] = [];
  for (const r of rows.slice(1)) {
    const price = Number(r[col("Tawfeer avg price per unit (USD)")] ?? "");
    if (!r[0] || !Number.isFinite(price) || price <= 0) continue;
    out.push({ sku: r[col("SKU")]!, name_en: r[col("Item")]!, name_ar: r[col("Arabic name")] || null, brand: r[col("Brand")] ?? "",
               category: r[col("Category")] ?? "", sub_type: r[col("Sub-type")] ?? "", unit: r[col("Sell unit")] ?? "each", price });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/** The draft villages and their zones, as written in the seed (the copy's served flags decide at run time). */
export function loadVillages(): VillageRow[] {
  const sql = readFileSync(repo("supabase/seed/villages.sql"), "utf8");
  const out: VillageRow[] = [];
  for (const m of sql.matchAll(/\('(core|mid|outer)','([^']+)','([^']+)',array\[([^\]]*)\]\)/g)) {
    out.push({ zone: m[1]!, name_en: m[2]!, name_ar: m[3]!, aliases: [...m[4]!.matchAll(/'([^']+)'/g)].map((a) => a[1]!) });
  }
  return out;
}

/** Customer messages written for the language evals (evals/language/cases.json, invented), by language: the simulator's style. */
export function loadStyle(): Record<"ar" | "arabizi" | "en" | "fr" | "mixed", string[]> {
  const j = JSON.parse(readFileSync(repo("evals/language/cases.json"), "utf8")) as { cases: { lang: string; text: string }[] };
  const out = { ar: [] as string[], arabizi: [] as string[], en: [] as string[], fr: [] as string[], mixed: [] as string[] };
  for (const c of j.cases) {
    const k = c.lang === "ar_lb" ? "ar" : c.lang;
    if (k in out && c.text.length >= 8 && c.text.length <= 220) out[k as keyof typeof out].push(c.text);
  }
  // Voice notes as the speech provider returned them (evals/voice_notes/cases): Arabic only.
  for (let i = 1; i <= 5; i++) {
    try { out.ar.push((JSON.parse(readFileSync(repo(`evals/voice_notes/cases/vn-0${i}.json`), "utf8")) as { transcript: string }).transcript); } catch { /* optional */ }
  }
  return out;
}
