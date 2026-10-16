// The catalogue sync (DECISIONS §39.12): dispatch takes the shops queued by a menu, price, availability, stock, claim, pause
// or photo change (and by the 10-minute reconcile and the nightly full sync), diffs each shop's desired catalogue against
// what Meta last got, and sends the difference through the Catalog Batch API. One product set per shop is created once.
// Draft menus never reach menu_items, so they never sync; an item that leaves the menu is hidden, never deleted.
// Meta's review status is the truth (DECISIONS §39.15.2): after every batch, and in a paced sweep of the whole catalogue,
// each product's review_status, visibility and errors go to catalog_item_status; product messages show only approved
// items. Catalogue rules (§39.15.4): a product Meta would refuse is held back before the batch (catalog-rules.ts); it
// stays orderable in chat and on the web, and its reasons go to catalog_item_holds ("held" in catalog_status_report).
import {
  catalogSyncPlan,
  holdBack,
  productHash,
  withContent,
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
  /**
   * GET /{catalog_id}/products with retailer_id, review_status, visibility, availability and errors: the products named in
   * `ids` (a filter), or one page of the whole catalogue from cursor `after`. `next` is the following page's cursor.
   */
  status?: (
    catalogId: string,
    transport: CatalogTransport,
    q: { ids?: string[]; after?: string | null; limit?: number },
  ) => Promise<
    { ok: true; rows: ProductStatus[]; next: string | null } | { ok: false; error: string }
  >;
};

export type ProductStatus = {
  retailer_id: string;
  review_status?: string | null;
  visibility?: string | null;
  availability?: string | null;
  errors?: unknown;
};

/** Products per filtered status read: their ids go in the request's filter, so a batch is read in a few calls. */
export const STATUS_IDS_PER_READ = 50;
/** Time a status read needs before it starts (its timeout and a margin). */
export const STATUS_READ_MIN_MS = 25_000;
/** Products per page of the whole-catalogue sweep. */
export const STATUS_PAGE = 500;

/** Reads and records the status of these products (after a batch); a failure is logged and the sweep catches up. */
export async function recordStatusOf(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>,
  api: CatalogApi,
  catalogId: string,
  transport: CatalogTransport,
  ids: string[],
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void,
  left: () => number = () => Infinity,
): Promise<number> {
  if (!api.status || !ids.length) return 0;
  let n = 0;
  for (let i = 0; i < ids.length; i += STATUS_IDS_PER_READ) {
    // A read may take up to 20 s: below that much time left the sweep catches up instead.
    if (left() < STATUS_READ_MIN_MS) break;
    const r = await api.status(catalogId, transport, {
      ids: ids.slice(i, i + STATUS_IDS_PER_READ),
    });
    if (!r.ok) {
      log?.("catalogue status read failed", { error: r.error.slice(0, 160) });
      return n;
    }
    n += Number(
      (await rpc("catalog_status_record", { p_catalog_id: catalogId, p_rows: r.rows })) ?? 0,
    );
  }
  return n;
}

/**
 * One page of the whole-catalogue status sweep when one is due (catalog_status_sweep_next paces it: every 15 minutes while
 * anything is pending or unknown, else nightly). Returns the rows recorded, or -1 when nothing was due.
 */
export async function catalogStatusStep(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>,
  api: CatalogApi,
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void,
): Promise<number> {
  if (!api.status) return -1;
  const due = await rpc("catalog_status_sweep_next", { p_catalog_id: null });
  if (!due?.due || !due.catalog_id || !due.transport) return -1;
  const failed = async (error: string) => {
    log?.("catalogue status sweep failed", { error: error.slice(0, 160) });
    await rpc("catalog_status_sweep_done", {
      p_catalog_id: due.catalog_id,
      p_next: null,
      p_failed: true,
    });
    return 0;
  };
  // A thrown read or record (a timeout, a network error, a database error) counts as a failed page like a refused one,
  // so it backs off and, the third time, restarts the sweep with an alert instead of retrying every minute.
  let r: Awaited<ReturnType<NonNullable<CatalogApi["status"]>>>;
  let n: number;
  try {
    r = await api.status(due.catalog_id, due.transport, {
      after: due.after ?? null,
      limit: STATUS_PAGE,
    });
    if (!r.ok) return await failed(r.error);
    n = Number(
      (await rpc("catalog_status_record", { p_catalog_id: due.catalog_id, p_rows: r.rows })) ?? 0,
    );
  } catch (e) {
    return await failed(e instanceof Error ? e.message : String(e));
  }
  await rpc("catalog_status_sweep_done", {
    p_catalog_id: due.catalog_id,
    p_next: r.next,
    p_failed: false,
  });
  log?.("catalogue status page", { rows: r.rows.length, recorded: n, more: r.next != null });
  return n;
}

const BATCH = 1000; // Meta takes up to 5,000 requests per call; smaller calls fail smaller.
// A refused product set keeps the job in backoff this many times (the fifth failure raises the ops alert).
const SET_RETRIES = 5;

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
    const j:
      { vendor_id: string; force: boolean; queued_at: string; attempts?: number } | undefined =
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
      const all: DesiredProduct[] = (
        ((await rpc("catalog_desired", { p_vendor_id: j.vendor_id })) ?? []) as DesiredProduct[]
      ).map(withContent);
      // Nothing Meta would refuse is sent (§39.15.4): a held product is left out, so a shown one is hidden, and the
      // reasons are recorded every time (an empty list clears the shop's holds once its items pass).
      const { send: desired, held } = holdBack(all, (p) =>
        api.imageUrl(p.retailer_id, productHash(p)),
      );
      await rpc("catalog_hold_record", { p_vendor_id: j.vendor_id, p_holds: held });
      const state: SyncState =
        (await rpc("catalog_sync_state", { p_vendor_id: j.vendor_id })) ?? {};
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
      // What Meta says about what we just sent (often "pending" at first; the sweep reads it again).
      const sentIds = plan.requests.map((q) => String(q.data.id)).filter((id) => !refused.has(id));
      await recordStatusOf(rpc, api, cat.catalog_id, cat.transport, sentIds, log, left).catch(
        (e: unknown) => log?.("catalogue status read failed", { error: String(e).slice(0, 160) }),
      );
      // The shop's product set, asked for once its products are sent. Meta refuses an empty set and ingests products a
      // little later, so a refusal finishes the job with an error and its retry (60 s, then doubling) creates the set.
      // After the fifth failure (the ops alert) the job finishes clean, so the shop's updates are not held in backoff;
      // the nightly full sync asks again.
      let setMissing = false;
      if (desired.length) {
        const have = await rpc("catalog_product_set", {
          p_vendor_id: j.vendor_id,
          p_catalog_id: cat.catalog_id,
          p_product_set_id: null,
        });
        if (!have) {
          const name = desired[0].brand || j.vendor_id;
          // A set request that fails outright counts as a refusal: the products are already in.
          const id = await api
            .productSet(cat.catalog_id, cat.transport, productSetBody(j.vendor_id, name))
            .catch(() => null);
          if (id)
            await rpc("catalog_product_set", {
              p_vendor_id: j.vendor_id,
              p_catalog_id: cat.catalog_id,
              p_product_set_id: id,
            });
          else setMissing = true;
        }
      }
      await finish(
        setMissing && (j.attempts ?? 1) <= SET_RETRIES ? "catalogue product set not created" : null,
      );
      log?.("catalogue synced", {
        vendor: j.vendor_id,
        sent: plan.requests.length,
        items: desired.length,
        held: held.length,
        refused: refused.size,
        set_missing: setMissing,
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
