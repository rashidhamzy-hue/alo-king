// SR1: loads the approved test facts the search request set is scored against (evals/search/facts.json) into a test database.
// Test data only, never staging: six invented items (SR1T-*) with their language-pack terms and an offer at the hub, and approved
// records on seed products: kinds and shopping tags, food facts (the panel, the 14 allergens, diet), printed claims, template fields.
// A person (an ops lead of the test) approves everything, so the medical-sounding claim and the hazard warnings are allowed.
import type { TestDb } from "./harness";
import { makeFactComplete } from "./fact-kit";
import facts from "../../evals/search/facts.json";

export interface FactItem {
  sku: string; kind?: string; tags?: string[]; nutrition?: Record<string, number>; allergens?: Record<string, string>;
  diet?: Record<string, string>; claims?: [string, string][]; fields?: Record<string, unknown>;
}
export const FACTS = facts as unknown as { products: { sku: string; name_en: string; name_ar: string; brand: string; category: string; sub_type: string;
  sell_unit: string; storage: string; price_usd: number; terms: [string, string, string][] }[]; items: FactItem[] };

/** Loads the products and facts. Returns the ops lead who approved them and the SKU of every product id. */
export async function seedSearchFacts(db: TestDb, opts: { stock?: number } = {}): Promise<{ ops: string; skuOf: Map<string, string>; idOf: Map<string, string> }> {
  const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops SR1') returning id`)).id as string;
  const hub = (await db.one(`select id from sources where kind = 'dark_store' limit 1`)).id as string;
  for (const p of FACTS.products) {
    const id = (await db.one(`insert into products(sku, name_en, name_ar, brand, category, sub_type, storage, sell_unit, is_active)
                              values ($1, $2, $3, $4, $5, $6, $7::storage_zone, $8, true) returning id`,
      [p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.storage, p.sell_unit])).id;
    await db.pg.query(`insert into offers(source_id, product_id, price_usd, is_available) values ($1, $2, $3, true)`, [hub, id, p.price_usd]);
    await db.pg.query(`insert into stock_levels(source_id, product_id) values ($1, $2) on conflict do nothing`, [hub, id]);
    for (const [term, level, lang] of p.terms)
      await db.pg.query(`insert into language_pack(sku, term, level, lang, version) values ($1, $2, $3, $4, 'sr1-test') on conflict do nothing`, [p.sku, term, level, lang]);
  }
  if (opts.stock !== undefined) await db.pg.query(`update stock_levels set on_hand = $1, reserved = 0`, [opts.stock]);
  const rows = await db.all<{ id: string; sku: string }>(`select id, sku from products`);
  const idOf = new Map(rows.map((r) => [r.sku, r.id])), skuOf = new Map(rows.map((r) => [r.id, r.sku]));
  const value = async (product: string, key: string, v: unknown) => {
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, approved_by, approved_at)
                       values ($1, $2, $3, 'label_photo', 'approved', $4, now())`, [product, key, JSON.stringify(v), ops]);
  };
  for (const it of FACTS.items) {
    const id = idOf.get(it.sku);
    if (!id) throw new Error(`facts.json: no product ${it.sku}`);
    // a non-food item needs its Arabic name to be sellable (and so fact-complete); a food item gets one from makeFactComplete
    if (it.fields || it.claims) await db.pg.query(`update products set name_ar = coalesce(name_ar, name_en) where id = $1`, [id]);
    if (it.kind) await db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, approved_by, approved_at)
                                    values ($1, 'kind', $2, 'rules', 'approved', $3, now())`, [id, JSON.stringify(it.kind), ops]);
    for (const t of it.tags ?? []) await db.pg.query(`insert into product_tags(product_id, tag_code, source) values ($1, $2, 'person') on conflict do nothing`, [id, t]);
    if (it.nutrition) {
      await makeFactComplete(db, id, ops, { nutrition: it.nutrition, allergens: it.allergens });
      for (const [attr, v] of Object.entries(it.diet ?? {})) {
        const f = await db.rpc("propose_product_fact", { p_product: id, p_attribute: attr, p_value: v, p_status: "declared", p_source: "label", p_by: ops, p_detail: {} });
        await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
      }
    }
    for (const [k, v] of Object.entries(it.fields ?? {})) await value(id, k, v);
    for (const [code, quote] of it.claims ?? [])
      await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source, status, approved_by, approved_at)
                         values ($1, $2, $3, 'label_photo', 'approved', $4, now())`, [id, code, quote, ops]);
  }
  await db.one(`select refresh_search_documents() as n`);
  return { ops, skuOf, idOf };
}
