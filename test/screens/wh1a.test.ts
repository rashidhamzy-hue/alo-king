// WH1a: screenshots of the warehouse pages (purchase orders, receiving against one, the printed order, bins, the temperature log, Stock's
// use-soon lots, the picker's runner with bins and lots) at 390 and 1280 px, Arabic and English, for docs/screens/wh1a. Skipped unless SCREENS
// names a folder, because it needs Playwright's Chromium, which CI does not install:
//   SCREENS=docs/screens/wh1a npx vitest run test/screens/wh1a.test.ts
// The console runs its real pages over the real migrations (as test/screens/ux2b.test.ts). Invented data only; nothing is sent anywhere.
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { openShop, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-tabs, .ak-board"); }).slice(0, 6).map((e) => e.tagName + "." + e.className + " <" + (e.textContent || "").trim().slice(0, 30) + ">")`;
const WIDTHS = [390, 1280] as const;
const MAX_H = 4000;
const view = (width: number) => ({ width, height: width === 390 ? 844 : 900 });
const day = (n: number) => new Date(Date.now() + n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#EFE9DA"/><text x="300" y="400" font-size="34" text-anchor="middle" font-family="sans-serif">thermometer (invented)</text></svg>`;

describe.skipIf(!OUT)("WH1a screenshots: purchase orders, receiving, bins, temperature, stock, the runner", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs the warehouse pages", async () => {
    const r = await rig();
    const db = r.db;
    r.deps.supabaseUrl = "https://media.test";
    const village = await openShop(db);
    const people = { lead: await r.staff("ops_lead", "Example lead"), picker: await r.staff("picker", "Example picker") };
    const L = people.lead.partyId, P = people.picker.partyId;
    const src = r.source;
    const prod = async (n: string) => (await db.one(`select id from products where name_en = $1`, [n])).id as string;
    const labneh = await prod("Leen Taanayel Labneh Premium"), coffee = await prod("Najjar Cafe Classic Normal 180G"), water = await prod("Tannourine Mineral Water 2L X6");
    const bread = await prod("Al Forno Pita White Bread Big 800G");
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1`, [labneh]);
    // ---- invented data ----
    const sup = await db.rpc("create_supplier", { p_name: "Example Dairy", p_by: L, p_phone: "+9610000000", p_terms: "30 days" });
    const sup2 = await db.rpc("create_supplier", { p_name: "Example Drinks", p_by: L, p_phone: null, p_terms: "cash on delivery" });
    const open = await db.rpc("create_purchase_order", { p_supplier: sup, p_source: src, p_expected: day(1), p_by: L, p_note: "Morning delivery, please",
      p_lines: [{ product_id: labneh, qty: 24, unit_cost_usd: 0.5 }, { product_id: coffee, qty: 12 }, { product_id: bread, qty: 10, unit_cost_usd: 0.6 }] });
    const got = await db.rpc("create_purchase_order", { p_supplier: sup2, p_source: src, p_expected: day(0), p_by: L,
      p_lines: [{ product_id: labneh, qty: 30, unit_cost_usd: 0.5 }, { product_id: water, qty: 20, unit_cost_usd: 2.1 }] });
    const gl = await db.all(`select id from purchase_order_lines where po_id = $1 order by position`, [got.po_id]);
    await db.rpc("receive_purchase_order", { p_po: got.po_id, p_by: P, p_supplier_ref: "INV-2001", p_lines: [
      { line_id: gl[0].id, counted: 26, damaged: 2, lot: "L-0412", expiry_date: day(1), note: "two lids split" }, { line_id: gl[1].id, counted: 20, lot: "W-88", expiry_date: day(240) }] });
    for (const [code, zone] of [["A1", "ambient"], ["A2", "ambient"], ["F1", "fresh"], ["C1", "chilled"]] as const) await db.rpc("create_bin", { p_source: src, p_code: code, p_zone: zone, p_by: L });
    const bin = async (code: string) => (await db.one(`select id from bins where code = $1`, [code])).id;
    await db.rpc("set_product_bin", { p_source: src, p_product: water, p_bin: await bin("A1"), p_by: L });
    await db.rpc("set_product_bin", { p_source: src, p_product: coffee, p_bin: await bin("A2"), p_by: L });
    await db.rpc("set_product_bin", { p_source: src, p_product: labneh, p_bin: await bin("C1"), p_by: L });
    await db.rpc("record_temperature", { p_source: src, p_zone: "chilled", p_reading_c: 3.5, p_photo: `temperature/${src}/${day(0)}/a.jpg`, p_by: P });
    await db.rpc("record_temperature", { p_source: src, p_zone: "chilled", p_reading_c: 7.2, p_photo: `temperature/${src}/${day(0)}/b.jpg`, p_by: P, p_note: "Door left open; closed it, checked again in 15 minutes" });
    // an order on the picker's runner: the labneh from its lot, the coffee from stock with no lot
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-shot", p_phone: "+96170000999", p_name: "Example customer" });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
    const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: labneh, qty: 4 }, { product_id: coffee, qty: 2 }, { product_id: water, qty: 1 }],
      p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: "w-shot" });
    await db.rpc("start_pick", { p_order: o.order_id, p_by: P });

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
    const plan: [keyof typeof people, string, string][] = [
      ["lead", "purchase-orders", "/purchase-orders"], ["lead", "purchase-order-new", "/purchase-orders?new=1"],
      ["picker", "receiving", `/purchase-orders/${open.po_id}`], ["lead", "received", `/purchase-orders/${got.po_id}`],
      ["lead", "print-en", `/purchase-orders/${open.po_id}/print?lang=en`], ["lead", "print-ar", `/purchase-orders/${open.po_id}/print?lang=ar`],
      ["lead", "bins", "/bins"], ["lead", "suppliers", "/receiving"], ["picker", "temperature", "/temperature"], ["lead", "stock", "/stock"], ["picker", "runner", `/pick/${o.order_id}`]];
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    for (const width of WIDTHS) for (const lang of ["en", "ar"]) for (const who of Object.keys(people) as (keyof typeof people)[]) {
      const ctx = await browser.newContext({ viewport: view(width), deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: "light", locale: "en-GB", timezoneId: "Asia/Beirut" });
      await ctx.route("https://media.test/**", (route: any) => route.fulfill({ contentType: "image/svg+xml", body: SVG }));
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", people[who].email); await page.fill("input[name=password]", people[who].password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [, name, path] of plan.filter(([w]) => w === who)) {
        if (/print-/.test(name) && lang === "ar") continue;                                // the print's language is its own: one shot each
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        if (name === "purchase-order-new") await page.evaluate(`document.querySelector("main details.ak-more")?.setAttribute("open", "")`);
        await page.evaluate("document.fonts.ready");
        if (width === 390) expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
        if (width === 390) expect(await page.evaluate(`[...document.querySelectorAll("main a.ak-btn, main button, main input:not([type=hidden]):not([type=checkbox]):not([type=file]), main select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.outerHTML.slice(0, 80))`), `${path} (${lang}) has a control under 44 px`).toEqual([]);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.min(Math.max(h, view(width).height), MAX_H) });
        await page.screenshot({ path: join(OUT!, `wh1a-${name}-${width}${/print-/.test(name) ? "" : `-${lang}`}.png`) });
        await page.setViewportSize(view(width));
        shots++;
      }
      await ctx.close();
    }
    await browser.close();
    expect(shots).toBe((plan.length - 2) * 4 + 2 * 2);
  }, 1_200_000);
});
