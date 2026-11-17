// DS1 (docs/strategy/05, sections A and C): the redesigned shell and flagship screens. What is new and can break: the six groups, the
// command bar, the bell, the appearance switch, the fonts from our own address, the gallery on staging only, Today's tiles counted
// from the database, and Orders as a table with filters, sorting, a drawer, columns and a logged CSV export.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "../src/app";
import { registry } from "../src/pages";
import { kpiData } from "../src/pages/today";
import { deliver, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); village = await openShop(r.db); }, 120_000);
const lead = async (role: "admin" | "ops_lead" | "picker" = "ops_lead", name = "Maya") => { const who = await r.staff(role, name); const b = r.browser(); await b.signIn(who); return { ...who, b }; };

describe("the shell", () => {
  it("groups the pages as section A says, hides Vendors from every menu, and keeps its route", async () => {
    const { b } = await lead("admin", "Rasheed");
    const page = (await b.get("/")).text;
    const side = /<aside class="sidebar"[\s\S]*?<\/aside>/.exec(page)![0];
    const heads = [...side.matchAll(/<(?:summary|a href="[^"]+"[^>]*)>(?:<svg[\s\S]*?<\/svg>)<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Today", "Inbox", "Orders", "Approve", "Stock", "Money", "Riders", "Settings"]);
    for (const [group, href] of [["Money", "/payments"], ["Riders", "/riders"], ["Money", "/refunds"], ["Settings", "/staff"], ["Settings", "/templates"], ["Settings", "/zones"], ["Stock", "/readiness"], ["Approve", "/names"]] as const) {
      const block = side.split("<details").find((x) => x.includes(`<span>${group}</span>`))!;
      expect(block, `${href} under ${group}`).toContain(`href="${href}"`);
    }
    expect(page).not.toContain('href="/merchants"'); expect((await b.get("/more")).text).not.toContain('href="/merchants"');
    expect((await b.get("/merchants")).status).toBe(200);
    // the group you are in is open and marked; the pages merged into Today and the Inbox keep them current
    expect(/<details open><summary>(?:<svg[\s\S]*?<\/svg>)<span>Money<\/span>/.test((await b.get("/payments")).text)).toBe(true);
    expect((await b.get("/exceptions")).text).toMatch(/<a href="\/" aria-current="page">/);
    expect((await b.get("/cases")).text).toMatch(/<a href="\/inbox" aria-current="page">/);
  });

  it("has a command bar that lists every page the role may open and searches orders for leads, the catalog for a picker", async () => {
    const { b } = await lead();
    const page = (await b.get("/")).text;
    const bar = /<dialog class="ak-cmdk"[\s\S]*?<\/dialog>/.exec(page)![0];
    expect(bar).toContain('action="/go"'); expect(bar).toContain('name="q"');
    for (const href of ["/", "/inbox", "/orders", "/payments", "/names", "/catalog", "/templates", "/more"]) expect(bar, href).toContain(`<a href="${href}">`);
    expect(bar).not.toContain('href="/staff"');                                   // admin only
    expect(page).toContain("data-open-cmdk");
    const p = await lead("picker", "Pia");
    const pbar = /<dialog class="ak-cmdk"[\s\S]*?<\/dialog>/.exec((await p.b.get("/")).text)![0];
    expect(pbar).toContain('action="/go"'); expect(pbar).not.toContain("/orders"); expect(pbar).not.toContain("/payments");
  });

  it("the bell carries the open high-priority exceptions, the ones a phone is told about, and nothing for a picker", async () => {
    await r.db.rpc("raise_ops_exception", { p_kind: "allergen_complaint", p_ref: "case-ds1", p_detail: {} });
    await r.db.rpc("raise_ops_exception", { p_kind: "count_needed", p_ref: "shelf-ds1", p_detail: {} });
    const { b } = await lead();
    const bell = /<details class="ak-bell"[\s\S]*?<\/details>/.exec((await b.get("/orders")).text)![0];
    expect(bell).toContain("Allergen complaint"); expect(bell).toContain('href="/cases"'); expect(bell).not.toContain("A shelf count is needed");
    expect(bell).toMatch(/<span class="ak-count">\d+<\/span>/); expect(bell).toContain('href="/exceptions"');
    const p = await lead("picker", "Pia");
    expect((await p.b.get("/")).text).not.toContain('class="ak-bell"');
    await r.db.pg.exec(`update ops_exceptions set status = 'resolved' where ref in ('case-ds1', 'shelf-ds1')`);
  });

  it("the appearance is the person's own choice, kept in a cookie; the default follows the phone", async () => {
    const { b } = await lead();
    expect((await b.get("/")).text).toContain('<html lang="en" dir="ltr">');
    const sw = await b.get("/theme?to=dark&next=/more");
    expect(sw.status).toBe(303); expect(sw.location).toBe("/more");
    expect((await b.get("/")).text).toContain('<html lang="en" dir="ltr" data-theme="dark">');
    expect((await b.get("/theme?to=dark&next=//evil.example")).location).toBe("/");
    await b.get("/theme?to=purple&next=/");
    expect((await b.get("/")).text).toContain('data-theme="dark"');
    await b.get("/theme?to=auto&next=/");
    expect((await b.get("/")).text).toContain('<html lang="en" dir="ltr">');
    expect((await b.get("/more")).text).toContain('href="/theme?to=light&amp;next=/more"');
  });

  it("serves the fonts from its own address, to anyone, and allows fonts from nowhere else", async () => {
    const anon = r.browser();
    for (const f of ["plex-latin-400", "plex-latin-600", "plex-arabic-400", "plex-arabic-600"]) {
      const res = await handle(new Request(`https://console.test/fonts/${f}.woff2`), r.deps, registry);
      expect(res.status, f).toBe(200); expect(res.headers.get("content-type")).toBe("font/woff2");
      expect(new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer()).slice(0, 4))).toBe("wOF2");
    }
    expect((await anon.get("/fonts/nope.woff2")).status).toBe(303);
    const { b } = await lead();
    const res = await b.get("/");
    expect(res.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(res.text).toContain('rel="preload" href="/fonts/plex-latin-400.woff2" as="font" type="font/woff2" crossorigin');
    await b.get("/lang?to=ar&next=/");
    expect((await b.get("/")).text).toContain('href="/fonts/plex-arabic-400.woff2"');
    const css = (await anon.get("/console.css")).text;
    expect(css).toContain("/fonts/plex-arabic-600.woff2");
  });

  it("shows the gallery on staging and in tests, in both languages, and never in production", async () => {
    const { b } = await lead();
    const g = await b.get("/gallery");
    expect(g.status).toBe(200); expect(g.text).toContain("The crown"); expect(g.text).toContain("Measured contrast"); expect(g.text).not.toMatch(/\sstyle="/);
    await b.get("/lang?to=ar&next=/");
    expect((await b.get("/gallery")).text).toContain("التاج");
    await b.get("/lang?to=en&next=/");
    expect((await b.get("/more")).text).toContain('href="/gallery"');
    const prod = { ...r.deps, environment: "production" };
    const pb = r.browser(); pb.cookies = b.cookies;
    const res = await handle(new Request("https://console.test/gallery", { headers: { cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } }), prod, registry);
    expect(res.status).toBe(404);
    const more = await handle(new Request("https://console.test/more", { headers: { cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } }), prod, registry);
    expect(await more.text()).not.toContain('href="/gallery"');
  });
});

describe("Today's tiles", () => {
  it("count orders and goods (never the rider's fee), on-time against the zone's ETA, and compare the same hours of yesterday", async () => {
    const rider = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
    await r.db.rpc("start_shift", { p_driver: rider });
    const a = await placeOrder(r.db, village), b2 = await placeOrder(r.db, village), old = await placeOrder(r.db, village);
    await deliver(r.db, a.id, rider); await r.db.rpc("rider_collect", { p_order: a.id, p_driver: rider, p_usd: a.total, p_lbp: 0 });
    const eta = Number((await r.db.one(`select z.base_eta_minutes as m from villages v join zones z on z.id = v.zone_id where v.id = $1`, [village])).m);
    // one delivered inside the zone time, one yesterday (an hour into that day) delivered late; a test order (a probe) is never counted
    await r.db.pg.query(`update orders set confirmed_at = delivered_at - make_interval(mins => $2::int) where id = $1`, [a.id, eta - 1]);
    await r.db.pg.query(`update orders set created_at = date_trunc('day', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut' - interval '23 hours 59 minutes', status = 'closed',
      confirmed_at = now() - interval '1 day' - interval '3 hours', delivered_at = now() - interval '1 day' - interval '3 hours' + make_interval(mins => $2::int) where id = $1`, [old.id, eta + 30]);
    const probe = await placeOrder(r.db, village);
    await r.db.pg.query(`update parties set is_probe = true where id = $1`, [probe.customer]);
    const { b } = await lead();
    const c = { deps: r.deps } as any;
    const k = (await kpiData(c))!;
    const goods = Number((await r.db.one(`select sum(subtotal_usd) as s from orders where id = any($1::uuid[])`, [`{${a.id},${b2.id}}`])).s);
    expect(k.today.orders).toBe(2); expect(k.today.sales).toBeCloseTo(goods, 2);
    expect(k.today.sales).toBeLessThan(a.total + b2.total);                       // the delivery fee is the rider's (invariant 10)
    expect(k.today).toMatchObject({ delivered: 1, onTime: 1 });
    expect(k.yesterday.orders).toBe(1);
    expect(k.days).toHaveLength(7); expect(k.days[6]!.orders).toBe(1);
    const page = (await b.get("/")).text;
    expect(page).toContain("Sales, goods only"); expect(page).toContain("vs yesterday, same hours"); expect(page).toContain("1 of 1 deliveries"); expect(page).toContain("100%");
    expect(page).toContain('class="ak-spark"'); expect(page).toContain("data-live");
    expect(page).not.toMatch(/Contribution|Reply time|Missing-item/i);             // no source yet: left out, listed for AN1
    // riders against the caps as a bar that says what it draws; a picker sees no money tiles
    expect(page).toMatch(/class="ak-bar[^"]*" role="img" aria-label="\$[\d.]+ of the \$[\d.]+ hard cap"/);
    const p = await lead("picker", "Pia");
    const pp = (await p.b.get("/")).text;
    expect(pp).not.toContain("Sales, goods only"); expect(pp).toContain('class="ak-board"');
  });
});

describe("Orders as a table", () => {
  it("filters by status, channel, payment, village and day through the address; sorts; chooses columns; pages; never shows a phone", async () => {
    const o = await placeOrder(r.db, village, "whish");
    const { b } = await lead();
    const all = (await b.get("/orders")).text;
    expect(all).toContain('class="ak-table"'); expect(all).toContain(`href="/orders/${o.id}"`); expect(all).not.toMatch(/\+?961\d{7,}/);
    const whish = (await b.get("/orders?payment=whish")).text;
    expect(whish).toContain(`href="/orders/${o.id}"`); expect(whish).not.toMatch(/<td>cod<\/td>/);
    expect((await b.get("/orders?status=awaiting_payment")).text).toContain(`href="/orders/${o.id}"`);
    expect((await b.get("/orders?status=closed")).text).not.toContain(`href="/orders/${o.id}"`);
    expect((await b.get("/orders?status=open&channel=web")).text).toContain("No order matches.");
    expect((await b.get(`/orders?village=${village}`)).text).toContain(`href="/orders/${o.id}"`);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(new Date());
    expect((await b.get(`/orders?from=${today}&to=${today}`)).text).toContain(`href="/orders/${o.id}"`);
    expect((await b.get(`/orders?to=2020-01-01`)).text).toContain("No order matches.");
    // a filter that is not one is ignored, never passed on
    expect((await b.get(`/orders?status=x'--&village=1&from=yesterday&sort=drop`)).status).toBe(200);
    // sorting is a link, and the server sorts
    const byTotal = (await b.get("/orders?sort=total&dir=asc")).text;
    const totals = [...byTotal.matchAll(/<td class="num"><bdi>\$([\d.]+)<\/bdi><\/td>/g)].map((m) => Number(m[1]));
    expect(totals.length).toBeGreaterThan(2); expect([...totals].sort((x, y) => x - y)).toEqual(totals);
    expect(byTotal).toContain('aria-sort="ascending"'); expect(byTotal).toContain("sort=total&amp;dir=desc");
    // columns
    const few = (await b.get("/orders?col=status&col=total")).text;
    expect(few).not.toContain(">Village</th>"); expect(few).toContain(">Total<");
    // a search keeps the other filters
    expect((await b.get(`/orders?q=${o.code}&payment=cod`)).text).toContain("No order matches.");
    expect((await b.get(`/orders?q=${o.code}&payment=whish`)).text).toContain(`href="/orders/${o.id}"`);
  });

  it("opens an order in a drawer beside the list, with the same story and the same two buttons as its page", async () => {
    const o = await placeOrder(r.db, village);
    const { b } = await lead();
    const page = (await b.get(`/orders?open=${o.id}`)).text;
    expect(page).toContain("<h1>Orders</h1>"); expect(page).toContain('<aside class="ak-drawer" id="order"'); expect(page).toContain(`<h2>${o.code}</h2>`);
    expect(page).toContain("Leen Taanayel Labneh Premium"); expect(page).toContain(`action="/orders/${o.id}/eval"`); expect(page).toContain('aria-selected="true"');
    expect(page).toContain(`data-drawer="/orders?open=${o.id}"`);
    expect(page).toMatch(/<a class="ak-drawer-scrim" href="\/orders"/);                        // closing is the list's own address
    expect((await b.get(`/orders?status=open&open=${o.id}`)).text).toContain('href="/orders?status=open"');
    expect((await b.get("/orders?open=AK-0000")).text).toContain("That order was not found.");
  });

  it("exports what the filters show as CSV, logged first, with no phone number, and not at all if the log cannot be written", async () => {
    const o = await placeOrder(r.db, village, "omt");
    const who = await lead("admin", "Rasheed");
    const res = await who.b.get("/orders.csv?payment=omt");
    expect(res.status).toBe(200); expect(res.headers.get("content-type")).toContain("text/csv"); expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="orders-\d{4}-\d\d-\d\d\.csv"/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("order,status,customer,village,total_usd,payment,channel,placed_utc");
    expect(lines.slice(1).every((l) => l.includes(",omt,"))).toBe(true); expect(lines.some((l) => l.startsWith(o.code + ","))).toBe(true);
    expect(res.text).not.toMatch(/961\d{7,}/);
    const log = (await r.actions()).filter((a) => a.action === "orders_export");
    expect(log.at(-1)).toMatchObject({ party_id: who.partyId, phase: "event" }); expect(log.at(-1)!.args).toMatchObject({ payment: "omt" });
    r.media.failPut = true;
    try { const refused = await who.b.get("/orders.csv"); expect(refused.status).toBe(503); expect(refused.text).not.toContain(o.code); } finally { r.media.failPut = false; }
    const p = await lead("picker", "Pia");
    expect((await p.b.get("/orders.csv")).status).toBe(403);
  });

  it("writes a cell a spreadsheet would run as a formula as text", async () => {
    const o = await placeOrder(r.db, village);
    await r.db.pg.query(`update parties set display_name = '=HYPERLINK("http://x","y")' where id = $1`, [o.customer]);
    const { b } = await lead();
    const line = (await b.get(`/orders.csv?q=${o.code}`)).text.split("\r\n").find((l) => l.startsWith(o.code))!;
    expect(line).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});

describe("the Inbox, in two languages", () => {
  it("shows cases as rows with a timer and who has them, in Arabic when chosen; the complaints page is its second tab", async () => {
    const a = await placeOrder(r.db, village);
    await r.db.pg.query(`update conversations set last_inbound_at = now() where id = $1`, [a.conversation]);
    const id = (await r.db.rpc("open_case", { p_conversation: a.conversation, p_kind: "complaint", p_topic: "late", p_order: a.id, p_source: "model" })).case_id;
    const { b } = await lead();
    const en = (await b.get("/inbox")).text;
    expect(en).toContain(`<a class="ak-case" href="/inbox/${id}">`); expect(en).toContain("nobody yet"); expect(en).toContain('class="ak-timer'); expect(en).toContain('href="/cases"');
    await b.get("/lang?to=ar&next=/");
    const ar = (await b.get("/inbox")).text;
    expect(ar).toContain('<main id="main">'); expect(ar).toContain("شكوى"); expect(ar).toContain("لا أحد بعد");
    expect((await b.get(`/inbox/${id}`)).text).toContain('class="ak-chat"');
  });
});
