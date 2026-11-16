// LB1: the label day's capture page in a real browser (Playwright's Chromium, a phone-sized screen), with screenshots at 390 px in English
// and Arabic, and the behaviour the page's script exists for: a photo that fails to upload is kept in the phone and sent again (no signal, a
// server error, the page closed before it went), never lost; the page moves on to the next item by itself; the camera scan.
// Skipped unless SCREENS names a folder, because it needs a browser that CI does not install:   SCREENS=/tmp/shots npx vitest run test/screens/capture-lb1.test.ts
// (The server side, in CI: apps/console/test/capture-lb1.test.ts.) Invented data only; the photos are drawn in the browser.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { rig, type Rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-board, .ak-tabs, .skip"); }).slice(0, 4).map((e) => e.tagName + "." + e.className)`;

describe.skipIf(!OUT)("the capture page in a browser", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs the flow, keeps a photo that cannot be sent and sends it again, and scans", async () => {
    const r: Rig = await rig();
    const picker = await r.staff("picker", "Example picker");
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
    mkdirSync(OUT!, { recursive: true });
    const dir = mkdtempSync(join(tmpdir(), "lb1-photos-"));

    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const newPhone = async (lang: "en" | "ar", init?: string) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-GB", timezoneId: "Asia/Beirut" });
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", picker.email); await page.fill("input[name=password]", picker.password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/capture`);
      return { ctx, page };
    };
    // Photos drawn in the browser (so no binary is kept in the repository), one file each.
    const draw = async (page: any, name: string, label: string) => {
      const url: string = await page.evaluate((t: string) => {
        const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const g = c.getContext("2d")!;
        g.fillStyle = "#f4efe6"; g.fillRect(0, 0, 1600, 1200); g.fillStyle = "#222"; g.font = "bold 90px sans-serif"; g.fillText(t, 80, 220);
        g.font = "48px sans-serif"; for (let i = 0; i < 9; i++) g.fillText("Ingredients: example text line " + i + " " + t, 80, 330 + i * 70);
        return c.toDataURL("image/jpeg", 0.9);
      }, label);
      const path = join(dir, name); writeFileSync(path, Buffer.from(url.split(",")[1]!, "base64")); return path;
    };
    const waitRows = async (product: string, n: number, ms = 20000) => {
      const end = Date.now() + ms;
      for (;;) {
        const got = (await r.db.one(`select count(*)::int as n from label_captures where product_id = $1 and superseded_at is null`, [product])).n as number;
        if (got >= n) return got;
        if (Date.now() > end) throw new Error(`only ${got} of ${n} captures for ${product}`);
        await new Promise((k) => setTimeout(k, 150));
      }
    };
    const product = (page: any) => page.getAttribute("[data-capture]", "data-product") as Promise<string>;
    const shot = async (page: any, name: string) => { await page.evaluate("document.fonts.ready"); await page.screenshot({ path: join(OUT!, `capture-${name}.png`), fullPage: true }); };
    const noSideways = async (page: any, where: string) => expect(await page.evaluate(WIDE), `${where} scrolls sideways at 390 px`).toEqual([]);

    // ---------------- English: the flow, one item to the next ----------------
    {
      const { ctx, page } = await newPhone("en");
      await page.goto(`${base}/capture`);
      await noSideways(page, "capture en");
      await shot(page, "1-start-en-390");
      const first = await product(page);
      expect(await page.isHidden("[data-scan]")).toBe(true);                          // no camera scanner in this browser: the typed number and the list remain
      await page.setInputFiles("input[data-shot=front]", await draw(page, "front.jpg", "FRONT 1"));
      await page.waitForSelector("[data-slot=front][data-status=done]");
      await waitRows(first, 1);
      await shot(page, "2-front-saved-en-390");
      await page.setInputFiles("input[data-shot=back]", await draw(page, "back.jpg", "BACK 1"));
      await page.waitForSelector("[data-slot=back][data-status=done]");
      await page.waitForURL((u: URL) => u.pathname === "/capture" && u.searchParams.has("item") && u.searchParams.get("item") !== first, { timeout: 10000 });   // on to the next item by itself
      const second = await product(page);
      expect(second).not.toBe(first);
      expect(await page.textContent("[data-count-done]")).toBe("1");
      await noSideways(page, "capture next item en");
      await shot(page, "3-next-item-en-390");
      await page.goto(`${base}/capture/list`);
      await noSideways(page, "list en");
      await shot(page, "4-list-en-390");
      await page.goto(`${base}/capture?code=${encodeURIComponent((await r.db.one(`select barcode from products where is_active and intake_barcode_key(barcode) is not null order by sku offset 40 limit 1`)).barcode)}`);
      expect(await page.getAttribute("[data-capture]", "data-product")).toBeTruthy();
      await ctx.close();
    }

    // ---------------- Arabic ----------------
    {
      const { ctx, page } = await newPhone("ar");
      await page.goto(`${base}/capture`);
      expect(await page.evaluate("document.dir")).toBe("rtl");
      await noSideways(page, "capture ar");
      await shot(page, "1-start-ar-390");
      const id = await product(page);
      await page.setInputFiles("input[data-shot=front]", await draw(page, "front-ar.jpg", "FRONT AR"));
      await page.waitForSelector("[data-slot=front][data-status=done]");
      await waitRows(id, 1);
      await shot(page, "2-front-saved-ar-390");
      await page.goto(`${base}/capture/list`);
      await noSideways(page, "list ar");
      await shot(page, "4-list-ar-390");
      await ctx.close();
    }

    // ---------------- a photo that cannot be sent is kept, and sent again ----------------
    {
      const { ctx, page } = await newPhone("en");
      const id = (await r.db.one(`select id from products where is_active and not exists (select 1 from label_captures c where c.product_id = products.id) order by sku offset 100 limit 1`)).id as string;
      await page.goto(`${base}/capture?item=${id}`);
      // (1) no signal: kept on the phone, shown as waiting, sent when the network is back
      await ctx.setOffline(true);
      await page.setInputFiles("input[data-shot=front]", await draw(page, "off-front.jpg", "OFFLINE FRONT"));
      await page.waitForSelector("[data-slot=front][data-status=waiting]");
      await page.waitForSelector("[data-pending]:not([hidden])");
      await shot(page, "5-waiting-offline-en-390");
      expect(await page.evaluate(() => new Promise<number>((ok) => { const q = indexedDB.open("ak-capture", 1); q.onsuccess = () => { const t = q.result.transaction("photos"); const g = t.objectStore("photos").count(); g.onsuccess = () => ok(g.result); }; }))).toBe(1);
      expect((await r.db.one(`select count(*)::int as n from label_captures where product_id = $1`, [id])).n).toBe(0);
      await ctx.setOffline(false);
      await page.waitForSelector("[data-slot=front][data-status=done]", { timeout: 20000 });
      await waitRows(id, 1);
      await page.waitForFunction(() => new Promise<boolean>((ok) => { const q = indexedDB.open("ak-capture", 1); q.onsuccess = () => { const g = q.result.transaction("photos").objectStore("photos").count(); g.onsuccess = () => ok(g.result === 0); }; }), null, { timeout: 5000 });   // removed from the phone only once the server had it
      expect(await page.isHidden("[data-pending]")).toBe(true);

      // (2) the server answers with an error twice: the page tries again by itself
      let failures = 0;
      await page.route("**/capture/photo", (route: any) => (failures++ < 2 ? route.fulfill({ status: 502, contentType: "application/json", body: '{"ok":false,"error":"storage","retry":true}' }) : route.continue()));
      await page.setInputFiles("input[data-shot=side]", await draw(page, "side.jpg", "SIDE"));
      await page.waitForSelector("[data-slot=side][data-status=waiting]");
      await page.waitForSelector("[data-slot=side][data-status=done]", { timeout: 30000 });
      expect(failures).toBeGreaterThanOrEqual(3);
      await waitRows(id, 2);

      // (3) the page is closed before the photo went: it is still in the phone, and goes when the page is opened again
      await page.unroute("**/capture/photo");
      await ctx.setOffline(true);
      await page.setInputFiles("input[data-shot=back]", await draw(page, "off-back.jpg", "OFFLINE BACK"));
      await page.waitForSelector("[data-slot=back][data-status=waiting]");
      await page.close();
      await ctx.setOffline(false);
      const again = await ctx.newPage();
      await again.goto(`${base}/capture?item=${id}`);
      await again.waitForSelector("[data-slot=back][data-status=done], [data-slot=back][data-status=waiting]");
      await waitRows(id, 3, 30000);
      expect((await r.db.one(`select count(*)::int as n from label_captures where product_id = $1 and superseded_at is null`, [id])).n).toBe(3);

      // (4) a refusal retrying cannot fix: kept, with the reason, and a button to send it again
      await again.goto(`${base}/capture?item=${id}`);
      await again.route("**/capture/photo", (route: any) => route.fulfill({ status: 422, contentType: "application/json", body: '{"ok":false,"error":"Your role cannot do this.","retry":false}' }));
      await again.setInputFiles("input[data-shot=front]", await draw(again, "refused.jpg", "REFUSED"));
      await again.waitForSelector("[data-slot=front][data-status=refused]");
      await again.waitForSelector("[data-retry]:not([hidden])");
      await shot(again, "6-refused-en-390");
      await again.unroute("**/capture/photo");
      await again.click("[data-retry]");
      await again.waitForSelector("[data-slot=front][data-status=done]", { timeout: 20000 });
      await ctx.close();
    }

    // ---------------- the camera scan (a stand-in detector: this browser has none) ----------------
    {
      const code = (await r.db.one(`select barcode from products where is_active and intake_barcode_key(barcode) is not null order by sku offset 12 limit 1`)).barcode as string;
      const init = `window.BarcodeDetector = class { constructor(){} async detect(){ return [{ rawValue: ${JSON.stringify(code)} }]; } };
        navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement("canvas"); c.width = 320; c.height = 240; c.getContext("2d").fillRect(0,0,320,240); return c.captureStream(); };`;
      const { ctx, page } = await newPhone("en", init);
      await page.goto(`${base}/capture`);
      expect(await page.isHidden("[data-scan]")).toBe(false);
      await Promise.all([page.waitForURL((u: URL) => u.pathname === "/capture" && u.searchParams.get("code") === code, { timeout: 10000 }), page.click("[data-scan]")]);
      const want = (await r.db.one(`select id from products where barcode = $1`, [code])).id;
      expect(await product(page)).toBe(want);
      await ctx.close();
    }
    await browser.close();
  }, 300_000);
});
