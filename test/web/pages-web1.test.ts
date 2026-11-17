// Session WEB1: the pages, built and served by the Worker runtime (workerd) over the real migrations. The Worker's database calls go to a
// stand-in for PostgREST (postgrest-fake.ts) that runs each function as the role web_channel. What this proves:
//   pages render from the database with JavaScript off; no unapproved picture or fact can render; «لبنة», "labne" and "labneh" find the
//   same products; a page weighs under 100 KB before pictures; the Worker sends its anon key and its web_channel token and calls nothing
//   but the catalog functions; a database that is down gives a plain "try again", not a stack trace.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer } from "node:net";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../db/harness";
import { makeFactComplete } from "../db/fact-kit";
import { productJsonLd } from "../../apps/web/src/lib/jsonld";
import { DICTS } from "../../apps/web/src/lib/i18n";
import { pictureUrl } from "../../apps/web/src/lib/db";
import { WEB_CATALOG_FUNCTIONS, WEB_CHANNEL_FUNCTIONS } from "@ak/commerce/index";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "./postgrest-fake";

const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });

let db: TestDb; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
let ops: string; let n = 0;
const pid: Record<string, string> = {};

async function startServer(vars: Record<string, string>) {
  // The build copies .dev.vars next to the built Worker, and the preview reads that copy: write both.
  const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, ...vars }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(root + ".dev.vars", body);
  writeFileSync(root + "dist/server/.dev.vars", body);
  const port = await freePort();
  const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
  stop = () => server.stop();
  base = `http://127.0.0.1:${port}`;
}
const get = (path: string, h: Record<string, string> = {}) => fetch(base + path, { redirect: "manual", headers: { "accept-language": "en", ...h } });
const page = async (path: string, h: Record<string, string> = {}) => { const r = await get(path, h); return { status: r.status, headers: r.headers, html: await r.text() }; };
/** The JSON-LD blocks of a page, parsed. */
const lds = (html: string): any[] => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
const ld = (html: string): any => lds(html)[0];
const skus = (html: string) => [...new Set([...html.matchAll(/href="\/p\/(AK-\d+)"/g)].map((m) => m[1]!))];
/** The page without its data blocks (LD1: the head carries JSON-LD, whose addresses are not cards). */
const body = (html: string) => html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function propose(sku: string, kind: "intake_photo" | "open_food_facts" | "web_search") {
  n++;
  const r = await db.rpc<any>("propose_product_image", { p_product: pid[sku], p_source_kind: kind, p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`,
    p_page_url: null, p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: `product_images/${sku}/secret-${n}.jpg`, p_sha256: `sha-pw1-${n}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  return r.image_id as string;
}
const review = (image: string, decision: "approve" | "reject") => db.rpc("review_product_image", { p_image: image, p_by: ops, p_decision: decision, p_note: null });
const fact = (sku: string, attribute: string, value: string | null, status: string, source: string, detail: object = {}) =>
  db.rpc<string>("propose_product_fact", { p_product: pid[sku], p_attribute: attribute, p_value: value, p_status: status, p_source: source, p_by: ops, p_evidence: null, p_detail: detail });
const approveFact = (id: string) => db.rpc("approve_product_fact", { p_fact: id, p_by: ops });

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  for (const r of await db.all<any>(`select id, sku from products`)) pid[r.sku] = r.id;
  await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0;
                    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);
  fake = await startFakePostgrest(db);
  await build({ root, logLevel: "error" });
  await startServer({ PAGE_CACHE: "off" });
}, 240_000);
afterAll(async () => { await stop(); await fake?.close(); if (existsSync(root + ".dev.vars")) rmSync(root + ".dev.vars"); });

describe("pages render from the database, with JavaScript off", () => {
  it("home: hours, villages with their fee and time, and categories come from the database", async () => {
    const { status, html, headers } = await page("/");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toMatch(/text\/html/);
    const served = await db.all<any>(`select vi.name_en, z.delivery_fee_usd from villages vi join zones z on z.id = vi.zone_id where vi.is_served and z.is_active order by vi.name_en limit 3`);
    for (const v of served) { expect(html).toContain(v.name_en); expect(html).toContain(`$${Number(v.delivery_fee_usd).toFixed(2)}`); }
    expect(html).toContain("00:00–23:59");
    expect(text(html)).toContain("Open now");
    expect(html).toContain('href="/c/dairy_eggs"');
    // no script runs the page: the only script is the service worker's registration, an external file
    expect([...html.matchAll(/<script\b[^>]*>/g)].every((m) => /\ssrc="/.test(m[0]))).toBe(true);
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
  });

  it("home shows the closed state from the database, and a WhatsApp link only when a person has set one", async () => {
    await db.pg.exec(`update settings set value = '{"open":"10:00","close":"10:00","tz":"Asia/Beirut"}' where key = 'hours'`);   // open = close: closed at every hour
    const closed = await page("/");
    expect(text(closed.html)).toContain("Closed now");
    await db.pg.exec(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours'`);
    expect(closed.html).not.toContain("wa.me");
    await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    const home = (await page("/")).html;
    expect(home).toContain('href="https://wa.me/96100000000?text=');           // DS1: the chat opens with a greeting already typed
    expect(decodeURIComponent(/href="https:\/\/wa\.me\/96100000000\?text=([^"]+)"/.exec(home)![1]!)).toBe("Hello, I would like to order");
    expect((await page("/p/AK-0042")).html).toContain("https://wa.me/96100000000?text=AK-0042");
  });

  it("a category lists its items with price and stock; sold out is shown", async () => {
    await db.pg.exec(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = 'AK-0042')`);
    const { status, html } = await page("/c/dairy_eggs");
    await db.pg.exec(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = 'AK-0042')`);
    expect(status).toBe(200);
    expect(skus(html).length).toBeGreaterThan(10);
    expect(html).toContain("Leen Taanayel Labneh Premium");
    const card = body(html).split('<li class="ak-product').find((c) => c.includes("AK-0042"))!;      // DS1: the shared product card
    expect(card).toContain("Out of stock");
    expect(card).toMatch(/\$\d+\.\d\d/);
  });

  it("an unknown category or item is a 404 with a way home; a bad address cannot break the page", async () => {
    for (const path of ["/c/nope", "/p/AK-9999", "/p/%3Cscript%3E", "/c/%00"]) {
      const r = await page(path);
      expect(r.status, path).toBe(404);
      expect(r.html).toContain('href="/"');
      expect(r.html, path).not.toContain("<script>");
    }
  });

  it("privacy and terms are present in Arabic and English", async () => {
    for (const path of ["/privacy", "/terms"]) {
      const en = await page(path, { "accept-language": "en" });
      const ar = await page(path, { "accept-language": "ar" });
      expect(en.status).toBe(200); expect(ar.status).toBe(200);
      expect(en.html).toContain('<html lang="en" dir="ltr">'); expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    }
  });
});

describe("Arabic and English from one set of templates", () => {
  it("the browser's language is the default; Arabic is right to left and uses the Arabic names", async () => {
    const ar = await page("/c/dairy_eggs", { "accept-language": "ar-LB,ar;q=0.9,en;q=0.5" });
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(ar.html).toContain("ألبان وبيض");
    expect(ar.headers.get("content-language")).toBe("ar");
    const en = await page("/c/dairy_eggs", { "accept-language": "en-US,en;q=0.9" });
    expect(en.html).toContain('<html lang="en" dir="ltr">');
    expect(en.html).toContain("Dairy &amp; Eggs");
    expect((await page("/", { "accept-language": "" })).html).toContain('dir="rtl"');           // no preference: Arabic
    expect((await page("/", { "accept-language": "fr-FR" })).html).toContain('<html lang="fr" dir="ltr">');
  });

  it("the language link sets a cookie that wins over the browser, and only ever returns to this site", async () => {
    const r = await get("/lang?set=ar&next=%2Fc%2Fdairy_eggs", { "accept-language": "en" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/c/dairy_eggs");
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^lang=ar; Path=\/; Max-Age=\d+; SameSite=Lax; Secure; HttpOnly/);
    const next = await page("/c/dairy_eggs", { "accept-language": "en", cookie: "lang=ar" });
    expect(next.html).toContain('dir="rtl"');
    for (const bad of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const b = await get(`/lang?set=en&next=${encodeURIComponent(bad)}`);
      expect(b.headers.get("location"), bad).toBe("/");
    }
    expect((await get("/lang?set=xx&next=%2F")).headers.get("set-cookie")).toBeNull();
  });
});

describe("pictures: only approved ones the bucket holds", () => {
  it("a proposed, rejected, unknown-licence or uncopied picture never appears, on any page", async () => {
    const proposed = await propose("AK-0103", "intake_photo");
    const rejected = await propose("AK-0080", "intake_photo"); await review(rejected, "reject");
    const unknown = await propose("AK-0133", "web_search");
    const uncopied = await propose("AK-0001", "intake_photo"); await review(uncopied, "approve");
    for (const path of ["/", "/c/water_drinks", "/c/bakery", "/c/fruits_vegetables", "/p/AK-0103", "/p/AK-0080", "/p/AK-0133", "/p/AK-0001", "/search?q=mazaraana"]) {
      const { html } = await page(path);
      expect(html, path).not.toMatch(/<img[^>]*class="pic"/);
      expect(html, path).not.toContain("/storage/v1/");
      expect(html, path).not.toContain("secret-");
    }
    void proposed;
  });

  it("an approved, copied picture shows in the category and on the product, with its credit; once withdrawn it is gone", async () => {
    const img = await propose("AK-0042", "open_food_facts");
    await review(img, "approve");
    const path = await db.rpc<string>("catalog_picture_copied", { p_image: img });
    const src = `${fake.url}/storage/v1/object/public/catalog/${path}`;
    const cat = await page("/c/dairy_eggs");
    expect(cat.html).toContain(`src="${src}"`);
    expect(cat.html).toContain("Open Food Facts");
    const prod = await page("/p/AK-0042");
    expect(prod.html).toContain(`src="${src}"`);
    expect(prod.html).toContain("Open Food Facts contributors, CC BY-SA 3.0");
    expect(prod.html).toContain("openfoodfacts.org");
    expect(prod.html).not.toContain("secret-");                                // the private key never leaves the database
    expect(cat.headers.get("content-security-policy")).toContain(`img-src 'self' data: ${fake.url}`);
    await review(img, "reject");
    expect((await page("/c/dairy_eggs")).html).not.toContain(src);
    expect((await page("/p/AK-0042")).html).not.toContain(src);
  });
});

describe("food facts: approved ones with their source; everything else is 'not confirmed yet'", () => {
  it("with no records: every attribute is 'not confirmed yet' and nothing says safe, free or healthy", async () => {
    const { html } = await page("/p/AK-0043");
    const t = text(html);
    expect(t).toContain("Nothing is confirmed yet for this item.");
    expect(t).toMatch(/Not confirmed yet: .*Milk/);
    expect(t).toContain("do not assume it is safe or free of anything");
    const facts = t.slice(t.indexOf("Nothing is confirmed yet"));                      // the facts themselves, after the standing notice
    expect(facts).not.toMatch(/Free of|\bsafe\b|healthy|health|rating|stars|score/i);
  });

  it("a proposed fact never renders; an approved declared one does, with its status, source and date; a partial 'free' stays 'not confirmed yet'", async () => {
    const proposedOnly = await fact("AK-0043", "milk", "contains", "declared", "label");
    expect(text((await page("/p/AK-0043")).html)).not.toContain("Contains: Milk");
    await approveFact(proposedOnly);
    expect(text((await page("/p/AK-0043")).html)).toMatch(/Contains: Milk \(from the pack, checked \d{4}-\d\d-\d\d\)/);
    const partialFree = await fact("AK-0043", "gluten", "free", "partial", "label"); await approveFact(partialFree);
    const t = text((await page("/p/AK-0043")).html);
    expect(t).not.toContain("Free of: Cereals containing gluten");
    expect(t).toMatch(/Not confirmed yet: .*Cereals containing gluten/);
    const sesame = await fact("AK-0043", "sesame", "free", "declared", "label"); await approveFact(sesame);
    expect(text((await page("/p/AK-0043")).html)).toContain("Free of: Sesame (from the pack");
    await db.pg.query(`update product_facts set expires_at = now() - interval '1 day' where id = $1`, [sesame]);
    expect(text((await page("/p/AK-0043")).html)).not.toContain("Free of: Sesame");
  });

  it("ingredients render as printed once approved; the nutrition panel only for a fact-complete item; evidence details never leave", async () => {
    const ing = await fact("AK-0044", "ingredients", null, "declared", "label", { text: "Strained yoghurt, salt", lang: "en", secret_note: "internal-evidence-ref" });
    expect(text((await page("/p/AK-0044")).html)).not.toContain("Strained yoghurt");
    await approveFact(ing);
    const nut = await fact("AK-0044", "nutrition", null, "declared", "label", { values: { energy_kcal: 120, proteins: 4.5 }, per: "100g" }); await approveFact(nut);
    let { html } = await page("/p/AK-0044");
    expect(text(html)).toContain("Strained yoghurt, salt");
    expect(text(html)).not.toMatch(/Energy 120 kcal/);                                     // approved, but the item is not fact-complete yet: no numbers
    expect(text(html)).toMatch(/Nutrition Not confirmed yet/);
    await makeFactComplete(db, pid["AK-0044"]!, ops);
    html = (await page("/p/AK-0044")).html;
    expect(text(html)).toMatch(/Energy[^A-Za-z]*120 kcal/); expect(text(html)).toMatch(/Protein[^A-Za-z]*4.5 g/); expect(text(html)).toContain("Per 100 g");
    expect(html).not.toContain("internal-evidence-ref");
  });

  it("a web-page reading is never shown", async () => {
    await db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, detail, proposed_at) values ($1, 'vegan', 'yes', 'partial', 'web_page', '{"url": "https://x.test"}', now())`, [pid["AK-0045"]]);
    const t = text((await page("/p/AK-0045")).html);
    expect(t).not.toMatch(/Vegan: Yes/);
  });

  it("the page never calls a product good, bad, healthy or recommended, in any language", async () => {
    for (const lang of ["en", "ar", "fr"]) {
      const { html } = await page("/p/AK-0044", { "accept-language": lang });
      expect(text(html), lang).not.toMatch(/healthy|best seller|recommended|top rated|rating|صحي|الأفضل|مميز|sain\b|meilleur/i);
    }
  });
});

describe("LD1: the product page follows its template, and its JSON-LD is built from the same read", () => {
  const sku = async (category: string) => (await db.one(`select sku from products where category = $1 and is_active order by sku limit 1`, [category])).sku as string;
  const read = async (s: string) => await db.rpc<any>("web_catalog_product", { p_sku: s });

  it("one JSON-LD block, a data block the content security policy does not run, equal to the one built from the same read; no microdata", async () => {
    const r = await page("/p/AK-0042");
    expect(lds(r.html)).toHaveLength(1);
    expect(r.html).toMatch(/<script type="application\/ld\+json">/);
    expect(r.headers.get("content-security-policy")).toMatch(/script-src 'self';/);
    expect(r.html).not.toMatch(/itemscope|itemprop/);
    const ok = await read("AK-0042");
    const image = ok.picture ? pictureUrl({ SUPABASE_URL: fake.url }, ok.picture.path, 1200) : null;
    expect(ld(r.html)).toEqual(JSON.parse(JSON.stringify(productJsonLd("en", ok, { origin: base, imageUrl: image }))));
    expect(ld(r.html).offers.url).toBe(`${base}/p/AK-0042`);
    expect(text(r.html)).toContain(`$${ld(r.html).offers.price}`);                 // the price in the data is the price on the page
  });

  it.each([["Cleaning & Household"], ["Beauty & Personal Care"], ["Baby & Child"], ["Pet Zone"]])("%s: no allergen, diet, nutrition or food-facts line; its own fields read not confirmed yet, in all three languages", async (category) => {
    const s = await sku(category);
    for (const lang of ["en", "ar", "fr"] as const) {
      const { status, html } = await page(`/p/${s}`, { "accept-language": lang });
      const t = text(html);
      expect(status, lang).toBe(200);
      expect(t, `${lang} ${s}`).toContain(DICTS[lang].not_confirmed_yet);
      for (const w of [DICTS[lang].allergens, DICTS[lang].diets, DICTS[lang].nutrition, DICTS[lang].facts_title, DICTS[lang].contains, DICTS[lang].free_of]) expect(t, `${lang}: ${w}`).not.toContain(w);
      expect(ld(html)).not.toHaveProperty("nutrition");
    }
  });

  it("packaged food in all three languages: the groups its template has, each unknown listed as not confirmed yet", async () => {
    for (const lang of ["en", "ar", "fr"] as const) {
      const t = text((await page("/p/AK-0045", { "accept-language": lang })).html);
      expect(t).toContain(DICTS[lang].facts_title); expect(t).toContain(DICTS[lang].allergens); expect(t).toContain(DICTS[lang].not_confirmed_yet);
    }
  });

  it("an item with no price entered states none: no $0.00 on the page and no Offer in the data", async () => {
    const { status, html } = await page("/p/AK-0190");
    expect(status).toBe(200);
    expect(text(html)).toContain("Price not set yet"); expect(text(html)).not.toContain("$0.00");
    expect(ld(html)).not.toHaveProperty("offers");
    expect(ld(html)).toMatchObject({ "@type": "Product", sku: "AK-0190" });
  });

  it("a category page carries an ItemList of exactly the items it lists", async () => {
    const { html } = await page("/c/dairy_eggs");
    const list = ld(html);
    const listed = skus(html);
    expect(list["@type"]).toBe("ItemList"); expect(list.numberOfItems).toBe(listed.length);
    expect(list.itemListElement.map((x: any) => x.url.replace(`${base}/p/`, "")).sort()).toEqual([...listed].sort());
    expect(list.itemListElement.map((x: any) => x.position)).toEqual(listed.map((_, i) => i + 1));
    expect(JSON.stringify(list)).not.toMatch(/aggregateRating|ratingValue|review/i);
  });
});

describe("search: the chat's matcher", () => {
  it("«لبنة», \"labne\" and \"labneh\" find the same products in the same order", async () => {
    const [a, b, c] = [await page("/search?q=labne"), await page("/search?q=" + encodeURIComponent("لبنة")), await page("/search?q=labneh")];
    expect(skus(a.html)).toEqual(["AK-0042", "AK-0046", "AK-0051"]);
    expect(skus(b.html)).toEqual(skus(a.html));
    expect(skus(c.html)).toEqual(skus(a.html));
    expect(a.headers.get("cache-control")).toBe("no-store");
  });

  it("a miss says so, offers the chat, and is logged once", async () => {
    await db.pg.exec(`delete from demand_signals`);
    for (let i = 0; i < 3; i++) { const { html, status } = await page("/search?q=zzqqxx+nothing"); expect(status).toBe(200); expect(text(html)).toContain('We do not have "zzqqxx nothing" yet'); }
    expect((await page("/search?q=zzqqxx+nothing")).html).toContain('href="https://wa.me/96100000000?text=');
    expect(await db.all(`select kind, origin, query from demand_signals`)).toEqual([{ kind: "unknown_product", origin: "web_search", query: "zzqqxx nothing" }]);
  });

  it("a one-letter search, an empty one and a very long one are answered, and the query is escaped", async () => {
    expect((await page("/search?q=a")).status).toBe(200);
    expect((await page("/search")).status).toBe(200);
    const long = await page("/search?q=" + "x".repeat(500));
    expect(long.status).toBe(200);
    const xss = await page("/search?q=" + encodeURIComponent('"><script>alert(1)</script>'));
    expect(xss.html.replace(/="[^"]*"/g, '=""')).not.toContain("<script>alert");      // the text is inside a quoted attribute and escaped text, never markup
  });
});

describe("weight and the installable shell", () => {
  it("a page weighs under 100 KB before pictures (HTML, stylesheet and script, uncompressed)", async () => {
    for (const path of ["/", "/c/water_drinks", "/c/dairy_eggs", "/p/AK-0044", "/search?q=labneh", "/privacy"]) {
      const { html } = await page(path);
      let bytes = Buffer.byteLength(html);
      for (const href of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]!)) bytes += (await (await get(href)).arrayBuffer()).byteLength;
      for (const src of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!)) bytes += (await (await get(src)).arrayBuffer()).byteLength;
      expect(bytes, `${path}: ${bytes} bytes`).toBeLessThan(100 * 1024);
    }
  });

  it("the manifest, the icons, the service worker and the offline page are served", async () => {
    const m = await get("/manifest.webmanifest");
    expect(m.status).toBe(200);
    const manifest = JSON.parse(await m.text());
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", name: "Alo King" });
    for (const icon of manifest.icons) { const r = await get(icon.src); expect(r.status, icon.src).toBe(200); expect(r.headers.get("content-type")).toBe("image/png"); }
    expect(manifest.icons.map((i: any) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    const sw = await get("/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("cache-control")).toBe("no-cache");
    const code = await sw.text();
    expect(code).toContain("PAGE_PATH");
    // A phone that visited before the redesign must not keep the old look: the cache names are versioned (v2 for the redesign), every
    // older ak- cache is deleted when the new worker takes over, and the icons and the manifest (same names, new content) come from
    // the network first. Only the hashed files under /_astro are served from the phone first.
    expect(code).toContain('SHELL = "ak-shell-v2", PAGES = "ak-pages-v2"');
    expect(code).toMatch(/k\.indexOf\("ak-"\) === 0 && k !== SHELL && k !== PAGES[\s\S]*caches\.delete\(k\)/);
    expect(code).toMatch(/\^\\\/icons\\\/[\s\S]{0,80}manifest\.webmanifest[\s\S]{0,40}fresh\(req\)/);
    expect(code).toMatch(/function fresh\(req\) \{\s*return fetch\(req\)/);
    expect(code).toMatch(/\^\\\/_astro\\\/\/\.test\(url\.pathname\)\) \{ e\.respondWith\(shell\(req\)\)/);
    expect(code).not.toMatch(/PAGE_PATH = [^\n]*(search|cart|checkout|orders|account)/);   // it caches the catalog pages and nothing else
    expect((await get("/offline")).status).toBe(200);
  });

  it("the home page links the manifest and registers the worker from a file, not inline", async () => {
    const { html } = await page("/");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<script src="/sw-register.js" defer>');
    expect(html).toContain('<script src="/site.js" defer>');                 // DS1: the one small script, a file of this site
    const reg = await (await get("/sw-register.js")).text();
    expect(reg).toContain("serviceWorker.register");
  });

  it("security headers: a policy that allows no inline script, no framing, nothing but this site and the picture host", async () => {
    const { headers } = await page("/");
    const csp = headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("the Worker's connection", () => {
  it("sends its anon key and its web_channel token, and calls only the catalog functions", async () => {
    const used = new Set(fake.calls.map((c) => c.fn));
    expect(used.size).toBeGreaterThan(0);
    for (const fn of used) expect([...WEB_CATALOG_FUNCTIONS] as string[]).toContain(fn);
    // the fake answers 401 to any request without both, so every page above rendering is the proof they were sent
    const bad = await fetch(`${fake.url}/rest/v1/rpc/web_catalog_home`, { method: "POST", headers: { apikey: "x", authorization: "Bearer y" }, body: "{}" });
    expect(bad.status).toBe(401);
  });

  it("a database that is down gives a plain 'try again' with no detail; the page is not cached as good", async () => {
    fake.failing.on = true;
    try {
      for (const path of ["/", "/c/dairy_eggs", "/p/AK-0042", "/search?q=labneh"]) {
        const r = await page(path);
        expect(r.status, path).toBe(503);
        expect(text(r.html)).toContain("Temporarily unavailable");
        expect(r.html).not.toMatch(/database down|PostgREST|supabase|stack|at \w+ \(/i);
      }
    } finally { fake.failing.on = false; }
    expect((await page("/")).status).toBe(200);
  });

  it("search is limited per address", async () => {
    const ip = { "cf-connecting-ip": "203.0.113.77" };
    let last = 200;
    for (let i = 0; i < 32; i++) last = (await get("/search?q=labneh", ip)).status;
    expect(last).toBe(429);
    expect((await get("/search?q=labneh", { "cf-connecting-ip": "203.0.113.78" })).status).toBe(200);
  });
});

describe("DS1: the redesigned pages", () => {
  it("every page carries the crown, the fonts as this site's own files, and Order on WhatsApp with a greeting, in the header and the phone's bar", async () => {
    for (const path of ["/", "/c/dairy_eggs", "/p/AK-0042", "/search?q=labneh"]) {
      const { html } = await page(path);
      expect(html, path).toContain('class="ak-crown"');
      expect(html.match(/href="https:\/\/wa\.me\/96100000000\?text=Hello%2C%20I%20would%20like%20to%20order"/g)!.length, path).toBeGreaterThanOrEqual(2);
      expect(html, path).toMatch(/<link rel="preload" href="\/_astro\/plex-latin-400\.[\w-]+\.woff2" as="font" type="font\/woff2" crossorigin>/);
      expect(html, path).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\./);
      expect(html, path).not.toMatch(/\/cart|class="ak-cartbar"/);                     // no cart until it exists (WEB2)
    }
    const css = await (await get(/href="(\/_astro\/[^"]+\.css)"/.exec((await page("/")).html)![1]!)).text();
    expect([...css.matchAll(/url\(([^)]+)\)/g)].every((m) => /^\/_astro\/plex-(latin|arabic)-(400|600)\.[\w-]+\.woff2$/.test(m[1]!.replace(/["']/g, "")))).toBe(true);
    expect(css).toContain("--ak-gold:#c9a227"); expect(css).toContain("prefers-color-scheme:dark");
    expect((await page("/", { "accept-language": "ar" })).html).toContain(encodeURIComponent("مرحبا، بدي اطلب"));
  });

  it("'Do we deliver to you?' answers from the database with no script: the village's fee and time, and whether we are open", async () => {
    const served = await db.all<any>(`select vi.name_en, z.delivery_fee_usd, z.base_eta_minutes from villages vi join zones z on z.id = vi.zone_id where vi.is_served and z.is_active`);
    const home = await page("/");
    const options = [...home.html.matchAll(/<option value="(\d+)"[^>]*data-name="([^"]+)"/g)].map((m) => ({ n: m[1]!, name: m[2]! }));
    expect(options.length).toBe(served.length);
    expect(home.html).toMatch(/<div class="answer" role="status" hidden/);            // nothing is claimed before a village is picked
    const pick = options[1]!; const row = served.find((v) => v.name_en === pick.name)!;
    const t = text((await page(`/?village=${pick.n}`)).html);
    expect(t).toContain(`We deliver to ${pick.name}.`); expect(t).toContain(`$${Number(row.delivery_fee_usd).toFixed(2)}`); expect(t).toContain(`About ${row.base_eta_minutes} minutes`);
    expect(t).toContain("Open now");
    for (const bad of ["0", "999", "abc", "-1", "1.5"]) { const r = await page(`/?village=${bad}`); expect(r.status, bad).toBe(200); expect(text(r.html), bad).not.toContain("We deliver to "); }
    expect(text(home.html)).not.toMatch(/next round/i);                                 // no source for it yet: not said
  });

  it("a category filters by brand, how it is sold and stock, and sorts by price only; the filtered address is not cached", async () => {
    await db.pg.exec(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = 'AK-0042')`);
    try {
      const plain = await page("/c/dairy_eggs");
      const all = skus(plain.html);
      const stock = await page("/c/dairy_eggs?stock=1");
      expect(skus(stock.html)).toEqual(all.filter((x) => x !== "AK-0042"));
      expect(stock.headers.get("cache-control")).toBe("no-store");
      const brand = /<select class="ak-select" name="brand">[\s\S]*?<option value="([^"]+)"/.exec(plain.html.replace(/<option value="">[^<]*<\/option>/g, ""))![1]!;
      const byBrand = await page(`/c/dairy_eggs?brand=${encodeURIComponent(brand)}`);
      expect(skus(byBrand.html).length).toBeGreaterThan(0); expect(skus(byBrand.html).length).toBeLessThan(all.length);
      expect(text(byBrand.html)).toMatch(new RegExp(`${skus(byBrand.html).length} of ${all.length} items`));
      const prices = (h: string) => [...h.matchAll(/<span class="price"><bdi>\$([\d.]+)<\/bdi>/g)].map((m) => Number(m[1]));
      const up = prices((await page("/c/dairy_eggs?sort=price_asc")).html), down = prices((await page("/c/dairy_eggs?sort=price_desc")).html);
      expect(up.length).toBe(all.length); expect([...up].sort((a, b) => a - b)).toEqual(up); expect([...down].sort((a, b) => b - a)).toEqual(down);
      // a filter that is not one is ignored; nothing but facts can sort (invariant 14)
      expect(skus((await page("/c/dairy_eggs?brand=%3Cscript%3E&sort=best&unit=x")).html)).toEqual(all);
      expect(plain.html).not.toMatch(/value="(popular|best|rating|recommended)[^"]*"/i);
    } finally { await db.pg.exec(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = 'AK-0042')`); }
  });

  it("a card's one tap orders that item on WhatsApp, only when it is in stock; the product page says what a search engine may read, with no script", async () => {
    await db.pg.exec(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = 'AK-0046')`);
    try {
      const cat = (await page("/c/dairy_eggs")).html;
      const card = (sku: string) => body(cat).split('<li class="ak-product').find((c) => c.includes(`/p/${sku}"`))!;
      expect(card("AK-0042")).toContain('href="https://wa.me/96100000000?text=AK-0042"'); expect(card("AK-0046")).not.toContain("wa.me");
      const prod = (await page("/p/AK-0042")).html;
      expect(ld(prod).offers).toMatchObject({ priceCurrency: "USD", availability: "https://schema.org/InStock" });
      expect(ld((await page("/p/AK-0046")).html).offers.availability).toBe("https://schema.org/OutOfStock");
      expect((await page("/")).html).toContain('itemtype="https://schema.org/GroceryStore"');
      expect(prod).not.toMatch(/aggregateRating|ratingValue|review|itemprop/i);
    } finally { await db.pg.exec(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = 'AK-0046')`); }
  });

  it("search follows the typing through this site's own script, which asks only this site; with no script the form still works", async () => {
    const { html } = await page("/search?q=labneh");
    expect(html).toContain("data-live-search"); expect(html).toMatch(/<div data-live aria-live="polite">/);
    const js = await (await get("/site.js")).text();
    expect(js).toContain('"/search?q="'); expect(js).not.toMatch(/https?:\/\//); expect(js).not.toMatch(/cookie =|localStorage|innerHTML|eval\(/);
    expect(js).toMatch(/q\.length < 3/);                                                // a pause on three letters or more, never each key
    expect((await page("/")).html).not.toContain("data-live-search");                 // only the search page swaps results in
  });

  it("the gallery is served outside production, in the visitor's language, and reads nothing from the database", async () => {
    const before = fake.calls.length;
    const g = await page("/gallery");
    expect(g.status).toBe(200); expect(text(g.html)).toContain("Measured contrast"); expect(g.html).not.toMatch(/\sstyle="/);
    expect((await page("/gallery", { "accept-language": "ar" })).html).toContain("التاج");
    expect(fake.calls.length).toBe(before);
    expect((await page("/")).html).toContain('href="/gallery"');
  });
});

describe("LV1: Chouf places listed before they sign", () => {
  const NOT_YET = "Not on Alo King yet. You can't order from here yet.";
  const flat = (h: string) => text(h).replace(/&#39;/g, "'");
  const post = (path: string, form: Record<string, string>, h: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: base, "accept-language": "en", ...h }, body: new URLSearchParams(form) });
  const cookieOf = (r: Response) => /(?:^|,\s*)(ak_session=[0-9a-f]{64})/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
  const href = (id: string) => `/food/${encodeURIComponent(id)}`;
  const mainOf = (h: string) => /<main[\s\S]*<\/main>/.exec(body(h))![0];
  const rowsOf = (h: string) => [...new Set([...h.matchAll(/href="(\/food\/[^"/?]+)"/g)].map((m) => decodeURIComponent(m[1]!.slice(6))))];
  /** A page's weight as a first visit pays it: the page, its stylesheet, its script and the font files it asks for (uncompressed). */
  async function weigh(path: string, h: Record<string, string> = {}) {
    const { html } = await page(path, h);
    let bytes = Buffer.byteLength(html);
    for (const href of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]!)) {
      const css = await (await get(href)).text();
      bytes += Buffer.byteLength(css);
    }
    for (const src of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!)) bytes += (await (await get(src)).arrayBuffer()).byteLength;
    return { bytes, html };
  }
  let near: any; let baak: any; let noVillage: any;
  beforeAll(async () => {
    await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    near = await db.one(`select * from listings order by km_from_hub, name limit 1`);
    baak = await db.one(`select * from listings where kind = 'bakery' and village = 'Baakleen' order by km_from_hub limit 1`);
    noVillage = await db.one(`select * from listings where village is null order by km_from_hub limit 1`);
  });

  it("the Food page lists by distance, with the kind, the village and how far, and the choices of kind, village and sort", async () => {
    const r = await page("/food");
    expect(r.status).toBe(200);
    expect(r.html).toContain('<html lang="en" dir="ltr">');
    expect(text(r.html)).toContain("Food places");
    const ids = rowsOf(r.html);
    expect(ids.length).toBe(20);
    expect(ids[0]).toBe(near.listing_id);
    const km = [...mainOf(r.html).matchAll(/data-km="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(km.length).toBe(20); expect([...km].sort((a, b) => a - b)).toEqual(km);
    expect(text(mainOf(r.html))).toContain(`${near.name}`);
    expect(text(mainOf(r.html))).toContain("Restaurant");
    expect(text(mainOf(r.html))).toContain("Baakleen");
    expect(text(mainOf(r.html))).toMatch(/0\.4 km from our hub/);
    expect(text(mainOf(r.html))).toContain("Places: 460");
    // the choices: kind and village from the database, sort by distance or name and nothing else
    expect(mainOf(r.html)).toMatch(/<option value="bakery"[^>]*>Bakery/);
    expect(mainOf(r.html)).toMatch(/<option value="Boqaata"/);
    const sort = /<select[^>]*name="sort">([\s\S]*?)<\/select>/.exec(r.html)![1]!;
    expect([...sort.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(["distance", "name"]);
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(r.headers.get("x-page-cache")).toBeNull();
  });

  it("says nothing about a rating, a review, a menu, hours, a phone number or a photo, and shows no picture", async () => {
    for (const path of ["/food", `/food?kind=bakery&village=Baakleen`, href(near.listing_id), `${href(near.listing_id)}/remove`]) {
      for (const l of ["en", "ar", "fr"]) {
        const m = mainOf((await page(path, { "accept-language": l })).html);
        expect(m, `${path} ${l}`).not.toMatch(/<img|<picture|<video|tel:|itemprop|aria-label="[^"]*(rating|review)/i);
        expect(text(m), `${path} ${l}`).not.toMatch(/\b(rating|ratings|review|reviews|stars?|menu|opening hours|open now|phone|call us|photo|photos|popular|best|top rated|healthy|recommended)\b/i);
        expect(text(m), `${path} ${l}`).not.toMatch(/(\$\s?\d|\d\s?\$|\d+\s?USD|\d{7,})/);                  // no price, no phone-shaped number
      }
    }
  });

  it("filters by kind and by village; a village of '-' is the places with none; anything else is ignored or empty, never an error", async () => {
    const b = await page(`/food?kind=bakery&village=Baakleen`);
    const n = Number((await db.one(`select count(*)::int as n from listings where kind = 'bakery' and village = 'Baakleen'`)).n);
    expect(text(mainOf(b.html))).toContain(`Places: ${n}`);
    expect(rowsOf(b.html)).toContain(baak.listing_id);
    const rows = await db.all<any>(`select listing_id from listings where kind = 'bakery' and village = 'Baakleen'`);
    for (const id of rowsOf(b.html)) expect(rows.map((x) => x.listing_id)).toContain(id);
    const none = await page(`/food?village=-`);
    expect(text(mainOf(none.html))).toContain("Places: 34");
    expect(rowsOf(none.html)).toContain(noVillage.listing_id);
    expect(text(mainOf(none.html))).toContain("Village not listed");
    for (const q of ["kind=hotel", "kind=%3Cscript%3E", "village=%00", "sort=rating", "sort=popular", "page=-4", "page=abc", "page=99999", "kind=" + "x".repeat(400)]) {
      const r = await page(`/food?${q}`);
      expect(r.status, q).toBe(200);
      expect(r.html, q).not.toContain("<script>");
    }
    expect(text(mainOf((await page("/food?kind=hotel")).html))).toContain("No places match this.");
    // a sort that is not distance or name is distance
    expect(rowsOf((await page("/food?sort=rating")).html)).toEqual(rowsOf((await page("/food")).html));
  });

  it("sorts by name only when asked, and pages with Next and Previous that keep the choices", async () => {
    const byName = await page("/food?sort=name");
    const names = [...mainOf(byName.html).matchAll(/data-name="([^"]*)"/g)].map((m) => m[1]!.toLowerCase());
    expect(names.length).toBe(20);
    expect([...names].sort()).toEqual(names);
    const p1 = await page("/food"); const p2 = await page("/food?page=2");
    expect(rowsOf(p2.html).length).toBe(20);
    expect(rowsOf(p2.html).filter((x) => rowsOf(p1.html).includes(x))).toEqual([]);
    expect(p1.html).toMatch(/href="\/food\?page=2"/);
    expect(p2.html).toMatch(/href="\/food"/);                                  // Previous goes to the plain address
    expect(text(p2.html)).toContain("Page 2 of 23");
    const k = await page("/food?kind=bakery&sort=name&page=2");
    expect(k.html).toMatch(/href="\/food\?kind=bakery&amp;sort=name&amp;page=3"/);
    expect(k.html).toMatch(/href="\/food\?kind=bakery&amp;sort=name"/);
  });

  it("Arabic: right to left, the village in Arabic where the village list knows it, the kind in Arabic", async () => {
    const r = await page("/food?kind=bakery&village=Baakleen", { "accept-language": "ar" });
    expect(r.html).toContain('<html lang="ar" dir="rtl">');
    expect(text(mainOf(r.html))).toContain("بعقلين");
    expect(text(mainOf(r.html))).toContain("مخبز");
    expect(text(mainOf(r.html))).toContain(DICTS.ar.food_title);
    expect(r.html).toContain(`<option value="Baakleen" selected`);
  });

  it("a place: name, kind, village, distance, a map link, and the line that says it is not on Alo King yet; no way to order", async () => {
    const r = await page(href(baak.listing_id));
    expect(r.status).toBe(200);
    const m = mainOf(r.html);
    expect(m).toContain(`<h1>${baak.name}</h1>`);
    expect(flat(m)).toContain(NOT_YET);
    expect(flat(m)).toContain("Bakery"); expect(flat(m)).toContain("Baakleen");
    expect(flat(m)).toContain(`${Number(baak.km_from_hub).toFixed(1)} km from our hub`);
    const maps = /href="(https:\/\/www\.google\.com\/maps\/[^"]+)"[^>]*>/.exec(m)!;
    expect(maps[1]!.replace(/&amp;/g, "&")).toBe(baak.maps_url);
    expect(m).toMatch(/href="https:\/\/www\.google\.com\/maps\/[^"]+" rel="noopener"/);
    // no cart, no WhatsApp order for this place, no price
    expect(m).not.toMatch(/\/cart|add to|basket|checkout/i);
    expect(r.headers.get("cache-control")).toBe("no-cache");
    // the three things a person can do
    expect(m).toContain(`action="${href(baak.listing_id)}/want"`);
    expect(m).toContain("I want to order from here");
    expect(m).toContain(`href="${href(baak.listing_id)}/remove"`);
    expect(m).toContain("Remove this listing");
    expect(m).toContain("Is this your place? Claim it");
  });

  it("a place's JSON-LD is a LocalBusiness with a name and an address locality, and nothing else: never an Offer", async () => {
    const r = await page(href(baak.listing_id));
    const all = lds(r.html);
    expect(all.length).toBe(1);
    expect(all[0]).toEqual({ "@context": "https://schema.org", "@type": "LocalBusiness", name: baak.name, address: { "@type": "PostalAddress", addressLocality: "Baakleen" } });
    const raw = JSON.stringify(all[0]);
    expect(raw).not.toMatch(/Offer|price|telephone|aggregateRating|review|openingHours|menu|image|url|geo/i);
    // a place with no village has no address at all
    expect(lds((await page(href(noVillage.listing_id))).html)[0]).toEqual({ "@context": "https://schema.org", "@type": "LocalBusiness", name: noVillage.name });
    // the list page carries no structured data about the places
    expect(lds((await page("/food")).html)).toEqual([]);
    // the name is the name in the file in every language (it is a business's name, not ours to translate)
    expect(lds((await page(href(baak.listing_id), { "accept-language": "ar" })).html)[0].name).toBe(baak.name);
  });

  it("the claim button opens our WhatsApp with 'Claim <listing_id>' already typed, and only when a person has set the chat's address", async () => {
    const r = await page(href(baak.listing_id));
    const link = /href="(https:\/\/wa\.me\/96100000000\?text=Claim[^"]+)"/.exec(r.html)![1]!;
    expect(decodeURIComponent(new URL(link.replace(/&amp;/g, "&")).searchParams.get("text")!)).toBe(`Claim ${baak.listing_id}`);
    expect(new URL(link).pathname).toBe("/96100000000");
    // the same in Arabic: the words the turn reads are the same, whatever the page's language
    const ar = await page(href(baak.listing_id), { "accept-language": "ar" });
    expect(new URL(/href="(https:\/\/wa\.me\/96100000000\?text=Claim[^"]+)"/.exec(ar.html)![1]!.replace(/&amp;/g, "&")).searchParams.get("text")).toBe(`Claim ${baak.listing_id}`);
    await db.pg.query(`update settings set value = value - 'product_link' where key = 'catalog'`);
    try {
      const none = await page(href(baak.listing_id));
      expect(none.status).toBe(200);
      expect(none.html).not.toContain("Is this your place?");
      expect(none.html).not.toContain("wa.me");
    } finally { await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`); }
  });

  it("an unknown place is a 404 with a way home", async () => {
    for (const path of ["/food/no-such-place-1", "/food/%3Cscript%3E", "/food/%00", `/food/${"x".repeat(300)}`]) {
      const r = await page(path);
      expect(r.status, path).toBe(404);
      expect(r.html, path).toContain('href="/"');
      expect(r.html, path).not.toContain("<script>");
    }
  });

  it("'I want to order from here': one tap, no contact detail, logged as demand once per session; a page from another site cannot do it", async () => {
    const id = near.listing_id;
    const before = Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [id])).n);
    const first = await post(`${href(id)}/want`, {});
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(`${href(id)}?asked=1`);
    const cookie = cookieOf(first)!;
    expect(cookie).toBeTruthy();
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i); expect(first.headers.get("set-cookie")).toMatch(/SameSite=Lax/i); expect(first.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [id])).n)).toBe(before + 1);
    // the same visitor tapping again counts nothing more, and is told the same thing
    const again = await post(`${href(id)}/want`, {}, { cookie });
    expect(again.status).toBe(303);
    expect(cookieOf(again)).toBeNull();
    expect(Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [id])).n)).toBe(before + 1);
    const thanks = await page(`${href(id)}?asked=1`);
    expect(flat(mainOf(thanks.html))).toContain(`We've noted that you want to order from ${near.name}.`);
    expect(thanks.html).not.toMatch(/<script>/i);
    // another visitor counts
    expect((await post(`${href(id)}/want`, {})).status).toBe(303);
    expect(Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [id])).n)).toBe(before + 2);
    // what was sent: the form has no field at all
    expect(mainOf((await page(href(id))).html)).toMatch(new RegExp(`<form[^>]*action="${href(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/want"[^>]*>(?:(?!</form>)[\\s\\S])*</form>`));
    const form = new RegExp(`<form[^>]*action="[^"]*/want"[^>]*>((?:(?!</form>)[\\s\\S])*)</form>`).exec(mainOf((await page(href(id))).html))![1]!;
    expect(form).not.toMatch(/<input|<textarea|<select/);
    // a request that says it comes from another site is refused and counts nothing
    const foreign = await post(`${href(id)}/want`, {}, { origin: "https://evil.example.test" });
    expect(foreign.status).toBe(403);
    expect(Number((await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [id])).n)).toBe(before + 2);
  });

  it("a cookie the database does not know gets a new session instead of an error", async () => {
    const r = await post(`${href(baak.listing_id)}/want`, {}, { cookie: `ak_session=${"a".repeat(64)}` });
    expect(r.status).toBe(303);
    expect(cookieOf(r)).toBeTruthy();
    const d = await db.one(`select count(*)::int as n from demand_signals where kind = 'listing' and subject = $1`, [baak.listing_id]);
    expect(Number(d.n)).toBe(1);
  });

  it("'Remove this listing' is a short form: who you are, an optional reason; the page is hidden at once and our team is told", async () => {
    const id = baak.listing_id;
    const form = await page(`${href(id)}/remove`);
    expect(form.status).toBe(200);
    const m = mainOf(form.html);
    expect(m).toContain(`method="post"`); expect(m).toContain(`action="${href(id)}/remove"`);
    const who = /<select[^>]*name="who"[^>]*>([\s\S]*?)<\/select>/.exec(m)![1]!;
    expect([...who.matchAll(/<option value="([^"]*)"/g)].map((x) => x[1])).toEqual(["", "owner", "manager", "staff", "other"]);
    expect(m).toMatch(/<textarea[^>]*name="reason"/);
    expect(m).not.toMatch(/name="(phone|email|name|tel)"/i);                               // no contact detail is asked for
    // nothing chosen: not hidden, the form again with the reason in words
    const bad = await post(`${href(id)}/remove`, { who: "", reason: "x" });
    expect(bad.status).toBe(400);
    expect(flat(await bad.text())).toContain("Choose who you are.");
    expect((await page(href(id))).status).toBe(200);
    // chosen
    const ok = await post(`${href(id)}/remove`, { who: "owner", reason: "We closed last year" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/food?removed=1");
    expect(cookieOf(ok)).toBeTruthy();
    const gone = await page(href(id));
    expect(gone.status).toBe(404);
    expect(rowsOf((await page("/food?kind=bakery&village=Baakleen")).html)).not.toContain(id);
    expect(flat(mainOf((await page("/food?removed=1")).html))).toContain("The page is hidden and our team has been told.");
    const req = await db.one(`select who, reason, hidden, status from listing_removal_requests where listing_id = $1`, [id]);
    expect(req).toMatchObject({ who: "owner", reason: "We closed last year", hidden: true, status: "open" });
    expect((await db.one(`select status from ops_exceptions where kind = 'listing_removal' and ref = $1`, [id])).status).toBe("open");
    // its address, its want button and its form are gone too
    expect((await post(`${href(id)}/want`, {})).status).toBe(303);
    expect((await page(`${href(id)}/remove`)).status).toBe(404);
    // a request from another site hides nothing
    const other = await db.one(`select listing_id from listings where kind = 'cafe' and hidden_at is null order by km_from_hub limit 1`);
    const foreign = await post(`${href(other.listing_id)}/remove`, { who: "owner" }, { origin: "https://evil.example.test" });
    expect(foreign.status).toBe(403);
    expect((await page(href(other.listing_id))).status).toBe(200);
    await db.rpc("restore_listing", { p_listing: id, p_by: ops, p_reason: "put back by the test" });
    expect((await page(href(id))).status).toBe(200);
  });

  it("the Food pages are never cached: a hidden page must be gone at once", async () => {
    const mw = readFileSync(root + "src/middleware.ts", "utf8");
    const re = new RegExp(/const CACHEABLE = (\/.*\/);/.exec(mw)![1]!.slice(1, -1));
    for (const p of ["/food", "/food/some-place-1", "/food/some-place-1/remove"]) expect(re.test(p), p).toBe(false);
    const sw = readFileSync(root + "public/sw.js", "utf8");
    expect(/PAGE_PATH = (\/.*\/);/.exec(sw)![1]).not.toMatch(/food/);
  });

  it("the form posts are limited per address", async () => {
    const ip = { "cf-connecting-ip": "203.0.113.91" };
    let last = 303;
    for (let i = 0; i < 24; i++) last = (await post(`${href(near.listing_id)}/want`, {}, ip)).status;
    expect(last).toBe(429);
    expect((await post(`${href(near.listing_id)}/want`, {}, { "cf-connecting-ip": "203.0.113.92" })).status).toBe(303);
  });

  it("every Food page is under 100 KB on a first visit, in Arabic too: the page, its stylesheet, its script and the fonts it asks for", async () => {
    for (const lang of ["en", "ar"]) {
      for (const path of ["/food", "/food?kind=restaurant&sort=name&page=3", href(baak.listing_id), `${href(baak.listing_id)}/remove`, "/"]) {
        const { bytes, html } = await weigh(path, { "accept-language": lang });
        // the fonts the page asks for: the preload, and the faces its stylesheet names for the scripts on the page
        const css = await (await get(/href="(\/_astro\/[^"]+\.css)"/.exec(html)![1]!)).text();
        const faces = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((x) => x[1]!.replace(/["']/g, ""));
        let fonts = 0;
        const needsLatin = /[A-Za-z]/.test(text(html)); const needsArabic = /[\u0600-\u06FF]/.test(text(html));
        for (const f of new Set(faces)) {
          const arabic = f.includes("plex-arabic"); if ((arabic && !needsArabic) || (!arabic && !needsLatin)) continue;
          fonts += (await (await get(f)).arrayBuffer()).byteLength;
        }
        expect(bytes + fonts, `${lang} ${path}: ${bytes + fonts} bytes`).toBeLessThan(100 * 1024);
      }
    }
  });

  it("the home page has a door to the Food page", async () => {
    expect((await page("/")).html).toContain('href="/food"');
  });

  it("a database that is down gives a plain 'try again' on every Food page", async () => {
    fake.failing.on = true;
    try {
      for (const path of ["/food", href(near.listing_id), `${href(near.listing_id)}/remove`]) {
        const r = await page(path);
        expect(r.status, path).toBe(503);
        expect(text(r.html)).toContain("Temporarily unavailable");
        expect(r.html).not.toMatch(/database down|PostgREST|supabase|stack|at \w+ \(/i);
      }
      expect((await post(`${href(near.listing_id)}/want`, {})).status).toBe(503);
    } finally { fake.failing.on = false; }
  });

  it("the Worker calls only the functions the role may execute", async () => {
    const used = new Set(fake.calls.map((c) => c.fn));
    for (const fn of ["web_food_list", "web_food_place", "web_listing_want", "web_listing_remove"]) expect(used.has(fn), fn).toBe(true);
    for (const fn of used) expect([...WEB_CHANNEL_FUNCTIONS] as string[]).toContain(fn);
  });
});

describe("SELL1: a packaged item with no label reading yet is \"Coming soon\" on the site (sell_requires_label on)", () => {
  const gate = (on: boolean) => db.pg.query(`update settings set value = $1::jsonb where key = 'sell_requires_label'`, [JSON.stringify({ enabled: on })]);
  // the item's own order link (the {sku} prefill): the header and the bottom bar carry the shop's general WhatsApp link on every page
  const WA = "wa.me/96100000000?text=AK-0042";

  it("off: the page and the list are as before, with its stock badge and its WhatsApp order button", async () => {
    await gate(false);
    await db.pg.exec(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = 'AK-0042')`);
    const r = await page("/p/AK-0042");
    expect(text(r.html)).toContain("In stock"); expect(text(r.html)).not.toContain("Coming soon");
    expect(r.html).toContain(WA);
    expect(ld(r.html).offers.availability).toBe("https://schema.org/InStock");
  });

  it.each([["en", "Coming soon"], ["ar", "قريباً"], ["fr", "Bientôt disponible"]] as const)("on, %s: the page says %s, shows no stock badge, no order or ask button, and the data says out of stock", async (lang, word) => {
    await gate(true);
    expect(DICTS[lang].coming_soon).toBe(word);
    const r = await page("/p/AK-0042", { "accept-language": lang });
    const t = text(r.html);
    expect(t).toContain(word);
    expect(t).not.toContain(DICTS[lang].in_stock + " ");
    expect(r.html).not.toContain(WA);
    expect(t).not.toContain(DICTS[lang].ask_whatsapp);
    expect(ld(r.html).offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("on: the category list shows Coming soon on the card, with no order button; a loose item beside it is unchanged", async () => {
    await gate(true);
    const { html } = await page("/c/dairy_eggs");
    const card = html.split(/<li\b|<article\b/).find((c) => c.includes('href="/p/AK-0042"'))!;
    expect(text(card)).toContain("Coming soon");
    expect(card).not.toContain(WA);
    const veg = (await db.one(`select p.sku, pl.category_code from products p join catalog_placements pl on pl.sku = p.sku where p.category = 'Fruits & Vegetables' and p.is_active order by p.sku limit 1`));
    await db.pg.query(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = $1)`, [veg.sku]);
    const v = await page(`/p/${veg.sku}`);
    expect(text(v.html)).not.toContain("Coming soon"); expect(text(v.html)).toContain("In stock");
  });

  it("on: the search page lists it as Coming soon too (one read for every list)", async () => {
    await gate(true);
    const name = (await db.one(`select name_en from products where sku = 'AK-0042'`)).name_en as string;
    const { html } = await page(`/search?q=${encodeURIComponent(name)}`);
    if (html.includes('href="/p/AK-0042"')) {
      const card = html.split(/<li\b|<article\b/).find((c) => c.includes('href="/p/AK-0042"'))!;
      expect(text(card)).toContain("Coming soon");
    }
  });

  it("every language has the word, and the three dictionaries keep the same keys", () => {
    for (const lang of ["en", "ar", "fr"] as const) expect(DICTS[lang].coming_soon.length).toBeGreaterThan(2);
    expect(Object.keys(DICTS.ar).sort()).toEqual(Object.keys(DICTS.en).sort());
    expect(Object.keys(DICTS.fr).sort()).toEqual(Object.keys(DICTS.en).sort());
  });

  it("back off: everything returns at once", async () => {
    await gate(false);
    expect(text((await page("/p/AK-0042")).html)).toContain("In stock");
  });
});

describe("the page cache keys by language", () => {
  it("a cached Arabic page is not served to an English visitor, and a cached page is at most a minute stale", async () => {
    await stop();
    await startServer({});                       // cache on (the default)
    const ar1 = await page("/c/dairy_eggs", { "accept-language": "ar" });
    const en1 = await page("/c/dairy_eggs", { "accept-language": "en" });
    expect(ar1.html).toContain('dir="rtl"'); expect(en1.html).toContain('dir="ltr"');
    await db.pg.exec(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = 'AK-0042')`);
    const ar2 = await page("/c/dairy_eggs", { "accept-language": "ar" });
    const en2 = await page("/c/dairy_eggs", { "accept-language": "en" });
    await db.pg.exec(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = 'AK-0042')`);
    expect(ar2.headers.get("x-page-cache")).toBe("hit"); expect(en2.headers.get("x-page-cache")).toBe("hit");
    expect(ar2.html).toContain('dir="rtl"'); expect(en2.html).toContain('dir="ltr"');
    expect(ar2.html).toBe(ar1.html); expect(en2.html).toBe(en1.html);       // within the minute: the copy
    expect(ar2.headers.get("cache-control")).toBe("no-cache");               // the visitor's browser always asks; the Worker's copy is the cache
    expect((await page("/c/dairy_eggs?x=1", { "accept-language": "ar" })).headers.get("x-page-cache")).toBeNull();   // only the plain address is cached
    expect((await page("/search?q=labneh")).headers.get("x-page-cache")).toBeNull();
  });
});

describe("DS1: the gallery is staging only", () => {
  it("in production the gallery is 'not found' and the home page does not link to it", async () => {
    await stop();
    await startServer({ ENVIRONMENT: "production", PAGE_CACHE: "off" });
    const g = await page("/gallery");
    expect(g.status).toBe(404); expect(text(g.html)).toContain("Page not found"); expect(text(g.html)).not.toContain("Measured contrast");
    expect((await page("/")).html).not.toContain('href="/gallery"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// UX3: the join pages. /join/rider and /for-vendors take an application and nothing else: a number confirmed the WEB2 way (the visitor messages us first,
// invariant 17), an application row and a staff case. Never a rider, never a merchant (invariant 11). Written before the pages and migration 0233.
describe("UX3: /join/rider and /for-vendors", () => {
  const flat = (h: string) => text(h).replace(/&#39;/g, "'");
  const post = (path: string, form: Record<string, string | string[]>, h: Record<string, string> = {}) => {
    const body = new URLSearchParams(); for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
    return fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: base, "accept-language": "en", ...h }, body });
  };
  const cookieOf = (r: Response) => /(?:^|,\s*)(ak_session=[0-9a-f]{64})/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
  const mainOf = (h: string) => /<main[\s\S]*<\/main>/.exec(body(h))![0];
  /** A first visit's weight: the page, its stylesheet, its scripts and the font files a browser would fetch for it (a face is fetched when the page's text uses a character in its unicode-range; both weights are counted). */
  async function weigh(path: string, h: Record<string, string> = {}) {
    const { html } = await page(path, h);
    let bytes = Buffer.byteLength(html);
    const chars = new Set([...text(body(html))].map((c) => c.codePointAt(0)!));
    const inRange = (range: string) => range.split(",").map((r) => r.trim().replace(/^U\+/i, "").split("-").map((x) => parseInt(x, 16))).some(([lo, hi]) => [...chars].some((c) => c >= lo! && c <= (hi ?? lo!)));
    const fonts = new Set<string>();
    for (const href of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]!)) {
      const css = await (await get(href)).text();
      bytes += Buffer.byteLength(css);
      for (const f of css.matchAll(/@font-face\s*\{[^}]*?url\(["']?([^"')]+\.woff2)["']?\)[^}]*?unicode-range:\s*([^;}]+)/g)) if (inRange(f[2]!)) fonts.add(new URL(f[1]!, new URL(href, base + "/")).pathname);
    }
    for (const f of fonts) bytes += (await (await get(f)).arrayBuffer()).byteLength;
    for (const src of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!)) bytes += (await (await get(src)).arrayBuffer()).byteLength;
    return { bytes, html };
  }
  let seq = 0;
  /** The visitor's whole journey as the page and the customer line would run it: a code from the page, then the sender's message (claim_link_code, by code). */
  async function confirmed(path: string, lang = "en") {
    const first = await post(path, { step: "code" }, { "accept-language": lang });
    const cookie = cookieOf(first)!;
    const html = (await page(path, { cookie, "accept-language": lang })).html;
    const code = /ALO-[23456789A-HJ-NP-Z]{6}/.exec(html)![0];
    seq++;
    const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`UX3 web ${seq}`])).id;
    await db.pg.exec(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ('${party}', 'customer', 'wa-ux3w-${seq}', '+96170000${String(300 + seq)}')`);
    await db.pg.exec(`insert into conversations(line, party_id, last_inbound_at) values ('customer', '${party}', now())`);
    expect((await db.rpc<any>("claim_link_code", { p_party: party, p_code: code, p_wamid: `wamid-ux3w-${seq}` })).status).toBe("linked");
    return { cookie, party, code };
  }
  const RIDER_FORM = { step: "apply", name: "Sami Webtest", village: "Baakline", vehicle: "motorbike", licence: "yes", days: ["mon", "sat"], shifts: ["morning", "evening"] };
  let aListing: any;
  beforeAll(async () => {
    await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    aListing = await db.one(`select * from listings where kind = 'bakery' and hidden_at is null and village is not null order by km_from_hub limit 1`);
  });

  it("/join/rider says what a rider keeps, from the settings: the whole fee and all tips, the cash caps, the fee range, the shifts, the written terms", async () => {
    const r = await page("/join/rider");
    expect(r.status).toBe(200);
    expect(r.html).toContain('<html lang="en" dir="ltr">');
    const m = flat(mainOf(r.html));
    expect(m).toMatch(/Keep the whole (delivery )?fee/i);
    expect(m).toMatch(/100% of the delivery fee/); expect(m).toMatch(/100% of tips/);
    const caps = await db.rpc<any>("setting", { p_key: "cash_cap" });
    expect(m).toContain(`$${Number(caps.soft_usd).toFixed(2)}`); expect(m).toContain(`$${Number(caps.hard_usd).toFixed(2)}`);
    const fees = await db.one<any>(`select min(z.delivery_fee_usd) as lo, max(z.delivery_fee_usd) as hi from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active`);
    expect(m).toContain(`$${Number(fees.lo).toFixed(2)}`); expect(m).toContain(`$${Number(fees.hi).toFixed(2)}`);
    expect(m).toContain("08:00–15:30"); expect(m).toContain("15:30–23:00");
    expect(m).toMatch(/written terms/i);
    expect(m).toMatch(/never taken out of your (delivery )?fees, tips or earnings/i);          // invariant 10
    expect(m).toMatch(/never rated, scored or ranked/i);
    expect(m).not.toMatch(/commission|hourly wage of|per hour/i);                               // no commission on a rider, and no promise of an hourly figure
    // a number changed by a person changes the page: nothing is fixed in the page (invariant 13)
    await db.pg.query(`update settings set value = '{"soft_usd": 111, "hard_usd": 222}' where key = 'cash_cap'`);
    const changed = flat(mainOf((await page("/join/rider")).html));
    expect(changed).toContain("$111.00"); expect(changed).toContain("$222.00");
    await db.pg.query(`update settings set value = $1::jsonb where key = 'cash_cap'`, [JSON.stringify(caps)]);
  });

  it("before the number is confirmed the page offers the confirmation and not the form; there is no phone field anywhere", async () => {
    const r = await page("/join/rider");
    const m = mainOf(r.html);
    expect(m).toMatch(/name="step" value="code"/);
    expect(flat(m)).toMatch(/Confirm your number on WhatsApp/);
    expect(m).not.toMatch(/name="step" value="apply"/);
    expect(m).not.toMatch(/type="tel"|name="phone"|name="number"|name="whatsapp"/i);
    expect(r.headers.get("cache-control")).toBe("no-cache"); expect(r.headers.get("x-page-cache")).toBeNull();
    expect([...r.html.matchAll(/<script\b[^>]*>/g)].every((x) => /\ssrc="/.test(x[0]))).toBe(true);
  });

  it("asking for the code starts a session, shows the code and a WhatsApp link with the code already typed; nothing is sent to anyone", async () => {
    const sent = Number((await db.one<any>(`select count(*)::int as n from outbox`).catch(() => ({ n: 0 }))).n);
    const first = await post("/join/rider", { step: "code" });
    expect(first.status).toBe(303); expect(first.headers.get("location")).toMatch(/^\/join\/rider(#|$|\?)/);
    const cookie = cookieOf(first); expect(cookie).toBeTruthy();
    const r = await page("/join/rider", { cookie: cookie! });
    const code = /ALO-[23456789A-HJ-NP-Z]{6}/.exec(mainOf(r.html))![0];
    expect(mainOf(r.html)).toContain(`href="https://wa.me/96100000000?text=${code}"`);
    expect(flat(mainOf(r.html))).toMatch(/send (it|the code)/i);
    expect((await db.one<any>(`select purpose from link_codes where code = $1`, [code])).purpose).toBe("rider");
    expect(Number((await db.one<any>(`select count(*)::int as n from outbox`).catch(() => ({ n: 0 }))).n)).toBe(sent);
  });

  it("once the number is confirmed the form appears: name, village, vehicle, licence yes or no, the days and shifts; and it has no phone field", async () => {
    const v = await confirmed("/join/rider");
    const r = await page("/join/rider", { cookie: v.cookie });
    const m = mainOf(r.html);
    expect(flat(m)).toMatch(/Your number is confirmed/);
    expect(m).toMatch(/name="step" value="apply"/);
    for (const f of ["name", "village", "vehicle", "licence", "days", "shifts"]) expect(m, f).toContain(`name="${f}"`);
    expect(m.match(/name="licence"[^>]*value="(yes|no)"/g)!.length).toBe(2);
    expect(m.match(/name="days"/g)!.length).toBe(7);
    expect(m.match(/name="shifts"/g)!.length).toBe(2);
    expect(m).toMatch(/<option value="Baakline"/);
    expect(m).not.toMatch(/type="tel"|name="phone"/i);
    expect(m).not.toMatch(/name="licence"[^>]*checked/);                                      // no answer is pre-picked
  });

  it("an application creates an application row and a staff case, and no rider, shift or login; the page then says it is with us", async () => {
    const v = await confirmed("/join/rider");
    const drivers = Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n);
    const res = await post("/join/rider", RIDER_FORM, { cookie: v.cookie });
    expect(res.status).toBe(303); expect(res.headers.get("location")).toMatch(/^\/join\/rider\?applied=1/);
    const a = await db.one<any>(`select * from join_applications where party_id = $1`, [v.party]);
    expect(a).toMatchObject({ kind: "rider", status: "open", name: "Sami Webtest", vehicle: "motorbike", licence: true, rider_party_id: null });
    expect(a.days).toEqual(["mon", "sat"]); expect(a.shifts).toEqual(["evening", "morning"]);
    expect((await db.one<any>(`select state, source from handoffs where id = $1`, [a.case_id]))).toMatchObject({ state: "open", source: "rider_application" });
    expect(Number((await db.one<any>(`select count(*)::int as n from parties where role = 'driver'`)).n)).toBe(drivers);
    const after = await page("/join/rider?applied=1", { cookie: v.cookie });
    expect(flat(mainOf(after.html))).toMatch(/Your application is with us/);
    expect(flat(mainOf(after.html))).toMatch(/A person reads it and decides/);
    expect(mainOf(after.html)).not.toMatch(/name="step" value="apply"/);
    // sent again: still one application
    await post("/join/rider", { ...RIDER_FORM, name: "Someone Else" }, { cookie: v.cookie });
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications where party_id = $1`, [v.party])).n)).toBe(1);
  });

  it("a missing answer is named, what was typed is kept, and nothing is written", async () => {
    const v = await confirmed("/join/rider");
    const res = await post("/join/rider", { ...RIDER_FORM, licence: "" }, { cookie: v.cookie });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(flat(mainOf(html))).toMatch(/Tell us whether you have a licence/);
    expect(mainOf(html)).toContain('value="Sami Webtest"');
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications where party_id = $1`, [v.party])).n)).toBe(0);
    const noHours = await post("/join/rider", { ...RIDER_FORM, days: [] }, { cookie: v.cookie });
    expect(noHours.status).toBe(400); expect(flat(mainOf(await noHours.text()))).toMatch(/Choose at least one day and one shift/);
  });

  it("an application from a visitor whose number is not confirmed writes nothing and asks for the confirmation; a post from another origin is refused", async () => {
    const s = await post("/join/rider", { step: "code" });
    const cookie = cookieOf(s)!;
    const before = Number((await db.one<any>(`select count(*)::int as n from join_applications`)).n);
    const res = await post("/join/rider", RIDER_FORM, { cookie });
    expect(res.status).toBe(400);
    expect(flat(mainOf(await res.text()))).toMatch(/Confirm your number on WhatsApp first/);
    expect(Number((await db.one<any>(`select count(*)::int as n from join_applications`)).n)).toBe(before);
    expect((await fetch(base + "/join/rider", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: new URLSearchParams({ step: "code" }) })).status).toBe(403);
    expect((await post("/join/rider", RIDER_FORM)).status).toBe(400);                           // no cookie at all: a new session, and nothing confirmed
  });

  it("/for-vendors offers a kitchen or shop what we do, publishes no commission figure, and says an application opens nothing", async () => {
    const r = await page("/for-vendors");
    expect(r.status).toBe(200);
    const m = flat(mainOf(r.html));
    expect(m).toMatch(/WhatsApp/);
    expect(m).toMatch(/Applying does not open your place/i);
    expect(m).toMatch(/terms we agree with you before you start/i);                              // a commission exists and is agreed first; its figure is not published
    expect(m).not.toMatch(/\d\s?%|percent|commission of|\$\s?\d/i);
    expect(m).not.toMatch(/\b(best|top rated|popular|healthy|recommended)\b/i);
    expect(mainOf(r.html)).toMatch(/href="\/food"/);                                              // already listed? find your place
    expect(mainOf(r.html)).not.toMatch(/type="tel"|name="phone"/i);
    expect(mainOf(r.html)).toMatch(/name="step" value="code"/);
  });

  it("a vendor application: the owner's number confirmed the same way, then name, kind and village; a staff case and nothing else", async () => {
    const v = await confirmed("/for-vendors");
    const sources = Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant'`)).n);
    const form = await page("/for-vendors", { cookie: v.cookie });
    for (const f of ["name", "kind", "village"]) expect(mainOf(form.html), f).toContain(`name="${f}"`);
    const kinds = await db.rpc<any>("setting", { p_key: "join" });                              // the kinds to choose from are the setting's (invariant 13)
    for (const k of kinds.vendor.kinds) expect(mainOf(form.html), k).toMatch(new RegExp(`<option value="${k}"`));
    expect(mainOf(form.html)).not.toMatch(/type="tel"|name="phone"/i);
    const res = await post("/for-vendors", { step: "apply", name: "Test Oven", kind: "bakery", village: "Baakline" }, { cookie: v.cookie });
    expect(res.status).toBe(303); expect(res.headers.get("location")).toMatch(/^\/for-vendors\?applied=1/);
    const a = await db.one<any>(`select * from join_applications where party_id = $1`, [v.party]);
    expect(a).toMatchObject({ kind: "vendor", status: "open", name: "Test Oven", place_kind: "bakery", listing_id: null });
    expect((await db.one<any>(`select source from handoffs where id = $1`, [a.case_id])).source).toBe("vendor_application");
    expect(Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant'`)).n)).toBe(sources);
    expect(Number((await db.one<any>(`select count(*)::int as n from sources where kind = 'merchant' and is_open`)).n)).toBe(0);
    expect(flat(mainOf((await page("/for-vendors?applied=1", { cookie: v.cookie })).html))).toMatch(/Your application is with us/);
  });

  it("for one of the listed places: the page is prefilled, says this counts as the claim, and the application links to the listing", async () => {
    const v = await confirmed("/for-vendors");
    const r = await page(`/for-vendors?place=${encodeURIComponent(aListing.listing_id)}`, { cookie: v.cookie });
    const m = mainOf(r.html);
    expect(m).toContain(aListing.name.replace(/&/g, "&amp;"));
    expect(flat(m)).toMatch(/counts as your claim/i);
    expect(m).toContain(`name="listing" value="${aListing.listing_id}"`);
    const res = await post("/for-vendors", { step: "apply", name: aListing.name, kind: aListing.kind, village: aListing.village, listing: aListing.listing_id }, { cookie: v.cookie });
    expect(res.status).toBe(303);
    expect((await db.one<any>(`select listing_id from join_applications where party_id = $1`, [v.party])).listing_id).toBe(aListing.listing_id);
    expect(Number((await db.one<any>(`select count(*)::int as n from listing_claims where listing_id = $1 and party_id = $2`, [aListing.listing_id, v.party])).n)).toBe(1);
    // a place that is not there is ignored, not an error: the page is the plain one
    const odd = await page(`/for-vendors?place=${encodeURIComponent("no such place")}`);
    expect(odd.status).toBe(200); expect(flat(mainOf(odd.html))).not.toMatch(/counts as your claim/i);
  });

  it("a listed place's page and the Food page lead to the vendor page; every page leads to both from the footer", async () => {
    const place = await page(`/food/${encodeURIComponent(aListing.listing_id)}`);
    expect(place.html).toContain(`href="/for-vendors?place=${encodeURIComponent(aListing.listing_id)}"`);
    const home = await page("/");
    expect(home.html).toContain('href="/join/rider"'); expect(home.html).toContain('href="/for-vendors"');
  });

  it("is in Arabic and French too: right to left in Arabic, the hub is «المستودع» and never «المركز», every word present in each language", async () => {
    for (const path of ["/join/rider", "/for-vendors"]) {
      const ar = await page(path, { "accept-language": "ar" });
      expect(ar.html).toContain('<html lang="ar" dir="rtl">');
      const m = text(mainOf(ar.html));
      expect(m, path).toMatch(/[؀-ۿ]/);
      expect(m, path).not.toContain("المركز");
      expect(m, path).not.toMatch(/\{\w+\}/);
      const fr = await page(path, { "accept-language": "fr" });
      expect(fr.html).toContain('<html lang="fr" dir="ltr">'); expect(text(mainOf(fr.html)), path).not.toMatch(/\{\w+\}/);
    }
    expect(text(mainOf((await page("/join/rider", { "accept-language": "ar" })).html))).toContain("المستودع");
    for (const k of Object.keys(DICTS.en).filter((k) => k.startsWith("join_") || k.startsWith("vend_"))) {
      expect(DICTS.ar[k], `ar ${k}`).toBeTruthy(); expect(DICTS.fr[k], `fr ${k}`).toBeTruthy();
    }
  });

  it("says nothing that rates, praises or promises: no rating, score, ranking, 'best', 'healthy' or income promise", async () => {
    for (const path of ["/join/rider", "/for-vendors"]) for (const l of ["en", "ar", "fr"]) {
      const t = flat(mainOf((await page(path, { "accept-language": l })).html));
      expect(t, `${path} ${l}`).not.toMatch(/\b(best|top rated|top-rated|healthy|guaranteed|earn up to|per month|a month|sans commission)\b/i);
      expect(t, `${path} ${l}`).not.toMatch(/\b\d+\s?(stars?|\/\s?5)\b|★|⭐/);
    }
  });

  it("each page weighs under 100 KB on a first visit, Arabic included (the page, its stylesheet, its script and its fonts)", async () => {
    const out: string[] = [];
    for (const path of ["/join/rider", "/for-vendors", `/for-vendors?place=${encodeURIComponent(aListing.listing_id)}`, "/"]) for (const l of ["en", "ar", "fr"]) {
      const w = await weigh(path, { "accept-language": l });
      out.push(`${path} ${l} ${(w.bytes / 1024).toFixed(1)} KB`);
      expect(w.bytes, `${path} ${l}: ${(w.bytes / 1024).toFixed(1)} KB`).toBeLessThan(100 * 1024);
    }
    writeFileSync(root + "dist/ux3-weights.txt", out.join("\n") + "\n");
  });
});
