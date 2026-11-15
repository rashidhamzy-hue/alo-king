// Screenshots of D4b's pages for a pull request (docs/NEXT_SESSIONS.md, rule 8): the pick queue, one order's list, the packing steps, rider
// jobs and rider incidents; 390 and 1440 px, Arabic and English, light and dark. Skipped unless SCREENS names a folder (it needs Playwright's
// Chromium, which CI does not install):   SCREENS=/tmp/shots npx vitest run test/screens/pick-rider.test.ts
// The pages run over the real migrations with invented data (the same rig as every console test); nothing here is real.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handle } from "../../apps/console/src/app";
import { registry } from "../../apps/console/src/pages";
import { openShop, placeOrder, rig } from "../../apps/console/test/kit";

const OUT = process.env.SCREENS;
const WIDE = `document.documentElement.scrollWidth <= window.innerWidth + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return (document.dir === "rtl" ? r.left < -1 : r.right > window.innerWidth + 1) && !e.closest(".ak-table-wrap, main table, .ak-cmdk, pre"); }).slice(0, 5).map((e) => e.tagName + "." + e.className)`;

describe.skipIf(!OUT)("screenshots of the pick queue and rider jobs", () => {
  let close: (() => void) | undefined;
  afterAll(() => close?.());

  it("photographs them", async () => {
    const r = await rig();
    const db = r.db;
    const village = await openShop(db);
    const lead = await r.staff("ops_lead", "Example lead");
    const picker = await r.staff("picker", "Example picker");
    const addRider = async (name: string) => (await db.one(`insert into parties(role, display_name) values ('driver', $1) returning id`, [name])).id as string;
    const act = (driver: string, action: string, more: Record<string, unknown> = {}) => db.rpc("act_for_rider", { p_by: lead.partyId, p_driver: driver, p_action: action, ...more });
    const one = await addRider("Example rider one"), two = await addRider("Example rider two"), three = await addRider("Example rider three");
    await db.pg.query(`update settings set value = value || '{"console_queue": true}' where key = 'picking'`);

    // the queue: four orders at different ages, one note, one being picked by the picker
    const orders = [] as Awaited<ReturnType<typeof placeOrder>>[];
    // order 0 has four lines, so the pick list has something to show; the others are one line, as the shared rig places them
    const prod = async (name: string) => (await db.one(`select id from products where name_en = $1`, [name])).id as string;
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-shot", p_phone: "+96170000999", p_name: "Example customer" });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
    const lines = [{ product_id: await prod("Leen Taanayel Labneh Premium"), qty: 6 }, { product_id: await prod("Tannourine Mineral Water 2L X6"), qty: 2 },
      { product_id: await prod("Najjar Cafe Classic Normal 180G"), qty: 1 }, { product_id: await prod("Al Forno Pita White Bread Big 800G"), qty: 3 }];
    const big = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: lines, p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: "Ring the bell twice. Allergic to nuts." });
    await db.rpc("confirm_order_checked", { p_order: big.order_id, p_party: t.party_id, p_wamid: "w-shot" });
    orders.push({ id: big.order_id } as Awaited<ReturnType<typeof placeOrder>>);
    for (const qty of [14, 16, 18, 20]) orders.push(await placeOrder(db, village, "cod", qty));
    const eta = Number((await db.one(`select z.base_eta_minutes as m from villages v join zones z on z.id = v.zone_id where v.id = $1`, [village])).m);
    for (const [i, age] of [[0, eta + 12], [1, Math.round(eta * 0.8)], [2, Math.round(eta * 0.3)], [3, 4], [4, 1]] as const)
      await db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2::int) where id = $1`, [orders[i]!.id, age]);
    await db.pg.query(`update orders set customer_notes = 'Please no plastic bag, I have my own.' where id = $1`, [orders[1]!.id]);

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

    // order 0 is being picked by the picker: one line ticked, the others not; orders 1 to 3 were picked and packed by the lead
    const pickup = async (order: string, by: string) => {
      await db.rpc("start_pick", { p_order: order, p_by: by });
      const ids = (await db.all(`select id from order_items where order_id = $1 and status = 'ok'`, [order])).map((x) => x.id as string);
      for (const id of ids) await db.rpc("pick_mark_line", { p_item: id, p_by: by, p_picked: true });
      await db.rpc("finish_pick_packed", { p_order: order, p_by: by, p_packing: { checked: ["cold_bag", "eggs_bread_top", "bag_label"] } });
    };
    for (const i of [1, 2, 3]) await pickup(orders[i]!.id, lead.partyId);
    await db.rpc("start_pick", { p_order: orders[0]!.id, p_by: picker.partyId });
    const first = await db.all(`select id from order_items where order_id = $1 and status = 'ok'`, [orders[0]!.id]);
    await db.rpc("pick_mark_line", { p_item: first[0]!.id, p_by: picker.partyId, p_picked: true });

    await act(one, "start_shift"); await act(two, "start_shift"); await act(three, "start_shift");
    await act(one, "assign", { p_order: orders[2]!.id });
    const d1 = (await db.one(`select id from deliveries where driver_id = $1`, [one])).id;
    await act(one, "picked_up", { p_delivery: d1 });
    await act(one, "arrived", { p_order: orders[2]!.id });
    await act(one, "delivered", { p_order: orders[2]!.id });              // delivered, cash not yet recorded
    // rider two is offered order 3 by the system (the cron's step) and has not answered
    await db.rpc("offer_delivery", { p_driver: two, p_orders: [orders[3]!.id] });
    // rider three holds a job in progress for a prepaid order? keep it simple: a rider with cash and no job
    await db.pg.query(`insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
      select gen_random_uuid(), ensure_account('driver_cash:' || $1::text, 'driver_cash', $1), 40, 'USD', 40, 'invented cash'`, [three]).catch(() => undefined);
    await act(three, "start_shift");
    // a stranded order for the incidents page: rider three takes order 1, goes on the road, is marked off
    await act(three, "assign", { p_order: orders[1]!.id });
    const d3 = (await db.one(`select id from deliveries where driver_id = $1 and status = 'accepted'`, [three])).id;
    await act(three, "picked_up", { p_delivery: d3 });
    await db.rpc("mark_rider_off", { p_driver: three, p_by: lead.partyId, p_reason: "cannot_continue" });

    const only = (process.env.PAGES ?? "").split(",").filter(Boolean);
    const all: [string, string, "lead" | "picker"][] = [
      ["pick-queue", "/pick", "picker"], ["pick-list", `/pick/${orders[0]!.id}`, "picker"], ["pick-missing", `/pick/${orders[0]!.id}?missing=${first[1]!.id}`, "picker"], ["pick-done", `/pick/${orders[0]!.id}/done`, "picker"],
      ["pick-queue-lead", "/pick", "lead"], ["rider-jobs", "/rider-jobs", "lead"], ["rider-incidents", "/rider-incidents", "lead"]];
    const pages = only.length ? all.filter(([n]) => only.includes(n)) : all;
    mkdirSync(OUT!, { recursive: true });
    let shots = 0;
    const who = { lead, picker };
    for (const width of [390, 1440]) for (const lang of ["en", "ar"]) for (const theme of ["light", "dark"]) for (const role of ["picker", "lead"] as const) {
      const mine = pages.filter(([, , rl]) => rl === role);
      if (!mine.length) continue;
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1, colorScheme: theme, locale: "en-GB", timezoneId: "Asia/Beirut" });
      const page = await ctx.newPage();
      await page.goto(`${base}/sign-in`);
      await page.fill("input[name=email]", who[role].email); await page.fill("input[name=password]", who[role].password);
      await Promise.all([page.waitForURL(`${base}/`), page.click("button")]);
      await page.goto(`${base}/lang?to=${lang}&next=/`);
      for (const [name, path] of mine) {
        const res = await page.goto(base + path);
        expect(res?.status(), path).toBe(200);
        await page.evaluate("document.fonts.ready");
        if (width === 390) expect(await page.evaluate(WIDE), `${path} at 390 px scrolls sideways`).toEqual([]);
        const h = await page.evaluate("document.documentElement.scrollHeight") as number;
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
