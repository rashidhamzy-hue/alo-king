// The dark-store catalog as the generators see it: supabase/seed/catalog.csv and the curated aliases, read only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
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

/** One row per product: sku, name, brand, category, sub_type, velocity, unit, name_ar, aliases. */
export function loadCatalog() {
  const [head, ...rows] = parseCsv(readFileSync(root + "supabase/seed/catalog.csv", "utf8"));
  const col = (n) => head.indexOf(n);
  const aliases = new Map();
  for (const [sku, alias] of parseCsv(readFileSync(root + "supabase/seed/product_aliases.csv", "utf8")).slice(1)) {
    if (!sku) continue;
    if (!aliases.has(sku)) aliases.set(sku, []);
    aliases.get(sku).push(alias);
  }
  return rows.filter((r) => r[0]).map((r) => ({
    sku: r[col("SKU")], name: r[col("Item")], brand: r[col("Brand")], category: r[col("Category")],
    sub_type: r[col("Sub-type")], velocity: r[col("Velocity tier")] || null, unit: r[col("Sell unit")],
    name_ar: r[col("Arabic name")] || null, aliases: aliases.get(r[col("SKU")]) ?? [],
  }));
}

export function byCategory(catalog) {
  const m = new Map();
  for (const p of catalog) { if (!m.has(p.category)) m.set(p.category, []); m.get(p.category).push(p); }
  return m;
}

/** Small concurrency pool: runs fn over items, at most n at a time, keeping order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Split a list into chunks of at most k. */
export const chunks = (xs, k) => Array.from({ length: Math.ceil(xs.length / k) }, (_, i) => xs.slice(i * k, i * k + k));

export const line = (p) => `${p.sku} | ${p.name} | brand: ${p.brand} | kind: ${p.sub_type}${p.name_ar ? ` | Arabic label: ${p.name_ar}` : ""}`;
export { root };
