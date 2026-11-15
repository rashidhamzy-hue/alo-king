// Session WEB1: the pages, built and served by the Worker runtime (workerd) over the real migrations. The Worker's database calls go to a
// stand-in for PostgREST (postgrest-fake.ts) that runs each function as the role web_channel. What this proves:
//   pages render from the database with JavaScript off; no unapproved picture or fact can render; «لبنة», "labne" and "labneh" find the
//   same products; a page weighs under 100 KB before pictures; the Worker sends its anon key and its web_channel token and calls nothing
//   but the catalog functions; a database that is down gives a plain "try again", not a stack trace.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer } from "node:net";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../db/harness";
import { WEB_CATALOG_FUNCTIONS } from "@ak/commerce/index";
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
const skus = (html: string) => [...new Set([...html.matchAll(/href="\/p\/(AK-\d+)"/g)].map((m) => m[1]!))];
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
    const card = html.split('<li class="ak-product').find((c) => c.includes("AK-0042"))!;      // DS1: the shared product card
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

describe("food facts: approved ones with their status; everything else is 'not verified'", () => {
  it("with no records: every attribute is 'not verified' and nothing says safe, free or healthy", async () => {
    const { html } = await page("/p/AK-0043");
    const t = text(html);
    expect(t).toContain("Nothing is verified yet for this item.");
    expect(t).toMatch(/Not verified: .*Milk/);
    expect(t).toContain("do not assume it is safe or free of anything");
    const facts = t.slice(t.indexOf("Nothing is verified yet"));                      // the facts themselves, after the standing notice
    expect(facts).not.toMatch(/Free of|\bsafe\b|healthy|health|rating|stars|score/i);
  });

  it("a proposed fact never renders; an approved declared one does, with its status, source and date; a partial 'free' stays 'not verified'", async () => {
    const proposedOnly = await fact("AK-0043", "milk", "contains", "declared", "label");
    expect(text((await page("/p/AK-0043")).html)).not.toContain("Contains: Milk");
    await approveFact(proposedOnly);
    expect(text((await page("/p/AK-0043")).html)).toMatch(/Contains: Milk \(declared, pack label, checked \d{4}-\d\d-\d\d\)/);
    const partialFree = await fact("AK-0043", "gluten", "free", "partial", "label"); await approveFact(partialFree);
    const t = text((await page("/p/AK-0043")).html);
    expect(t).not.toContain("Free of: Cereals containing gluten");
    expect(t).toMatch(/Not verified: .*Cereals containing gluten/);
    const sesame = await fact("AK-0043", "sesame", "free", "declared", "label"); await approveFact(sesame);
    expect(text((await page("/p/AK-0043")).html)).toContain("Free of: Sesame (declared");
    await db.pg.query(`update product_facts set expires_at = now() - interval '1 day' where id = $1`, [sesame]);
    expect(text((await page("/p/AK-0043")).html)).not.toContain("Free of: Sesame");
  });

  it("ingredients and the nutrition panel render as printed, only when approved; evidence details never leave", async () => {
    const ing = await fact("AK-0044", "ingredients", null, "declared", "label", { text: "Strained yoghurt, salt", lang: "en", secret_note: "internal-evidence-ref" });
    expect(text((await page("/p/AK-0044")).html)).not.toContain("Strained yoghurt");
    await approveFact(ing);
    const nut = await fact("AK-0044", "nutrition", null, "declared", "label", { values: { energy_kcal: 120, protein_g: 4.5 }, per: "100g" }); await approveFact(nut);
    const { html } = await page("/p/AK-0044");
    expect(text(html)).toContain("Strained yoghurt, salt");
    expect(html).toContain("energy kcal"); expect(html).toContain("4.5");
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
      const card = (sku: string) => cat.split('<li class="ak-product').find((c) => c.includes(`/p/${sku}"`))!;
      expect(card("AK-0042")).toContain('href="https://wa.me/96100000000?text=AK-0042"'); expect(card("AK-0046")).not.toContain("wa.me");
      const prod = (await page("/p/AK-0042")).html;
      expect(prod).toContain('itemtype="https://schema.org/Product"'); expect(prod).toContain('itemprop="priceCurrency" content="USD"'); expect(prod).toContain('href="https://schema.org/InStock"');
      expect((await page("/p/AK-0046")).html).toContain('href="https://schema.org/OutOfStock"');
      expect((await page("/")).html).toContain('itemtype="https://schema.org/GroceryStore"');
      expect(prod).not.toMatch(/application\/ld\+json|aggregateRating|ratingValue|review/i);
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
