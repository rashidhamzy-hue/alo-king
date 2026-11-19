// Session MENU2 (menus from any source), migrations 0259 and 0260, on the real migrations. docs/DECISIONS.md, "MENU2, 19 November 2026".
//   1 sources       a PDF, a link, pasted text, a Word file, an Excel or CSV file added for one place (several for one place); who may add
//   2 files         the saved fixtures (test/fixtures/menus/files/): a .docx, an .xlsx, a .csv, pasted text and a PDF, taken out to text
//   3 fetch         links and files into source pages (screenshots stored privately), failures counted
//   4 reading       photos and pages in one batch under the one cap: text, the PDF itself, a screenshot when there is no text
//   5 proposals     description as printed, flags, "price to confirm" (a range, no price, a size with no price, the reader's doubt)
//   6 approval      clean rows approved by section (each recorded per dish), flagged rows one by one with the price typed
//   7 re-import     only what changed: new, price changed, removed; unchanged kept out of the queue
//   8 invariants    nothing written to orders, payments, stock or the ledger; no place opened
// A scripted Batch API, no key, no network, USD 0. Invented places, dishes and numbers only.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb, type TestDb } from "./harness";
// @ts-expect-error plain .mjs
import { runMenuRead, estimateTextUsd, pageCustomId } from "../../scripts/menus/batch.mjs";
// @ts-expect-error plain .mjs
import { runMenuFetch } from "../../scripts/menus/fetch.mjs";
// @ts-expect-error plain .mjs
import { docxText, xlsxSheets, csvText, filePages, fileKind, split, unzip, pdfPages } from "../../scripts/menus/extract.mjs";
// @ts-expect-error plain .mjs
import { normalisePrices, priceFor } from "../../scripts/lib/model-cost.mjs";
import { MenuReading } from "../../apps/console/src/menu-read";

const FIX = (f: string) => new Uint8Array(readFileSync(new URL(`../fixtures/menus/files/${f}`, import.meta.url)));
const MODEL = "claude-haiku-5-5";
const USAGE = { input_tokens: 3000, output_tokens: 1200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let db: TestDb; let lead: string; let admin: string; let picker: string; let reader: string; let prices: unknown[]; let place: string; let place2: string;
const fails = async (p: Promise<unknown>, code: RegExp) => { await expect(p).rejects.toThrow(code); };

function fakeApi(answer: (customId: string, rq: any) => Record<string, unknown> | "error") {
  const batches = new Map<string, { requests: any[]; polls: number }>();
  const calls: { method: string; url: string; body?: any }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const u = new URL(url);
    if (method === "POST" && u.pathname === "/v1/messages/batches") { const id = `msgbatch_${batches.size + 1}`; batches.set(id, { requests: body.requests, polls: 0 }); return Response.json({ id, processing_status: "in_progress" }); }
    const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      const b = batches.get(m[1]!)!;
      if (!m[2]) { b.polls++; return Response.json({ id: m[1], processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` }); }
      return new Response(b.requests.map((rq: any) => {
        const a = answer(rq.custom_id, rq);
        if (a === "error") return JSON.stringify({ custom_id: rq.custom_id, result: { type: "errored" } });
        return JSON.stringify({ custom_id: rq.custom_id, result: { type: "succeeded", message: { content: [{ type: "tool_use", name: "record_menu", input: a }], usage: USAGE, stop_reason: "tool_use" } } });
      }).join("\n"));
    }
    return new Response("not found", { status: 404 });
  };
  return { f, calls, batches };
}
const files = new Map<string, Uint8Array>();
const deps = (api: ReturnType<typeof fakeApi>, extra: Record<string, unknown> = {}) => ({
  rpc: (fn: string, args: Record<string, unknown> = {}) => db.rpc(fn, args),
  download: async (p: string) => { const b = files.get(p); if (!b) throw new Error("storage_404"); return { bytes: b, mime: p.endsWith(".pdf") ? "application/pdf" : "image/jpeg" }; },
  fetch: api.f, prices, model: MODEL, apiKey: "test-key-not-real", capUsd: 2, runId: "menu2-test", sleep: async () => {}, log: () => {}, ...extra,
});
const dish = (name_ar: string | null, name_en: string | null, price: number | null, more: Record<string, unknown> = {}) =>
  ({ name_ar, name_en, translated: null, price, currency: "USD", price_text: price === null ? "" : `${price}$`, sizes: [], options: [], addons: [], ...more });
const reading = (sections: [string, string, any[]][]) => ({ sections: sections.map(([ar, en, dishes]) => ({ name_ar: ar, name_en: en, dishes })) });

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead MENU2') returning id`)).id;
  admin = (await db.one(`insert into parties(role, display_name) values ('admin', 'Admin MENU2') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker MENU2') returning id`)).id;
  reader = await db.rpc("menu_reader_party", {});
  prices = normalisePrices((await db.all(`select to_jsonb(m) as j from model_prices m`)).map((x) => x.j));
  const village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  place = (await db.rpc("create_place_from_listing", { p_listing: "safa-chicken-boqaata", p_by: lead, p_details: { village_id: village } })).source_id;
  const other = (await db.one(`select listing_id from listings where hidden_at is null and listing_id <> 'safa-chicken-boqaata' order by listing_id limit 1`)).listing_id;
  place2 = (await db.rpc("create_place_from_listing", { p_listing: other, p_by: lead, p_details: { village_id: village } })).source_id;
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
}, 120_000);

describe("1 sources: every kind, several for one place", () => {
  it("staff add a PDF, a link, pasted text, a Word file and a sheet; the reading party may add a link only; a picker nothing", async () => {
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "link", p_by: picker, p_detail: { url: "https://menus.example/p/x" } }), /NOT_AUTHORISED/);
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: reader, p_detail: { body: "Hummus 3$ and more" } }), /NOT_AUTHORISED/);
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "photo", p_by: lead, p_detail: {} }), /MENU_SOURCE_KIND/);
    for (const bad of ["ftp://menus.example/x", "https://localhost/menu", "https://user:pw@menus.example/x", "http://192.168.1.4/menu", "https://10.0.0.1/x", "menus.example/x", "javascript:alert(1)"]) {
      await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "link", p_by: lead, p_detail: { url: bad } }), /MENU_LINK_INVALID/);
    }
    const link = await db.rpc("add_menu_source", { p_place: place, p_kind: "link", p_by: reader, p_detail: { url: "https://menus.example/p/example-grill", full_menu: true } });
    expect(link).toMatchObject({ ok: true, already: false });
    expect(await db.rpc("add_menu_source", { p_place: place, p_kind: "link", p_by: lead, p_detail: { url: "https://menus.example/p/example-grill" } })).toMatchObject({ already: true, menu_source_id: link.menu_source_id });
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { body: "short" } }), /MENU_TEXT_SHORT/);
    const txt = await db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { body: new TextDecoder().decode(FIX("example-menu-pasted.txt")) } });
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "docx", p_by: lead, p_detail: { media_path: `menus/${place2}/src/x.docx` } }), /MENU_PATH/);
    await fails(db.rpc("add_menu_source", { p_place: place, p_kind: "pdf", p_by: lead, p_detail: { media_path: `menus/${place}/../x.pdf` } }), /MENU_PATH/);
    const pdf = await db.rpc("add_menu_source", { p_place: place, p_kind: "pdf", p_by: lead, p_detail: { media_path: `menus/${place}/src/2026-11-19/a.pdf`, file_name: "example-menu.pdf" } });
    const docx = await db.rpc("add_menu_source", { p_place: place, p_kind: "docx", p_by: admin, p_detail: { media_path: `menus/${place}/src/2026-11-19/b.docx`, file_name: "example-menu.docx" } });
    const xlsx = await db.rpc("add_menu_source", { p_place: place, p_kind: "sheet", p_by: lead, p_detail: { media_path: `menus/${place}/src/2026-11-19/c.xlsx`, file_name: "example-menu.xlsx" } });
    const csv = await db.rpc("add_menu_source", { p_place: place, p_kind: "sheet", p_by: lead, p_detail: { media_path: `menus/${place}/src/2026-11-19/d.csv`, file_name: "example-menu.csv" } });
    expect(new Set([link, txt, pdf, docx, xlsx, csv].map((x) => x.menu_source_id)).size).toBe(6);
    // pasted text and the PDF need no fetch: their page waits for the reading at once; links and files wait for the fetch
    const pages = await db.all(`select m.kind, p.title, p.doc_path is not null as doc, p.status from menu_source_pages p join menu_sources m on m.id = p.menu_source_id where p.source_id = $1 order by m.added_at`, [place]);
    expect(pages).toEqual([{ kind: "text", title: "Pasted text", doc: false, status: "waiting" }, { kind: "pdf", title: "example-menu.pdf", doc: true, status: "waiting" }]);
    expect((await db.rpc("menu_fetch_queue", {})).map((x: any) => x.kind)).toEqual(["link", "docx", "sheet", "sheet"]);
    expect((await db.all(`select action from place_log where source_id = $1 and action = 'menu_source'`, [place])).length).toBe(6);
    files.set(`menus/${place}/src/2026-11-19/a.pdf`, FIX("example-menu.pdf"));
    files.set(`menus/${place}/src/2026-11-19/b.docx`, FIX("example-menu.docx"));
    files.set(`menus/${place}/src/2026-11-19/c.xlsx`, FIX("example-menu.xlsx"));
    files.set(`menus/${place}/src/2026-11-19/d.csv`, FIX("example-menu.csv"));
  });

  it("no client role reads the sources or their pages", async () => {
    const grants = await db.all(`select grantee, table_name from information_schema.role_table_grants where table_name in ('menu_sources', 'menu_source_pages') and grantee in ('anon', 'authenticated', 'web_channel')`);
    expect(grants).toEqual([]);
  });
});

describe("2 the saved files, taken out to text", () => {
  it("a Word file: paragraphs, and each table row on one line", () => {
    const t = docxText(FIX("example-menu.docx"));
    expect(t).toContain("Grills / مشاوي");
    expect(t).toContain("شيش طاووق | Shish taouk plate | $8");
    expect(t).toContain("مشاوي مشكلة | Mixed grill | $12 / $20 (half / whole)");
    expect(t).toContain("ساندويش طاووق صغير 3");
    expect(t).toContain("Burger with cheese, lettuce and tom");
  });
  it("an Excel file: one page per sheet, cells joined, numbers as typed", () => {
    const s = xlsxSheets(FIX("example-menu.xlsx"));
    expect(s.map((x: any) => x.name)).toEqual(["Food", "Drinks"]);
    expect(s[0].text).toContain("Manakish / مناقيش | منقوشة زعتر | Zaatar manousheh | 1.5 | USD");
    expect(s[0].text).toContain("لحم بعجين | Lahm bi ajine | small 1 / large 3 | USD");
    expect(s[1].text).toContain("Ayran / عيران | 1");
    expect(filePages("sheet", "example-menu.xlsx", FIX("example-menu.xlsx")).map((p: any) => p.title)).toEqual(["example-menu.xlsx: Food", "example-menu.xlsx: Drinks"]);
  });
  it("a CSV file: quotes and commas inside a cell; Windows Arabic when it is not UTF-8", () => {
    const t = csvText(FIX("example-menu.csv"));
    expect(t).toContain('Salads / سلطات | "Greek" salad, house dressing | 5');
    expect(t).toContain("Dips / صلصات | Garlic / ثوم | 450,000 L.L.");
    const cp1256 = new Uint8Array([0xcd, 0xe3, 0xd5, 0x2c, 0x33]);              // «حمص,3» in Windows-1256
    expect(csvText(cp1256)).toBe("حمص | 3");
    expect(csvText(new TextEncoder().encode("name;price\nFattoush;4\n"))).toBe("name | price\nFattoush | 4");
  });
  it("a PDF is read as itself (its page count bounds the cost); a long text is cut at line ends", () => {
    expect(pdfPages(FIX("example-menu.pdf"))).toBe(1);
    const long = Array.from({ length: 400 }, (_, i) => `Dish ${i} ............ ${i}$`).join("\n");
    const parts = split(long, 2000);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p: string) => p.length <= 2000 && !p.startsWith("\n"))).toBe(true);
    expect(parts.join("\n")).toBe(long);
  });
  it("the kind of a file by its type or its name; anything else is refused; a file that is not a zip says so", () => {
    expect(fileKind("menu.PDF", "")).toBe("pdf"); expect(fileKind("m.docx", "")).toBe("docx"); expect(fileKind("m.xlsx", "")).toBe("sheet");
    expect(fileKind("m.csv", "text/csv")).toBe("sheet"); expect(fileKind("p.jpg", "image/jpeg")).toBe("photo"); expect(fileKind("m.doc", "application/msword")).toBe(null);
    expect(() => unzip(new TextEncoder().encode("not a zip at all, just some text to read"))).toThrow(/not_a_zip/);
  });
});

describe("3 fetch: links with a browser, files from the private bucket", () => {
  it("each page is kept with its text and a private screenshot; Word and sheet files become pages; nothing is read yet", async () => {
    const uploads: string[] = []; const crawled: string[] = [];
    const crawl = async (url: string) => {
      crawled.push(url);
      return { opened: [url, `${url}/s1`, `${url}/s2`], refused: [{ url: `${url}/private`, reason: "robots" }], pages: [
        { position: 0, url, title: "Start page", body: "SANDWICHES / سندويشات\nGRILLS / مشاوي", shot: new Uint8Array([1, 2, 3]), skip_reason: "the start page lists the sections; each is read on its own page" },
        { position: 1, url: `${url}/s1`, title: "SANDWICHES / سندويشات", body: "# SANDWICHES / سندويشات\nساندويش طاووق صغير\n3$\nساندويش طاووق كبير\n4.5$", shot: new Uint8Array([4, 5, 6]), skip_reason: null },
        { position: 2, url: `${url}/s2`, title: "OFFERS / عروضات", body: "# OFFERS / عروضات", shot: new Uint8Array([7, 8]), skip_reason: "the page shows no item or price" }] };
    };
    const out = await runMenuFetch({ rpc: (fn: string, a: any) => db.rpc(fn, a), download: async (p: string) => ({ bytes: files.get(p)! }), upload: async (p: string) => { uploads.push(p); }, crawl, day: "2026-11-19" });
    expect(out.queued).toBe(4); expect(out.failed).toEqual([]);
    expect(crawled).toEqual(["https://menus.example/p/example-grill"]);
    expect(uploads.length).toBe(3);
    for (const u of uploads) expect(u).toMatch(new RegExp(`^menus/${place}/pages/2026-11-19/[0-9a-f]{32}\\.jpg$`));
    const pages = await db.all(`select m.kind, p.title, p.status, p.shot_path is not null as shot from menu_source_pages p join menu_sources m on m.id = p.menu_source_id
                                 where p.source_id = $1 and m.kind in ('link', 'docx', 'sheet') order by m.added_at, p.position`, [place]);
    expect(pages).toEqual([
      { kind: "link", title: "Start page", status: "skipped", shot: true }, { kind: "link", title: "SANDWICHES / سندويشات", status: "waiting", shot: true },
      { kind: "link", title: "OFFERS / عروضات", status: "skipped", shot: true },
      { kind: "docx", title: "example-menu.docx", status: "waiting", shot: false },
      { kind: "sheet", title: "example-menu.xlsx: Food", status: "waiting", shot: false }, { kind: "sheet", title: "example-menu.xlsx: Drinks", status: "waiting", shot: false },
      { kind: "sheet", title: "example-menu.csv", status: "waiting", shot: false }]);
    expect(await db.rpc("menu_fetch_queue", {})).toEqual([]);
    expect(out.summary).toMatch(/Menu sources fetched: 4 of 4/);
  });

  it("a fetch that fails is recorded with its reason; the third failure marks the source failed; a screenshot elsewhere is refused", async () => {
    const s = await db.rpc("add_menu_source", { p_place: place2, p_kind: "link", p_by: lead, p_detail: { url: "https://menus.example/p/gone" } });
    const crawl = async () => { throw new Error("robots_disallow: the site's robots.txt does not allow this page"); };
    for (let i = 0; i < 3; i++) await runMenuFetch({ rpc: (fn: string, a: any) => db.rpc(fn, a), download: async () => ({ bytes: new Uint8Array() }), upload: async () => {}, crawl });
    expect(await db.one(`select status, failures, last_failure from menu_sources where id = $1`, [s.menu_source_id])).toMatchObject({ status: "failed", failures: 3, last_failure: expect.stringMatching(/robots_disallow/) });
    const t = await db.rpc("add_menu_source", { p_place: place2, p_kind: "link", p_by: lead, p_detail: { url: "https://menus.example/p/other" } });
    await fails(db.rpc("record_menu_source_pages", { p_menu_source: t.menu_source_id, p_by: reader, p_pages: [{ position: 0, body: "x 1$", shot_path: `menus/${place}/pages/a.jpg` }] }), /MENU_PATH/);
    await fails(db.rpc("record_menu_source_pages", { p_menu_source: t.menu_source_id, p_by: picker, p_pages: [{ position: 0, body: "x 1$" }] }), /NOT_AUTHORISED/);
  });
});

const PAGE_READINGS: Record<string, any> = {
  "SANDWICHES / سندويشات": reading([["سندويشات", "Sandwiches", [
    dish("ساندويش طاووق", "Taouk sandwich", null, { price_text: "3$ / 4.5$", source_text: "ساندويش طاووق صغير 3$ | ساندويش طاووق كبير 4.5$",
      sizes: [{ name_ar: "صغير", name_en: "Small", price: 3, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 4.5, currency: "USD" }] })]]]),
  "Pasted text": reading([["المقبلات", "Starters", [
    dish("حمص", "Hummus", 3, { source_text: "حمص ............ 3$" }),
    dish("متبل", "Moutabal", 3.5, { source_text: "متبل ............ 3.5$" }),
    dish("بطاطا مقلية", "Fries", null, { sizes: [{ name_ar: "صغير", name_en: "Small", price: 2, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 3.5, currency: "USD" }] }),
    dish("رقاقات", "Rakakat (cheese rolls)", 4, { description: "6 pcs" }),
    dish("كبة مقلية", "Fried kibbeh", null, { price_clear: false, flags: ["unclear_price"], flag_note: "the price is missing: only a $ sign is printed", price_text: "$" })]]]),
  "example-menu.docx": reading([["مشاوي", "Grills", [
    dish("شيش طاووق", "Shish taouk plate", 8),
    dish("مشاوي مشكلة", "Mixed grill", null, { price_text: "$12 / $20 (half / whole)", sizes: [{ name_ar: "نصف", name_en: "Half", price: 12, currency: "USD" }, { name_ar: "كامل", name_en: "Whole", price: 20, currency: "USD" }] })]],
    ["سندويشات", "Sandwiches", [
      dish("ساندويش فلافل", "Falafel sandwich", null, { price_text: "2 - 3" }),
      dish(null, "Burger with cheese, lettuce and tom", null, { price_clear: false, flags: ["cut_off"], flag_note: "the line is cut off and has no price" })]]]),
  "example-menu.xlsx: Food": reading([["مناقيش", "Manakish", [dish("منقوشة زعتر", "Zaatar manousheh", 1.5), dish("منقوشة جبنة", "Cheese manousheh", 2.5, { description: "Juicy cheese, the best in town" })]]]),
  "example-menu.xlsx: Drinks": reading([["مشروبات", "Drinks", [dish("عيران", "Ayran", 1)]]]),
  "example-menu.csv": reading([["سلطات", "Salads", [dish("فتوش", "Fattoush", 4), dish("تبولة", "Tabbouleh", 4.5)]], ["صلصات", "Dips", [dish("ثوم", "Garlic", 450000, { currency: "LBP", price_text: "450,000 L.L." })]]]),
  "example-menu.pdf": reading([["مشاوي", "Grills", [dish("كفتة", "Kafta plate", 7.5, { page: 1 })]]]),
};

describe("4 reading: photos and pages, one batch, one cap", () => {
  let out: any; let api: ReturnType<typeof fakeApi>;
  it("sends the text of text pages, the PDF itself, and records each page's reading as proposals", async () => {
    const titles = new Map((await db.rpc("menu_page_queue", {})).map((p: any) => [pageCustomId(p.page_id), p.title]));
    api = fakeApi((id) => PAGE_READINGS[titles.get(id) as string] ?? reading([]));
    out = await runMenuRead(deps(api));
    expect(api.batches.size).toBe(1);
    const reqs = api.calls.find((c) => c.method === "POST")!.body.requests;
    expect(reqs.length).toBe(7);
    for (const rq of reqs) expect(rq.custom_id).toMatch(/^pg_[0-9a-f-]{36}$/);
    const pdfRq = reqs.find((r: any) => titles.get(r.custom_id) === "example-menu.pdf");
    expect(pdfRq.params.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(pdfRq.params.max_tokens).toBe(16000);
    const textRq = reqs.find((r: any) => titles.get(r.custom_id) === "SANDWICHES / سندويشات");
    expect(textRq.params.messages[0].content).toHaveLength(1);
    expect(textRq.params.messages[0].content[0].text).toMatch(/a section of the place's menu web page[\s\S]*<source>\n# SANDWICHES[\s\S]*ساندويش طاووق كبير\n4\.5\$\n<\/source>/);
    expect(out).toMatchObject({ pagesRead: 7, read: 0 });
    expect(out.summary).toMatch(/Source pages read \(links, PDFs, pasted text, Word and Excel files\): 7 of 7 waiting/);
    expect(await db.rpc("menu_page_queue", {})).toEqual([]);
    expect((await db.all(`select status from menu_sources where source_id = $1 and status <> 'failed'`, [place])).map((x: any) => x.status)).toEqual(Array(6).fill("done"));
  });

  it("a screenshot is sent only for a page with no text; the cap counts a page's length", async () => {
    const s = await db.rpc("add_menu_source", { p_place: place2, p_kind: "link", p_by: lead, p_detail: { url: "https://menus.example/p/images-only" } });
    await db.rpc("record_menu_source_pages", { p_menu_source: s.menu_source_id, p_by: reader, p_pages: [{ position: 0, title: "Menu board", shot_path: `menus/${place2}/pages/2026-11-19/abc.jpg` }] });
    files.set(`menus/${place2}/pages/2026-11-19/abc.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const api2 = fakeApi(() => reading([["", "", [dish("فلافل", "Falafel", 1)]]]));
    const price = priceFor(prices, MODEL, new Date().toISOString().slice(0, 10));
    expect(estimateTextUsd(price, 20000)).toBeGreaterThan(estimateTextUsd(price, 200));
    await runMenuRead(deps(api2));
    const rq = api2.calls.find((c) => c.method === "POST")!.body.requests[0];
    expect(rq.params.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  });
});

const row = async (name: string) => db.one(`select * from menu_dish_proposals where source_id = $1 and coalesce(name_en, name_ar) = $2 and status = 'waiting'`, [place, name]);
describe("5 proposals: the description as printed, flags, price to confirm", () => {
  it("sizes keep their own prices; a range is never one price; the reader's doubts are flags; praise in a description is flagged", async () => {
    expect(await row("Taouk sandwich")).toMatchObject({ price: null, currency: "USD", price_status: "clear", flags: [], source_text: "ساندويش طاووق صغير 3$ | ساندويش طاووق كبير 4.5$",
      sizes: [{ name_ar: "صغير", name_en: "Small", price: 3, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: 4.5, currency: "USD" }] });
    expect(await row("Falafel sandwich")).toMatchObject({ price: null, price_status: "to_confirm", flags: ["price_range"] });
    expect(await row("Fried kibbeh")).toMatchObject({ price_status: "to_confirm", flags: ["unclear_price"], flag_note: "the price is missing: only a $ sign is printed" });
    expect(await row("Burger with cheese, lettuce and tom")).toMatchObject({ price_status: "to_confirm", flags: ["cut_off"] });
    expect(await row("Rakakat (cheese rolls)")).toMatchObject({ description: "6 pcs", flags: [], price_status: "clear" });
    expect(await row("Cheese manousheh")).toMatchObject({ description: "Juicy cheese, the best in town", flags: ["description_claim"] });
    expect(await row("Kafta plate")).toMatchObject({ pdf_page: 1 });
    expect(await row("Garlic")).toMatchObject({ price: "450000", currency: "LBP", price_status: "clear" });
    // nothing about food is kept from a reading: the form has no allergen field, and a stray one is dropped
    expect(MenuReading.safeParse(reading([["", "", [{ ...dish("x", "x", 1), allergens: ["milk"] }]]])).success).toBe(true);
    const cols = (await db.all(`select column_name from information_schema.columns where table_name = 'menu_dish_proposals'`)).map((c: any) => c.column_name);
    expect(cols.filter((c: string) => /allerg|halal|vegan|diet|health|rating/.test(c))).toEqual([]);
  });

  it("a clean row: a name, a clear price with its currency (or every size priced), no flag, no claim", async () => {
    const clean = (await db.rpc("menu_console", { p_source: place })).waiting.filter((d: any) => d.clean).map((d: any) => d.name_en).sort();
    expect(clean).toEqual(["Ayran", "Fattoush", "Fries", "Garlic", "Hummus", "Kafta plate", "Mixed grill", "Moutabal", "Rakakat (cheese rolls)", "Shish taouk plate", "Tabbouleh", "Taouk sandwich", "Zaatar manousheh"].sort());
    const report = await db.rpc("menu_place_report", { p_place: place });
    expect(report).toMatchObject({ waiting: 17, clean: 13 });
    expect(report.sections.find((s: any) => s.section === "Sandwiches")).toMatchObject({ dishes: 3, clean: 1, price_to_confirm: 2, flagged: 2 });
    expect(report.sizes.map((s: any) => s.dish).sort()).toEqual(["بطاطا مقلية", "ساندويش طاووق", "مشاوي مشكلة"].sort());
    expect(report.flagged.map((f: any) => f.dish).sort()).toEqual(["Burger with cheese, lettuce and tom", "ساندويش فلافل", "كبة مقلية", "منقوشة جبنة"].sort());
  });
});

describe("6 approval made fast, and still per dish", () => {
  it("the section's clean rows in one press: each recorded with who approved it; a flagged id in the list is left for one by one", async () => {
    const w = (await db.rpc("menu_console", { p_source: place })).waiting;
    const salads = w.filter((d: any) => d.section_en === "Salads").map((d: any) => d.id);
    const kibbeh = w.find((d: any) => d.name_en === "Fried kibbeh").id;
    await fails(db.rpc("approve_menu_section", { p_place: place, p_ids: salads, p_by: picker }), /NOT_AUTHORISED/);
    await fails(db.rpc("approve_menu_section", { p_place: place2, p_ids: salads, p_by: lead }).then((r: any) => { if (r.approved) throw new Error("approved another place's dishes"); throw new Error("NONE"); }), /NONE/);
    const r = await db.rpc("approve_menu_section", { p_place: place, p_ids: [...salads, kibbeh], p_by: lead });
    expect(r).toEqual({ ok: true, approved: 2, left: 1 });
    const done = await db.all(`select status, reviewed_by from menu_dish_proposals where id = any($1::uuid[])`, [salads]);
    expect(done).toEqual([{ status: "approved", reviewed_by: lead }, { status: "approved", reviewed_by: lead }]);
    expect((await db.all(`select detail->>'dish' as d from place_log where action = 'dish_approve' and by_party = $1 and detail->>'dish' = any($2::text[])`, [lead, salads])).length).toBe(2);
    expect((await db.one(`select status from menu_dish_proposals where id = $1`, [kibbeh])).status).toBe("waiting");
    const fat = await db.one(`select o.price_usd::text as p from offers o join products p on p.id = o.product_id where p.name_en = 'Fattoush' and o.source_id = $1`, [place]);
    expect(fat.p).toBe("4.00");
  });

  it("a price to confirm cannot be approved until it is typed; sizes are typed one each; a praised description must change", async () => {
    const kibbeh = (await row("Fried kibbeh")).id;
    await fails(db.rpc("review_menu_dish", { p_dish: kibbeh, p_by: lead, p_approve: true }), /PRICE_REQUIRED/);
    const burger = (await row("Burger with cheese, lettuce and tom")).id;
    await fails(db.rpc("review_menu_dish", { p_dish: burger, p_by: lead, p_approve: true, p_edit: { name_en: "Cheeseburger" } }), /PRICE_REQUIRED/);
    expect((await db.rpc("review_menu_dish", { p_dish: kibbeh, p_by: lead, p_approve: true, p_edit: { price: 5 } })).price_usd).toBe(5);
    // a sized row with the reader's doubt: every size typed
    const s = await db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { body: "Shawarma small 3 large 5 (blurred)" } });
    const pg = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [s.menu_source_id])).id;
    await db.rpc("record_menu_page_reading", { p_page: pg, p_by: reader, p_model: "m", p_reading: reading([["شاورما", "Shawarma", [dish("شاورما", "Shawarma", null, { price_clear: false,
      sizes: [{ name_ar: "صغير", name_en: "Small", price: 3, currency: "USD" }, { name_ar: "كبير", name_en: "Large", price: null, currency: "USD" }] })]]]) });
    const sh = (await row("Shawarma")).id;
    await fails(db.rpc("review_menu_dish", { p_dish: sh, p_by: lead, p_approve: true }), /PRICE_TO_CONFIRM/);
    await fails(db.rpc("review_menu_dish", { p_dish: sh, p_by: lead, p_approve: true, p_edit: { size_prices: [3] } }), /SIZE_PRICES/);
    const ok = await db.rpc("review_menu_dish", { p_dish: sh, p_by: lead, p_approve: true, p_edit: { size_prices: [3, 5.5] } });
    expect(ok.price_usd).toBe(3);
    expect((await db.one(`select sizes from menu_dish_proposals where id = $1`, [sh])).sizes.map((x: any) => x.price)).toEqual([3, 5.5]);
    const cheese = (await row("Cheese manousheh")).id;
    await fails(db.rpc("review_menu_dish", { p_dish: cheese, p_by: lead, p_approve: true }), /DISH_DESCRIPTION_CLAIM/);
    await db.rpc("review_menu_dish", { p_dish: cheese, p_by: lead, p_approve: true, p_edit: { description: "Cheese on dough" } });
    expect((await db.one(`select description from menu_dish_proposals where id = $1`, [cheese])).description).toBe("Cheese on dough");
  });

  it("the stamp waits for every source page; then everything else is approved and the stamp is given", async () => {
    await db.rpc("review_menu_dish", { p_dish: (await row("Burger with cheese, lettuce and tom")).id, p_by: lead, p_approve: false, p_note: "cut off in the file" });
    await db.rpc("review_menu_dish", { p_dish: (await row("Falafel sandwich")).id, p_by: lead, p_approve: true, p_edit: { size_prices: [] } }).catch(() => undefined);
    await db.rpc("review_menu_dish", { p_dish: (await row("Falafel sandwich")).id, p_by: lead, p_approve: true, p_edit: { price: 2.5 } });
    const rest = (await db.rpc("menu_console", { p_source: place })).waiting;
    for (const d of rest) await db.rpc("review_menu_dish", { p_dish: d.id, p_by: lead, p_approve: true });
    const s = await db.rpc("add_menu_source", { p_place: place, p_kind: "link", p_by: lead, p_detail: { url: "https://menus.example/p/example-grill/drinks" } });
    await fails(db.rpc("stamp_menu_checked", { p_source: place, p_by: lead }), /MENU_SOURCES_UNREAD/);
    await db.rpc("record_menu_source_pages", { p_menu_source: s.menu_source_id, p_by: reader, p_pages: [{ position: 0, title: "x", body: "no figures here", skip_reason: "the page shows no item or price" }] });
    expect((await db.rpc("stamp_menu_checked", { p_source: place, p_by: lead })).ok).toBe(true);
  });
});

describe("7 a re-import shows only what changed", () => {
  it("unchanged dishes stay out of the queue; a new price is shown beside the old; a new dish is new; a dish gone from a whole menu is proposed as removed", async () => {
    const before = (await db.one(`select count(*)::int as n from offers where source_id = $1 and is_available`, [place])).n;
    const s = await db.rpc("add_menu_source", { p_place: place, p_kind: "text", p_by: lead, p_detail: { full_menu: true, body: "the whole menu, again: Hummus 3, Fattoush 4.5, Tabbouleh 4.5, Lentil soup 3" } });
    const pg = (await db.one(`select id from menu_source_pages where menu_source_id = $1`, [s.menu_source_id])).id;
    const r = await db.rpc("record_menu_page_reading", { p_page: pg, p_by: reader, p_model: "m", p_reading: reading([["", "", [
      dish("حمص", "Hummus", 3), dish("فتوش", "Fattoush", 4.5), dish("تبولة", "Tabbouleh", 4.5), dish("شوربة عدس", "Lentil soup", 3)]]]) });
    expect(r.removed).toBe(before - 3);
    const w = (await db.rpc("menu_console", { p_source: place })).waiting;
    expect(w.find((d: any) => d.name_en === "Hummus")).toBeUndefined();                        // same price: unchanged, not in the queue
    expect(w.find((d: any) => d.name_en === "Tabbouleh")).toBeUndefined();
    expect(w.find((d: any) => d.name_en === "Fattoush")).toMatchObject({ change: "price_changed", old_price: 4, old_currency: "USD", price: 4.5 });
    expect(w.find((d: any) => d.name_en === "Lentil soup")).toMatchObject({ change: "new" });
    const removed = w.filter((d: any) => d.change === "removed");
    expect(removed.length).toBe(before - 3);
    expect(removed.every((d: any) => !d.clean)).toBe(true);                                       // never in "approve all clean"
    expect((await db.rpc("menu_console", { p_source: place })).unchanged).toBe(2);
    // approving "removed" takes the dish off sale; rejecting keeps it
    const garlic = removed.find((d: any) => d.name_en === "Garlic"); const fries = removed.find((d: any) => d.name_en === "Fries");
    expect((await db.rpc("review_menu_dish", { p_dish: garlic.id, p_by: lead, p_approve: true })).off_sale).toBe(true);
    await db.rpc("review_menu_dish", { p_dish: fries.id, p_by: lead, p_approve: false, p_note: "still sold, the new text missed it" });
    const avail = async (name: string) => (await db.one(`select o.is_available from offers o join products p on p.id = o.product_id where p.name_en = $1 and o.source_id = $2`, [name, place])).is_available;
    expect(await avail("Garlic")).toBe(false); expect(await avail("Fries")).toBe(true);
    // the price change, approved: same product, new price
    const fat = w.find((d: any) => d.name_en === "Fattoush");
    const prod = fat.matched_product_id;
    expect((await db.rpc("review_menu_dish", { p_dish: fat.id, p_by: lead, p_approve: true })).product_id).toBe(prod);
    expect((await db.one(`select price_usd::text as p from offers where product_id = $1`, [prod])).p).toBe("4.50");
  });
});

describe("8 invariants", () => {
  it("0259 and 0260 write no order, payment, stock or ledger row, and open no place", () => {
    for (const f of ["0259_menu_sources.sql", "0260_menu_review.sql"]) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(orders|order_items|payments|stock_levels|stock_movements|ledger_entries)\b/i);
      expect(sql).not.toMatch(/approve_merchant|approved_at\s*=|visibility\s*=/i);
    }
  });
});
