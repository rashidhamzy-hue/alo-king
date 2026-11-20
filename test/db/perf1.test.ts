// PERF1 (0267): the website's small copies of each public picture (content-hashed, made by the hourly job, removed with a withdrawal),
// the media clean-up's list (rejected or withdrawn pictures older than 3 days, never anything still named elsewhere), and the staging
// probe's spend recorded in model_costs and capped at USD 0.10 a day. The buckets are the in-memory stand-in of A5 (public-store-kit.ts).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openFlowDb } from "./flow-kit";
import type { TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";
import { fakeStore } from "./public-store-kit";
import { syncCatalogPictures } from "../../apps/gateway/src/catalog-feed";
import { runVariants, variantPath } from "../../scripts/images/feed-jpegs.mjs";
import { clean } from "../../scripts/images/media-clean.mjs";

let db: TestDb;
let ops: string;
const pid: Record<string, string> = {};
let n = 0;

async function propose(sku: string, media = `product_images/${sku}/${++n}.webp`) {
  const r = await db.rpc<any>("propose_product_image", { p_product: pid[sku], p_source_kind: "intake_photo", p_source_url: null, p_page_url: null,
    p_attribution: null, p_media_path: media, p_sha256: `sha-perf1-${++n}`, p_width: 1000, p_height: 1000, p_bytes: 50000, p_vision: {} });
  return { image: (r.image_id ?? r.id) as string, media };
}
const review = (image: string, decision: "approve" | "reject") => db.rpc("review_product_image", { p_image: image, p_by: ops, p_decision: decision, p_note: "test" });
const variantPass = (s: ReturnType<typeof fakeStore>, bytes = 12_000) => runVariants({
  store: { rpc: (fn: string, a?: Record<string, unknown>) => db.rpc(fn, a ?? {}),
    download: async (k: string) => { const b = s.media.get(k); if (b === undefined) throw new Error(`source not found: ${k}`); return b; },
    uploadPublic: async (k: string, data: string) => { s.catalog.set(k, { bytes: data, createdAt: new Date().toISOString() }); },
    removePublic: async (ks: string[]) => { for (const k of ks) s.catalog.delete(k); } },
  variant: async (b: string, w: number) => ({ data: Buffer.from(`${w} of ${b}`), bytes: w === 400 ? bytes : bytes * 3 }) });
const webPicture = async (sku: string) => (await db.rpc<any>("web_catalog_product", { p_sku: sku }))?.picture ?? null;

beforeAll(async () => {
  ({ db } = await openFlowDb());
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  for (const sku of ["AK-0103", "AK-0080"]) pid[sku] = (await db.one(`select id from products where sku = $1`, [sku])).id;
}, 60_000);
beforeEach(async () => {
  await db.pg.exec(`delete from catalog_picture_variants; delete from catalog_public_pictures; delete from catalog_feed_jpegs; delete from automation_decisions; delete from product_images`);
});

describe("the website's 400 and 800 px copies", () => {
  it("are made once for a public picture, under content-hashed names, and named by the website's picture", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect((await webPicture("AK-0103"))).toMatchObject({ w400: null, w800: null });       // before the job: the original, as before
    expect(await variantPass(s)).toMatchObject({ made: 2, failed: 0 });
    const paths = [...s.catalog.keys()].filter((k) => /-w(400|800)-/.test(k)).sort();
    expect(paths).toEqual([variantPath(`AK-0103-${a.image}`, 400, Buffer.from(`400 of bytes of ${a.media}`)), variantPath(`AK-0103-${a.image}`, 800, Buffer.from(`800 of bytes of ${a.media}`))]);
    expect(paths[0]).toMatch(new RegExp(`^AK-0103-${a.image}-w400-[0-9a-f]{12}\\.webp$`));
    expect(await webPicture("AK-0103")).toMatchObject({ w400: paths[0], w800: paths[1] });
    expect(await variantPass(s)).toMatchObject({ made: 0, removed: 0 });                    // nothing twice
    expect(await db.rpc<any>("catalog_public_report")).toMatchObject({ variants: 2, variants_to_make: 0, variants_to_remove: 0 });
  });

  it("refuses a copy over its cap, a wrong name or a width it does not know", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const ok = `AK-0103-${a.image}-w400-0123456789ab.webp`;
    await expect(db.rpc("catalog_variant_made", { p_image: a.image, p_width: 400, p_path: ok, p_bytes: 25_001 })).rejects.toThrow(/VARIANT_TOO_BIG/);
    await expect(db.rpc("catalog_variant_made", { p_image: a.image, p_width: 400, p_path: `AK-0080-${a.image}-w400-0123456789ab.webp`, p_bytes: 9000 })).rejects.toThrow(/VARIANT_PATH/);
    await expect(db.rpc("catalog_variant_made", { p_image: a.image, p_width: 600, p_path: ok, p_bytes: 9000 })).rejects.toThrow(/VARIANT_WIDTH/);
    expect(await db.rpc("catalog_variant_made", { p_image: a.image, p_width: 400, p_path: ok, p_bytes: 25_000 })).toBe(ok);
  });

  it("a withdrawn picture leaves the pages at once, and its copies leave the bucket on the gateway's next minute", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    await variantPass(s);
    await review(a.image, "reject");                                                          // withdrawn
    expect(await webPicture("AK-0103")).toBeNull();
    const r = await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(r.variantsRemoved).toBe(2);
    expect([...s.catalog.keys()].filter((k) => /-w(400|800)-/.test(k))).toEqual([]);
    expect(await db.one(`select count(*)::int as n from catalog_picture_variants`)).toEqual({ n: 0 });
  });

  it("a variant the books know is not a stray; one whose object is gone is forgotten, so it is made again", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    await variantPass(s);
    const names = [...s.catalog.keys()];
    expect(await db.rpc("catalog_picture_strays", { p_listed: names })).toEqual([]);
    await db.pg.exec(`update catalog_picture_variants set made_at = now() - interval '1 hour'`);
    const without400 = names.filter((k) => !/-w400-/.test(k));
    expect(await db.rpc("catalog_picture_forget", { p_listed: without400 })).toBe(1);
    expect(await variantPass(s)).toMatchObject({ made: 1 });
  });

  it("the cache header: everything the job and the gateway put in the public bucket is a year, immutable", async () => {
    const { CATALOG_CACHE_CONTROL } = await import("../../scripts/images/lib/store.mjs");
    const gw = await import("../../apps/gateway/src/catalog-feed");
    expect(CATALOG_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(gw.CATALOG_CACHE_CONTROL).toBe(CATALOG_CACHE_CONTROL);
  });
});

describe("the media clean-up (rejected or withdrawn pictures older than 3 days)", () => {
  const old = (image: string, days = 4) => db.pg.query(`update product_images set reviewed_at = now() - make_interval(days => $2) where id = $1`, [image, days]);
  it("lists only old rejections whose file nothing else names; deletes them and keeps the rows", async () => {
    const due = await propose("AK-0103");              await review(due.image, "reject"); await old(due.image);
    const young = await propose("AK-0080");            await review(young.image, "reject"); await old(young.image, 1);
    const label = await propose("AK-0103", "labels/AK-0103/front.jpg"); await review(label.image, "reject"); await old(label.image);
    const kept = await propose("AK-0080");             await review(kept.image, "approve");
    expect(await db.rpc("media_cleanup_work")).toEqual([{ media_path: due.media }]);
    const removed: string[] = [];
    const r = await clean({ store: { rpc: (fn: string, a?: Record<string, unknown>) => db.rpc(fn, a ?? {}), removeMedia: async (p: string[]) => { removed.push(...p); } } });
    expect(r).toMatchObject({ deleted: 1, failed: 0 });
    expect(removed).toEqual([due.media]);
    expect(await db.one(`select status, review_note, sha256 is not null as sha, file_deleted_at is not null as gone from product_images where id = $1`, [due.image]))
      .toEqual({ status: "rejected", review_note: "test", sha: true, gone: true });
    expect(await db.rpc("media_cleanup_work")).toEqual([]);                                  // never twice
  });
  it("leaves the file of a rule's rejection a person can still undo, and a file another picture still uses", async () => {
    const byRule = await propose("AK-0103"); await review(byRule.image, "reject"); await old(byRule.image);
    await db.pg.query(`insert into automation_decisions(kind, version, action, target_id, title, reason, created_at) values ('photo', 'photo-vision-2', 'rejected', $1, 'x', 'another brand', now() - interval '4 days')`, [byRule.image]);
    const shared = await propose("AK-0080", "product_images/shared/1.webp"); await review(shared.image, "reject"); await old(shared.image);
    const again = await propose("AK-0080", "product_images/shared/1.webp");               // the same file, proposed again
    void again;
    expect(await db.rpc("media_cleanup_work")).toEqual([]);
    await db.pg.query(`update automation_decisions set created_at = now() - interval '9 days' where target_id = $1`, [byRule.image]);
    expect(await db.rpc("media_cleanup_work")).toEqual([{ media_path: byRule.media }]);
  });
});

describe("the staging probe's spend (USD 0.10 a day)", () => {
  let probe = ""; let conv = "";
  beforeAll(async () => {
    await db.pg.exec(`update settings set value = value || '{"enabled": true, "order_text": "بدي مي"}' where key = 'probe';
                      update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);
    probe = (await db.one(`select p.id from parties p where p.is_probe and p.role = 'customer' limit 1`).catch(() => null))?.id
      ?? (await db.one(`insert into parties(role, is_probe) values ('customer', true) returning id`)).id;
    await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'customer', 'PR.PERF1') on conflict do nothing`, [probe]);
    conv = (await db.one(`select id from conversations where party_id = $1 and line = 'customer'`, [probe]).catch(() => null))?.id
      ?? (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [probe])).id;
  });
  const turn = (tokensIn: number, tokensOut: number) => db.pg.query(`insert into agent_runs(agent, model, conversation_id, input_tokens, output_tokens, trace)
    values ('concierge', 'claude-haiku-5-5', $1, $2, $3, '{}')`, [conv, tokensIn, tokensOut]);
  it("orders every three open hours, records the day's spend in model_costs, and rests before the cap", async () => {
    expect(await db.one(`select (value->>'every_minutes')::int as every, (value->>'daily_cap_usd')::numeric as cap from settings where key = 'probe'`)).toEqual({ every: 180, cap: "0.10" });
    await db.pg.exec(`delete from orders where customer_id = '${probe}'; delete from wa_inbound_events where idempotency_key like 'probe:%'; delete from agent_runs where conversation_id = '${conv}'`);
    await turn(20_000, 2_000);
    expect(await db.rpc("probe_due")).toMatchObject({ text: "بدي مي" });
    const row = await db.one<any>(`select workflow, run_id, step, calls, usd::float as usd, cap_usd::float as cap from model_costs where workflow = 'probe'`);
    expect(row).toMatchObject({ workflow: "probe", step: "gateway turns", calls: 1, cap: 0.1 });
    expect(row.run_id).toMatch(/^probe-\d{4}-\d\d-\d\d$/);
    expect(row.usd).toBeGreaterThan(0);
    // enough turns today that one more order would pass USD 0.10: no order, and probe_silent stays quiet that day
    await turn(400_000, 20_000);
    expect(await db.rpc("probe_capped")).toBe(true);
    expect(await db.rpc("probe_due")).toBeNull();
    expect(((await db.rpc("heartbeat_alerts")) as { kind: string }[]).map((a) => a.kind)).not.toContain("probe_silent");
    expect((await db.one<any>(`select stopped_at_cap from model_costs where workflow = 'probe'`)).stopped_at_cap).toBe(true);
  });
  it("probe_silent waits one probe period and 30 minutes, and names the period", async () => {
    await db.pg.exec(`delete from agent_runs where conversation_id = '${conv}'; delete from orders where customer_id = '${probe}'`);
    await db.pg.query(`update parties set created_at = now() - interval '2 days' where id = $1`, [probe]);
    const opened = (h: number) => db.pg.exec(`update settings set value = jsonb_build_object('tz', 'Asia/Beirut',
        'open', to_char((now() at time zone 'Asia/Beirut') - interval '${h} hours', 'HH24:MI'),
        'close', to_char((now() at time zone 'Asia/Beirut') + interval '2 hours', 'HH24:MI')) where key = 'hours'`);
    const silent = async () => ((await db.rpc("heartbeat_alerts")) as { kind: string; detail: any }[]).find((a) => a.kind === "probe_silent");
    await opened(3);
    expect(await silent()).toBeUndefined();
    await opened(4);
    expect((await silent())?.detail).toMatchObject({ every_minutes: 180 });
  });
});
