// CAT2: one item in Meta's catalogue for a flow test (an approved picture and its feed JPEG), so the catalogue message has a thumbnail.
// Kapso refuses a catalog_message without action.parameters.thumbnail_product_retailer_id; the thumbnail is chosen from catalog_feed.
import type { TestDb } from "./harness";

export async function seedFeedItem(db: TestDb, sku = "AK-0103"): Promise<string> {
  const pid = (await db.one(`select id from products where sku = $1`, [sku])).id as string;
  const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'CAT2 seed') returning id`)).id as string;
  const r = await db.rpc<any>("propose_product_image", { p_product: pid, p_source_kind: "intake_photo", p_source_url: null, p_page_url: null,
    p_attribution: null, p_media_path: `product_images/${sku}/cat2.jpg`, p_sha256: `sha-cat2-${sku}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  const image = (r.image_id ?? r.id) as string;
  await db.rpc("review_product_image", { p_image: image, p_by: ops, p_decision: "approve", p_note: null });
  await db.rpc("catalog_feed_jpeg_made", { p_image: image, p_bytes: 90000 });
  return sku;
}
