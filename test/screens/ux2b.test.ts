// UX2b: screenshots of the five pages (Approve, Intake, Money, Settings, Riders) at 390 and 1280 px, Arabic and English, for docs/screens/ux2b beside the
// design reference's matching screens. Skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI does not install:
//   SCREENS=/tmp/shots npx vitest run test/screens/ux2b.test.ts
// The console runs its real pages over the real migrations (as test/screens/ux2a.test.ts). Invented data only; nothing is sent anywhere. Pictures are
// stand-in drawings served for the fake media address, so the screens show where a pack photo or a payment screenshot goes.
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { deliver, dropAtHub, openShop, placeOrder, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
// Anything that sticks out of the window, ignoring what scrolls inside its own box (a table's wrapper, the tab bar).
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-tabs, .ak-board"); }).slice(0, 6).map((e) => e.tagName + "." + e.className + " <" + (e.textContent || "").trim().slice(0, 30) + ">")`;
const WIDTHS = [390, 1280] as const;
const MAX_H = 3000;
const view = (width: number) => ({ width, height: width === 390 ? 844 : 900 });
const SVG = (w: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#EFE9DA"/><rect x="120" y="120" width="360" height="560" rx="28" fill="#FAF8F3" stroke="#C9A227" stroke-width="6"/><text x="300" y="400" font-size="34" text-anchor="middle" fill="#0E0F12" font-family="sans-serif">${w}</text><text x="300" y="450" font-size="22" text-anchor="middle" fill="#6B6A63" font-family="sans-serif">invented photo</text></svg>`;

describe.skipIf(!OUT)("UX2b screenshots: Approve, Intake, Money, Settings, Riders", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs the five pages", async () => {
    const r = await rig();
    const db = r.db;
    r.deps.supabaseUrl = "https://media.test";                                           // lets the page's content policy show the stand-in pictures
    const village = await openShop(db);
    const people = { lead: await r.staff("ops_lead", "Example lead"), admin: await r.staff("admin", "Example admin"), picker: await r.staff("picker", "Example picker") };
    // ---- invented data ----
    const rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rider one') returning id`)).id as string;
    const rider2 = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rider two') returning id`)).id as string;
    await db.rpc("start_shift", { p_driver: rider });
    await db.rpc("record_rider_terms", { p_driver: rider, p_by: people.lead.partyId, p_reference: "Rider terms v1, signed copy", p_signed_on: "2026-11-10", p_path: `rider_terms/${rider}/2026-11-10/a.pdf` });
    for (let i = 0; i < 3; i++) { const o = await placeOrder(db, village, "cod", 14 + i); await deliver(db, o.id, rider); await db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 }); if (i === 0) await dropAtHub(db, rider, people.lead.partyId); }
    const toDrop = await placeOrder(db, village, "cod", 12); await deliver(db, toDrop.id, rider); await db.rpc("rider_collect", { p_order: toDrop.id, p_driver: rider, p_usd: toDrop.total, p_lbp: 0 });
    await db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: toDrop.total, p_lbp: 0 });
    void rider2;                                                                           // the second rider is off shift, holds nothing and has no terms on file
    await db.rpc("record_petty_cash", { p_usd: 3.5, p_lbp: 0, p_reason: "bin bags and tape", p_name: "Hala", p_by: people.lead.partyId, p_receipt_path: null, p_key: "shot-petty" });
    for (const m of ["whish", "omt"] as const) { const o = await placeOrder(db, village, m, 15); await db.rpc("submit_payment_proof", { p_party: o.customer, p_wamid: `wamid.shot.${o.id}`, p_media_path: `payment_proofs/${o.id}.jpg`, p_sha256: `shot-${o.id}` }); }
    const paid = await placeOrder(db, village, "cod", 40); await deliver(db, paid.id, rider); await db.rpc("rider_collect", { p_order: paid.id, p_driver: rider, p_usd: paid.total, p_lbp: 0 });
    await db.rpc("refund_order", { p_order: paid.id, p_by: people.lead.partyId, p_amount_usd: 25, p_charged_to: "goods", p_reason: "damaged", p_settle: "credit", p_ref: null, p_note: null, p_item: null, p_key: "shot-refund" });
    await db.rpc("set_fx_rate", { p_lbp_per_usd: 89500, p_by: people.admin.partyId });
    await db.rpc("set_fx_rate", { p_lbp_per_usd: 95000, p_by: people.admin.partyId });
    await db.rpc("change_setting", { p_key: "timers", p_field: "draft_min", p_value: "75", p_by: people.admin.partyId, p_reason: "longer drafts for the pilot" });
    await db.rpc("change_setting", { p_key: "hours", p_field: "open", p_value: JSON.stringify("07:30"), p_by: people.admin.partyId, p_reason: "earlier opening" });
    await db.rpc("change_setting", { p_key: "cash_cap", p_field: "hard_usd", p_value: "175", p_by: people.admin.partyId, p_reason: "the weekend rush" });
    const food = await db.all(`select id from products where is_active and category = 'Snacks & Candy' order by sku limit 3`);
    const lp = (p: string, s: string) => `labels/${p}/2026-11-16/${s}.jpg`;
    for (const x of [food[0].id, food[1].id]) for (const s of ["front", "back"]) await db.rpc("record_label_capture", { p_product: x, p_shot: s, p_media_path: lp(x, s), p_by: people.lead.partyId });
    const scan = (p: string, reading: object) => db.rpc("record_label_scan", { p_product: p, p_photos: [lp(p, "front"), lp(p, "back")], p_model: "test", p_by: people.lead.partyId, p_reading: reading });
    await scan(food[0].id, { facts: [{ attribute: "milk", value: "contains", quote: "Contains milk" }, { attribute: "halal", value: "yes", quote: "Halal" }], fields: { warnings_as_printed: ["Contains caffeine."] } });
    await scan(food[1].id, { claims: [{ code: "high_protein", quote: "High protein" }] });
    const [p1] = await db.all(`select id from products where is_active order by sku limit 1`);
    await db.rpc("propose_product_image", { p_product: p1.id, p_source_kind: "open_food_facts", p_source_url: "https://images.example.test/1.jpg", p_page_url: "https://world.openfoodfacts.org/product/1",
      p_attribution: "Open Food Facts contributors, CC BY-SA 3.0", p_media_path: "product_images/shot/1.jpg", p_sha256: "shot-sha-1", p_width: 1200, p_height: 900, p_bytes: 120000, p_vision: { keep: true, rank: 1 } });
    await db.pg.query(`update product_name_proposals set ar_source = 'model_written' where sku = (select sku from product_name_proposals order by sku limit 1)`);

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
      ["admin", "approve", "/approve?tab=names"], ["admin", "approve-labels", "/approve?tab=labels"], ["admin", "approve-money", "/approve?tab=money"],
      ["lead", "intake", "/intake"], ["picker", "intake-photograph", "/capture"], ["lead", "intake-approvals", "/label-queue"], ["lead", "intake-readiness", "/readiness"],
      ["lead", "money", "/money"], ["lead", "money-confirm", "/payments"], ["lead", "money-drops", "/money/drops"], ["lead", "money-refunds", `/refunds?order=${paid.code}`],
      ["admin", "settings", "/settings"], ["lead", "riders", "/riders"]];
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    for (const width of WIDTHS) for (const lang of ["en", "ar"]) for (const who of Object.keys(people) as (keyof typeof people)[]) {
      const ctx = await browser.newContext({ viewport: view(width), deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: "light", locale: "en-GB", timezoneId: "Asia/Beirut" });
      await ctx.route("https://media.test/**", (route: any) => route.fulfill({ contentType: "image/svg+xml", body: SVG(/rider_terms/.test(route.request().url()) ? "terms" : /payment/.test(route.request().url()) ? "payment screenshot" : /labels/.test(route.request().url()) ? "label photo" : "product picture") }));
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", people[who].email); await page.fill("input[name=password]", people[who].password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [, name, path] of plan.filter(([w]) => w === who)) {
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        if (width === 390) expect(await page.evaluate(WIDE), `${path} (${lang}) at 390 px scrolls sideways`).toEqual([]);
        // every control is at least 44 px tall and wide on a phone, so the page works with one thumb
        if (width === 390) expect(await page.evaluate(`[...document.querySelectorAll("main a.ak-btn, main button, main input:not([type=hidden]):not([type=checkbox]):not([type=file]), main select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.outerHTML.slice(0, 80))`), `${path} (${lang}) has a control under 44 px`).toEqual([]);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.min(Math.max(h, view(width).height), MAX_H) });
        await page.screenshot({ path: join(OUT!, `ux2b-${name}-${width}-${lang}.png`) });
        await page.setViewportSize(view(width));
        shots++;
      }
      await ctx.close();
    }
    await browser.close();
    expect(shots).toBe(plan.length * 4);
  }, 1_200_000);
});
