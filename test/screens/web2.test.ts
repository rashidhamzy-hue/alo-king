// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, the session's name) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// WEB2: screenshots of the basket, sign-in, checkout, the order page (waiting for the WhatsApp Confirm, then confirmed), history, account and
// "How it works", at 390 and 1280 px, in Arabic and English (the screens bucket, web2/, beside the reference's screens, ref-web-*),
// a check that nothing scrolls sideways at 390 px, and each page's weight on a first visit measured by the browser itself (nothing cached).
// Skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI does not install:
//   SCREENS=/tmp/shots/web2 npx vitest run test/screens/web2.test.ts
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
const root = fileURLToPath(new URL("../../apps/.web2-test/", import.meta.url));
const freePort = () => new Promise<number>((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0; }).map((e) => e.tagName + "." + e.className)`;

describe.skipIf(!OUT)("WEB2 screenshots", () => {
  let h: Hub; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
  const tokens: Record<string, string> = {}; const paths: Record<string, string> = {};
  beforeAll(async () => {
    h = await openHub({ pickerOnOps: false });
    const db = h.db;
    await db.pg.exec(`update settings set value = '{"open":"08:00","close":"22:00","tz":"Asia/Beirut"}' where key = 'hours';
                      update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    // one signed-in customer with a place, a basket, a waiting web order and a confirmed, paid one; and a visitor waiting on a code
    // (one customer per waiting card: a newer card replaces an older one that still waits, as in the chat)
    let n = 0;
    const customer = async () => {
      const c = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-screens-web2-${++n}`, p_phone: `+9617650000${n}`, p_name: "Test" });
      await db.rpc("save_customer_pin", { p_party: c.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
      const pl = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [c.party_id])).id;
      await db.rpc("set_place_details", { p_party: c.party_id, p_place: pl, p_building: "Stone house by the school", p_floor: "1" });
      await db.rpc("save_stated_restriction", { p_party: c.party_id, p_text: "no sesame" });
      return { c, place: pl };
    };
    let { c, place } = await customer();
    const signIn = async () => {
      const s = await db.rpc("web_session_start", { p_device: "screens" });
      const code = await db.rpc("web_link_code", { p_token: s.token });
      await db.rpc("claim_link_code", { p_party: c.party_id, p_code: code.code, p_wamid: `wamid-screens-${Math.random()}` });
      return s.token as string;
    };
    const fill = async (token: string) => { for (const [sku, q] of [["AK-0103", 2], ["AK-0080", 1], ["AK-0133", 3], ["AK-0042", 1]] as const) await db.rpc("cart_set_line", { p_token: token, p_sku: sku, p_qty: q, p_price_seen: null }); };
    tokens.user = await signIn(); await fill(tokens.user);
    ({ c, place } = await customer());
    const waitOn = await signIn(); await fill(waitOn);
    const w = await db.rpc("web_place_order", { p_token: waitOn, p_request_key: "req-screens-wait", p_place: place, p_slot: null, p_payment: "cod", p_cash: "usd", p_note: 50,
      p_missing: "best_match", p_items: { "AK-0080": "remove" }, p_notes: null, p_lang: "en" });
    paths.waiting = `/o/${w.short_code}?k=${w.link}`;
    ({ c, place } = await customer());
    const paid = await signIn(); await fill(paid);
    const p = await db.rpc("web_place_order", { p_token: paid, p_request_key: "req-screens-paid", p_place: place, p_slot: null, p_payment: "whish", p_cash: null, p_note: null,
      p_missing: "ask", p_items: {}, p_notes: null, p_lang: "en" });
    await db.rpc("confirm_order_checked", { p_order: p.order_id, p_party: c.party_id, p_wamid: "wamid-screens-paid" });
    await db.rpc("confirm_payment", { p_order: p.order_id, p_by: h.ops, p_external_ref: "WH-SCREENS", p_amount_usd: Number((await db.one(`select total_usd from orders where id = $1`, [p.order_id])).total_usd) });
    await db.rpc("start_pick", { p_order: p.order_id, p_by: h.picker });
    paths.confirmed = `/o/${p.short_code}?k=${p.link}`;
    const anon = await db.rpc("web_session_start", { p_device: "screens" });
    await db.rpc("cart_set_line", { p_token: anon.token, p_sku: "AK-0103", p_qty: 2, p_price_seen: null });
    await db.rpc("web_link_code", { p_token: anon.token });
    tokens.visitor = anon.token;

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

  it("photographs every WEB2 page at 390 and 1280 px in Arabic and English, weighs it cold, and nothing scrolls sideways", async () => {
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    mkdirSync(OUT!, { recursive: true });
    const village = (await h.db.one(`select id from villages where name_en = 'Baakline'`)).id;
    const shots: [string, string, "user" | "visitor" | null][] = [
      ["cart", "/cart", "user"], ["signin", "/signin?next=/checkout", "visitor"], ["checkout", "/checkout", "user"],
      ["order-waiting", paths.waiting!, null], ["order-confirmed", paths.confirmed!, null], ["orders", "/orders", "user"],
      ["account", "/account", "user"], ["how", "/how", null], ["aisle-added", "/c/dairy_eggs?added=AK-0042", "user"],
    ];
    const weights: string[] = [];
    for (const lang of ["en", "ar"] as const) for (const width of [390, 1280]) for (const [name, path, who] of shots) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: lang === "ar" ? "ar-LB" : "en-GB", timezoneId: "Asia/Beirut" });
      const cookies = [{ name: "lang", value: lang, url: base }, ...(who ? [{ name: "ak_session", value: tokens[who]!, url: base }] : []), ...(name === "cart" ? [{ name: "ak_village", value: village, url: base }] : [])];
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      const sizes: Promise<number>[] = [];
      page.on("response", (res: any) => { const u = new URL(res.url()); if (u.origin === base && !/\.(png|svg|webmanifest)$/.test(u.pathname)) sizes.push(res.body().then((b: Buffer) => b.length, () => 0)); });
      const res = await page.goto(base + path, { waitUntil: "networkidle" });
      expect(res?.status(), path).toBe(200);
      await page.evaluate("document.fonts.ready");
      const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
      if (width === 390) {
        expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
        expect(bytes, `${path} (${lang}) weighs ${bytes} bytes with its fonts`).toBeLessThan(100 * 1024);
        weights.push(`${name} ${lang}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
      }
      const hgt = await page.evaluate("document.documentElement.scrollHeight") as number;
      await page.setViewportSize({ width, height: Math.min(Math.max(hgt, 844), 2400) });
      await page.screenshot({ path: join(OUT!, `web2-${name}-${width}-${lang}.png`) });
      await ctx.close();
    }
    await browser.close();
    writeFileSync(join(OUT!, "web-weights.txt"), weights.join("\n") + "\n");
  }, 900_000);
});
