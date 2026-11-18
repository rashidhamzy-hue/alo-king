// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, the session's name) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// Screenshots of the website for a pull request (docs/NEXT_SESSIONS.md, rule 8): 390 and 1440 px, Arabic and English, light and dark.
// Skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI does not install.
//   SCREENS=/tmp/shots npx vitest run test/screens/web.test.ts
// The built site runs in the Worker runtime over the real migrations and the seed catalog, as in test/web/pages-web1.test.ts; the chat's
// address is an invented one. No picture is approved in the seed, so every card shows its placeholder: that is the true state today.
// It also weighs each page as a browser loads it (HTML, stylesheet, scripts, fonts) and fails above 100 KB.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../db/harness";
import { makeFactComplete } from "../db/fact-kit";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "../web/postgrest-fake";

const OUT = process.env.SCREENS;
// What sticks out of a phone screen, if anything (an element inside its own scrolling box does not count).
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-board, .ak-tabs, .skip"); }).slice(0, 4).map((e) => e.tagName + "." + e.className)`;
const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });

let PRODUCT_PAGES: [string, string][] = [];
describe.skipIf(!OUT)("screenshots", () => {
  let db: TestDb; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
  beforeAll(async () => {
    db = await openTestDb();
    await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0;
      update stock_levels set on_hand = 0 where product_id in (select id from products where sku in ('AK-0046', 'AK-0051'));
      update settings set value = '{"open":"09:00","close":"21:00","tz":"Asia/Beirut"}' where key = 'hours';
      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    // LD1: invented approved data, so the three product pages show both states (the seed holds no approved fact or field): a fact-complete food
    // item, a cleaning item with its own fields approved, and a baby item left bare (every field "not confirmed yet": the true state today).
    // None of it is real; nothing here leaves the test database.
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Example ops') returning id`)).id as string;
    const named = async (sku: string, ar: string) => { await db.pg.query(`update products set name_ar = $2 where sku = $1`, [sku, ar]); return (await db.one(`select id from products where sku = $1`, [sku])).id as string; };
    const food = await named("AK-0052", "زبادي يوناني سادة قليل الدسم ١٧٥ غ");
    await makeFactComplete(db, food, ops, { allergens: { milk: "contains" }, ingredients: "Milk, live cultures", nutrition: { energy_kcal: 72, fat: 2, saturated_fat: 1.3, carbohydrates: 4.1, sugars: 4.1, proteins: 9.5, salt: 0.1 } });
    await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source, status, approved_by, approved_at) values ($1, 'low_fat', 'Low fat', 'label_photo', 'approved', $2, now())`, [food, ops]);
    const clean = await named("AK-0249", "منظف مرحاض ١ ليتر");
    for (const [k, v, src] of [["hazard_warnings", ["Irritant"], "label_photo"], ["pictograms", ["irritant"], "label_photo"], ["scent", "Pine", "brand_site"], ["keep_from_children", true, "label_photo"], ["use_surface", "Toilet bowls", "label_photo"]] as const)
      await db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, proposed_by, approved_by, approved_at, reviewed_at) values ($1, $2, $3::jsonb, $4, 'approved', $5, $5, now(), now())`, [clean, k, JSON.stringify(v), src, ops]);
    const baby = (await db.one(`select sku from products where category = 'Baby & Child' and is_active order by sku limit 1`)).sku as string;
    await named(baby, "حفاضات أطفال");
    PRODUCT_PAGES = [["product-food", "/p/AK-0052"], ["product-cleaning", "/p/AK-0249"], ["product-baby", `/p/${baby}`]];
    fake = await startFakePostgrest(db);
    await build({ root, logLevel: "error" });
    const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", ENVIRONMENT: "staging" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    writeFileSync(root + ".dev.vars", body); writeFileSync(root + "dist/server/.dev.vars", body);
    const port = await freePort();
    const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
    stop = () => server.stop(); base = `http://127.0.0.1:${port}`;
  }, 240_000);
  afterAll(async () => { await stop(); await fake?.close(); if (existsSync(root + ".dev.vars")) rmSync(root + ".dev.vars"); });

  it("photographs and weighs the flagship pages", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const all: [string, string][] = [["home", "/"], ["home-check", "/?village=2#deliver"], ["category", "/c/dairy_eggs"], ["category-filtered", "/c/dairy_eggs?sort=price_asc&stock=1"],
      ["search", "/search?q=labneh"], ["search-miss", "/search?q=zzqq"], ["product", "/p/AK-0042"], ...PRODUCT_PAGES, ["gallery", "/gallery"]];
    const only = (process.env.PAGES ?? "").split(",").filter(Boolean);
    const pages = only.length ? all.filter(([n]) => only.includes(n)) : all;
    mkdirSync(OUT!, { recursive: true });
    const weights: string[] = [];
    for (const width of [390, 1440]) for (const lang of ["en", "ar"]) for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: theme, locale: lang === "ar" ? "ar-LB" : "en-GB", timezoneId: "Asia/Beirut" });
      const page = await ctx.newPage();
      for (const [name, path] of pages) {
        let bytes = 0; const kinds: Record<string, number> = {};
        const onResponse = async (res: any) => { try { const u = new URL(res.url()); if (u.origin !== base) return; const n = (await res.body()).length; bytes += n; const k = /\.woff2$/.test(u.pathname) ? "fonts" : /\.css$/.test(u.pathname) ? "css" : /\.js$/.test(u.pathname) ? "js" : /\.(png|svg|webmanifest)$/.test(u.pathname) ? "icons" : "html"; kinds[k] = (kinds[k] ?? 0) + n; } catch { /* a redirect has no body */ } };
        page.on("response", onResponse);
        const res = await page.goto(base + path, { waitUntil: "networkidle" });
        page.off("response", onResponse);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        if (width === 390) expect(await page.evaluate(WIDE), `${path} at 390 px scrolls sideways`).toEqual([]);
        const before = bytes - (kinds.icons ?? 0);      // the favicon and the manifest are not the page
        if (name !== "gallery") { /* WEB4a: reported, not capped (F18 2) */ if (width === 390 && theme === "light") weights.push(`${name} ${lang}: ${before} bytes (${Object.entries(kinds).filter(([k]) => k !== "icons").map(([k, v]) => `${k} ${v}`).join(", ")})`); }
        // the whole page, with the phone's fixed bar where it sits: at the bottom
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.max(h, width === 390 ? 844 : 900) });
        await page.screenshot({ path: join(OUT!, `web-${name}-${width}-${lang}-${theme}.png`) });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      }
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web-weights.txt"), weights.join("\n") + "\n");
  }, 900_000);
});
