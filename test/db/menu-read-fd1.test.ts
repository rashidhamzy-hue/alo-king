// FD1: the menu reading run (.github/workflows/menu-read.yml, scripts/menus/): the Menus page's photos go through the Anthropic Batch API
// at half price with MODEL_FAST, capped at USD 2, recorded in model_costs (COST1); each reading goes through record_menu_reading as dish
// proposals that a person approves. Here: a scripted Batch API, the real migrations, no key, no network, USD 0. Written before the run.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";
// @ts-expect-error plain .mjs
import { runMenuRead, estimatePhotoUsd, MAX_CAP_USD } from "../../scripts/menus/batch.mjs";
// @ts-expect-error plain .mjs
import { normalisePrices, priceFor } from "../../scripts/lib/model-cost.mjs";
import { MenuReading, menuPrompt, menuTool } from "../../apps/console/src/menu-read";

let db: TestDb; let lead: string; let prices: unknown[]; let place: string; const photos: string[] = [];
const MODEL = "claude-haiku-5-5";
const USAGE = { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const PER_PHOTO = ((4000 * 0.10 + 1500 * 0.50) / 1e6) * 0.5;                        // haiku 5.5 list price, half price in a batch
const JPEG = new Uint8Array(readFileSync(new URL("../fixtures/menus/example-bakery.jpg", import.meta.url)));
const log = () => {};
const READING = { sections: [{ name_ar: "مناقيش", name_en: "Manakish", dishes: [
  { name_ar: "منقوشة زعتر", name_en: "Zaatar manousheh", translated: "en", price: 1.5, currency: "USD", price_text: "$1.5", sizes: [], options: [],
    addons: [{ name_ar: "خضرة", name_en: "Vegetables", price: 0.5, currency: "USD" }] },
  { name_ar: "لحم بعجين", name_en: "Lahm bi ajine", translated: "en", price: null, currency: "USD", price_text: "", sizes: [
    { name_ar: "صغير", name_en: "Small", price: 1, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 3, currency: "USD" }], options: [], addons: [] }] }] };

function fakeApi(answer: (customId: string) => Record<string, unknown> | "error" | "garbage") {
  const batches = new Map<string, { requests: any[]; polls: number }>();
  const calls: { method: string; url: string; headers: Record<string, string>; body?: any }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    const u = new URL(url);
    if (method === "POST" && u.pathname === "/v1/messages/batches") {
      const id = `msgbatch_${batches.size + 1}`; batches.set(id, { requests: body.requests, polls: 0 });
      return Response.json({ id, processing_status: "in_progress" });
    }
    const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      const b = batches.get(m[1]!)!;
      if (!m[2]) { b.polls++; return Response.json({ id: m[1], processing_status: b.polls >= 2 ? "ended" : "in_progress", results_url: `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` }); }
      const lines = b.requests.map((rq: any) => {
        const a = answer(rq.custom_id);
        if (a === "error") return { custom_id: rq.custom_id, result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "x" } } } };
        const input = a === "garbage" ? { sections: "none" } : a;
        return { custom_id: rq.custom_id, result: { type: "succeeded", message: { id: "m", model: MODEL, content: [{ type: "tool_use", id: "t", name: "record_menu", input }], usage: USAGE } } };
      });
      return new Response(lines.map((l) => JSON.stringify(l)).join("\n"));
    }
    return new Response("not found", { status: 404 });
  };
  return { f, calls, batches };
}
const deps = (api: ReturnType<typeof fakeApi>, extra: Record<string, unknown> = {}) => ({
  rpc: (fn: string, args: Record<string, unknown> = {}) => db.rpc(fn, args), download: async () => ({ bytes: JPEG, mime: "image/jpeg" }), fetch: api.f,
  prices, model: MODEL, apiKey: "test-key-not-real", capUsd: 2, runId: "test-run", sleep: async () => {}, log, ...extra,
});

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead FD1') returning id`)).id;
  prices = normalisePrices((await db.all(`select to_jsonb(m) as j from model_prices m`)).map((x) => x.j));
  const village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  place = (await db.rpc("create_place_from_listing", { p_listing: "safa-chicken-boqaata", p_by: lead, p_details: { village_id: village } })).source_id;
  for (const n of ["a", "b", "c"]) photos.push((await db.rpc("record_menu_photo", { p_source: place, p_media_path: `menus/${place}/2026-11-18/${n}.jpg`, p_by: lead })).photo_id);
}, 120_000);

describe("the reader's form", () => {
  it("asks for names, prices with their currency, sizes, options and add-ons, and never a food fact, a description or praise", () => {
    const schema = JSON.stringify(menuTool().input_schema);
    expect(schema).not.toMatch(/allergen|halal|vegan|vegetarian|calorie|descri(?!ption\b)|rating/i);
    // MENU2: the description printed under a dish is copied for the person checking; the reader still writes none of its own
    expect(menuPrompt()).toMatch(/Never write a description of your own, an ingredient list, an allergen, a diet, halal, sugar or spice fact, a health claim, a rating or praise/);
    expect(menuPrompt()).toMatch(/Never invent or estimate a price/);
    expect(MenuReading.safeParse(READING).success).toBe(true);
  });
});

describe("a run on three waiting photos: one read, one failed, one unreadable", () => {
  let out: any; let api: ReturnType<typeof fakeApi>;
  it("sends one half-price batch, records the reading as proposals, keeps the failures waiting, and counts the cost", async () => {
    api = fakeApi((id) => (id === photos[0] ? READING : id === photos[1] ? "error" : "garbage"));
    out = await runMenuRead(deps(api));
    expect(out).toMatchObject({ queued: 3, selected: 3, read: 1, dishes: 2, cap: 2 });
    expect(out.failed.map((x: any) => x.photo_id).sort()).toEqual([photos[1], photos[2]].sort());
    expect(api.batches.size).toBe(1);
    expect(out.usd).toBeCloseTo(2 * PER_PHOTO, 8);                                 // the errored request is not billed
    expect(out.cost.lines[0]).toMatchObject({ model: MODEL, step: "batch_read", calls: 2 });
    const rq = api.calls.find((c) => c.method === "POST")!.body.requests[0];
    expect(rq.params).toMatchObject({ model: MODEL, tool_choice: { type: "tool", name: "record_menu" } });
    expect(rq.params.messages[0].content[0].source).toMatchObject({ type: "base64", media_type: "image/jpeg" });
    const rows = await db.all(`select name_en, price::text, currency, status, photo_id from menu_dish_proposals where source_id = $1 order by position`, [place]);
    expect(rows).toEqual([{ name_en: "Zaatar manousheh", price: "1.5", currency: "USD", status: "waiting", photo_id: photos[0] },
                          // MENU2 (0260): a dish priced by its sizes keeps the menu's currency (FD1 left it empty), so it can be approved in one press
                          { name_en: "Lahm bi ajine", price: null, currency: "USD", status: "waiting", photo_id: photos[0] }]);
    const left = (await db.rpc("menu_reading_queue", { p_limit: 10 })).map((x: any) => x.photo_id).sort();
    expect(left).toEqual([photos[1], photos[2]].sort());
    expect((await db.one(`select failures, last_failure from menu_photos where id = $1`, [photos[2]]))).toMatchObject({ failures: 1, last_failure: expect.stringMatching(/unreadable/) });
    expect(out.summary).toMatch(/Photos read: 1 of 3 waiting; 2 dish\(es\) proposed/);
  });

  it("a sized dish with no base price is approved at its smallest size", async () => {
    const d = (await db.one(`select id from menu_dish_proposals where name_en = 'Lahm bi ajine'`)).id;
    const r = await db.rpc("review_menu_dish", { p_dish: d, p_by: lead, p_approve: true });
    expect((await db.one(`select price_usd::text as p from offers where product_id = $1`, [r.product_id])).p).toBe("1.00");
  });
});

describe("the cap", () => {
  it("is at most USD 2, and photos past the worst case wait for the next run", async () => {
    expect(MAX_CAP_USD).toBe(2);
    await expect(runMenuRead(deps(fakeApi(() => READING), { capUsd: 3 }))).rejects.toThrow(/at most USD 2/);
    const one = estimatePhotoUsd(priceFor(prices, MODEL, new Date().toISOString().slice(0, 10)));
    const api = fakeApi(() => READING);
    const out = await runMenuRead(deps(api, { capUsd: one * 1.5 }));
    expect(out.selected).toBe(1);
    expect(out.skipped).toEqual([{ photo_id: expect.any(String), reason: "cap" }]);
    expect(out.summary).toMatch(/The cap was reached/);
  });

  it("refuses to spend without a price for the model", async () => {
    await expect(runMenuRead(deps(fakeApi(() => READING), { model: "no-such-model" }))).rejects.toThrow(/NO_PRICE/);
  });
});

describe("the dry run", () => {
  it("reads the photos it is given and writes nothing to the database", async () => {
    const before = (await db.one(`select count(*)::int as n from menu_dish_proposals`)).n;
    const api = fakeApi(() => READING);
    const out = await runMenuRead(deps(api, { rpc: async () => { throw new Error("the dry run must not call the database"); },
      dryRunPhotos: [{ photo_id: "example-bakery", place: "example-bakery", media_path: "example-bakery.jpg", bytes: JPEG, mime: "image/jpeg" },
                     { photo_id: "example-grill-house", place: "example-grill-house", media_path: "example-grill-house.jpg", bytes: JPEG, mime: "image/jpeg" }] }));
    expect(out).toMatchObject({ queued: 2, read: 2, dishes: 4 });
    expect(out.cost.lines[0].step).toBe("dry_run");
    for (const q of api.calls.find((c) => c.method === "POST")!.body.requests) expect(q.custom_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);   // the API's own rule
    await expect(runMenuRead(deps(fakeApi(() => READING), { dryRunPhotos: [{ photo_id: "a.jpg", place: "x", media_path: "a.jpg", bytes: JPEG, mime: "image/jpeg" }] }))).rejects.toThrow(/Batch API refuses/);
    expect(out.summary).toMatch(/dry run: nothing written but the cost/);
    expect((await db.one(`select count(*)::int as n from menu_dish_proposals`)).n).toBe(before);
  });
});
