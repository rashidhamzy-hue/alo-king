// UX2a: screenshots of the six staff pages (Today, Inbox, Orders, Pick, Dispatch, Stock) at 390 and 1280 px, Arabic and English, for docs/screens/ux2a
// beside the design reference's matching screens. Skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI does
// not install:   SCREENS=/tmp/shots npx vitest run test/screens/ux2a.test.ts
// The console runs its real pages over the real migrations (as test/screens/ds2.test.ts). Invented data only; nothing is sent anywhere.
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { deliver, openShop, placeOrder, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0; }).slice(0, 5).map((e) => e.tagName + "." + e.className)`;
const WIDTHS = [390, 1280] as const;
const MAX_H = 2600;
const view = (width: number) => ({ width, height: width === 390 ? 844 : 900 });

describe.skipIf(!OUT)("UX2a screenshots: the six staff pages", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs Today, Inbox, Orders (list and one order), Pick (queue and runner), Dispatch and Stock", async () => {
    const r = await rig();
    const db = r.db;
    const village = await openShop(db);
    const people = { lead: await r.staff("ops_lead", "Example lead"), picker: await r.staff("picker", "Example picker") };
    // ---- invented data: two riders (one holding cash), orders at every stage, a late one, a gift order with its code, cases at different waits, stock out and low ----
    const rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rider one') returning id`)).id as string;
    const rider2 = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rider two') returning id`)).id as string;
    await db.rpc("start_shift", { p_driver: rider }); await db.rpc("start_shift", { p_driver: rider2 });
    for (let i = 0; i < 4; i++) { const o = await placeOrder(db, village, "cod", 14 + i); const d = await deliver(db, o.id, rider); if (i < 3) await db.rpc("rider_collect", { p_order: o.id, p_driver: rider, p_usd: o.total, p_lbp: 0 }); void d; }       // delivered; three paid in cash (the rider holds it), one not yet recorded
    const toPick = await placeOrder(db, village, "cod", 12);
    const late = await placeOrder(db, village, "cod", 13); await db.pg.query(`update orders set confirmed_at = now() - interval '70 minutes' where id = $1`, [late.id]);
    const picking = await placeOrder(db, village, "cod", 15);
    const packed = await placeOrder(db, village, "cod", 16);
    const gift = await placeOrder(db, village, "cod", 18); await db.pg.query(`update orders set handover_required = true, handover_code = '4827', missing_pref = 'best_match' where id = $1`, [gift.id]);
    const other = await r.staff("picker", "Example picker two");
    for (const [o, who] of [[picking, people.picker], [packed, other]] as const) await db.rpc("start_pick", { p_order: o.id, p_by: who.partyId });
    const lines = await db.all(`select id from order_items where order_id = $1`, [packed.id]);
    for (const l of lines) await db.rpc("pick_mark_line", { p_item: l.id, p_by: other.partyId, p_picked: true });
    await db.rpc("finish_pick_packed", { p_order: packed.id, p_by: other.partyId, p_packing: { checked: [] } });
    await db.rpc("raise_ops_exception", { p_kind: "pick_empty", p_ref: picking.code, p_detail: {} });
    for (const [o, mins, kind] of [[toPick, 7, "complaint"], [late, 17, "person_requested"], [gift, 2, "order_problem"]] as const) {
      await db.pg.query(`update conversations set last_inbound_at = now() where id = $1`, [o.conversation]);
      const id = (await db.rpc("open_case", { p_conversation: o.conversation, p_kind: kind, p_topic: kind === "complaint" ? "the order is late" : null, p_order: o.id, p_source: "model" })).case_id;
      await db.pg.query(`update handoffs set ladder_from = now() - make_interval(mins => $2) where id = $1`, [id, mins]);
    }
    const prod = await db.all(`select id from products where is_active order by sku limit 3`);
    await db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where product_id = $1`, [prod[0].id]);
    await db.pg.query(`update stock_levels set on_hand = 4, reserved = 1, reorder_point = 10 where product_id = $1`, [prod[1].id]);

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
    const plan: [keyof typeof people, string, (w: number) => string][] = [
      ["lead", "today", () => "/"], ["lead", "inbox", () => "/inbox"], ["lead", "orders", (w) => (w === 1280 ? `/orders?open=${gift.id}` : "/orders")], ["lead", "order", () => `/orders/${gift.code}`],
      ["picker", "pick", () => "/pick"], ["picker", "pick-runner", () => `/pick/${picking.id}`], ["lead", "dispatch", () => "/rider-jobs"], ["picker", "stock", () => "/stock"]];
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    for (const width of WIDTHS) for (const lang of ["en", "ar"]) for (const who of Object.keys(people) as (keyof typeof people)[]) {
      const ctx = await browser.newContext({ viewport: view(width), deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: "light", locale: "en-GB", timezoneId: "Asia/Beirut" });
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", people[who].email); await page.fill("input[name=password]", people[who].password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [, name, path] of plan.filter(([w]) => w === who)) {
        const res = await page.goto(base + path(width));
        expect(res?.status(), path(width)).toBe(200);
        await page.evaluate("document.fonts.ready");
        if (width === 390) expect(await page.evaluate(WIDE), `${path(width)} (${lang}) at 390 px scrolls sideways`).toEqual([]);
        // every control is at least 44 px tall and wide on a phone, so the page works with one thumb
        if (width === 390) expect(await page.evaluate(`[...document.querySelectorAll("main a.ak-btn, main button, main input:not([type=hidden]):not([type=checkbox]), main select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).slice(0, 5).map((e) => e.outerHTML.slice(0, 80))`), `${path(width)} (${lang}) has a control under 44 px`).toEqual([]);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.min(Math.max(h, view(width).height), MAX_H) });
        await page.screenshot({ path: join(OUT!, `ux2a-${name}-${width}-${lang}.png`) });
        await page.setViewportSize(view(width));
        shots++;
      }
      await ctx.close();
    }
    await browser.close();
    expect(shots).toBe(plan.length * 4);
  }, 900_000);
});
