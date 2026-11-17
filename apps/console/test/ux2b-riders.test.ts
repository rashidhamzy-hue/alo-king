// UX2b: Riders (the roster): who is on shift (start and end), the cash each holds against the caps, whether the written terms are on file. No rating.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deliver, flashOf, openShop, placeOrder, rig, type Rig } from "./kit";

let r: Rig; let village: string; let rami: string; let karim: string;
afterEach(() => vi.unstubAllGlobals());
const who = async (role: "ops_lead" | "picker" | "admin", name: string, lang = "en") => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); b.cookies.set("ak_lang", lang); return { ...w, b }; };
beforeAll(async () => {
  r = await rig(); village = await openShop(r.db);
  rami = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  karim = (await r.db.one(`insert into parties(role, display_name) values ('driver', 'Karim') returning id`)).id;
  await r.db.rpc("start_shift", { p_driver: rami });
}, 120_000);

describe("the roster", () => {
  it("lists every rider with the shift state and the cash against the caps; leads only", async () => {
    const o = await placeOrder(r.db, village);
    await deliver(r.db, o.id, rami);
    await r.db.rpc("rider_collect", { p_order: o.id, p_driver: rami, p_usd: o.total, p_lbp: 0 });
    const lead = await who("ops_lead", "Maya");
    const t = (await lead.b.get("/riders")).text;
    expect(t).toContain("Rami"); expect(t).toContain("Karim");
    expect(t).toMatch(/On shift \(1\)/); expect(t).toMatch(/Off shift \(1\)/);
    expect(t).toMatch(/Cash held: <strong><bdi>\$[\d.]+<\/bdi> \+ <bdi>[\d,]+ LBP<\/bdi><\/strong>/);
    expect(t).toContain("under the caps");
    expect(t).toContain("soft $100.00, hard $150.00");                                  // the caps are the setting's (CFG1), not a number in the page
    expect((await (await who("picker", "Pia")).b.get("/riders")).status).toBe(403);
  });
  it("has no rating, score or ranking of a rider", async () => {
    const lead = await who("ops_lead", "Maya2");
    const raw = (await lead.b.get("/riders")).text;
    expect(raw).toContain("never rated or scored");                                       // the page says so
    const t = raw.replace(/<[^>]+>/g, " ").replace(/Riders are never rated or scored here: this page measures the service, not people\./, "");
    expect(t).not.toMatch(/\b(rating|rated|score|scored|ranking|ranked|stars|best rider|top rider)\b/i);
    expect(/\d(\.\d)?\s*\/\s*5|★|⭐/.test(t)).toBe(false);
  });
});

describe("shifts: start and end", () => {
  it("starts a shift through act_for_rider and ends it through close_shift, each logged", async () => {
    const lead = await who("ops_lead", "Maya3");
    await lead.b.get("/riders");
    expect(flashOf((await lead.b.post(`/riders/${karim}/start-shift`)).text)).toBe("Their shift is open. They can be offered jobs.");
    expect(Number((await r.db.one(`select count(*) as n from driver_shifts where driver_id = $1 and ended_at is null`, [karim])).n)).toBe(1);
    expect(flashOf((await lead.b.post(`/riders/${karim}/start-shift`)).text)).toBe("Their shift was already open.");
    expect(flashOf((await lead.b.post(`/riders/${karim}/end-shift`)).text)).toBe("Shift ended.");
    expect(Number((await r.db.one(`select count(*) as n from driver_shifts where driver_id = $1 and ended_at is null`, [karim])).n)).toBe(0);
    const acts = (await r.actions()).filter((a: any) => a.action === "rider_start_shift" || a.action === "rider_end_shift").map((a: any) => `${a.action}:${a.phase}`);
    expect(acts).toEqual(expect.arrayContaining(["rider_start_shift:intent", "rider_start_shift:done", "rider_end_shift:intent", "rider_end_shift:done"]));
  });
  it("a picker cannot start or end a shift", async () => {
    const p = await who("picker", "Pia2");
    expect((await p.b.post(`/riders/${karim}/start-shift`, {}, { follow: false })).status).toBe(403);
    expect((await p.b.post(`/riders/${karim}/end-shift`, {}, { follow: false })).status).toBe(403);
  });
});

describe("written terms on file", () => {
  it("says so plainly when they are not on file, and records them with the document in the private bucket", async () => {
    const lead = await who("ops_lead", "Maya4");
    let t = (await lead.b.get("/riders")).text;
    expect(t).toContain("not on file");
    const res = await lead.b.postFiles(`/riders/${rami}/terms`, { reference: "Rider terms v1, signed copy", signed_on: "2026-11-10" }, { terms: { name: "terms.pdf", type: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) } });
    expect(flashOf(res.text)).toBe("The written terms are on file.");
    t = res.text;
    expect(t).toContain("Rider terms v1, signed copy"); expect(t).toContain("2026-11-10"); expect(t).toContain("Recorded by Maya4");
    expect(t).toContain("open the document");
    expect(t).toMatch(/https:\/\/media\.test\/rider_terms\//);
    const row = await r.db.one(`select reference, document_path, recorded_by from rider_terms where driver_id = $1 and superseded_at is null`, [rami]);
    expect(row.recorded_by).toBe(lead.partyId); expect(row.document_path).toMatch(new RegExp(`^rider_terms/${rami}/`));
    const again = await lead.b.post(`/riders/${rami}/terms`, { reference: "Rider terms v2", signed_on: "2026-11-12" });
    expect(flashOf(again.text)).toBe("Newer terms recorded; the earlier ones stay as history.");
  });
  it("refuses a missing name, a bad day and a picker", async () => {
    const lead = await who("ops_lead", "Maya5");
    await lead.b.get("/riders");
    expect(flashOf((await lead.b.post(`/riders/${karim}/terms`, { reference: "x", signed_on: "2026-11-10" })).text)).toBe("Name the document and its version.");
    expect(flashOf((await lead.b.post(`/riders/${karim}/terms`, { reference: "Terms v1", signed_on: "" })).text)).toBe("Choose the day it was signed.");
    expect(flashOf((await lead.b.post(`/riders/${karim}/terms`, { reference: "Terms v1", signed_on: "2999-01-01" })).text)).toContain("cannot be in the future");
    expect((await (await who("picker", "Pia3")).b.post(`/riders/${karim}/terms`, { reference: "Terms v1", signed_on: "2026-11-10" }, { follow: false })).status).toBe(403);
  });
});

describe("Arabic", () => {
  it("the roster, the cap words and the terms are in Arabic, right to left", async () => {
    const lead = await who("ops_lead", "Maya6", "ar");
    const t = (await lead.b.get("/riders")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    for (const w of ["في الوردية", "النقد معه", "الشروط المكتوبة", "تحت السقفين", "لا تقييم ولا درجات"]) expect(t, w).toContain(w);
  });
});
