// VOICE1: voice notes understood properly, through the real turn code, food path, tools and gateway (evals/cases/voice1_places.json).
//   1. A place name we do not know is never repeated as a real place: the closest place this customer may order from is asked about
//      («قصدك …؟», two buttons), and "yes" goes on with the order; nothing close lists the places.
//   2. A dish on the place's menu that is not on sale (rejected for a price range) is said honestly, with the place's dishes that are.
//   3. A voice note: our own transcript (Scribe) first, with the places' names as keyterms, Kapso's the fallback; the cost recorded.
//   4. The catalogue's own button: with the welcome, with a tester's first reply in test mode, and for «بدي شوف الكتالوج».
// The place is an invented copy («Safa Chicken», its other names as on staging, 0274; an invented menu and invented prices). Invented
// people and numbers only.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Sent } from "./flow-kit";
import { seedFeedItem } from "./catalog-seed";
import { checkInteractive } from "@ak/wa/contract";
import { runTurn } from "../../apps/gateway/src/turn";
import cases from "../../evals/cases/voice1_places.json";

let db: TestDb; let lead: string; let BAAKLINE: string; let safa: string;
beforeAll(async () => {
  let ids; ({ db, ids } = await openFlowDb());
  BAAKLINE = ids.BAAKLINE;
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  const village = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  await db.pg.query(`insert into listings(listing_id, name, kind, village, km_from_hub, maps_url) values ('voice1-invented-safa', 'Safa Chicken', 'restaurant',
    'Baqaata', 1.0, 'https://www.google.com/maps/search/?api=1&query=Baqaata')`);
  safa = (await db.rpc("create_place_from_listing", { p_listing: "voice1-invented-safa", p_by: lead, p_details: { village_id: village, name: "Safa Chicken",
    phone: "+96100000091", prep_minutes: 20, hours: { open: "00:00", close: "00:00" } } })).source_id;
  await db.pg.query(`update listings set hidden_at = now() where listing_id = 'voice1-invented-safa'`);
  await db.rpc("set_place_details", { p_source: safa, p_by: lead, p_details: { aliases: ["صفا", "صفا تشيكن", "صفا شيكن", "دجاج صفا", "safa", "safa chicken"] } });
  const photo = (await db.rpc("record_menu_photo", { p_source: safa, p_media_path: `menus/${safa}/invented.jpg`, p_by: lead })).photo_id;
  await db.rpc("record_menu_reading", { p_photo: photo, p_model: "invented", p_by: lead, p_reading: { sections: [
    { name_ar: "دجاج", name_en: "Chicken", dishes: [
      { name_ar: "فروج", name_en: "Whole chicken", price: 12, currency: "USD", price_text: "$10-12", sizes: [], options: [], addons: [] },
      { name_ar: "نص فروج", name_en: "Half chicken", price: 7, currency: "USD", price_text: "$7", sizes: [], options: [], addons: [] }] },
    { name_ar: "سندويشات", name_en: "Sandwiches", dishes: [
      { name_ar: "سندويش شاورما دجاج", name_en: "Chicken shawarma sandwich", price: 4.5, currency: "USD", price_text: "$4.50", sizes: [], options: [], addons: [] },
      { name_ar: "سندويش شاورما لحمة", name_en: "Meat shawarma sandwich", price: 5, currency: "USD", price_text: "$5", sizes: [], options: [], addons: [] }] }] } });
  for (const d of (await db.pg.query<{ id: string; name_ar: string }>(`select id, name_ar from menu_dish_proposals where source_id = $1 and status = 'waiting'`, [safa])).rows)
    await db.rpc("review_menu_dish", d.name_ar === "فروج" ? { p_dish: d.id, p_by: lead, p_approve: false, p_note: "a price range: to ask the place" }
                                                         : { p_dish: d.id, p_by: lead, p_approve: true });
  await db.rpc("stamp_menu_checked", { p_source: safa, p_by: lead });
  await db.rpc("set_place_visibility", { p_source: safa, p_by: lead, p_visibility: "testers", p_reason: "invented copy for VOICE1's tests" });
  await db.rpc("approve_merchant", { p_source: safa, p_by: lead, p_commission_pct: 0 });
  const kitchen = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  await db.rpc("set_place_details", { p_source: kitchen, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00" } } });
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
const all = () => outbound.map(bodyOf).join("\n");
const noAddress = { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null };
const reading = (lines: { raw: string; query: string; qty: number; source_hint?: string | null }[], language?: string) => ({ intent: "order", fulfilment: "unknown",
  restrictions: [], address: noAddress, ...(language ? { language } : {}),
  lines: lines.map((l) => ({ unit: "each", brand_hint: null, confidence: 0.9, modifiers: [], source_hint: null, ...l })) });
const caseOf = (id: string) => cases.cases.find((c) => c.id === id)! as (typeof cases.cases)[number] & { language?: string; expect: Record<string, any> };
async function tester(t: ReturnType<typeof flow>) {
  const c = await pinned(db, t, BAAKLINE);
  await db.rpc("set_tester", { p_by: lead, p_phone: t.who.phone, p_on: true });
  return c;
}
function expectCase(c: ReturnType<typeof caseOf>) {
  const text = all();
  for (const x of c.expect.contains ?? []) expect(text).toContain(x);
  for (const x of c.expect.not_contains ?? []) expect(text).not.toContain(x);
  for (const r of c.expect.rows ?? []) expect(rowsOf(last()).map((x) => x.title).join(" | ")).toContain(r);
  for (const b of c.expect.buttons ?? []) expect(rowsOf(last()).map((x) => x.title)).toContain(b);
}

describe("1 a place name we do not know", () => {
  it("Kapso's transcript of the 23 Nov note: «قصدك Safa Chicken؟», never «عنفطة …»; yes goes on with Safa's menu", async () => {
    const c = caseOf("voice1-kapso-transcript");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
    expect(t.seen).toHaveLength(1);                                                // the reading only: code asks
    const yes = rowsOf(last()).find((r) => r.id === `fplace:${safa}`)!;
    expect(yes).toBeDefined();
    await t.tap(yes.id, yes.title);
    expect(t.seen).toHaveLength(1);
    expect(all()).toContain("Safa Chicken");                                       // the place's own answer: the dish not found, its menu
    expect(rowsOf(last()).map((r) => r.title).join(" | ")).toContain("نص فروج");
    expect(all()).not.toContain("مش متوفّر بعد");
  });

  it("«لا» to the guess lists the places this customer may order from", async () => {
    const c = caseOf("voice1-kapso-transcript");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    await t.tap("fplace:none", "لا");
    expect(bodyOf(last())).toContain("ما لقينا هالمحل على ألو كينغ");
    expect(bodyOf(last())).toContain("Safa Chicken");
    expect(bodyOf(last())).toContain("Alo King test kitchen");
  });

  it("typed «ايه» answers the guess as the button does", async () => {
    const c = caseOf("voice1-kapso-transcript");
    const t = flow(db, [read(reading(c.lines)), read({ intent: "confirm", fulfilment: "unknown", restrictions: [], address: noAddress, lines: [] })]);
    await tester(t);
    await t.text(c.said);
    await t.text("ايه");
    expect(rowsOf(last()).map((r) => r.title).join(" | ")).toContain("نص فروج");
  });

  it("a place that does not exist: the places listed, the name never repeated", async () => {
    const c = caseOf("voice1-no-such-place");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
  });

  it("a customer who is not a tester: no place offered, no name repeated", async () => {
    const c = caseOf("voice1-kapso-transcript");
    const t = flow(db, [read(reading(c.lines))]);
    await pinned(db, t, BAAKLINE);
    await t.text(c.said);
    expect(all()).toContain("ما لقينا هالمحل على ألو كينغ");
    expect(all()).not.toContain("عنفطة");
    expect(all()).not.toContain("Safa Chicken");
  });
});

describe("1b the place's name inside a dish line", () => {
  it("is taken out: only the dish word is said back, with Safa's menu", async () => {
    const c = caseOf("voice1-place-in-the-line");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
  });
});

describe("2 a dish that is not on sale", () => {
  it("the clean note: «فروج» can't be ordered yet, with Safa's dishes that can; never its unapproved price", async () => {
    const c = caseOf("voice1-clean");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
    expect(rowsOf(last()).map((r) => r.title).join(" | ")).not.toMatch(/^فروج$/m);
    const half = rowsOf(last()).find((r) => r.title.includes("نص فروج"))!;
    await t.tap(half.id, half.title);
    expect(bodyOf(last())).toContain("🍗 من: Safa Chicken");
    expect(bodyOf(last())).toContain("نص فروج");
  });

  it("«بدي تنين شاورما من صفا»: which shawarma, from Safa's menu", async () => {
    const c = caseOf("voice1-two-shawarma");
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
  });

  it("an English note said as people speak: the card from Safa Chicken", async () => {
    const c = caseOf("voice1-english");
    const t = flow(db, [read(reading(c.lines, "en"))]);
    await tester(t);
    await t.text(c.said);
    expectCase(c);
    expect(bodyOf(last())).toContain("$9.00");                                     // 2 × $4.50, the database's price
  });
});

describe("3 a voice note: Scribe first, Kapso the fallback", () => {
  const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 1, 1, 7, 7, 7, 7]);
  const note = (text: string) => ({ type: "audio", audio: { id: "a1", voice: true },
    kapso: { direction: "inbound", origin: "cloud_api", transcript: { text }, media_url: "https://app.kapso.ai/media/v1", media_data: { url: "https://app.kapso.ai/media/v1", byte_size: 2100 * 4 } } });

  it("Scribe's transcript is read, with Safa's names in the keyterms; Kapso's kept; the cost recorded once", async () => {
    outbound = recordKapso({ "https://app.kapso.ai/media/v1": { bytes: OGG, type: "audio/ogg" } });
    const c = caseOf("voice1-clean");
    const stt = { name: "elevenlabs_scribe", model: "scribe_v2", transcribe: vi.fn(async (_a: ArrayBuffer, _o: { keyterms: string[] }) => c.said) };
    const t = flow(db, [read(reading(c.lines))]);
    const cust = await tester(t);
    const r = await runTurn({ ...t.deps, stt }, t.pending(note(cases.cases[0]!.said)), {});
    expect(r.outcome).not.toBe("audio_unusable");
    const terms = stt.transcribe.mock.calls[0]![1].keyterms;
    expect(terms).toEqual(expect.arrayContaining(["Safa Chicken", "صفا", "صفا تشيكن", "فروج", "شاورما"]));
    expect(terms.length).toBeLessThanOrEqual(100);
    const row = await db.one(`select transcript from wa_messages where type = 'audio' order by created_at desc limit 1`);
    expect(row.transcript).toMatchObject({ chosen: "elevenlabs_scribe", kapso: cases.cases[0]!.said, ours: { provider: "elevenlabs_scribe", seconds: 4 } });
    expect(Number(row.transcript.ours.usd)).toBeCloseTo(4 / 3600 * 0.25, 6);
    expect(all()).toContain("ما فينا ناخد طلب «فروج» من Safa Chicken بعد");
    const cost = await db.one(`select count(*)::int n, sum(usd)::float usd from model_costs where workflow = 'stt' and run_id like 'wamid.b2.%'`);
    expect(cost.n).toBeGreaterThanOrEqual(1);
    expect(cust.party_id).toBeTruthy();
  });

  it("Scribe failing (or over the daily cap) never loses the note: Kapso's transcript is read", async () => {
    outbound = recordKapso({ "https://app.kapso.ai/media/v1": { bytes: OGG, type: "audio/ogg" } });
    const c = caseOf("voice1-clean");
    const stt = { name: "elevenlabs_scribe", transcribe: vi.fn(async () => { throw new Error("SCRIBE_500"); }) };
    const t = flow(db, [read(reading(c.lines))]);
    await tester(t);
    await runTurn({ ...t.deps, stt }, t.pending(note(c.said)), {});
    const row = await db.one(`select transcript from wa_messages where type = 'audio' order by created_at desc limit 1`);
    expect(row.transcript).toMatchObject({ chosen: "kapso", notes: { ours: "SCRIBE_500" } });
    await db.pg.query(`update settings set value = value || '{"daily_cap_usd": 0}'::jsonb where key = 'stt'`);
    const t2 = flow(db, [read(reading(c.lines))]);
    await tester(t2);
    const stt2 = { name: "elevenlabs_scribe", transcribe: vi.fn(async () => c.said) };
    await runTurn({ ...t2.deps, stt: stt2 }, t2.pending(note(c.said)), {});
    expect(stt2.transcribe).not.toHaveBeenCalled();
    await db.pg.query(`update settings set value = value || '{"daily_cap_usd": 1}'::jsonb where key = 'stt'`);
  });
});

describe("4 the catalogue's button", () => {
  beforeAll(async () => { await db.pg.exec(`update settings set value = value || '{"catalog_id": "CAT_TEST", "product_link": "https://wa.me/12036602328?text={sku}"}'::jsonb where key = 'catalog';
    update settings set value = '{"enabled": true}' where key = 'welcome';`); await seedFeedItem(db); });
  afterAll(async () => { await db.pg.exec(`update settings set value = value - 'catalog_id' where key = 'catalog';
    update settings set value = '{"enabled": false}' where key = 'welcome';`); });
  const catalogs = () => outbound.filter((o) => o.body.interactive?.type === "catalog_message");

  it("comes with the welcome, in the customer's language, once", async () => {
    const t = flow(db, []);
    await t.customer();
    await t.text("hello");
    expect(catalogs()).toHaveLength(1);
    expect(bodyOf(catalogs()[0]!)).toContain("The Alo King catalogue, with pictures");
    // CAT2: the thumbnail Kapso requires, a SKU in Meta's catalogue (an approved picture and its feed JPEG).
    expect(catalogs()[0]!.body.interactive.action).toEqual({ name: "catalog_message", parameters: { thumbnail_product_retailer_id: "AK-0103" } });
    expect(checkInteractive(catalogs()[0]!.body)).toBeNull();
    await t.text("hello again");
    expect(catalogs()).toHaveLength(1);
  });

  it("comes with a tester's first reply in test mode", async () => {
    await db.pg.exec(`insert into deployment_marker(environment) values ('staging');
      update settings set value = value || '{"enabled": true}'::jsonb where key = 'test_mode';`);
    try {
      const c = caseOf("voice1-two-shawarma");
      const t = flow(db, [read(reading(c.lines))], { env: { ENVIRONMENT: "staging" } });
      await tester(t);
      await t.text(c.said);
      expect(catalogs()).toHaveLength(1);
      expect(bodyOf(catalogs()[0]!)).toContain("كتالوج ألو كينغ بالصور");
    } finally {
      await db.pg.exec(`update settings set value = value || '{"enabled": false}'::jsonb where key = 'test_mode'; delete from deployment_marker;`);
    }
  });

  it.each([["بدي شوف الكتالوج", "كتالوج ألو كينغ"], ["show me the catalogue", "The Alo King catalogue"], ["le catalogue", "Le catalogue Alo King"]])(
    "«%s» sends it by code, no model", async (said, body) => {
      const t = flow(db, []);
      await t.customer();
      const s = { welcomed: true, catalogOffered: true, lang: (said.startsWith("le") ? "fr" : said.startsWith("show") ? "en" : "ar") as any };
      await runTurn(t.deps, t.pending({ type: "text", text: { body: said } }), s);
      expect(t.seen).toHaveLength(0);
      expect(catalogs()).toHaveLength(1);
      expect(bodyOf(catalogs()[0]!)).toContain(body);
    });

  // CAT2 (staging, 24 Nov 04:22 UTC): «الكتالوج» ended "answered" with nothing sent, because Kapso refused the catalog_message (422).
  const invalid = () => new Response(JSON.stringify({ error: "Invalid message payload" }), { status: 422, headers: { "content-type": "application/json" } });
  it("CAT2: «الكتالوج» refused by Kapso: the catalogue's link as a button, in the customer's language; never silence", async () => {
    outbound = recordKapso({}, (b) => (b.interactive?.type === "catalog_message" ? invalid() : null));
    const t = flow(db, []);
    await t.customer();
    const r = await runTurn(t.deps, t.pending({ type: "text", text: { body: "الكتالوج" } }), { welcomed: true, catalogOffered: true, lang: "ar" } as any);
    expect((outbound as any).refused).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.interactive).toMatchObject({ type: "cta_url", action: { name: "cta_url", parameters: { display_text: "افتح الكتالوج", url: "https://wa.me/c/12036602328" } } });
    expect(bodyOf(outbound[0]!)).toContain("كتالوج ألو كينغ بالصور");
    expect(r.outcome).toBe("answered");
    expect(r.sent.length).toBeGreaterThan(0);
  });
  it("CAT2: the button refused too: the same words as text with the link, in English for an English customer", async () => {
    outbound = recordKapso({}, (b) => (b.type === "interactive" ? invalid() : null));
    const t = flow(db, []);
    await t.customer();
    const r = await runTurn(t.deps, t.pending({ type: "text", text: { body: "show me the catalogue" } }), { welcomed: true, catalogOffered: true, lang: "en" } as any);
    expect((outbound as any).refused.map((s: Sent) => s.body.interactive.type)).toEqual(["catalog_message", "cta_url"]);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body.type).toBe("text");
    expect(outbound[0]!.body.text.body).toContain("The Alo King catalogue, with pictures");
    expect(outbound[0]!.body.text.body).toContain("https://wa.me/c/12036602328");
    expect(r.sent.length).toBeGreaterThan(0);
  });
});
