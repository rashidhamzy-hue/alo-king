// DOC2: screenshots are never committed (CI refuses an image under docs/). Run with SCREENS=<a folder outside the repository>, or dispatch the `screens` workflow
// (action shoot, this test file, the session's name) on the branch: it runs the test in Chromium and uploads the images to the private screens bucket.
// Screenshots of the console for a pull request (docs/NEXT_SESSIONS.md, rule 8): 390 and 1440 px, Arabic and English, light and dark.
// Not a test of behaviour: it is skipped unless SCREENS names a folder, because it needs a browser (Playwright's Chromium) that CI
// does not install.   SCREENS=/tmp/shots npx vitest run test/screens/console.test.ts
// (It lives in test/, which the type check does not read, because it uses Node and Playwright; the pages it drives are type-checked.)
// It runs the real pages over the real migrations (the same rig as every console test) with invented data, serves them on a local
// port, signs in as an invented admin and photographs the flagship screens. PAGES=/,/orders narrows it. Nothing here is real.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { deliver, openShop, placeOrder, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
// What sticks out of a phone screen, if anything (an element inside its own scrolling box does not count).
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && r.width > 0 && !e.closest(".ak-table-wrap, .ak-board, .ak-tabs, .skip"); }).slice(0, 4).map((e) => e.tagName + "." + e.className)`;

describe.skipIf(!OUT)("screenshots", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs the flagship screens", async () => {
    const r = await rig();
    const db = r.db;
    const village = await openShop(db);
    // ---- invented data: riders, orders at every stage, older orders for the comparisons, exceptions, cases ----
    const riders = [] as string[];
    const addRider = async (name: string) => { const id = (await db.one(`insert into parties(role, display_name) values ('driver', $1) returning id`, [name])).id as string; await db.rpc("start_shift", { p_driver: id }); riders.push(id); return id; };
    const first = await addRider("Rider one");
    const closed = [] as Awaited<ReturnType<typeof placeOrder>>[];
    for (let i = 0; i < 5; i++) { const o = await placeOrder(db, village, "cod", 12 + i); await deliver(db, o.id, first); await db.rpc("rider_collect", { p_order: o.id, p_driver: first, p_usd: i === 4 ? o.total - 2 : o.total, p_lbp: i === 4 ? 2 * 89500 : 0 }); closed.push(o); }
    await addRider("Rider two");
    const eta = Number((await db.one(`select z.base_eta_minutes as m from villages v join zones z on z.id = v.zone_id where v.id = $1`, [village])).m);
    // spread the closed ones over yesterday and last week, so the tiles have something to compare with
    await db.pg.query(`update orders set created_at = now() - interval '1 day' - interval '2 hours', confirmed_at = now() - interval '1 day' - interval '2 hours', delivered_at = now() - interval '1 day' - interval '95 minutes' where id = any($1::uuid[])`, [`{${closed.slice(0, 2).map((o) => o.id).join(",")}}`]);
    await db.pg.query(`update orders set created_at = now() - interval '7 days' - interval '1 hour', confirmed_at = now() - interval '7 days' - interval '1 hour', delivered_at = now() - interval '7 days' - interval '20 minutes' where id = $1`, [closed[2]!.id]);
    await db.pg.query(`update orders set created_at = now() - interval '3 hours', confirmed_at = now() - interval '3 hours', delivered_at = now() - interval '155 minutes' where id = any($1::uuid[])`, [`{${closed.slice(3).map((o) => o.id).join(",")}}`]);
    const open = [] as Awaited<ReturnType<typeof placeOrder>>[];
    for (let i = 0; i < 6; i++) open.push(await placeOrder(db, village, i === 4 ? "whish" : "cod", 12 + 2 * i));
    await db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2::int), created_at = now() - make_interval(mins => $2::int) where id = $1`, [open[0]!.id, eta + 14]);
    await db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2::int), created_at = now() - make_interval(mins => $2::int) where id = $1`, [open[1]!.id, Math.round(eta * 0.85)]);
    for (const [i, status] of [[1, "preparing"], [2, "ready"], [3, "out_for_delivery"]] as const) await db.pg.query(`update orders set status = $2 where id = $1`, [open[i]!.id, status]).catch(() => undefined);
    for (const o of open.slice(0, 3)) await db.pg.query(`insert into wa_messages(party_id, line, direction, type, body, order_id, wamid) select $1, 'customer', 'inbound', 'text', 'مرحبا، بدي لبنة وخبز', $2, 'w-s-' || $2`, [o.customer, o.id]).catch(() => undefined);
    await db.rpc("raise_ops_exception", { p_kind: "allergen_complaint", p_ref: "case-1", p_detail: { order: open[2]!.code } });
    const old = await db.rpc("raise_ops_exception", { p_kind: "count_needed", p_ref: "shelf-4", p_detail: { shelf: "A4" } });
    await db.pg.query(`update ops_exceptions set created_at = now() - interval '42 minutes' where id = $1`, [old]);
    await db.rpc("raise_ops_exception", { p_kind: "pick_empty", p_ref: open[1]!.code, p_detail: {} });
    await db.pg.query(`update conversations set last_inbound_at = now() where id = any($1::uuid[])`, [`{${open[0]!.conversation},${open[5]!.conversation}}`]);
    const caseA = (await db.rpc("open_case", { p_conversation: open[0]!.conversation, p_kind: "complaint", p_topic: "the order is late", p_order: open[0]!.id, p_source: "model" })).case_id as string;
    await db.rpc("open_case", { p_conversation: open[5]!.conversation, p_kind: "person_requested", p_topic: null, p_order: null, p_source: "customer_words" });
    await db.pg.query(`update handoffs set ladder_from = now() - interval '9 minutes' where id = $1`, [caseA]);

    const admin = await r.staff("admin", "Example admin");
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

    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const browser = await chromium.launch();
    const base = `http://localhost:${port}`;
    const all: [string, string][] = [["today", "/"], ["inbox", "/inbox"], ["case", `/inbox/${caseA}`], ["orders", "/orders"], ["order-drawer", `/orders?open=${open[2]!.id}`], ["order", `/orders/${open[2]!.id}`],
      ["more", "/more"], ["staff", "/staff"], ["templates", "/templates"], ["gallery", "/gallery"]];
    const only = (process.env.PAGES ?? "").split(",").filter(Boolean);
    const pages = only.length ? all.filter(([n, p]) => only.includes(n) || only.includes(p)) : all;
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    for (const width of [390, 1440]) for (const lang of ["en", "ar"]) for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: theme as "light" | "dark", locale: "en-GB", timezoneId: "Asia/Beirut" });
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", admin.email); await page.fill("input[name=password]", admin.password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [name, path] of pages) {
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        // no page may scroll sideways on a phone
        if (width === 390) expect(await page.evaluate(WIDE), `${path} at 390 px scrolls sideways`).toEqual([]);
        // the whole page, with the phone's fixed bar where it sits: at the bottom (the drawer is photographed as the screen shows it)
        const h = name === "order-drawer" ? 0 : await page.evaluate("document.documentElement.scrollHeight") as number;
        await page.setViewportSize({ width, height: Math.max(h, width === 390 ? 844 : 900) });
        await page.screenshot({ path: join(OUT!, `console-${name}-${width}-${lang}-${theme}.png`) });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        shots++;
      }
      await ctx.close();
    }
    await browser.close();
    expect(shots).toBe(pages.length * 8);
  }, 900_000);
});
