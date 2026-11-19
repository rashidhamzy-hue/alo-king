// Session AUTO1: the menu reading run's second reading and the place's details, against a scripted Batch API (no key, no network, USD 0).
//   - a photo and a PDF are read twice in ONE batch: the menu, then prices only (no sight of the first); the database compares them
//   - a text page is read once (its prices are checked against its own text)
//   - the rule then approves the photo's dish whose price both readings agree on, and leaves the one they disagree on (a mismatch)
//   - the hours and phone printed on the menu are proposed for a person, in E.164; a dry run reads once and writes nothing
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";
// @ts-expect-error plain .mjs
import { runMenuRead, secondId, pageCustomId } from "../../scripts/menus/batch.mjs";
// @ts-expect-error plain .mjs
import { normalisePrices } from "../../scripts/lib/model-cost.mjs";
import { lebanesePhone, priceTool } from "../../apps/console/src/menu-read";

const MODEL = "claude-haiku-5-5";
const USAGE = { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const JPEG = new Uint8Array(readFileSync(new URL("../fixtures/menus/example-bakery.jpg", import.meta.url)));
const PDF = new Uint8Array(readFileSync(new URL("../fixtures/menus/files/example-menu.pdf", import.meta.url)));
let db: TestDb; let lead: string; let place: string; let photo: string; let pdfPage: string; let textPage: string; let prices: unknown[];

function fakeApi(answer: (customId: string, tool: string) => Record<string, unknown>) {
  const batches = new Map<string, any[]>(); const posted: any[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(String(init.body)) : undefined; const u = new URL(url);
    if (method === "POST" && u.pathname === "/v1/messages/batches") { const id = `msgbatch_${batches.size + 1}`; batches.set(id, body.requests); posted.push(...body.requests); return Response.json({ id, processing_status: "in_progress" }); }
    const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      if (!m[2]) return Response.json({ id: m[1], processing_status: "ended" });
      return new Response(batches.get(m[1]!)!.map((rq: any) => JSON.stringify({ custom_id: rq.custom_id, result: { type: "succeeded", message: {
        content: [{ type: "tool_use", name: rq.params.tool_choice.name, input: answer(rq.custom_id, rq.params.tool_choice.name) }], usage: USAGE, stop_reason: "tool_use" } } })).join("\n"));
    }
    return new Response("not found", { status: 404 });
  };
  return { f, posted };
}
const dish = (name_ar: string, name_en: string, price: number) => ({ name_ar, name_en, translated: null, price, currency: "USD", price_text: `${price}$`, sizes: [], options: [], addons: [] });

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead AUTO1 reading') returning id`)).id;
  prices = normalisePrices((await db.all(`select to_jsonb(m) as j from model_prices m`)).map((x) => x.j));
  const village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  place = (await db.rpc("create_place_from_listing", { p_listing: "safa-chicken-boqaata", p_by: lead, p_details: { village_id: village } })).source_id;
  photo = (await db.rpc("record_menu_photo", { p_source: place, p_media_path: `menus/${place}/2026-11-19/a.jpg`, p_by: lead })).photo_id;
  const pdf = await db.rpc("add_menu_source", { p_place: place, p_kind: "pdf", p_by: lead, p_detail: { media_path: `menus/${place}/src/2026-11-19/m.pdf`, file_name: "m.pdf" } });
  pdfPage = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [pdf.menu_source_id])).id;
  const txt = await db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { body: "Desserts\nKnefeh\n3\n$\nMouhalabieh\n2\n$" } });
  textPage = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [txt.menu_source_id])).id;
}, 120_000);

describe("the second reading and the place's details", () => {
  it("the photo and the PDF are read twice in one batch, the text once; the rule approves what both readings agree on", async () => {
    const api = fakeApi((id, tool) => {
      if (tool === "record_prices") {
        if (id === secondId(photo)) return { items: [{ name_ar: "فتوش", name_en: "Fattoush", prices: [4] }, { name_ar: "حمص", name_en: "Hummus", prices: [3.5] }] };
        return { items: [{ name_ar: "صحن كباب", name_en: "Kebab plate", prices: [9] }] };
      }
      if (id === photo) return { place: { hours_text: "كل يوم من 10 صباحاً حتى 11 ليلاً", open: "10:00", close: "23:00", days_off: [], phone_text: "70 000 265" },
                                 sections: [{ name_ar: "مقبلات", name_en: "Starters", dishes: [dish("فتوش", "Fattoush", 4), dish("حمص", "Hummus", 3)] }] };
      if (id === pageCustomId(pdfPage)) return { place: null, sections: [{ name_ar: "مشاوي", name_en: "Grills", dishes: [dish("صحن كباب", "Kebab plate", 9)] }] };
      return { sections: [{ name_ar: "حلويات", name_en: "Desserts", dishes: [dish("كنافة", "Knefeh", 3), dish("مهلبية", "Mouhalabieh", 2)] }] };
    });
    const out = await runMenuRead({ rpc: (fn: string, a: Record<string, unknown> = {}) => db.rpc(fn, a), fetch: api.f, prices, model: MODEL, apiKey: "test-key-not-real",
      capUsd: 2, runId: "auto1-test", sleep: async () => {}, log: () => {}, secondReading: true,
      download: async (p: string) => (p.endsWith(".pdf") ? { bytes: PDF, mime: "application/pdf" } : { bytes: JPEG, mime: "image/jpeg" }) });
    expect(api.posted.map((r) => r.custom_id).sort()).toEqual([photo, secondId(photo), pageCustomId(pdfPage), secondId(pageCustomId(pdfPage)), pageCustomId(textPage)].sort());
    const pc = api.posted.find((r) => r.custom_id === secondId(photo));
    expect(pc.params.tool_choice.name).toBe("record_prices");
    expect(JSON.stringify(pc.params.messages)).not.toMatch(/Fattoush|فتوش/);                // the second reading never sees the first
    expect(out.secondChecks).toEqual({ same: 2, mismatch: 1, not_found: 0 });
    expect(out.cost.lines[0].calls).toBe(5);
    expect(out.summary).toMatch(/Second readings \(prices only, for the rule\): 2 dish\(es\) the same, 1 different/);
    const r = await db.rpc("automation_run_dishes", {});
    expect(r).toMatchObject({ approved: 4, left_for_a_person: 1 });                         // Fattoush, Kebab plate, Knefeh, Mouhalabieh
    expect((await db.one(`select status, price_check from menu_dish_proposals where name_en = 'Hummus'`))).toEqual({ status: "waiting", price_check: "mismatch" });
    // the hours and phone printed on the photo: proposed, not applied
    const w = await db.rpc("place_detail_waiting", { p_place: place });
    expect(w).toEqual([expect.objectContaining({ hours: { open: "10:00", close: "23:00", days_off: [] }, phone: "+96170000265", phone_text: "70 000 265" })]);
    expect((await db.one(`select phone_e164 from place_contacts where source_id = $1`, [place]))?.phone_e164 ?? null).not.toBe("+96170000265");
  });

  it("a phone as printed on a Lebanese menu, in E.164; anything else is not a phone", () => {
    expect(lebanesePhone("03 000 265")).toBe("+9613000265");
    expect(lebanesePhone("70-000-265")).toBe("+96170000265");
    expect(lebanesePhone("+961 70 000 265")).toBe("+96170000265");
    expect(lebanesePhone("٧٠ ٠٠٠ ٢٦٥")).toBe("+96170000265");
    expect(lebanesePhone("05 000265")).toBe("+9615000265");
    for (const x of ["", null, "1234", "www.example.com", "12 34"]) expect(lebanesePhone(x as any)).toBeNull();
  });

  it("the second reader's form asks for names and prices only", () => {
    const s = JSON.stringify(priceTool().input_schema);
    expect(Object.keys((priceTool().input_schema as any).properties.items.items.properties).sort()).toEqual(["name_ar", "name_en", "prices"]);
    expect(s).not.toMatch(/allergen|halal|vegan|rating/i);
  });
});
