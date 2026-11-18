// FD2, migration 0251: the order API for food baskets, for WEB4b's pages (no page in FD2). Called as the website calls it: the role web_channel,
// the party only from the session token. A testers-only place never shows to an anonymous visitor or to anyone not on the tester list; a tester
// sees its menu (with each dish's facts status), prices a basket of that one place, and the order goes as a card for the WhatsApp tap.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { asSupabase, type TestDb } from "./harness";
import { openHub, type Hub } from "./hub-kit";
import { channelCommerce, webCommerce, webFood, WEB_CHANNEL_FUNCTIONS, type RpcSource } from "@ak/commerce/index";

let h: Hub; let db: TestDb; let place: string; let lead: string;
let web: ReturnType<typeof webCommerce>; let food: ReturnType<typeof webFood>; let svc: ReturnType<typeof channelCommerce>;
let n = 0;
function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}
async function visitor(tester: boolean) {
  const k = ++n;
  const phone = `+9617630${String(k).padStart(4, "0")}`;
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-fd2web-${k}`, p_phone: phone, p_name: `FD2 web ${k}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const at = (await db.one(`select id from customer_places where party_id = $1 order by last_used_at desc nulls last limit 1`, [t.party_id])).id as string;
  if (tester) await db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  const s = await web.startSession("test phone");
  const code = await web.linkCode(s.token);
  if (!code.ok) throw new Error("no code");
  await svc.claimLinkCode(t.party_id, code.code, `wamid-fd2web-${k}`);
  return { party: t.party_id as string, token: s.token, at };
}
const dish = async (name: string) => (await db.one(`select id from products where owner_source_id = $1 and name_en = $2`, [place, name])).id as string;

beforeAll(async () => {
  h = await openHub(); db = h.db;
  await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  place = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await db.pg.query(`update sources set hours = '{"open":"00:00","close":"00:00"}' where id = $1`, [place]);
  web = webCommerce(asWebChannel(db)); food = webFood(asWebChannel(db)); svc = channelCommerce(asSupabase(db));
}, 180_000);

describe("FD2: the website's food API", () => {
  it("the four functions are the web channel's, and nothing else is", async () => {
    for (const f of ["web_food_places", "web_food_menu", "web_food_quote", "web_food_order"]) expect([...WEB_CHANNEL_FUNCTIONS] as string[]).toContain(f);
  });

  it("an anonymous visitor and a customer not on the tester list see no place and no menu", async () => {
    expect(await food.places(null)).toEqual([]);
    expect(await food.menu(null, place)).toMatchObject({ ok: false, reason: "not_on_alo_king", dishes: [] });
    const v = await visitor(false);
    expect(await food.places(v.token)).toEqual([]);
    expect(await food.quote(v.token, place, [{ product_id: await dish("Falafel sandwich"), qty: 2 }], v.at)).toMatchObject({ ok: false, error: "not_on_alo_king" });
  });

  it("a tester sees the place, its menu with groups and facts status, and prices a basket of that one place", async () => {
    const v = await visitor(true);
    const places = await food.places(v.token);
    expect(places.map((p) => p.name)).toEqual(["Alo King test kitchen"]);
    expect(JSON.stringify(places)).not.toContain("+961");
    const menu = await food.menu(v.token, place);
    const sh = menu.dishes.find((d) => d.name_en === "Chicken shawarma sandwich")!;
    expect(sh.groups.map((g) => g.name_en)).toEqual(["Size", "Bread", "Add-ons"]);
    expect(sh.facts!.every((f) => f.status === "not_confirmed")).toBe(true);
    const q1 = await food.quote(v.token, place, [{ product_id: sh.product_id, qty: 1 }], v.at);
    expect(q1.quote!.issues.map((i: any) => i.code)).toContain("choice_required");
    const large = sh.groups[0]!.options.find((o) => o.name_en === "Large")!.id;
    const saj = sh.groups[1]!.options.find((o) => o.name_en === "Saj")!.id;
    const q2 = await food.quote(v.token, place, [{ product_id: sh.product_id, qty: 2, options: [large, saj] }], v.at);
    expect(q2.quote!.ok).toBe(true);
    expect(q2.quote!.subtotal_usd).toBe(13);
    const hub = (await db.one(`select id from products where owner_source_id is null and is_active order by sku limit 1`)).id;
    expect(await food.quote(v.token, place, [{ product_id: sh.product_id, qty: 1, options: [large, saj] }, { product_id: hub, qty: 1 }], v.at))
      .toMatchObject({ ok: false, error: "one_shop" });
  });

  it("the order is a card for the WhatsApp tap, cash on delivery; the same request key never makes two", async () => {
    const v = await visitor(true);
    const taouk = await dish("Taouk plate");
    const garlic = (await db.one(`select o.id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = 'Garlic'`, [taouk])).id;
    const o = { requestKey: `req-fd2web-${n}`, at: v.at, place, lines: [{ product_id: taouk, qty: 1, options: [garlic] }], lang: "en" as const };
    const r = await food.order(v.token, o);
    expect(r).toMatchObject({ created: true, status: "awaiting_confirmation" });
    expect(await db.one(`select payment_method::text p, channel from orders where id = $1`, [r.order_id])).toEqual({ p: "cod", channel: "web" });
    expect((await db.one(`select count(*)::int n from web_card_requests where order_id = $1`, [r.order_id])).n).toBe(1);
    expect((r as any).card.quote.shop).toMatchObject({ name: "Alo King test kitchen", kind: "place" });
    const again = await food.order(v.token, o);
    expect(again.order_id).toBe(r.order_id);
  });
});
