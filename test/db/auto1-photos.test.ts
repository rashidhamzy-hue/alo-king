// Session AUTO1: the picture check run (scripts/images/lib/photo-check.mjs) against a scripted Batch API and the real migrations. USD 0.
//   - the label day's front photos are queued first (our own photos), then every waiting picture is checked in one half-price batch
//   - the database decides from each answer: approved, rejected with the exact reason, or left for a person; an unusable answer changes nothing
//   - a re-check of approved pictures changes nothing and reports the disagreements
//   - the cap (at most USD 1) and the price row are enforced before anything is sent
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";
// @ts-expect-error plain .mjs
import { runPhotoCheck, imageSize, estimatePictureUsd, cleanAnswer, CHECK_TOOL, MAX_CAP_USD } from "../../scripts/images/lib/photo-check.mjs";
// @ts-expect-error plain .mjs
import { normalisePrices, priceFor } from "../../scripts/lib/model-cost.mjs";

const MODEL = "claude-haiku-5-5";
const JPEG = new Uint8Array(readFileSync(new URL("../fixtures/menus/example-bakery.jpg", import.meta.url)));
const USAGE = { input_tokens: 1800, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let db: TestDb; let picker: string; let prices: unknown[]; const sku: Record<string, string> = {}; const img: Record<string, string> = {};

function fakeApi(answer: (customId: string, text: string) => unknown) {
  const batches = new Map<string, any[]>(); const posted: any[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(String(init.body)) : undefined; const u = new URL(url);
    if (method === "POST" && u.pathname === "/v1/messages/batches") { const id = `msgbatch_${batches.size + 1}`; batches.set(id, body.requests); posted.push(...body.requests); return Response.json({ id, processing_status: "in_progress" }); }
    const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      if (!m[2]) return Response.json({ id: m[1], processing_status: "ended" });
      return new Response(batches.get(m[1]!)!.map((rq: any) => {
        const a = answer(rq.custom_id, rq.params.messages[0].content[1].text);
        if (a === "error") return JSON.stringify({ custom_id: rq.custom_id, result: { type: "errored" } });
        return JSON.stringify({ custom_id: rq.custom_id, result: { type: "succeeded", message: { content: [{ type: "tool_use", name: "record_picture_check", input: a }], usage: USAGE, stop_reason: "tool_use" } } });
      }).join("\n"));
    }
    return new Response("not found", { status: 404 });
  };
  return { f, posted };
}
const yes = (seen: string) => ({ seen, match: "yes" });
const deps = (api: ReturnType<typeof fakeApi>, extra: Record<string, unknown> = {}) => ({
  rpc: (fn: string, a: Record<string, unknown> = {}) => db.rpc(fn, a), download: async () => ({ bytes: JPEG, mime: "image/jpeg" }),
  fetch: api.f, prices, model: MODEL, apiKey: "test-key-not-real", capUsd: 1, runId: "auto1-photos", sleep: async () => {}, log: () => {}, mode: "decide", ...extra });

beforeAll(async () => {
  db = await openTestDb();
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker AUTO1 photos') returning id`)).id;
  prices = normalisePrices((await db.all(`select to_jsonb(m) as j from model_prices m`)).map((x) => x.j));
  const ps = await db.all(`select id, sku from products where sku like 'AK-%' and is_active order by sku limit 6`);
  ps.forEach((p, i) => { sku[`p${i}`] = p.sku; });
  for (const [i, p] of ps.slice(0, 4).entries()) {
    img[p.sku] = (await db.one(`insert into product_images(product_id, status, source_kind, licence, media_path, sha256, width_px, height_px, bytes, source_note)
      values ($1, $2, 'founder_upload', 'founder_supplied', $3, $4, 1000, 1000, 50000, 'release pictures-test') returning id`,
      [p.id, i === 3 ? "approved" : "proposed", `product_images/${p.sku}/x.webp`, String(i).padStart(64, "0")])).id;
  }
  await db.rpc("record_label_capture", { p_product: ps[5].id, p_shot: "front", p_media_path: `labels/${ps[5].id}/front.jpg`, p_by: picker });
}, 120_000);

describe("the picture check run", () => {
  it("reads a picture's size from its header", () => {
    expect(imageSize(JPEG)).toMatchObject({ mime: "image/jpeg" });
    expect(imageSize(JPEG)!.width).toBeGreaterThan(0);
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("keeps the model's answer to the form; anything else is unusable", () => {
    expect(cleanAnswer({ verdict: "yes" })).toBeNull();
    expect(cleanAnswer({ verdict: "match", confidence: 7, brand: { match: "maybe" }, marks: ["hebrew_text", "rude"], reason: "  x  " }))
      .toMatchObject({ confidence: 1, brand: { match: "unsure" }, product_type: { match: "unsure" }, marks: ["hebrew_text"], reason: "x" });
    expect(Object.keys(CHECK_TOOL.input_schema.properties)).toEqual(["verdict", "confidence", "brand", "product_type", "size", "flavour", "marks", "reason"]);
  });
  it("queues the front photo, checks every waiting picture in one batch, and the database decides", async () => {
    const api = fakeApi((id, text) => {
      if (text.includes(sku.p0!) || id.endsWith(img[sku.p0!]!)) return { verdict: "match", confidence: 0.95, brand: yes("x"), product_type: yes("x"), size: yes("x"), flavour: { seen: null, match: "n/a" }, marks: [], reason: "the item, one pack" };
      if (id.endsWith(img[sku.p1!]!)) return { verdict: "mismatch", confidence: 0.93, brand: { seen: "Masafi", match: "no" }, product_type: yes("water"), size: yes("1.5 L"), flavour: { seen: null, match: "n/a" }, marks: [], reason: "shows Masafi, not Nejmeh" };
      if (id.endsWith(img[sku.p2!]!)) return "error";
      return { verdict: "uncertain", confidence: 0.5, brand: { seen: null, match: "unsure" }, product_type: yes("x"), size: { seen: null, match: "unsure" }, flavour: { seen: null, match: "n/a" }, marks: [], reason: "the label is not readable" };
    });
    const out = await runPhotoCheck(deps(api));
    expect(out.fronts).toBe(1);
    expect(api.posted).toHaveLength(4);                                            // three waiting founder pictures and the front photo
    expect(api.posted[0].params).toMatchObject({ model: MODEL, tool_choice: { type: "tool", name: "record_picture_check" } });
    expect(api.posted[0].params.messages[0].content[0].source).toMatchObject({ type: "base64", media_type: "image/jpeg" });
    expect(out.outcomes).toEqual({ approved: 1, rejected: 1, left: 1 });
    expect(out.failed).toEqual([{ sku: sku.p2, mode: "decide", reason: "the batch errored" }]);
    expect((await db.one(`select status, review_note from product_images where id = $1`, [img[sku.p1!]]))).toEqual({ status: "rejected", review_note: "automatic: rule photo-vision-1: shows Masafi, not Nejmeh" });
    expect((await db.one(`select status from product_images where id = $1`, [img[sku.p2!]])).status).toBe("proposed");          // an unusable answer changes nothing
    expect((await db.one(`select status, needs_review from product_images where media_path like 'labels/%'`))).toEqual({ status: "proposed", needs_review: true });
    expect(out.summary).toMatch(/Decided: \*\*1 approved automatically, 1 rejected with the reason, 1 left for a person\*\*/);
    expect(out.cost.lines[0]).toMatchObject({ model: MODEL, step: "batch_check", calls: 3 });
    // a second run: only what was never answered goes again (the errored one)
    const again = fakeApi(() => ({ verdict: "uncertain", confidence: 0.2, brand: { seen: null, match: "unsure" }, product_type: { seen: null, match: "unsure" }, size: { seen: null, match: "unsure" }, flavour: { seen: null, match: "unsure" }, marks: [], reason: "blurred" }));
    expect((await runPhotoCheck(deps(again))).queued).toBe(1);
  });
  it("re-checks the approved pictures without changing them, and lists the disagreements", async () => {
    const api = fakeApi((id) => (id.endsWith(img[sku.p3!]!)
      ? { verdict: "mismatch", confidence: 0.92, brand: yes("x"), product_type: yes("x"), size: { seen: "24-can tray", match: "no" }, flavour: { seen: null, match: "n/a" }, marks: [], reason: "24-can tray, product is one can" }
      : { verdict: "match", confidence: 0.97, brand: yes("x"), product_type: yes("x"), size: yes("x"), flavour: { seen: null, match: "n/a" }, marks: [], reason: "ok" }));
    const out = await runPhotoCheck(deps(api, { mode: "recheck" }));
    expect(out.recheck).toMatchObject({ checked: 2, agrees: 1, disagrees: 1 });
    expect(out.summary).toContain(`- ${sku.p3} `);
    expect((await db.one(`select status from product_images where id = $1`, [img[sku.p3!]])).status).toBe("approved");
  });
  it("the cap: at most USD 1, the worst case first; no price, no spend", async () => {
    expect(MAX_CAP_USD).toBe(1);
    await expect(runPhotoCheck(deps(fakeApi(() => "error"), { capUsd: 2 }))).rejects.toThrow(/at most USD 1/);
    await expect(runPhotoCheck(deps(fakeApi(() => "error"), { model: "no-such-model" }))).rejects.toThrow(/NO_PRICE/);
    const one = estimatePictureUsd(priceFor(prices, MODEL, new Date().toISOString().slice(0, 10)));
    expect(one).toBeLessThan(0.004);                                                 // 250 pictures fit well under USD 1
    await db.pg.exec(`update product_images set status = 'proposed', reviewed_by = null, reviewed_at = null where status = 'rejected'`);
    await db.pg.exec(`delete from product_image_checks`);
    const api = fakeApi(() => "error");
    const out = await runPhotoCheck(deps(api, { capUsd: one * 1.5, fronts: false }));
    expect(out.selected).toBe(1);
    expect(out.skipped.filter((x: any) => x.reason === "cap").length).toBe(out.queued - 1);
  });
});
