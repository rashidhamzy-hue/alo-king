// WEB4b: the website's food pages, built and served by workerd over the real migrations (the stand-in for PostgREST runs every call as
// web_channel), with FD2's seeded test kitchen (scripts/staging/test-place.sql: an invented place, testers only) and a second invented
// kitchen made the same way. Each behaviour of the session's prompt has its test here:
//   1. /food lists the places a visitor may order from and the listings, as before; a testers-only place never shows to anyone else;
//   2. a place's menu by section, prices from the database, the dish's choices; a required choice is made before "Add";
//   3. the food basket apart from the grocery basket, one place at a time; a dish of a second place asks to start a new basket;
//   4. allergens "declared by the place" or "not confirmed yet: ask us", never "safe"; no health or praise word;
//   5. checkout sends the card to WhatsApp (C1); cash only; the food service fee from the setting.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "astro";
import { createServer } from "node:net";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openHub, type Hub } from "../db/hub-kit";
import { asSupabase, type TestDb } from "../db/harness";
import { channelCommerce, webCommerce } from "@ak/commerce/index";
import { FAKE_ANON, FAKE_JWT, startFakePostgrest, type Fake } from "./postgrest-fake";

const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const root = fileURLToPath(new URL("../../apps/.web4b-test/", import.meta.url));
const OUT = root + "dist/";
const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
let h: Hub; let db: TestDb; let fake: Fake; let base = ""; let stop: () => Promise<void> = async () => {};
let kitchen = ""; let second = ""; let lead = "";
const WA = "https://wa.me/96100000000";

const dropBlocks = (html: string, tag: "script" | "style"): string => {
  let out = html;
  for (;;) {
    const low = out.toLowerCase(); const from = low.indexOf(`<${tag}`);
    if (from < 0) return out;
    const close = low.indexOf(`</${tag}`, from);
    const end = close < 0 ? out.length : (low.indexOf(">", close) < 0 ? out.length : low.indexOf(">", close) + 1);
    out = out.slice(0, from) + " " + out.slice(end);
  }
};
const untag = (html: string): string => { let out = html, prev = ""; while (out !== prev) { prev = out; out = out.replace(/<[^<>]*>/g, " "); } return out.replace(/[<>]/g, " "); };
const text = (html: string) => untag(dropBlocks(dropBlocks(html, "script"), "style")).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";

class Browser {
  jar = new Map<string, string>();
  constructor(lang: "ar" | "en" | "fr" = "en") { this.jar.set("lang", lang); }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  private keep(r: Response) {
    for (const c of r.headers.getSetCookie()) { const m = /^([^=]+)=([^;]*)/.exec(c); if (m) { if (/Max-Age=0/.test(c)) this.jar.delete(m[1]!); else this.jar.set(m[1]!, m[2]!); } }
    return r;
  }
  async get(path: string) { const r = this.keep(await fetch(base + path, { redirect: "manual", headers: { cookie: this.cookie } })); return { status: r.status, headers: r.headers, html: await r.text() }; }
  async post(path: string, form: [string, string][] | Record<string, string>) {
    const r = this.keep(await fetch(base + path, { method: "POST", redirect: "manual", body: new URLSearchParams(form as any),
      headers: { cookie: this.cookie, origin: base, "content-type": "application/x-www-form-urlencoded" } }));
    return { status: r.status, location: r.headers.get("location"), headers: r.headers, html: await r.text() };
  }
}

let n = 0;
/** A browser signed in as a customer (the WhatsApp code claimed by that customer), with a saved place in the test village. */
async function customer(tester: boolean, lang: "ar" | "en" | "fr" = "en") {
  const k = ++n;
  const phone = `+9617650${String(k).padStart(4, "0")}`;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-web4b-${k}`, p_phone: phone, p_name: `WEB4b ${k}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const at = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
  await db.rpc("set_place_details", { p_party: t.party_id, p_place: at, p_building: "Stone house by the school", p_floor: "1" });
  if (tester) await db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  const w = webCommerce(asSupabase(db));
  const s = await w.startSession("web4b test");
  const code = await w.linkCode(s.token);
  if (!code.ok) throw new Error("no code");
  await channelCommerce(asSupabase(db)).claimLinkCode(t.party_id, code.code, `wamid-web4b-${k}`);
  const b = new Browser(lang); b.jar.set("ak_session", s.token);
  return { b, party: t.party_id as string, at: at as string };
}
const dishId = async (place: string, name: string) => (await db.one(`select id from products where owner_source_id = $1 and name_en = $2`, [place, name])).id as string;
const optionId = async (dish: string, name: string) => (await db.one(`select o.id, o.group_id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = $2`, [dish, name])) as { id: string; group_id: string };

beforeAll(async () => {
  h = await openHub({ pickerOnOps: false }); db = h.db;
  await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
  await db.pg.query(`update settings set value = value || jsonb_build_object('product_link', $1::text) where key = 'catalog'`, [`${WA}?text={sku}`]);
  const sql = readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8");
  await db.pg.exec(sql);
  // a second invented kitchen, made the same way (FD1's own functions), for "one place per food basket"
  await db.pg.exec(sql.replaceAll("ak-test-kitchen-staging", "ak-second-kitchen-test").replaceAll("Alo King test kitchen", "Second test kitchen")
    .replaceAll("'test kitchen', 'مطبخ التجربة', 'مطبخ الاختبار'", "'second kitchen'").replaceAll("+96100000090", "+96100000091"));
  kitchen = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  second = (await db.one(`select id from sources where listing_id = 'ak-second-kitchen-test'`)).id;
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await db.pg.query(`update sources set hours = '{"open":"00:00","close":"00:00"}' where id in ($1, $2)`, [kitchen, second]);
  fake = await startFakePostgrest(db);
  rmSync(root, { recursive: true, force: true });
  cpSync(web, root, { recursive: true, filter: (src) => !/[\\/](dist|node_modules|\.astro|\.wrangler|\.dev\.vars)([\\/]|$)/.test(src.slice(web.length - 1)) });
  await build({ root, logLevel: "error" } as any);
  const body = Object.entries({ SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: FAKE_ANON, WEB_CHANNEL_JWT: FAKE_JWT, PAGE_CACHE: "off", WEB_POST_LIMIT: "100000" }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(OUT + "server/.dev.vars", body);
  const port = await freePort();
  const server = await preview({ root, logLevel: "error", server: { port, host: "127.0.0.1" } } as any);
  stop = () => server.stop(); base = `http://127.0.0.1:${port}`;
}, 300_000);
afterAll(async () => { await stop(); await fake?.close(); rmSync(root, { recursive: true, force: true }); });

describe("1. who sees which place", () => {
  it("an anonymous visitor and a customer not on the tester list: /food is the listings as before; the test kitchen is nowhere; its page is not found", async () => {
    for (const b of [new Browser(), (await customer(false)).b]) {
      const f = await b.get("/food");
      expect(f.status).toBe(200);
      expect(text(f.html)).not.toMatch(/test kitchen|Order from these places/i);
      expect(f.html).not.toContain("/food/place/");
      expect(text(mainOf(f.html))).toContain("Places: ");
      const p = await b.get(`/food/place/${kitchen}`);
      expect(p.status).toBe(404);
      expect(text(p.html)).not.toMatch(/test kitchen|shawarma/i);
      const add = await b.post("/food/basket/add", { place: kitchen, dish: await dishId(kitchen, "Falafel sandwich"), qty: "1" });
      expect(add.status).toBe(404);
      expect(b.jar.has("ak_food")).toBe(false);
      expect(text(mainOf((await b.get("/search?q=shawarma")).html))).not.toMatch(/shawarma sandwich/i);
    }
  });
  it("a tester sees the places they may order from above the listings, with the village, the preparation time and whether it takes orders", async () => {
    const { b } = await customer(true);
    const f = await b.get("/food");
    const m = mainOf(f.html);
    expect(text(m)).toContain("Order from these places");
    expect(m).toContain(`href="/food/place/${kitchen}"`);
    expect(text(m)).toMatch(/Alo King test kitchen[\s\S]*Prepared in about 20 min[\s\S]*Taking orders now/);
    expect(text(m)).toContain("Not on Alo King yet");                                           // the listings follow, as before
  });
});

describe("2. a place's menu", () => {
  it("by section, the database's prices, each dish's choices; required ones are required radios", async () => {
    const { b } = await customer(true);
    const r = await b.get(`/food/place/${kitchen}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    const m = mainOf(r.html); const tx = text(m);
    // sections in the database's order (place_menu: by section, then name)
    expect(tx).toMatch(/Plates[\s\S]*French fries[\s\S]*\$2\.00[\s\S]*Taouk plate[\s\S]*\$8\.00[\s\S]*Sandwiches[\s\S]*Chicken shawarma sandwich[\s\S]*\$4\.00[\s\S]*Falafel sandwich[\s\S]*\$2\.50/);
    const sh = await dishId(kitchen, "Chicken shawarma sandwich");
    const large = await optionId(sh, "Large");
    expect(m).toMatch(new RegExp(`<input(?=[^>]*type="radio")(?=[^>]*name="g:${large.group_id}")(?=[^>]*value="${large.id}")(?=[^>]*required)`));
    expect(tx).toMatch(/Size Required Choose one Regular Large \+ ?\$2\.00/);
    expect(tx).toMatch(/Bread Required Choose one Arabic bread Saj \+ ?\$0\.50/);
    expect(tx).toMatch(/Add-ons Optional/);
    // the Arabic page: the dish and section names in Arabic, mirrored
    const ar = await (await customer(true, "ar")).b.get(`/food/place/${kitchen}`);
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(text(mainOf(ar.html))).toMatch(/سندويشات[\s\S]*سندويش شاورما دجاج/);
  });
  it("a dish with a required choice not made does not go in: back to the dish with the choice named", async () => {
    const { b } = await customer(true);
    const sh = await dishId(kitchen, "Chicken shawarma sandwich");
    const saj = await optionId(sh, "Saj");
    const r = await b.post("/food/basket/add", [["place", kitchen], ["dish", sh], ["qty", "1"], [`g:${saj.group_id}`, saj.id]]);
    expect(r.status).toBe(303);
    const size = await optionId(sh, "Large");
    expect(r.location).toBe(`/food/place/${kitchen}?need=${sh}&g=${size.group_id}#dish-${sh}`);
    expect(b.jar.has("ak_food")).toBe(false);
    const back = await b.get(r.location!.replace(/#.*/, ""));
    expect(text(mainOf(back.html))).toContain("Choose Size first, then add it.");
    // an option of another dish is refused the same way
    const garlic = await optionId(await dishId(kitchen, "Taouk plate"), "Garlic");
    expect((await b.post("/food/basket/add", [["place", kitchen], ["dish", sh], ["opt", garlic.id]])).location).toBe(`/food/place/${kitchen}?need=${sh}#dish-${sh}`);
  });
});

describe("3. the food basket", () => {
  it("apart from the grocery basket; priced by the database; one less, one more, remove", async () => {
    const c = await customer(true); const b = c.b;
    await b.post("/cart/line", { sku: "AK-0103", qty: "1" });                                    // a grocery line, which stays apart
    const sh = await dishId(kitchen, "Chicken shawarma sandwich");
    const large = await optionId(sh, "Large"); const saj = await optionId(sh, "Saj");
    const add = await b.post("/food/basket/add", [["place", kitchen], ["dish", sh], ["qty", "2"], [`g:${large.group_id}`, large.id], [`g:${saj.group_id}`, saj.id]]);
    expect(add.location).toBe(`/food/place/${kitchen}?added=1#dish-${sh}`);
    expect(add.headers.getSetCookie().join()).toMatch(/ak_food=1~[^;]+; Path=\/; Max-Age=172800; SameSite=Lax; Secure; HttpOnly/);
    await b.post("/food/basket/add", { place: kitchen, dish: await dishId(kitchen, "Falafel sandwich"), qty: "1" });
    const page = await b.get(`/food/place/${kitchen}?added=1`);
    expect(text(mainOf(page.html))).toContain("Added to your food basket.");
    expect(mainOf(page.html)).toMatch(/<a[^>]*href="\/food\/basket"[^>]*data-primary/);
    const r = await b.get("/food/basket");
    const tx = text(mainOf(r.html));
    // 2 x (4 + 2 large + 0.50 saj) = 13.00, falafel 2.50: the quote's figures, never the page's
    const q = (await db.rpc<any>("web_food_quote", { p_token: b.jar.get("ak_session"), p_place: kitchen, p_at: c.at,
      p_lines: [{ product_id: sh, qty: 2, options: [large.id, saj.id] }, { product_id: await dishId(kitchen, "Falafel sandwich"), qty: 1, options: [] }] })).quote;
    expect(tx).toMatch(/Chicken shawarma sandwich Large, Saj \$13\.00 \$6\.50 × 2/);
    expect(tx).toContain("Falafel sandwich");
    expect(tx).toMatch(new RegExp(`Dishes \\$15\\.50[\\s\\S]*Delivery \\(all to the rider\\) \\$${Number(q.delivery_fee_usd).toFixed(2).replace(".", "\\.")}[\\s\\S]*Total \\$${Number(q.total_usd).toFixed(2).replace(".", "\\.")}`));
    expect(tx).not.toContain("Service fee");                                                      // 0 today: no line
    expect(tx).toContain("kept apart from your grocery basket");
    expect(mainOf(r.html)).toMatch(/href="\/food\/checkout"[^>]*data-primary/);
    expect((await b.get("/cart")).html).toContain("AK-0103");                                     // the grocery basket is untouched
    expect(text((await b.get("/cart")).html)).not.toContain("shawarma");
    // one less, then remove the falafel
    await b.post("/food/basket/line", { i: "0", qty: "1" });
    await b.post("/food/basket/line", { i: "1", qty: "0" });
    const after = text(mainOf((await b.get("/food/basket")).html));
    expect(after).toMatch(/Chicken shawarma sandwich Large, Saj \$6\.50/);
    expect(after).not.toContain("Falafel");
    await b.post("/food/basket/line", { do: "clear" });
    expect(b.jar.has("ak_food")).toBe(false);
    expect(text(mainOf((await b.get("/food/basket")).html))).toContain("Your food basket is empty.");
  });
  it("a dish from a second place asks first; 'start a new basket' replaces it, 'keep' changes nothing", async () => {
    const { b } = await customer(true);
    await b.post("/food/basket/add", { place: kitchen, dish: await dishId(kitchen, "Falafel sandwich"), qty: "1" });
    const before = b.jar.get("ak_food");
    const fries = await dishId(second, "French fries");
    const ask = await b.post("/food/basket/add", { place: second, dish: fries, qty: "2" });
    expect(ask.status).toBe(409);
    expect(b.jar.get("ak_food")).toBe(before);
    const tx = text(mainOf(ask.html));
    expect(tx).toContain("Start a new food basket?");
    expect(tx).toContain("Your food basket has dishes from Alo King test kitchen. A food order comes from one place. Start a new basket with Second test kitchen?");
    expect(mainOf(ask.html)).toMatch(/href="\/food\/basket"[^>]*>Keep my basket from Alo King test kitchen/);
    const yes = await b.post("/food/basket/add", { place: second, dish: fries, qty: "2", replace: "1" });
    expect(yes.status).toBe(303);
    const r = text(mainOf((await b.get("/food/basket")).html));
    expect(r).toContain("From Second test kitchen");
    expect(r).toMatch(/French fries \$4\.00/);
    expect(r).not.toContain("Falafel");
  });
  it("a basket someone wrote by hand is only ids: the database prices it or refuses it; nothing breaks", async () => {
    const { b } = await customer(true);
    b.jar.set("ak_food", "1~garbage~x.1");
    expect((await b.get("/food/basket")).status).toBe(200);
    // a dish of the other place inside this place's basket: refused by the database (one shop), the basket is let go
    const mine = await dishId(kitchen, "Falafel sandwich");
    await b.post("/food/basket/add", { place: kitchen, dish: mine, qty: "1" });
    const v = b.jar.get("ak_food")!;
    const other = await dishId(second, "French fries");
    const hex = (u: string) => Buffer.from(u.replace(/-/g, ""), "hex").toString("base64url");
    b.jar.set("ak_food", `${v}~${hex(other)}.1`);
    const r = await b.get("/food/basket");
    expect(r.status).toBe(200);
    expect(text(mainOf(r.html))).toContain("Your food basket is empty.");
    expect(b.jar.has("ak_food")).toBe(false);
  });
});

describe("4. facts and words", () => {
  it("'declared by the place' or 'not confirmed yet: ask us', never 'safe'; no praise or health word on any food page", async () => {
    const { b } = await customer(true);
    const falafel = await dishId(kitchen, "Falafel sandwich");
    const r1 = text(mainOf((await b.get(`/food/place/${kitchen}`)).html));
    expect(r1).toContain("Allergens and diet: not confirmed yet: ask us.");
    await db.pg.query(`insert into dish_declarations(product_id, attribute, value, declared_by) values ($1, 'sesame', 'contains', $2)`, [falafel, lead]);
    try {
      const r2 = text(mainOf((await b.get(`/food/place/${kitchen}`)).html));
      expect(r2).toMatch(/Sesame: contains \( ?declared by the place ?\)/);
      expect(r2).toMatch(/Not confirmed yet: ask us: Celery, Crustaceans, Eggs/);
    } finally { await db.pg.query(`delete from dish_declarations where product_id = $1`, [falafel]); }
    await b.post("/food/basket/add", { place: kitchen, dish: falafel, qty: "1" });
    for (const p of [`/food/place/${kitchen}`, "/food/basket", "/food/checkout", "/food"]) {
      for (const l of ["en", "ar", "fr"]) {
        b.jar.set("lang", l);
        const tx = text(mainOf((await b.get(p)).html));
        expect(tx, `${p} ${l}`).not.toMatch(/\bsafe\b|healthy|\bbest\b|delicious|tasty|popular|recommended|sans danger|آمن|صحي|لذيذ|الأفضل|الأشهر/i);
      }
    }
  });
  it("a place closed today: said on its page and on the basket, and there is no way to checkout", async () => {
    const { b } = await customer(true);
    await b.post("/food/basket/add", { place: kitchen, dish: await dishId(kitchen, "Falafel sandwich"), qty: "1" });
    await db.pg.query(`update sources set closed_on = (now() at time zone 'Asia/Beirut')::date where id = $1`, [kitchen]);
    try {
      expect(text(mainOf((await b.get(`/food/place/${kitchen}`)).html))).toContain("Closed today");
      const r = await b.get("/food/basket");
      expect(text(mainOf(r.html))).toContain("Alo King test kitchen is closed today.");
      expect(mainOf(r.html)).not.toContain('href="/food/checkout"');
    } finally { await db.pg.query(`update sources set closed_on = null where id = $1`, [kitchen]); }
  });
});

describe("5. checkout", () => {
  it("signs in first; then the card in WhatsApp's words, cash only; sending makes the card for the WhatsApp tap and never confirms", async () => {
    const anon = new Browser();
    const c = await customer(true);
    const b = c.b;
    const sh = await dishId(kitchen, "Chicken shawarma sandwich");
    const large = await optionId(sh, "Large"); const saj = await optionId(sh, "Saj");
    await b.post("/food/basket/add", [["place", kitchen], ["dish", sh], ["qty", "1"], [`g:${large.group_id}`, large.id], [`g:${saj.group_id}`, saj.id]]);
    // a visitor who is not signed in gets the sign-in panel (with the same basket cookie, the menu is not theirs: the empty state)
    anon.jar.set("ak_food", b.jar.get("ak_food")!);
    expect(text(mainOf((await anon.get("/food/checkout")).html))).toContain("Your food basket is empty.");
    const r = await b.get("/food/checkout");
    const m = mainOf(r.html); const tx = text(m);
    expect(tx).toContain("🍗");
    expect(tx).toContain("Alo King test kitchen");
    expect(tx).toMatch(/Chicken shawarma sandwich[\s\S]*Large[\s\S]*Saj/);
    expect(tx).toContain("Cash on delivery");
    expect(tx).not.toMatch(/Whish|OMT|card payment/i);
    expect(m).toMatch(/name="notes"/);
    // one primary action: the frame is in focus (no basket, no bottom bar), the send button is the one filled button
    expect(r.html).not.toMatch(/data-basket|data-bottom/);
    expect([...m.matchAll(/ak-btn--gold|data-primary/g)].length).toBe(1);
    const key = /name="key" value="([^"]+)"/.exec(m)![1]!;
    const sent = await b.post("/food/checkout", { key, at: c.at, notes: "allergic to sesame", do: "place" });
    expect(sent.status).toBe(303);
    expect(sent.location).toMatch(/^\/o\/AK-\d+\?k=/);
    expect(b.jar.has("ak_food")).toBe(false);                                                   // the basket is gone with the card
    const code = /\/o\/(AK-\d+)/.exec(sent.location!)![1]!;
    const o = await db.one(`select id, status::text, payment_method::text p, channel, customer_notes as notes from orders where short_code = $1`, [code]);
    expect(o).toMatchObject({ status: "awaiting_confirmation", p: "cod", channel: "web" });       // never confirmed by the page (invariant 4)
    expect(o.notes).toContain("allergic to sesame");
    expect((await db.one(`select count(*)::int n from web_card_requests where order_id = $1`, [o.id])).n).toBe(1);
    const opts = (await db.one(`select options from order_items where order_id = $1 limit 1`, [o.id])).options;
    expect(opts.map((x: any) => x.name_en).sort()).toEqual(["Large", "Saj"]);
    // the same submit again never makes a second order
    const again = await db.one(`select count(*)::int n from orders where turn_key = $1`, [`web:${key}`]);
    expect(again.n).toBe(1);
    const page = await b.get(sent.location!);
    expect(page.status).toBe(200);
    expect(text(mainOf(page.html))).toContain(code);
  });
  it("the food service fee is the setting's: its own line when above 0, in the total", async () => {
    const { b } = await customer(true);
    await b.post("/food/basket/add", { place: kitchen, dish: await dishId(kitchen, "Falafel sandwich"), qty: "2" });
    await db.pg.query(`update settings set value = value || '{"service_fee_usd": 1}' where key = 'food'`);
    try {
      const tx = text(mainOf((await b.get("/food/basket")).html));
      expect(tx).toMatch(/Dishes \$5\.00 Service fee \$1\.00/);
      expect(text(mainOf((await b.get("/food/checkout")).html))).toMatch(/\$1\.00/);
    } finally { await db.pg.query(`update settings set value = value || '{"service_fee_usd": 0}' where key = 'food'`); }
  });
});
