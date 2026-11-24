// Session TEST1: the friends' test on WhatsApp, through the real turn code, tools and gateway, with test mode on as on staging
// (the database marked as staging, the Worker's ENVIRONMENT "staging"). The shop is closed and the hub holds nothing all through.
//   1. A number not on the tester list: "we're not open yet" in its language, no model, no price; STOP still wins.
//   2. A tester's typed order: the card with the test line; only the Confirm tap confirms; then the order walks by itself with the real
//      messages (being prepared, on the way, at the door, delivered, the feedback question), each with the test line.
//   3. A tester's cart from the catalogue: the card with the test line; nothing is confirmed without the tap.
//   4. A tester's food order with a required choice: asked by code, the card with the place; the call ahead simulated, never a task.
// Invented people and numbers only.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { ENV, flow, openFlowDb, pinned, read, recordKapso, type Sent } from "./flow-kit";
import { send as gatewaySend } from "@ak/wa/gateway";
import { testLineSend, testOrderTick } from "@ak/agents/test-mode";
import fd2 from "../../evals/cases/fd2_food.json";

const STAGING = { ENVIRONMENT: "staging" };
const LINE_AR = "🧪 طلب تجريبي: ما في توصيل ولا دفع";
const LINE_EN = "🧪 Test order: no delivery, no payment";
let db: TestDb; let lead: string; let BAAKLINE: string;
beforeAll(async () => {
  let ids; ({ db, ids } = await openFlowDb());
  BAAKLINE = ids.BAAKLINE;
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  await db.pg.exec(`insert into deployment_marker(environment) values ('staging');
    update settings set value = value || '{"enabled": true, "step_min_s": 0, "step_max_s": 0}'::jsonb where key = 'test_mode';
    update settings set value = '{"open":"03:00","close":"03:01","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 0, reserved = 0;`);
  const place = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "03:00", close: "03:01" } } });
}, 180_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const rowsOf = (s: Sent): { id: string; title: string }[] => [
  ...(s.body.interactive?.action?.buttons ?? []).map((b: any) => ({ id: b.reply.id, title: b.reply.title })),
  ...(s.body.interactive?.action?.sections ?? []).flatMap((x: any) => (x.rows ?? []).map((r: any) => ({ id: r.id, title: r.title }))),
];
const last = () => outbound.at(-1)!;
const tester = async (t: ReturnType<typeof flow>) => {
  const c = await pinned(db, t, BAAKLINE);
  await db.rpc("set_tester", { p_by: lead, p_phone: t.who.phone, p_on: true });
  return c;
};
const lastOrder = (party: string) => db.one(`select id, short_code, status::text s, is_test from orders where customer_id = $1 order by created_at desc limit 1`, [party]);
const confirmRow = () => rowsOf(last()).find((r) => r.id.startsWith("order:confirm:"))!;
/** The minute cron's step, as index.ts wires it on staging. */
const tick = (t: ReturnType<typeof flow>) => testOrderTick({ db: t.client, send: testLineSend(t.client, (req) => gatewaySend(t.client, ENV as any, req)) },
  async (p) => (await db.one(`select coalesce(phone_e164, wa_user_id) a from party_identities where party_id = $1 and line = 'customer' limit 1`, [p])).a);

describe("1 a number not on the tester list", () => {
  it("is told we're not open yet, in its language, with no model and no price", async () => {
    const t = flow(db, [], { env: STAGING });
    await t.customer();
    await t.text("بدي ربطة خبز وكرتونة مي");
    expect(t.seen).toHaveLength(0);
    expect(outbound).toHaveLength(1);
    expect(bodyOf(last())).toContain("لسّا ما فتحنا");
    expect(bodyOf(last())).not.toMatch(/\$/);
    await t.text("hello, I'd like some bread and water please");
    expect(bodyOf(last())).toContain("We're not open yet");
    await t.say({ type: "audio", audio: { id: "media-1" } });
    expect(bodyOf(last())).toContain("not open yet");                           // a voice note is answered too, never dropped
    expect(t.seen).toHaveLength(0);
  }, 60_000);
  it("STOP still wins", async () => {
    const t = flow(db, [], { env: STAGING });
    const c = await t.customer();
    await t.text("STOP");
    expect((await db.one(`select action from consent_events where party_id = $1 order by created_at desc limit 1`, [c.party_id])).action).toBe("opt_out");
  }, 60_000);
  it("outside staging (no ENVIRONMENT) the gate is not asked: the database's test mode alone changes nothing for a stranger", async () => {
    const t = flow(db, [read({ intent: "question", lines: [], needs_clarification: [],
      address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null } })]);
    await t.customer();
    await t.text("شو عندكن؟");
    expect(t.seen.length).toBeGreaterThan(0);
    expect(t.rpcCalls.map((r: any) => r.fn ?? r)).not.toContain("test_mode_gate");
  }, 60_000);
});

describe("2 a tester's typed order", () => {
  it("the card carries the test line; the tap confirms; the order walks by itself with the real messages", async () => {
    const READING = { intent: "order", fulfilment: "delivery", transcript_quality: "good", needs_clarification: [],
      lines: [{ qty: 3, raw: "3 كرتونة مي تنورين", unit: "each", query: "مي تنورين", modifiers: [], brand_hint: "تنورين", confidence: 0.9, source_hint: null }],
      address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null } };
    const t = flow(db, [read(READING)], { env: STAGING });
    const c = await tester(t);
    await t.text("بدي 3 كرتونة مي تنورين");
    const card = bodyOf(last());
    expect(card).toContain("طلبك AK-");
    expect(card).toContain(LINE_AR);
    const o = await lastOrder(c.party_id);
    expect(o).toMatchObject({ s: "awaiting_confirmation", is_test: true });
    expect(await tick(t)).toBe(0);                                                 // nothing walks before the tap
    await t.tap(confirmRow().id, "تأكيد");
    expect((await lastOrder(c.party_id)).s).toBe("confirmed");
    expect(bodyOf(last())).toContain(LINE_AR);
    const walk: string[] = [];
    for (let i = 0; i < 6; i++) { if (await tick(t)) walk.push(`${(await lastOrder(c.party_id)).s}|${bodyOf(last())}`); }
    expect(walk).toHaveLength(5);
    expect(walk.every((w) => w.includes(LINE_AR))).toBe(true);
    expect(walk[0]).toMatch(/^preparing\|.*عم نحضّر|^preparing\|/);
    expect(walk.map((w) => w.split("|")[0])).toEqual(["preparing", "out_for_delivery", "arrived", "delivered", "delivered"]);
    expect(rowsOf(last()).map((r) => r.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^fb:fine:/)]));
    expect(Number((await db.one(`select count(*) n from stock_movements where order_id = $1`, [o.id])).n)).toBe(0);
    expect(Number((await db.one(`select count(*) n from ledger_entries where order_id = $1`, [o.id])).n)).toBe(0);
  }, 90_000);
});

describe("3 a tester's cart from the catalogue", () => {
  it("becomes the card with the test line, and nothing is confirmed without the tap", async () => {
    await db.pg.query(`update settings set value = value || '{"catalog_id": "1234567890"}' where key = 'catalog'`);
    const t = flow(db, [], { env: STAGING, });
    const c = await tester(t);
    const skus = (await db.all(`select p.sku from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id
      where s.kind = 'dark_store' and p.is_active and o.price_usd between 3 and 10 order by p.sku limit 2`)).map((r: any) => r.sku);
    await t.say({ type: "order", order: { catalog_id: "1234567890", product_items: skus.map((sku: string) => ({ product_retailer_id: sku, quantity: 2, item_price: 1, currency: "USD" })) } });
    expect(t.seen).toHaveLength(0);
    expect(bodyOf(last())).toContain("طلبك AK-");
    expect(bodyOf(last())).toContain(LINE_AR);
    expect((await lastOrder(c.party_id)).s).toBe("awaiting_confirmation");
  }, 60_000);
});

describe("4 a tester's food order", () => {
  it("required choices by code, the card with the place and the test line; the call ahead simulated, no task for staff", async () => {
    const k = fd2.cases.find((x) => x.id === "fd2-required-choice")!;
    const t = flow(db, [read({ intent: "order", fulfilment: "unknown", restrictions: [],
      address: { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null },
      lines: k.lines.map((l: any) => ({ unit: "each", brand_hint: null, confidence: 0.9, modifiers: [], source_hint: null, ...l })) })], { env: STAGING });
    const c = await tester(t);
    await t.text(k.said);
    for (const title of [/كبير/, /صاج/, /لا، شكراً/]) {
      const row = rowsOf(last()).find((r) => title.test(r.title));
      expect(row, `${title} in ${JSON.stringify(rowsOf(last()))}`).toBeDefined();
      await t.tap(row!.id, row!.title);
    }
    expect(bodyOf(last())).toContain("🍗 من: Alo King test kitchen");
    expect(bodyOf(last())).toContain(LINE_AR);
    await t.tap(confirmRow().id, "تأكيد");
    const o = await lastOrder(c.party_id);
    expect(o.s).toBe("confirmed");
    expect((await db.one(`select status from place_calls where order_id = $1`, [o.id])).status).toBe("accepted");
    expect(await tick(t)).toBe(1);
    expect(bodyOf(last())).toContain("Alo King test kitchen");
    expect(bodyOf(last())).toContain(LINE_AR);
  }, 90_000);
});

describe("the test line itself", () => {
  it("is added once, in the customer's language, and never to a template", async () => {
    const { withTestLine } = await import("@ak/agents/test-mode");
    const once = withTestLine({ type: "text", text: { body: "x" } }, "en");
    expect(withTestLine(once, "en")).toEqual(once);
    expect((once as any).text.body).toBe(`x\n\n${LINE_EN}`);
    const tpl = { type: "template", template: { name: "t", language: { code: "ar" }, components: [] } } as any;
    expect(withTestLine(tpl, "ar")).toBe(tpl);
    const long = withTestLine({ type: "interactive", interactive: { type: "button", body: { text: "y".repeat(1020) }, action: { buttons: [] } } } as any, "ar");
    expect((long as any).interactive.body.text.length).toBeLessThanOrEqual(1024);
  });
});

describe("the WhatsApp catalogue's words (sim-020, sim-test 45133515061)", () => {
  it("are in the customer's language: a French customer's Browse tap got Arabic once the catalogue was connected", async () => {
    const { catalogMessages } = await import("@ak/agents/catalog-messages");
    const { seedFeedItem } = await import("./catalog-seed");
    await db.pg.query(`update settings set value = value || '{"catalog_id": "1234567890"}' where key = 'catalog'`);
    await seedFeedItem(db, "AK-0080");
    const t = flow(db, []);
    const body = async (lang: "ar" | "en" | "fr") => {
      const r = await catalogMessages(t.client, { lang });
      if (!r.ok) throw new Error(r.error);
      return (r.messages[0] as any).interactive.body.text as string;
    };
    expect(await body("fr")).toContain("Le catalogue Alo King");
    expect(await body("en")).toContain("The Alo King catalogue");
    expect(await body("ar")).toContain("كتالوج ألو كينغ");
    expect(await body("fr")).not.toMatch(/[؀-ۿ]/);
  });
});
