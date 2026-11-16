// LB1: the reading run (.github/workflows/label-read.yml, scripts/label/): the captured photos go through the Anthropic Batch API at half
// price with MODEL_FAST, capped at USD 5, recorded in model_costs (COST1); each reading goes through record_label_scan into the item's
// template fields; the rules approve what they may; allergens, halal, certificates, hazard and printed warnings wait for a person; a label
// reading replaces a web proposal for the same field. This is the dry run on five seed items with recorded test photos and readings:
// a scripted Batch API, the real migrations, no key, no network, USD 0.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";
// @ts-expect-error plain .mjs
import { runLabelRead, estimateItemUsd } from "../../scripts/label/batch.mjs";
// @ts-expect-error plain .mjs
import { normalisePrices } from "../../scripts/lib/model-cost.mjs";
import fixture from "../fixtures/label-read-lb1.json";

let db: TestDb; let lead: string; let prices: unknown[];
const MODEL = "claude-haiku-5-5";
const USAGE = { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const PER_ITEM = ((3000 * 0.10 + 600 * 0.50) / 1e6) * 0.5;                          // haiku 5.5 list price, half price in a batch
const items: Record<string, string> = {};
const path = (p: string, s: string) => `labels/${p}/2026-11-16/${s}.jpg`;
const jpeg = () => Uint8Array.from(Buffer.from(fixture.jpeg_1x1_base64, "base64"));
const log = () => {};

/** A scripted Batch API: records what it was sent; answers a batch with the fixture reading of each item (or what `answer` says). */
function fakeApi(answer: (customId: string) => Record<string, unknown> | "error" | "garbage") {
  const batches = new Map<string, { requests: any[]; polls: number }>();
  const calls: { method: string; url: string; headers: Record<string, string>; body?: any }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    const u = new URL(url);
    if (method === "POST" && u.pathname === "/v1/messages/batches") {
      const id = `msgbatch_${batches.size + 1}`; batches.set(id, { requests: body.requests, polls: 0 });
      return Response.json({ id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: body.requests.length } });
    }
    const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      const b = batches.get(m[1]!)!;
      if (!m[2]) { b.polls++; return Response.json({ id: m[1], processing_status: b.polls >= 2 ? "ended" : "in_progress", results_url: `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` }); }
      const lines = b.requests.map((rq: any) => {
        const a = answer(rq.custom_id);
        if (a === "error") return { custom_id: rq.custom_id, result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "x" } } } };
        const input = a === "garbage" ? { name_en: 5 } : a;
        return { custom_id: rq.custom_id, result: { type: "succeeded", message: { id: "m", model: MODEL, content: [{ type: "tool_use", id: "t", name: "record_label", input }], usage: USAGE } } };
      });
      return new Response(lines.map((l) => JSON.stringify(l)).join("\n"), { headers: { "content-type": "application/x-jsonl" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { f, calls, batches };
}

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead LB1') returning id`)).id;
  prices = normalisePrices((await db.all(`select to_jsonb(m) as j from model_prices m`)).map((x) => x.j));      // as PostgREST sends them: dates as text
  const pick = async (key: string, category: string, n: number) => { items[key] = (await db.one(`select id from products where is_active and category = $1 order by sku offset ${n} limit 1`, [category])).id; };
  await pick("packaged_food_1", "Snacks & Candy", 0); await pick("packaged_food_2", "Dairy & Eggs", 0); await pick("cleaning_household", "Cleaning & Household", 0);
  await pick("water", "Water", 0); await pick("beauty_personal_care", "Beauty & Personal Care", 0);
  for (const p of Object.values(items)) for (const s of ["front", "back"]) await db.rpc("record_label_capture", { p_product: p, p_shot: s, p_media_path: path(p, s), p_by: lead });
  // a web page said something else about the chips' milk, and the brand's page gave other directions: the label replaces both
  await db.rpc("propose_off_facts", { p_product: items.packaged_food_1, p_run: "r", p_facts: [{ attribute: "milk", value: "contains", detail: { source_text: "milk", quote: "milk", off_code: "1", fingerprint: "m" } }] });
  await db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'directions_as_printed', '"From the brand page"', 'brand_site')`, [items.packaged_food_1]);
}, 120_000);

const reading = (customId: string) => {
  const key = Object.entries(items).find(([, v]) => v === customId)![0];
  return (fixture.readings as Record<string, Record<string, unknown>>)[key]!;
};
const deps = (api: ReturnType<typeof fakeApi>, extra: Record<string, unknown> = {}) => ({
  rpc: (fn: string, args: Record<string, unknown> = {}) => db.rpc(fn, args), download: async () => ({ bytes: jpeg(), mime: "image/jpeg" }), fetch: api.f,
  prices, model: MODEL, apiKey: "test-key-not-real", capUsd: 5, runId: "dry-run", sleep: async () => {}, log, ...extra,
});

describe("the dry run: five seed items, recorded photos and readings", () => {
  let out: any; let api: ReturnType<typeof fakeApi>;
  it("reads all five in one batch, fills their template fields, and stays within its cap", async () => {
    api = fakeApi(reading);
    out = await runLabelRead(deps(api));
    expect(out.queued).toBe(5);
    expect(out.read).toBe(5);
    expect(out.failed).toEqual([]);
    expect(api.batches.size).toBe(1);
    expect(out.usd).toBeCloseTo(5 * PER_ITEM, 8);
    expect(out.usd).toBeLessThan(5);                                             // the cap
    expect(out.cap).toBe(5);
    // fields filled per template
    expect(Object.keys(out.fieldsByTemplate).sort()).toEqual(["beauty_personal_care", "cleaning_household", "packaged_food", "water"]);
    expect(out.fieldsByTemplate.packaged_food).toBeGreaterThan(8);
    expect(out.fieldsByTemplate.cleaning_household).toBeGreaterThanOrEqual(6);
    expect(out.fieldsByTemplate.water).toBe(3);                                  // volume, type and the ingredients line? ingredients dropped: water is food ... see below
  });
  it("sent half-price batch requests: the fast model, the label tool, the item's template, base64 photos in order, one id per item", async () => {
    const create = api.calls.find((c) => c.method === "POST")!;
    expect(create.url).toBe("https://api.anthropic.com/v1/messages/batches");
    expect(create.headers["x-api-key"]).toBe("test-key-not-real");
    expect(create.headers["anthropic-version"]).toBeTruthy();
    const rqs = create.body.requests as any[];
    expect(rqs.map((q) => q.custom_id).sort()).toEqual(Object.values(items).sort());
    for (const q of rqs) {
      expect(q.params.model).toBe(MODEL);
      expect(q.params.tool_choice).toEqual({ type: "tool", name: "record_label" });
      expect(q.params.tools[0].name).toBe("record_label");
      const imgs = q.params.messages[0].content.filter((b: any) => b.type === "image");
      expect(imgs).toHaveLength(2);
      expect(imgs[0].source).toMatchObject({ type: "base64", media_type: "image/jpeg", data: fixture.jpeg_1x1_base64 });
    }
    const text = (id: string) => rqs.find((q) => q.custom_id === id).params.messages[0].content.at(-1).text as string;
    expect(text(items.cleaning_household!)).toMatch(/cleaning_household/); expect(text(items.cleaning_household!)).toMatch(/not food/);
    expect(text(items.packaged_food_1!)).toMatch(/packaged_food/); expect(text(items.packaged_food_1!)).toMatch(/Read the food facts/);
  });
  it("recorded each reading through record_label_scan: the scans, the proposals, and a person is still needed for what matters", async () => {
    for (const p of Object.values(items)) expect(await db.one(`select read_by, model, scanned_by from label_scans where product_id = $1`, [p])).toEqual({ read_by: "model", model: MODEL, scanned_by: await db.rpc("label_reader_party") });
    // nothing was approved by the run, except what the rules may (none here: no second source agrees)
    const f = items.packaged_food_1!;
    expect((await db.all(`select attribute from product_facts where product_id = $1 and approved_at is null and superseded_at is null and attribute in ('milk', 'sesame', 'halal')`, [f])).map((x) => x.attribute).sort()).toEqual(["halal", "milk", "sesame"]);
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and approved_at is not null`, [f])).n).toBe(0);
    const c = items.cleaning_household!;
    expect(await db.all(`select field_key, status from product_field_values where product_id = $1 and field_key in ('hazard_warnings', 'warnings_as_printed', 'pictograms') order by field_key`, [c]))
      .toEqual([{ field_key: "hazard_warnings", status: "proposed" }, { field_key: "pictograms", status: "proposed" }, { field_key: "warnings_as_printed", status: "proposed" }]);
    expect((await db.one(`select count(*)::int as n from product_field_values where status = 'approved' and approved_by = $1`, [await db.rpc("auto_approval_party")])).n).toBe(0);
    expect(await db.all(`select claim_code, status from product_claims where product_id = $1`, [f])).toEqual([{ claim_code: "no_added_sugar", status: "proposed" }]);
    // the fast model's reading of a water item: its volume and type, as printed
    expect(await db.all(`select field_key, value from product_field_values where product_id = $1 order by field_key`, [items.water])).toEqual(expect.arrayContaining([{ field_key: "volume_ml", value: 1500 }, { field_key: "water_type", value: "mineral" }]));
  });
  it("label beats web: the page's milk and the brand's directions were set aside, and the disagreement is kept for the person", async () => {
    const f = items.packaged_food_1!;
    expect(await db.all(`select source, status from product_field_values where product_id = $1 and field_key = 'directions_as_printed' order by source`, [f]))
      .toEqual([{ source: "brand_site", status: "superseded" }, { source: "label_photo", status: "proposed" }]);
    const milk = (await db.one(`select detail from product_facts where product_id = $1 and attribute = 'milk' and source = 'label' and superseded_at is null`, [f])).detail;
    expect(milk.disagrees_with).toEqual([expect.objectContaining({ source: "open_food_facts", value: "contains" })]);
    expect(out.settled.facts_set_aside).toBe(1); expect(out.settled.fields_set_aside).toBe(1);
  });
  it("the items leave the reading queue, and the person's queue has them in the sitting's order", async () => {
    expect(await db.rpc("label_reading_queue")).toEqual(expect.not.arrayContaining([expect.objectContaining({ product_id: items.packaged_food_1 })]));
    const q = (await db.rpc("approval_queue")) as { group: number; label: string }[];
    expect(q.map((x) => x.group)).toEqual([...q.map((x) => x.group)].sort((a, b) => a - b));
    expect(q.some((x) => x.group === 1 && x.label === "sesame")).toBe(true);
    expect(q.some((x) => x.group === 3 && x.label === "hazard_warnings")).toBe(true);
  });
  it("cost: one line in the shape model_costs takes, at half price, recorded", async () => {
    expect(out.cost.lines).toEqual([expect.objectContaining({ model: MODEL, step: "batch_read", calls: 5, input_tokens: 15000, output_tokens: 3000 })]);
    expect(out.cost.lines[0].usd).toBeCloseTo(5 * PER_ITEM, 6);
    expect(out.cost).toMatchObject({ workflow: "label-read", run_id: "dry-run", cap_usd: 5, stopped_at_cap: false });
    await db.rpc("record_model_cost", { p_workflow: out.cost.workflow, p_run_id: out.cost.run_id, p_cap_usd: out.cost.cap_usd, p_stopped: false, p_lines: out.cost.lines });
    expect((await db.one(`select sum(usd)::float as usd from model_costs where workflow = 'label-read'`)).usd).toBeCloseTo(5 * PER_ITEM, 6);
  });
  it("the summary: items read, fields filled per template, and every item not yet fact-complete with the reason", () => {
    expect(out.summary).toContain("Items read: 5");
    expect(out.summary).toMatch(/packaged_food \| \d+/);
    expect(out.summary).toMatch(/Not yet fact-complete/);
    expect(out.report.not_fact_complete.find((x: any) => x.sku && x.reason_code === "waiting_for_a_person")).toBeTruthy();
    expect(out.summary).toMatch(/waiting_for_a_person/);
    expect(out.summary).toMatch(/not_photographed/);
    expect(out.readings).toHaveLength(5);                                       // the readings, for the artifact
  });
});

describe("the cap, the failures and the batches", () => {
  const reset = async () => { await db.pg.query(`delete from label_scans`); };
  it("never selects more items than its cap allows at the worst case, and says which it left", async () => {
    await reset();
    const worst = estimateItemUsd(prices.find((p: any) => p.model === MODEL), 2);
    expect(worst).toBeGreaterThan(PER_ITEM);                                      // the estimate is an upper bound
    const api = fakeApi(reading);
    const out = await runLabelRead(deps(api, { capUsd: worst * 2.5, runId: "cap" }));
    expect(out.read).toBe(2);
    expect(out.skipped.filter((s: any) => s.reason === "cap")).toHaveLength(3);
    expect(out.cost.stopped_at_cap).toBe(true);
    expect(api.batches.get("msgbatch_1")!.requests).toHaveLength(2);
    expect(out.usd).toBeLessThanOrEqual(worst * 2.5);
    expect(out.summary).toMatch(/cap/i);
  });
  it("a cap above USD 5 is refused", async () => {
    await expect(runLabelRead(deps(fakeApi(reading), { capUsd: 5.01 }))).rejects.toThrow(/at most USD 5/);
    await expect(runLabelRead(deps(fakeApi(reading), { capUsd: 0 }))).rejects.toThrow(/cap/);
  });
  it("an errored or unreadable result leaves the item waiting, is counted at its cost, and is reported", async () => {
    await reset();
    const bad = items.water!, junk = items.beauty_personal_care!;
    const api = fakeApi((id) => (id === bad ? "error" : id === junk ? "garbage" : reading(id)));
    const out = await runLabelRead(deps(api, { runId: "bad" }));
    expect(out.read).toBe(3);
    expect(out.failed.map((x: any) => x.product_id).sort()).toEqual([bad, junk].sort());
    expect(out.failed.find((x: any) => x.product_id === bad).reason).toMatch(/errored/);
    expect(out.failed.find((x: any) => x.product_id === junk).reason).toMatch(/unreadable/);
    const q = (await db.rpc("label_reading_queue")).map((x: any) => x.product_id);
    expect(q).toEqual(expect.arrayContaining([bad, junk]));
    expect(out.report.not_fact_complete.find((x: any) => x.reason_code === "reading_failed")).toBeTruthy();
  });
  it("a photo that cannot be fetched skips that item, says so, and the rest go on; a photo over 5 MB is skipped too", async () => {
    await reset();
    const api = fakeApi(reading);
    const out = await runLabelRead(deps(api, { runId: "dl", download: async (p: string) => {
      if (p.includes(items.water!)) throw new Error("storage_404");
      if (p.includes(items.cleaning_household!)) return { bytes: new Uint8Array(5 * 1024 * 1024 + 1), mime: "image/jpeg" };
      return { bytes: jpeg(), mime: "image/jpeg" };
    } }));
    expect(out.read).toBe(3);
    expect(out.skipped.map((s: any) => s.reason).sort()).toEqual(["photo_too_large", "photo_unavailable"]);
  });
  it("splits into several batches when the photos are large, and can pick up a batch already made (resume)", async () => {
    await reset();
    const api = fakeApi(reading);
    const out = await runLabelRead(deps(api, { runId: "split", maxBatchBytes: 700 }));
    expect(api.batches.size).toBeGreaterThan(1);
    expect(out.read).toBe(5);
    // resume: nothing new is created, the results of the batches named are read and recorded
    await reset();
    const before = api.batches.size;
    const again = await runLabelRead(deps(api, { runId: "resume", resumeBatchIds: ["msgbatch_1"] }));
    expect(api.batches.size).toBe(before);
    expect(again.read).toBe(api.batches.get("msgbatch_1")!.requests.length);
  });
  it("the key is sent only to the API, and no photo or reading is written to the log", async () => {
    await reset();
    const lines: string[] = [];
    const api = fakeApi(reading);
    await runLabelRead(deps(api, { runId: "log", log: (s: string) => lines.push(s) }));
    const text = lines.join("\n");
    expect(text).not.toContain("test-key-not-real");
    expect(text).not.toContain(fixture.jpeg_1x1_base64);
    expect(text).not.toContain("Potatoes, sunflower oil");
    expect(api.calls.every((c) => new URL(c.url).hostname === "api.anthropic.com")).toBe(true);
  });
});

describe("the workflow's promises, read from the file", () => {
  const wf = readFileSync(new URL("../../.github/workflows/label-read.yml", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("runs by hand only, from main, with contents: read, and its own tests first", () => {
    expect(wf).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(wf).toContain("permissions: { contents: read }");
    expect(wf).toMatch(/refs\/heads\/main/);
    expect(wf.indexOf("label-read-lb1.test.ts")).toBeLessThan(wf.indexOf("scripts/label/read.mjs"));
  });
  it("caps the run at USD 5 and never prints a key", () => {
    expect(wf).toContain("MAX_USD: ${{ inputs.max_usd }}");
    expect(wf).toMatch(/max_usd:[\s\S]*?default: "5"/);
    expect(wf).not.toMatch(/echo[^\n]*(SERVICE_KEY|API_KEY)/);
    expect(wf).not.toMatch(/set -x/);
    const cli = readFileSync(new URL("../../scripts/label/read.mjs", import.meta.url), "utf8");
    expect(cli).toMatch(/Math\.min\(MAX_CAP_USD/);
  });
});
