// WEB4b: the food pages in the reference's look. Screenshots are never committed: run with SCREENS=<a folder outside the repository>, or
// dispatch the `screens` workflow (action shoot, web4b.test.ts, session web4b) on the branch; they show on the console's Screens page (chip
// WEB4B) beside the reference's nearest screens (its own food screens had no kitchens: packages/core/src/screens.mjs, ALIAS).
//   * as a tester: /food (the places to order from above the listings), a place's menu, a dish's choices open (a required choice named),
//     the food basket, the "start a new basket?" question, the food checkout;
//   * at 390 and 1440 px, in Arabic, English and French; dark at 390 px in Arabic and English;
//   * nothing scrolls sideways; at most one filled call to action in the page's content (the founder's test);
//   * each page's weight on a first visit, measured by the browser, written to web4b-weights.txt for the pull request.
// Skipped unless SCREENS names a folder (it needs Playwright's Chromium):  SCREENS=/tmp/shots/web4b npx vitest run test/screens/web4b.test.ts
// The website runs built, in the Worker runtime, over the real migrations, the seed catalogue and FD2's invented test kitchen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer as netServer } from "node:net";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHub, type Hub } from "../db/hub-kit";
import { asSupabase } from "../db/harness";
import { channelCommerce, webCommerce } from "@ak/commerce/index";
import { encodeBasket } from "../../apps/web/src/lib/food-basket";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "../web/postgrest-fake";

const OUT = process.env.SCREENS;
const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const root = fileURLToPath(new URL("../../apps/.web4b-shots/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".no-scrollbar"); }).map((e) => e.tagName + "." + e.className)`;
const PRIMARY = `[...document.querySelectorAll("main [data-primary], main .ak-btn--gold, main .ak-btn--primary, main .ak-btn--whatsapp")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).length`;

describe.skipIf(!OUT)("WEB4b screenshots: the food pages", () => {
  let h: Hub; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
  let token = ""; let kitchen = ""; let second = ""; let basket = ""; let need = "";
  beforeAll(async () => {
    h = await openHub({ pickerOnOps: false });
    const db = h.db;
    await db.pg.exec(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    const sql = readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8");
    await db.pg.exec(sql);
    await db.pg.exec(sql.replaceAll("ak-test-kitchen-staging", "ak-second-kitchen-test").replaceAll("Alo King test kitchen", "Second test kitchen")
      .replaceAll("'test kitchen', 'مطبخ التجربة', 'مطبخ الاختبار'", "'second kitchen'").replaceAll("+96100000090", "+96100000091"));
    kitchen = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
    second = (await db.one(`select id from sources where listing_id = 'ak-second-kitchen-test'`)).id;
    await db.pg.query(`update sources set hours = '{"open":"00:00","close":"00:00"}' where id in ($1, $2)`, [kitchen, second]);
    const lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
    // a tester, signed in on the site by a WhatsApp code, with a saved place
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-screens-web4b", p_phone: "+96170000498", p_name: "Test" });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
    const at = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
    await db.rpc("set_place_details", { p_party: t.party_id, p_place: at, p_building: "Stone house by the school", p_floor: "1" });
    await db.rpc("set_tester", { p_by: lead, p_phone: "+96170000498", p_on: true });
    const w = webCommerce(asSupabase(db));
    const s = await w.startSession("screens");
    const code = await w.linkCode(s.token);
    if (!code.ok) throw new Error("no code");
    await channelCommerce(asSupabase(db)).claimLinkCode(t.party_id, code.code, "wamid-screens-web4b");
    token = s.token;
    const dish = async (name: string) => (await db.one(`select id from products where owner_source_id = $1 and name_en = $2`, [kitchen, name])).id as string;
    const opt = async (d: string, name: string) => (await db.one(`select o.id, o.group_id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = $2`, [d, name]));
    const sh = await dish("Chicken shawarma sandwich");
    const large = await opt(sh, "Large"); const saj = await opt(sh, "Saj"); const garlic = await opt(sh, "Extra garlic");
    basket = encodeBasket({ place: kitchen, lines: [{ product_id: sh, qty: 2, options: [large.id, saj.id, garlic.id] }, { product_id: await dish("Falafel sandwich"), qty: 1, options: [] },
      { product_id: await dish("Taouk plate"), qty: 1, options: [(await opt(await dish("Taouk plate"), "Garlic")).id] }] });
    need = `/food/place/${kitchen}?need=${sh}&g=${large.group_id}`;

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

  async function open(browser: any, o: { lang: string; width: number; dark?: boolean; path: string; status?: number }) {
    const ctx = await browser.newContext({ viewport: { width: o.width, height: 844 }, deviceScaleFactor: 2, colorScheme: o.dark ? "dark" : "light",
      locale: o.lang === "ar" ? "ar-LB" : o.lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Asia/Beirut" });
    await ctx.addCookies([{ name: "lang", value: o.lang, url: base }, { name: "ak_session", value: token, url: base }, { name: "ak_food", value: basket, url: base }]);
    const page = await ctx.newPage();
    const sizes: Promise<number>[] = [];
    page.on("response", (res: any) => { const u = new URL(res.url()); if (u.origin === base && !/\.(png|svg|webmanifest)$/.test(u.pathname)) sizes.push(res.body().then((b: Buffer) => b.length, () => 0)); });
    const res = await page.goto(base + o.path, { waitUntil: "networkidle" });
    expect(res?.status(), o.path).toBe(o.status ?? 200);
    await page.evaluate("document.fonts.ready");
    return { ctx, page, bytes: async () => (await Promise.all(sizes)).reduce((a, b) => a + b, 0) };
  }
  async function shoot(page: any, file: string, width: number) {
    const hgt = await page.evaluate("document.documentElement.scrollHeight") as number;
    await page.setViewportSize({ width, height: Math.min(Math.max(hgt, 844), 6000) });
    await page.screenshot({ path: join(OUT!, file) });
  }
  async function check(page: any, what: string) {
    expect(await page.evaluate(WIDE), `${what} scrolls sideways`).toEqual([]);
    expect(await page.evaluate(PRIMARY), `${what}: more than one primary action`).toBeLessThanOrEqual(1);
  }

  it("the food pages, 390 and 1440 px, Arabic, English and French; dark at 390", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    const weights: string[] = [];
    const pages: [string, string][] = [["food-list", "/food"], ["food-place", `/food/place/${kitchen}`], ["food-place-choose", need], ["food-basket", "/food/basket"], ["food-checkout", "/food/checkout"]];
    for (const lang of ["ar", "en", "fr"]) for (const width of [390, 1440]) {
      for (const [name, path] of pages) {
        const { ctx, page, bytes } = await open(browser, { lang, width, path });
        await check(page, `${path} (${lang}, ${width} px)`);
        if (name === "food-place-choose") expect(await page.locator("main details[open] [role=alert]").count()).toBe(1);
        if (name === "food-checkout") expect(await page.locator("[data-bottom]").count()).toBe(0);
        if (width === 390) weights.push(`${path.startsWith("/food/place/") ? path.replace(/[0-9a-f-]{36}/g, "<id>") : path} ${lang}: ${await bytes()} bytes (${((await bytes()) / 1024).toFixed(1)} KB)`);
        await shoot(page, `web4b-${name}-${width}-${lang}.png`, width);
        await ctx.close();
      }
      // a dish of a second place: the question
      const { ctx, page } = await open(browser, { lang, width, path: `/food/place/${second}` });
      await page.locator(`main li[data-dish] form button[type=submit]`).first().click();
      await page.waitForLoadState("networkidle");
      await check(page, `the new-basket question (${lang}, ${width} px)`);
      expect(await page.locator("main [data-primary]").count()).toBe(1);
      await shoot(page, `web4b-food-switch-${width}-${lang}.png`, width);
      await ctx.close();
    }
    for (const lang of ["ar", "en"]) for (const [name, path] of pages) {
      const { ctx, page } = await open(browser, { lang, width: 390, dark: true, path });
      await shoot(page, `web4b-${name}-390-${lang}-dark.png`, 390);
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web4b-weights.txt"), weights.join("\n") + "\n");
  }, 1_800_000);
});
