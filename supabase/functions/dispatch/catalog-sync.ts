// The catalogue sync (DECISIONS §39.12): dispatch takes the shops queued by a menu, price, availability, stock, claim, pause
// or photo change (and by the 10-minute reconcile and the nightly full sync), diffs each shop's desired catalogue against
// what Meta last got, and sends the difference through the Catalog Batch API. One product set per shop is created once.
// Draft menus never reach menu_items, so they never sync; an item that leaves the menu is hidden, never deleted.
import {
  catalogSyncPlan,
  productSetBody,
  type BatchRequest,
  type DesiredProduct,
  type SyncState,
} from "../_shared/catalog.ts";

export type CatalogTransport = "kapso" | "graph";
export type CatalogApi = {
  /** POST /{catalog_id}/items_batch (item_type PRODUCT_ITEM, allow_upsert); ok when Meta accepted the batch. */
  batch: (
    catalogId: string,
    transport: CatalogTransport,
    requests: BatchRequest[],
  ) => Promise<{ ok: true; refused?: string[] } | { ok: false; error: string }>;
  /** POST /{catalog_id}/product_sets; the new set's id, or null. */
  productSet: (
    catalogId: string,
    transport: CatalogTransport,
    body: { name: string; filter: string },
  ) => Promise<string | null>;
  /** The public URL of an item's image (dispatch draws it); the hash makes Meta fetch it again after a change. */
  imageUrl: (itemId: string, hash: string) => string;
};

const BATCH = 1000; // Meta takes up to 5,000 requests per call; smaller calls fail smaller.

/** Time one shop's sync may take (a product set and a batch, each with its own timeout). */
export const JOB_MS = 45_000;

/**
 * Takes one shop at a time while the worker has time left for a whole job, at most `max` shops; a taken shop is leased
 * in the database, so another worker never syncs it at the same time.
 */
export async function catalogSyncStep(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>,
  api: CatalogApi,
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void,
  left: () => number = () => Infinity,
  max = 5,
): Promise<number> {
  let n = 0;
  for (let k = 0; k < max && left() > JOB_MS; k++) {
    const claim = await rpc("catalog_sync_claim", { p_limit: 1 });
    const j: { vendor_id: string; force: boolean; queued_at: string } | undefined =
      claim?.items?.[0];
    if (!j) break;
    const cat: { catalog_id: string; transport: CatalogTransport } | null = claim?.catalog ?? null;
    const finish = (error: string | null) =>
      rpc("catalog_sync_finish", {
        p_vendor_id: j.vendor_id,
        p_queued_at: j.queued_at,
        p_error: error,
      });
    try {
      if (!cat?.catalog_id || !cat.transport) {
        await finish("no catalogue that can be written");
        continue;
      }
      const desired: DesiredProduct[] =
        (await rpc("catalog_desired", { p_vendor_id: j.vendor_id })) ?? [];
      const state: SyncState =
        (await rpc("catalog_sync_state", { p_vendor_id: j.vendor_id })) ?? {};
      if (desired.length) {
        const have = await rpc("catalog_product_set", {
          p_vendor_id: j.vendor_id,
          p_catalog_id: cat.catalog_id,
          p_product_set_id: null,
        });
        if (!have) {
          const name = desired[0].brand || j.vendor_id;
          const id = await api.productSet(
            cat.catalog_id,
            cat.transport,
            productSetBody(j.vendor_id, name),
          );
          if (id)
            await rpc("catalog_product_set", {
              p_vendor_id: j.vendor_id,
              p_catalog_id: cat.catalog_id,
              p_product_set_id: id,
            });
          else log?.("catalogue product set not created", { vendor: j.vendor_id });
        }
      }
      const plan = catalogSyncPlan(
        desired,
        state,
        (p, h) => api.imageUrl(p.retailer_id, h),
        !!j.force,
      );
      const refused = new Set<string>();
      for (let i = 0; i < plan.requests.length; i += BATCH) {
        const r = await api.batch(cat.catalog_id, cat.transport, plan.requests.slice(i, i + BATCH));
        if (!r.ok) throw new Error(r.error);
        for (const id of r.refused ?? []) refused.add(id);
      }
      // A product Meta refused is recorded as not shown (never offered in a product message) and is sent again next time.
      // A product shown before keeps its visibility (Meta still shows the earlier version, so a later hide still applies).
      const record = plan.record.map((x) =>
        refused.has(x.retailer_id)
          ? {
              retailer_id: x.retailer_id,
              hash: "refused",
              visible: state[x.retailer_id]?.visible ?? false,
            }
          : x,
      );
      await rpc("catalog_sync_record", { p_vendor_id: j.vendor_id, p_items: record });
      await finish(null);
      log?.("catalogue synced", {
        vendor: j.vendor_id,
        sent: plan.requests.length,
        items: desired.length,
        refused: refused.size,
      });
      n++;
    } catch (e) {
      const error = String(e instanceof Error ? e.message : e).slice(0, 400);
      log?.("catalogue sync failed", { vendor: j.vendor_id, error: error.slice(0, 160) });
      await finish(error).catch(() => null);
    }
  }
  return n;
}
