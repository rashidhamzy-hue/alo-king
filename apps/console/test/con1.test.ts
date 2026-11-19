// CON1, a simple console (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026"). Driven through handle() as a browser drives it
// (an older address's 301 is followed, as a browser follows it; test/screens/con1.test.ts does the same in Chromium):
//   - every address the console answered before CON1 still reaches its page, and the duplicates move into one page;
//   - each role sees only its sections (picker: Pick and Stock; ops lead: the seven; admin: the seven and Settings);
//   - the one Approvals inbox has a card for each kind, posting to the routes the older pages had, and comes back to the next card;
//   - Today lists what needs attention, most urgent first, each with one tap; then today's four numbers;
//   - Orders filters groceries and food; the assistant is on every lead's page (AST1; a picker has none); Sentry's count is read with a read-only token.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { MOVED } from "../src/app";
import { ADVANCED, GROUPS } from "../src/nav";
import { registry } from "../src/pages";
import { sentryErrors } from "../src/worker";
import { flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig;
let village: string;
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const p = await r.staff(role, name); const b = r.browser(); await b.signIn(p); return { ...p, b }; };
const side = (page: string) => /<aside class="sidebar"[\s\S]*?<\/aside>/.exec(page)?.[0] ?? "";
const heads = (page: string) => [...side(page).matchAll(/<(?:summary|a href="[^"]+"[^>]*)>(?:<svg[\s\S]*?<\/svg>)<span>([^<]+)<\/span>/g)].map((m) => m[1]);
const bar = (page: string) => [...(/<nav class="bottom-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "").matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

beforeAll(async () => {
  r = await rig();
  village = await openShop(r.db);
  await r.db.pg.exec(readFileSync(fileURLToPath(new URL("../../../scripts/staging/test-place.sql", import.meta.url)), "utf8"));
}, 180_000);

/** Every GET page the console answered before CON1 (each section's page and the hubs), and the page each must reach now. */
const BEFORE: [string, RegExp][] = [
  ["/", /Needs attention/], ["/inbox", /<h1>Inbox/], ["/orders", /<h1>Orders/], ["/food", /<h1>/], ["/pick", /<h1>/], ["/rider-jobs", /<h1>/], ["/rider-incidents", /<h1>/],
  ["/exceptions", /<h1>/], ["/cases", /<h1>/], ["/approve", /<h1>Approvals/], ["/approvals", /<h1>Approvals[\s\S]*Second approvals/], ["/names", /tab=names/],
  ["/label-queue", /Label approvals/], ["/auto-approvals", /Automatic approvals|Spot checks/], ["/photos", /<h1>Photos/], ["/pictures", /<h1>Product pictures/],
  ["/gallery", /<h1>Photos/], ["/intake", /<h1>Intake/], ["/food-facts", /<h1>/], ["/readiness", /<h1>Product readiness/], ["/search-words", /<h1>/], ["/weights", /<h1>/],
  ["/catalog", /<h1>/], ["/stock", /<h1>Stock/], ["/purchase-orders", /<h1>/], ["/receiving", /<h1>/], ["/bins", /<h1>/], ["/capture", /<h1>/], ["/temperature", /<h1>/],
  ["/returns", /<h1>/], ["/riders", /<h1>/], ["/staff", /<h1>/], ["/places", /<h1>/], ["/listings", /<h1>/], ["/menus", /<h1>/], ["/merchants", /<h1>/],
  ["/money", /<h1>/], ["/money/drops", /<h1>/], ["/payments", /<h1>/], ["/refunds", /<h1>/], ["/day-open", /<h1>/], ["/day-close", /<h1>/], ["/fx", /<h1>/],
  ["/settings", /<h1>/], ["/zones", /id="hub"/], ["/windows", /<h1>/], ["/templates", /<h1>/], ["/screens", /<h1>/], ["/more", /id="settings"/], ["/install", /<h1>/],
];

describe("old addresses", () => {
  it("every address the console answered before still reaches its page; the merged ones answer 301 to the page they live in now", async () => {
    const { b } = await who("admin", "Rasheed");
    for (const [path, mark] of BEFORE) {
      const res = await b.get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toMatch(mark);
      expect(res.text, path).not.toContain("Not for your role");
    }
    for (const [from, to] of Object.entries(MOVED)) {
      const res = await (b as any).go("GET", from);
      expect(res.status, from).toBe(301); expect(res.location, from).toBe(to);
    }
    // the query of an older address goes with it (a page number, a filter)
    expect((await (b as any).go("GET", "/pictures?status=approved&page=2")).location).toBe("/photos?f=list&status=approved&page=2");
    expect((await b.get("/pictures?status=approved")).text).toMatch(/<strong>approved<\/strong>/);
    // posts and item pages keep their addresses
    const product = (await r.db.one(`select id from products where is_active order by sku limit 1`)).id;
    expect((await b.get(`/intake/${product}`)).status).toBe(200);
    expect((await b.get(`/food-facts/${product}`)).status).toBe(200);
    expect((await (b as any).go("POST", "/names/batch/approve")).status).not.toBe(301);
  });

  it("every page of a section and every Advanced tool is in a menu: nothing is lost from the navigation", async () => {
    const listed = new Set([...GROUPS.flatMap((g) => g.hrefs), ...ADVANCED, "/more", "/merchants", "/assistant"]);   // AST1: the assistant is reached by its button on every lead's page
    const pages = registry.map((s) => s.nav.href).filter((h) => !Object.keys(MOVED).includes(h) && !["/exceptions", "/cases", "/rider-incidents", "/intake", "/food-facts"].includes(h));
    for (const h of pages) expect(listed.has(h), h).toBe(true);
  });
});

describe("roles", () => {
  it("an admin sees the seven sections and Settings behind the name, with Advanced", async () => {
    const { b } = await who("admin", "Rasheed2");
    const page = (await b.get("/orders")).text;
    expect(heads(page)).toEqual(["Today", "Orders", "Approvals", "Products", "Stock", "People", "Money"]);
    expect(bar(page)).toEqual(["/", "/orders", "/approve", "/stock", "/more"]);
    expect(page).toMatch(/<a class="name-link" href="\/more#settings"/);
    const more = (await b.get("/more")).text;
    for (const h of ["/settings", "/screens", "/templates", "/zones", "/windows", "/fx", "/components", "/zones#hub", "/staff"]) expect(more, h).toContain(`href="${h}"`);
    expect(more).toContain('id="advanced"');
  });

  it("an ops lead sees the seven sections and the tools their role opens, never Settings or Staff", async () => {
    const { b } = await who("ops_lead", "Maya");
    const page = (await b.get("/orders")).text;
    expect(heads(page)).toEqual(["Today", "Orders", "Approvals", "Products", "Stock", "People", "Money"]);
    expect(side(page)).not.toContain('href="/staff"');
    const more = (await b.get("/more")).text;
    expect(more).not.toContain('href="/settings"'); expect(more).not.toContain('href="/staff"');
    for (const h of ["/fx", "/windows", "/zones", "/templates"]) expect(more, h).toContain(`href="${h}"`);
    expect((await b.get("/settings")).status).toBe(403);
  });

  it("a picker sees Pick and Stock only, and Today is the pick queue", async () => {
    const { b } = await who("picker", "Pia");
    const home = await (b as any).go("GET", "/");
    expect(home.status).toBe(303); expect(home.location).toBe("/pick");
    const page = (await b.get("/pick")).text;
    expect(heads(page)).toEqual(["Pick", "Stock"]);
    expect(bar(page)).toEqual(["/pick", "/stock", "/capture", "/more"]);
    for (const h of ["/orders", "/approve", "/catalog", "/photos", "/riders", "/money", "/inbox", "/labels"]) expect(side(page), h).not.toContain(`href="${h}"`);
    const more = (await b.get("/more")).text;
    expect(more).not.toContain('id="advanced"'); expect(more).not.toContain('href="/settings"'); expect(more).not.toContain('href="/screens"');
    for (const h of ["/purchase-orders", "/receiving", "/bins", "/capture", "/temperature", "/returns"]) expect(more, h).toContain(`href="${h}"`);
    expect((await b.get("/approve")).status).toBe(403);
  });
});

describe("the one Approvals inbox", () => {
  it("has eight kinds with their counts and a card for a dish, a place and a spot check, each coming back to the next card", async () => {
    const { b } = await who("ops_lead", "Maya2");
    // a place made from a listing, with a menu photo the reading run read into one dish (as FD1's test does)
    const safa = "safa-chicken-boqaata";
    const baqaata = (await r.db.one(`select id from villages where name_en = 'Baqaata'`)).id;
    await b.post("/places/new", { listing: safa, name: "Safa Chicken", village_id: baqaata, prep_minutes: 20 });
    const src = (await r.db.one(`select id from sources where listing_id = $1`, [safa])).id;
    await r.db.rpc("record_menu_photo", { p_source: src, p_media_path: `menus/${src}/2026-11-19/a.jpg`, p_by: (await r.db.one(`select id from parties where display_name = 'Maya2'`)).id });
    const photo = (await r.db.rpc("menu_reading_queue", { p_limit: 5 }))[0].photo_id;
    await r.db.rpc("record_menu_reading", { p_photo: photo, p_by: await r.db.rpc("menu_reader_party", {}), p_model: "test", p_reading: { sections: [{ name_ar: "سندويشات", name_en: "Sandwiches", dishes: [
      { name_ar: "شاورما دجاج", name_en: "Chicken shawarma", translated: null, price: 5, currency: "USD", price_text: "$5", sizes: [], options: [], addons: [] }] }] } });
    const p = (await b.get("/approve")).text;
    for (const k of ["names", "photos", "labels", "dishes", "places", "second", "refunds", "auto"]) expect(p, k).toMatch(new RegExp(`href="/approve\\?tab=${k}"`));
    const dish = (await b.get("/approve?tab=dishes")).text;
    expect(dish).toContain('data-card="dishes"'); expect(dish).toContain("Chicken shawarma"); expect(dish).toContain('name="return_to" value="/approve?tab=dishes"');
    const id = (await r.db.one(`select id from menu_dish_proposals where name_en = 'Chicken shawarma'`)).id;
    const done = await b.post(`/menus/dish/${id}`, { source: src, decision: "approve", return_to: "/approve?tab=dishes" });
    expect(flashOf(done.text)).toBe("Approved at $5.00 today."); expect(b.lastPath).toBe("/approve?tab=dishes");
    const place = (await b.get("/approve?tab=places")).text;
    expect(place).toContain('data-card="places"'); expect(place).toContain("Safa Chicken"); expect(place).toContain(`action="/places/${src}/approve"`);
    const refused = await b.post(`/places/${src}/approve`, { return_to: "/approve?tab=places" });
    expect(flashOf(refused.text)).toBe("Stamp the menu as checked first (Menus page)."); expect(b.lastPath).toBe("/approve?tab=places");
    // an address that is not the inbox's is never followed
    await b.post(`/places/${src}/approve`, { return_to: "https://evil.example/" }); expect(b.lastPath).toBe(`/places/${src}`);
  });

  it("the older list pages are drawn under the inbox's kinds (view=list); a kind owned by another page goes there", async () => {
    const { b } = await who("ops_lead", "Maya3");
    const names = (await b.get("/approve?tab=names&view=list")).text;
    expect(names).toContain("Back to one card at a time"); expect(names).toMatch(/aria-current="page">Names/);
    const go = await (b as any).go("GET", "/approve?tab=dishes&view=list");
    expect(go.status).toBe(303); expect(go.location).toBe("/menus");
  });
});

describe("Today", () => {
  it("lists what needs attention, most urgent first, each with one tap; then orders, sales, delivery time and restaurant acceptance time", async () => {
    const { b } = await who("ops_lead", "Maya4");
    const late = await placeOrder(r.db, village);
    const eta = Number((await r.db.one(`select z.base_eta_minutes as m from villages v join zones z on z.id = v.zone_id where v.id = $1`, [village])).m);
    await r.db.pg.query(`update orders set confirmed_at = now() - make_interval(mins => $2::int) where id = $1`, [late.id, eta + 30]);
    const waiting = await placeOrder(r.db, village);
    await r.db.pg.query(`update orders set status = 'awaiting_confirmation', confirmed_at = null where id = $1`, [waiting.id]);
    // a food order whose call ahead has waited 15 minutes, and a place found closed today
    const kitchen = (await r.db.one(`select id, name from sources where listing_id = 'ak-test-kitchen-staging'`));
    const fo = await placeOrder(r.db, village);
    await r.db.pg.query(`insert into place_calls(order_id, source_id, status, created_at) values ($1, $2, 'to_call', now() - interval '15 minutes')`, [fo.id, kitchen.id]);
    const accepted = await placeOrder(r.db, village);
    await r.db.pg.query(`insert into place_calls(order_id, source_id, status, created_at, accepted_at) values ($1, $2, 'accepted', now() - interval '20 minutes', now() - interval '12 minutes')`, [accepted.id, kitchen.id]);
    await r.db.pg.query(`update sources set closed_on = (now() at time zone 'Asia/Beirut')::date where id = $1`, [kitchen.id]);
    const page = (await b.get("/")).text;
    const main = page.slice(page.indexOf("<main"));
    const at = (s: string) => main.indexOf(s);
    expect(at(`${late.code} is`)).toBeGreaterThan(0);
    expect(at(`${late.code} is`)).toBeLessThan(at("has not answered the call ahead"));
    expect(at("has not answered the call ahead")).toBeLessThan(at("was found closed today"));
    expect(at("was found closed today")).toBeLessThan(at(`${waiting.code} waits for the customer&#39;s Confirm`));
    expect(at(`${waiting.code} waits`)).toBeLessThan(at("approvals waiting"));
    expect(main).toMatch(new RegExp(`href="/orders/${late.id}"[\\s\\S]{0,300}?Open the order`));
    expect(main).toMatch(/href="\/food"[\s\S]{0,300}?Call the place/);
    expect(main).toContain("Sentry is not connected to the console yet");
    expect(main).toContain("Today&#39;s numbers"); expect(main).toContain("Average restaurant acceptance time"); expect(main).toMatch(/Average restaurant acceptance time[\s\S]{0,400}?8 min/);
    expect(main).toContain('class="ak-board"');                                                     // the live board is still there, folded
    await r.db.pg.query(`update sources set closed_on = null where id = $1`, [kitchen.id]);
  });

  it("shows Sentry's count of the last 24 hours with one tap to Sentry, and says when Sentry did not answer", async () => {
    const { b } = await who("ops_lead", "Maya5");
    r.deps.errorsLast24h = async () => ({ count: 7, link: "https://alo-king.sentry.io/issues/?statsPeriod=24h" });
    expect((await b.get("/")).text).toMatch(/7 errors in the last 24 hours[\s\S]{0,400}?href="https:\/\/alo-king\.sentry\.io\/issues\/\?statsPeriod=24h"/);
    r.deps.errorsLast24h = async () => null;
    expect((await b.get("/")).text).toContain("Sentry did not answer");
    delete r.deps.errorsLast24h;
  });

  it("reads the count from Sentry's events API with the read-only token, for this environment only, and fails to null", async () => {
    expect(sentryErrors({ ENVIRONMENT: "staging" })).toBeUndefined();
    const seen: string[] = [];
    const f = sentryErrors({ ENVIRONMENT: "staging", SENTRY_READ_TOKEN: "t", SENTRY_ORG: "alo-king", SENTRY_API: "https://de.sentry.io" },
      (async (u: string, init: RequestInit) => { seen.push(u, String((init.headers as Record<string, string>).authorization)); return new Response(JSON.stringify({ data: [{ "count()": 4 }] })); }) as never)!;
    expect(await f()).toEqual({ count: 4, link: "https://alo-king.sentry.io/issues/?statsPeriod=24h&query=environment%3Astaging" });
    expect(seen[0]).toMatch(/^https:\/\/de\.sentry\.io\/api\/0\/organizations\/alo-king\/events\/\?field=count\(\)&dataset=errors&statsPeriod=24h&query=event\.type%3Aerror%20environment%3Astaging$/);
    expect(seen[1]).toBe("Bearer t");
    const down = sentryErrors({ ENVIRONMENT: "staging", SENTRY_READ_TOKEN: "t", SENTRY_ORG: "alo-king" }, (async () => new Response("no", { status: 500 })) as never)!;
    expect(await down()).toBeNull();
    expect(sentryErrors({ ENVIRONMENT: "staging", SENTRY_READ_TOKEN: "t", SENTRY_ORG: "x/../y" })).toBeUndefined();
  });
});

describe("Orders, the assistant's place", () => {
  it("filters groceries and food together on one page, and marks a food order", async () => {
    const { b } = await who("ops_lead", "Maya6");
    const food = (await r.db.one(`select order_id from place_calls limit 1`)).order_id;
    const code = (await r.db.one(`select short_code from orders where id = $1`, [food])).short_code;
    const grocery = await placeOrder(r.db, village);
    const f = (await b.get("/orders?kind=food")).text;
    expect(f).toContain(code); expect(f).not.toContain(grocery.code); expect(f).toMatch(new RegExp(`${code}</strong></a> <span class="ak-badge`));
    const g = (await b.get("/orders?kind=grocery")).text;
    expect(g).toContain(grocery.code); expect(g).not.toContain(`>${code}<`);
    expect((await b.get("/orders")).text).toContain(grocery.code);
  });

  // AST1 filled CON1's place: the button and the panel are on every page of a lead (admin, ops lead); a picker has no assistant.
  it("puts the assistant on every lead's page (a button, a panel beside the page, /assistant); a picker has none", async () => {
    const lead = (await who("ops_lead", "Lea2")).b;
    for (const p of ["/", "/stock", "/more", "/orders"]) { const t = (await lead.get(p)).text; expect(t, p).toContain('class="ak-assistant-btn" href="/assistant"'); expect(t, p).toContain('data-assistant="AST1"'); }
    const a = await lead.get("/assistant");
    expect(a.status).toBe(200); expect(a.text).toContain("never changes anything"); expect(a.text).not.toContain('data-assistant="AST1"');
    const { b } = await who("picker", "Pia2");
    for (const p of ["/pick", "/stock", "/more"]) { const t = (await b.get(p)).text; expect(t, p).not.toContain("ak-assistant"); }
    expect((await b.get("/assistant")).status).toBe(403);
    expect((await r.browser().get("/sign-in")).text).not.toContain("ak-assistant");
  });
});
