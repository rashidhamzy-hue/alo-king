// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, the session's name) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// LV1: screenshots of the Food page and one place page, at 390 px, in Arabic and English (the screens bucket, lv1/), and the weight of every Food page on a
// first visit (page, stylesheet, script and font files, uncompressed, nothing cached), which must be under 100 KB. Skipped unless SCREENS names a folder,
// because it needs a browser (Playwright's Chromium) that CI does not install:
//   SCREENS=/tmp/shots/lv1 npx vitest run test/screens/lv1.test.ts
// The website runs built, in the Worker runtime, over the real migrations and the founder's listings file. Invented data only (the listings are the file).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer as netServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../db/harness";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "../web/postgrest-fake";

const OUT = process.env.SCREENS;
const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0; }).map((e) => e.tagName + "." + e.className)`;

describe.skipIf(!OUT)("LV1 screenshots: the Food pages", () => {
  let db: TestDb; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
  beforeAll(async () => {
    db = await openTestDb();
    await db.pg.exec(`update settings set value = '{"open":"09:00","close":"21:00","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    fake = await startFakePostgrest(db);
    await build({ root, logLevel: "error" });
    const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", ENVIRONMENT: "staging" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    writeFileSync(root + ".dev.vars", body); writeFileSync(root + "dist/server/.dev.vars", body);
    const port = await freePort();
    const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
    stop = () => server.stop(); base = `http://127.0.0.1:${port}`;
  }, 240_000);
  afterAll(async () => { await stop(); await fake?.close(); if (existsSync(root + ".dev.vars")) rmSync(root + ".dev.vars"); });

  it("photographs the Food page and a place at 390 px, weighs every Food page on a first visit, and checks nothing scrolls sideways", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    const place = await db.one(`select listing_id, name from listings where kind = 'bakery' and village = 'Baakleen' order by km_from_hub limit 1`);
    const arabicVillage = await db.one(`select listing_id from listings where village = 'Baakleen' order by km_from_hub offset 3 limit 1`);
    const pages: [string, string][] = [
      ["food", "/food"], ["food-filtered", "/food?kind=bakery&village=Baakleen&sort=name"], ["food-page-23", "/food?page=23"],
      ["place", `/food/${encodeURIComponent(place.listing_id)}`], ["place-asked", `/food/${encodeURIComponent(arabicVillage.listing_id)}?asked=1`],
      ["remove", `/food/${encodeURIComponent(place.listing_id)}/remove`], ["home", "/"],
    ];
    const weights: string[] = [];
    const fresh = (lang: string) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: lang === "ar" ? "ar-LB" : "en-GB", timezoneId: "Asia/Beirut", extraHTTPHeaders: { "accept-language": lang } });
    for (const lang of ["en", "ar"]) for (const [name, path] of pages) {
      const ctx = await fresh(lang); const page = await ctx.newPage();                          // a cold load: its own context, nothing cached
      const sizes: Promise<number>[] = [];
      page.on("response", (res: any) => { const u = new URL(res.url()); if (u.origin === base && !/\.(png|svg|webmanifest)$/.test(u.pathname)) sizes.push(res.body().then((b: Buffer) => b.length, () => 0)); });
      const res = await page.goto(base + path, { waitUntil: "networkidle" });
      expect(res?.status(), path).toBe(200);
      await page.evaluate("document.fonts.ready");
      const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
      expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
      expect(bytes, `${path} (${lang}) was weighed`).toBeGreaterThan(0);   // WEB4a: reported, not capped (F18 2)
      weights.push(`${name} ${lang}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
      const h = await page.evaluate("document.documentElement.scrollHeight") as number;
      await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 2600) });
      if (["food", "place", "food-filtered", "remove", "place-asked"].includes(name)) await page.screenshot({ path: join(OUT!, `${name}-390-${lang}.png`) });
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web-weights.txt"), weights.join("\n") + "\n");
  }, 900_000);
});
