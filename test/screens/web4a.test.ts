// WEB4a (the website looks like the reference, stage 1): the frame and the home page. Screenshots are never committed: run with
// SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow (action shoot, web4a.test.ts, session web4a) on the branch;
// they show on the console's Screens page beside the reference's home (ref-web-home-*).
//   * the home page at 390 and 1440 px in Arabic, English and French, light; at 390 px dark; for a first visitor (no village, empty basket)
//     and for a visitor with a village and a basket (the hero's "Delivering to <village> · time · fee" chip, the header's count and total);
//   * the village picker open (the header chip), at 390 and 1440, Arabic and English;
//   * every page of the site at 390 and 1440 px in Arabic, English and French: nothing scrolls sideways (the frame is on every page);
//   * each page's weight on a first visit, measured by the browser (nothing cached), written to web4a-weights.txt for the pull request;
//   * every image of the site's own is WebP, and every image below the fold is lazy.
// Skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI does not install:
//   SCREENS=/tmp/shots/web4a npx vitest run test/screens/web4a.test.ts
// The website runs built, in the Worker runtime, over the real migrations and the seed catalogue. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer as netServer } from "node:net";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHub, type Hub } from "../db/hub-kit";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "../web/postgrest-fake";

const OUT = process.env.SCREENS;
const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const root = fileURLToPath(new URL("../../apps/.web4a-test/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".no-scrollbar"); }).map((e) => e.tagName + "." + e.className)`;
// The site's own images (not the catalogue bucket's product pictures): WebP; below the first screen, lazy.
const IMAGES = `[...document.images].filter((i) => new URL(i.currentSrc || i.src).origin === location.origin).map((i) => ({ src: new URL(i.currentSrc || i.src).pathname, lazy: i.loading === "lazy", top: i.getBoundingClientRect().top + scrollY }))`;

describe.skipIf(!OUT)("WEB4a screenshots: the frame and the home page", () => {
  let h: Hub; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
  let token = ""; let village = ""; let waiting = "";
  beforeAll(async () => {
    h = await openHub({ pickerOnOps: false });
    const db = h.db;
    await db.pg.exec(`update settings set value = '{"open":"08:00","close":"22:00","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog';
                      update stock_levels set on_hand = 20, reserved = 0`);
    village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
    const s = await db.rpc("web_session_start", { p_device: "screens" });
    token = s.token;
    for (const [sku, q] of [["AK-0103", 2], ["AK-0080", 1], ["AK-0042", 1]] as const) await db.rpc("cart_set_line", { p_token: token, p_sku: sku, p_qty: q, p_price_seen: null });
    // an order waiting for its WhatsApp tap (its page shows one action: open WhatsApp)
    const c = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-screens-web4a", p_phone: "+96170000499", p_name: "Test" });
    await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
    const place = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [c.party_id])).id;
    await db.rpc("set_place_details", { p_party: c.party_id, p_place: place, p_building: "Stone house by the school", p_floor: "1" });
    const w = await db.rpc("web_session_start", { p_device: "screens" });
    const code = await db.rpc("web_link_code", { p_token: w.token });
    await db.rpc("claim_link_code", { p_party: c.party_id, p_code: code.code, p_wamid: "wamid-screens-web4a" });
    await db.rpc("cart_set_line", { p_token: w.token, p_sku: "AK-0103", p_qty: 3, p_price_seen: null });
    const o = await db.rpc("web_place_order", { p_token: w.token, p_request_key: "req-screens-web4a", p_place: place, p_slot: null, p_payment: "cod", p_cash: "usd", p_note: 20,
      p_missing: "best_match", p_items: {}, p_notes: null, p_lang: "en" });
    waiting = `/o/${o.short_code}?k=${o.link}`;

    fake = await startFakePostgrest(db);
    rmSync(root, { recursive: true, force: true });
    cpSync(web, root, { recursive: true, filter: (src) => !/[\\/](dist|node_modules|\.astro|\.wrangler|\.dev\.vars)([\\/]|$)/.test(src.slice(web.length - 1)) });
    await build({ root, logLevel: "error" } as any);
    const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", ENVIRONMENT: "staging", WEB_POST_LIMIT: "100000" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    writeFileSync(root + "dist/server/.dev.vars", body);
    const port = await freePort();
    const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
    stop = () => server.stop(); base = `http://127.0.0.1:${port}`;
  }, 300_000);
  afterAll(async () => { await stop(); await fake?.close(); rmSync(root, { recursive: true, force: true }); });

  async function open(browser: any, o: { lang: string; width: number; dark?: boolean; who?: "basket" | null; path: string }) {
    const ctx = await browser.newContext({ viewport: { width: o.width, height: 844 }, deviceScaleFactor: 2, colorScheme: o.dark ? "dark" : "light",
      locale: o.lang === "ar" ? "ar-LB" : o.lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Asia/Beirut" });
    await ctx.addCookies([{ name: "lang", value: o.lang, url: base },
      ...(o.who ? [{ name: "ak_session", value: token, url: base }, { name: "ak_b", value: "4", url: base }, { name: "ak_village", value: village, url: base }] : [])]);
    const page = await ctx.newPage();
    const sizes: Promise<number>[] = [];
    page.on("response", (res: any) => { const u = new URL(res.url()); if (u.origin === base && !/\.(png|svg|webmanifest)$/.test(u.pathname)) sizes.push(res.body().then((b: Buffer) => b.length, () => 0)); });
    const res = await page.goto(base + o.path, { waitUntil: "networkidle" });
    expect(res?.status(), o.path).toBe(200);
    await page.evaluate("document.fonts.ready");
    return { ctx, page, bytes: async () => (await Promise.all(sizes)).reduce((a, b) => a + b, 0) };
  }
  async function shoot(page: any, file: string, width: number) {
    const hgt = await page.evaluate("document.documentElement.scrollHeight") as number;
    await page.setViewportSize({ width, height: Math.min(Math.max(hgt, 844), 6000) });
    await page.screenshot({ path: join(OUT!, file) });
  }

  it("the home page, beside the reference's: 390 and 1440 px, Arabic, English and French, a first visit and a returning visitor", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    const weights: string[] = [];
    for (const lang of ["ar", "en", "fr"]) for (const width of [390, 1440]) for (const who of [null, "basket"] as const) {
      if (lang === "fr" && who) continue;
      const { ctx, page, bytes } = await open(browser, { lang, width, who, path: "/" });
      if (who) {
        const chip = await page.locator("header summary").first().innerText();
        expect(chip).toMatch(lang === "ar" ? /بعقلين/ : /Baakline/);
        if (width === 1440) expect(await page.locator("header a[data-basket]").innerText()).toMatch(/4[\s\S]*\$\d+\.\d\d/);
      }
      if (width === 390) expect(await page.evaluate(WIDE), `home (${lang}) at 390 px scrolls sideways`).toEqual([]);
      const imgs = await page.evaluate(IMAGES) as { src: string; lazy: boolean; top: number }[];
      for (const i of imgs) {
        expect(i.src, "the site's own pictures are WebP").toMatch(/\.webp$/);
        if (i.top > 844) expect(i.lazy, `${i.src} is below the fold and must be lazy`).toBe(true);
      }
      if (!who) weights.push(`home ${lang} ${width}px, first visit: ${await bytes()} bytes (${((await bytes()) / 1024).toFixed(1)} KB, images included)`);
      await shoot(page, `web4a-home${who ? "-returning" : ""}-${width}-${lang}.png`, width);
      await ctx.close();
    }
    for (const lang of ["ar", "en"]) {
      const { ctx, page } = await open(browser, { lang, width: 390, dark: true, path: "/" });
      await shoot(page, `web4a-home-390-${lang}-dark.png`, 390);
      await ctx.close();
      for (const width of [390, 1440]) {
        const o = await open(browser, { lang, width, path: "/" });
        await o.page.locator("header summary").first().click();
        await o.page.screenshot({ path: join(OUT!, `web4a-picker-${width}-${lang}.png`) });
        await o.ctx.close();
      }
    }
    await browser.close();
    writeFileSync(join(OUT!, "web4a-weights.txt"), weights.join("\n") + "\n");
  }, 900_000);

  it("every page, in Arabic, English and French, at 390 and 1440 px: the frame never makes a page scroll sideways; the weights", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const pages = ["/", "/c/dairy_eggs", "/p/AK-0042", "/search?q=labneh", "/cart", "/checkout", "/signin", "/orders", "/account", "/how", "/food",
      "/join/rider", "/for-vendors", "/village", "/privacy", "/terms", waiting];
    const weights: string[] = [];
    for (const lang of ["ar", "en", "fr"]) for (const width of [390, 1440]) for (const path of pages) {
      const { ctx, page, bytes } = await open(browser, { lang, width, path, who: path === "/cart" || path === "/checkout" ? "basket" : null });
      expect(await page.evaluate(WIDE), `${path} (${lang}) at ${width} px scrolls sideways`).toEqual([]);
      if (width === 390 && lang !== "fr") weights.push(`${path.startsWith("/o/") ? "/o/<code>" : path} ${lang}: ${await bytes()} bytes (${((await bytes()) / 1024).toFixed(1)} KB)`);
      if (path === waiting || path === "/checkout") {
        // one primary action: no basket, no WhatsApp order button, no bottom bar while the order waits for its tap
        expect(await page.locator("header a[data-basket]").count(), path).toBe(0);
        expect(await page.locator("[data-bottom]").count(), path).toBe(0);
      }
      if (lang === "ar" && OUT) await shoot(page, `web4a${path === "/" ? "-frame-home" : path.startsWith("/o/") ? "-order" : path.replace(/\?.*$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "")}-${width}-ar.png`, width);
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web4a-weights-pages.txt"), weights.join("\n") + "\n");
  }, 1_800_000);
});
