// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, session con1) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// CON1, a simple console, in a real browser (Playwright's Chromium; skipped unless SCREENS names a folder, because CI does not install a browser;
// apps/console/test/con1.test.ts checks the same through handle() on every pull request):
//   1. every address the console answered before CON1 reaches its page, following the 301 of a page that moved, as a browser does;
//   2. each role sees only its sections (picker: Pick and Stock; ops lead: the seven; admin: the seven and Settings);
//   3. screenshots of Today, Approvals, Orders and one Products page (Photos), at 390 and 1440 px, light and dark, Arabic and English, for the
//      screens bucket (con1/), with no sideways scroll on a phone and every control at least 44 px.
//   SCREENS=/tmp/shots npx vitest run test/screens/con1.test.ts
// The console runs its real pages over the real migrations. Invented data only; nothing is sent anywhere. Pictures are stand-in drawings.
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { openShop, placeOrder, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-tabs, .ak-board, .chips"); }).slice(0, 6).map((e) => e.tagName + "." + e.className + " <" + (e.textContent || "").trim().slice(0, 30) + ">")`;
const SMALL = `[...document.querySelectorAll("main a.ak-btn, main button, main input:not([type=hidden]):not([type=checkbox]):not([type=file]), main select, .bottom-nav a, .ak-assistant-btn, header.top .name-link, header.top .tool, header.top .who button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.outerHTML.slice(0, 80))`;
const WIDTHS = [390, 1440] as const;
const MAX_H = 3200;
const view = (width: number) => ({ width, height: width === 390 ? 844 : 900 });
const SVG = (w: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#FAF8F3"/><rect x="150" y="110" width="300" height="380" rx="28" fill="#EFE9DA" stroke="#C9A227" stroke-width="6"/><text x="300" y="310" font-size="30" text-anchor="middle" fill="#0E0F12" font-family="sans-serif">${w}</text></svg>`;
/** Pages answered before CON1 (each section's page and the hubs); the moved ones are followed through their 301. */
const BEFORE = ["/", "/inbox", "/orders", "/food", "/pick", "/rider-jobs", "/rider-incidents", "/exceptions", "/cases", "/approve", "/approvals", "/names", "/label-queue", "/auto-approvals",
  "/photos", "/pictures", "/gallery", "/intake", "/food-facts", "/readiness", "/search-words", "/weights", "/catalog", "/stock", "/purchase-orders", "/receiving", "/bins", "/capture",
  "/temperature", "/returns", "/riders", "/staff", "/places", "/listings", "/menus", "/merchants", "/money", "/money/drops", "/payments", "/refunds", "/day-open", "/day-close", "/fx",
  "/settings", "/zones", "/windows", "/templates", "/screens", "/more", "/install"];

describe.skipIf(!OUT)("CON1 in Chromium: old addresses, roles, and the screens of Today, Approvals, Orders and Photos", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("reaches every old address, shows each role its sections, and photographs the four pages", async () => {
    const r = await rig();
    const db = r.db;
    r.deps.supabaseUrl = "https://media.test";
    const village = await openShop(db);
    await db.pg.exec(readFileSync(fileURLToPath(new URL("../../scripts/staging/test-place.sql", import.meta.url)), "utf8"));
    const people = { admin: await r.staff("admin", "Example admin"), lead: await r.staff("ops_lead", "Example lead"), picker: await r.staff("picker", "Example picker") };
    // ---- invented data: a late order, one waiting for the customer's Confirm, a food order whose call ahead waits, a picture to approve ----
    const late = await placeOrder(db, village);
    await db.pg.query(`update orders set confirmed_at = now() - interval '55 minutes' where id = $1`, [late.id]);
    const waiting = await placeOrder(db, village);
    await db.pg.query(`update orders set status = 'awaiting_confirmation', confirmed_at = null where id = $1`, [waiting.id]);
    await placeOrder(db, village); await placeOrder(db, village);
    const kitchen = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
    const food = await placeOrder(db, village);
    await db.pg.query(`insert into place_calls(order_id, source_id, status, created_at) values ($1, $2, 'to_call', now() - interval '14 minutes')`, [food.id, kitchen]);
    const food2 = await placeOrder(db, village);
    await db.pg.query(`insert into place_calls(order_id, source_id, status, created_at, accepted_at) values ($1, $2, 'accepted', now() - interval '25 minutes', now() - interval '19 minutes')`, [food2.id, kitchen]);
    await db.rpc("raise_ops_exception", { p_kind: "allergen_complaint", p_ref: "case-con1", p_detail: { order: late.code } });
    const items = await db.all(`select id from products where is_active order by sku limit 3`);
    for (const [i, p] of items.entries()) await db.rpc("propose_product_image", { p_product: p.id, p_source_kind: "open_food_facts", p_source_url: `https://images.example.test/${i}.jpg`, p_page_url: `https://world.openfoodfacts.org/product/${i}`,
      p_attribution: "Open Food Facts contributors, CC BY-SA 3.0", p_media_path: `product_images/con1/${i}.jpg`, p_sha256: `con1-sha-${i}`, p_width: 1000, p_height: 1000, p_bytes: 60000, p_vision: { keep: true, rank: i + 1 } });

    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const ch of req) chunks.push(ch as Buffer);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), r.deps, registry);
      const h: Record<string, string | string[]> = {}; out.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
      const cookies = out.headers.getSetCookie().map((ck) => ck.replace(/;\s*Secure/gi, "")); if (cookies.length) h["set-cookie"] = cookies;
      res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    close = () => server.close();
    const base = `http://localhost:${port}`;

    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const signIn = async (who: keyof typeof people, ctxOpts: object = {}) => {
      const ctx = await browser.newContext({ locale: "en-GB", timezoneId: "Asia/Beirut", ...ctxOpts });
      await ctx.route("https://media.test/**", (route: any) => route.fulfill({ contentType: "image/svg+xml", body: SVG("product picture") }));
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", people[who].email); await page.fill("input[name=password]", people[who].password);
      await Promise.all([page.waitForLoadState("load"), page.click("button")]);
      return { ctx, page };
    };
    const headsOf = (page: any) => page.evaluate(`[...document.querySelectorAll("aside.sidebar > a:not(.side-brand) > span:first-of-type, aside.sidebar summary > span:first-of-type")].map((e) => e.textContent.trim())`);

    // 1. every old address reaches its page, as the admin (who may open them all)
    {
      const { ctx, page } = await signIn("admin", { viewport: view(1440) });
      for (const path of BEFORE) {
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        // one heading a page (the Menus page draws a second one of its own: MENU2 is rebuilding its insides, CON1 leaves it)
        if (path !== "/menus") expect(await page.locator("main h1").count(), path).toBe(1);
        expect(await page.content(), path).not.toContain("Not for your role");
      }
      expect(new URL(page.url()).pathname).toBe("/install");
      await page.goto(base + "/pictures"); expect(page.url()).toBe(`${base}/photos?f=list`);
      await page.goto(base + "/names"); expect(page.url()).toBe(`${base}/approve?tab=names&view=list`);
      await page.goto(base + "/intake"); expect(page.url()).toBe(`${base}/labels`);
      // 2. the admin's sections
      await page.goto(base + "/orders");
      expect(await headsOf(page)).toEqual(["Today", "Orders", "Approvals", "Products", "Stock", "People", "Money"]);
      await ctx.close();
    }
    // 2. the ops lead's and the picker's
    {
      const { ctx, page } = await signIn("lead", { viewport: view(1440) });
      await page.goto(base + "/orders");
      expect(await headsOf(page)).toEqual(["Today", "Orders", "Approvals", "Products", "Stock", "People", "Money"]);
      expect(await page.locator('aside.sidebar a[href="/staff"]').count()).toBe(0);
      expect((await page.goto(base + "/settings"))?.status()).toBe(403);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("picker", { viewport: view(1440) });
      expect(new URL(page.url()).pathname).toBe("/pick");
      expect(await headsOf(page)).toEqual(["Pick", "Stock"]);
      expect((await page.goto(base + "/approve"))?.status()).toBe(403);
      await ctx.close();
    }

    // 3. the screens
    const plan: [string, string][] = [["today", "/"], ["approve", "/approve?tab=photos"], ["orders", "/orders"], ["photos", "/photos"]];   // file names pair with the reference's ref-ops-<page>
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    for (const width of WIDTHS) for (const scheme of ["light", "dark"] as const) for (const lang of ["en", "ar"]) {
      const { ctx, page } = await signIn("admin", { viewport: view(width), deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: scheme });
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [name, path] of plan) {
        await page.setViewportSize(view(width));
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        if (width === 390) {
          expect(await page.evaluate(WIDE), `${path} (${lang}, ${scheme}) at 390 px scrolls sideways`).toEqual([]);
          expect(await page.evaluate(SMALL), `${path} (${lang}) has a control under 44 px`).toEqual([]);
          expect(await page.locator(".ak-assistant-btn").isVisible(), "the assistant's button on a phone").toBe(true);
        } else expect(await page.locator("aside.ak-assistant").isVisible(), "the assistant's panel at 1440 px").toBe(true);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.min(Math.max(h, view(width).height), MAX_H) });
        await page.screenshot({ path: join(OUT!, `con1-${name}-${width}-${scheme}-${lang}.png`) });
        shots++;
      }
      await ctx.close();
    }
    await browser.close();
    expect(shots).toBe(plan.length * WIDTHS.length * 4);
  }, 1_500_000);
});
