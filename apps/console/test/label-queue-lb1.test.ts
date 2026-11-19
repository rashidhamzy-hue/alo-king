// LB1: the approval queue in the order of one sitting: allergens; halal, diet labels and certificates; hazard and printed warnings;
// disagreements between sources; then the rest of the label readings. A person decides each row against the pack photo; the database
// (0211: review_field_value, review_claim, review_certificate; 0049: review_proposed_fact) does the approving and refuses anyone else.
import { beforeAll, describe, expect, it } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig; let A: string, B: string, C: string, D: string;
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); return { ...w, b }; };
const one = async (sql: string, p: unknown[] = []) => r.db.one(sql, p);
const path = (p: string, s: string) => `labels/${p}/2026-11-16/${s}.jpg`;

beforeAll(async () => {
  r = await rig();
  const food = await r.db.all(`select id from products where is_active and category = 'Snacks & Candy' order by sku limit 5`);
  const clean = await r.db.one(`select id from products where is_active and category = 'Cleaning & Household' order by sku limit 1`);
  [A, B, C, D] = [food[0].id, food[1].id, clean.id, food[2].id];
  const lead = await r.staff("ops_lead", "Seed lead");
  for (const x of [A, B, C, D]) for (const s of ["front", "back"]) await r.db.rpc("record_label_capture", { p_product: x, p_shot: s, p_media_path: path(x, s), p_by: lead.partyId });
  const scan = (p: string, reading: object) => r.db.rpc("record_label_scan", { p_product: p, p_photos: [path(p, "front"), path(p, "back")], p_model: "test", p_by: lead.partyId, p_reading: reading });
  await scan(A, { facts: [{ attribute: "milk", value: "contains", quote: "Contains milk" }, { attribute: "halal", value: "yes", quote: "Halal" }], fields: { warnings_as_printed: ["Contains caffeine."], directions_as_printed: "Serve cold." } });
  await scan(B, { facts: [{ attribute: "nutrition", values: { energy_kcal: 100, fat: 1, carbohydrates: 10, proteins: 5 } }], claims: [{ code: "high_protein", quote: "High protein" }] });
  await scan(C, { fields: { hazard_warnings: ["Causes eye irritation"] } });
}, 120_000);

describe("the queue page", () => {
  it("is for the ops lead and the admin: a picker is refused, a lead sees the groups in the order of the sitting with the pack photos", async () => {
    const picker = await who("picker", "Pia q");
    expect((await picker.b.get("/label-queue")).status).toBe(403);
    const lead = await who("ops_lead", "Maya q");
    const p = await lead.b.get("/label-queue");
    expect(p.status).toBe(200);
    const heads = [...p.text.matchAll(/<h2 data-group="(\d)">/g)].map((m) => Number(m[1]));
    expect(heads).toEqual([...heads].sort((a, b) => a - b));
    expect(heads).toEqual([1, 2, 3, 5]);                                              // no disagreements in this data: that group is not shown empty
    const at = (re: RegExp) => p.text.search(re);
    expect(at(/Allergens/)).toBeLessThan(at(/Halal, diet labels and certificates/));
    expect(at(/Halal, diet labels and certificates/)).toBeLessThan(at(/Hazard and printed warnings/));
    expect(at(/Hazard and printed warnings/)).toBeLessThan(at(/The rest of the label readings/));
    expect(p.text).toContain("Contains milk");                                         // the printed words beside the value
    expect(p.text).toMatch(/href="https:\/\/media\.test\/labels\/[^"]*back[^"]*"|href="https:\/\/media\.test\/labels\/[0-9a-f-]+\/2026-11-16\/back\.jpg/);
    expect(p.text).toContain(`href="/intake/${A}"`);
    expect(p.text).not.toMatch(/<script(?![^>]*\bsrc=)|<style|\sstyle="/);
  });
  it("is in the Approve group of the menu for a lead, and not for a picker", async () => {
    const lead = await who("ops_lead", "Maya nav");
    expect((await lead.b.get("/approve")).text).toContain('href="/approve?tab=labels"');          // CON1: a kind of the one Approvals inbox
    const picker = await who("picker", "Pia nav");
    expect((await picker.b.get("/pick")).text).not.toContain('href="/approve');
  });
  it("in Arabic: the groups and the buttons", async () => {
    const lead = await who("ops_lead", "Maya ar"); lead.b.cookies.set("ak_lang", "ar");
    const t = (await lead.b.get("/label-queue")).text;
    expect(t).toMatch(/<html lang="ar" dir="rtl">/);
    expect(t).toContain("مسبّبات الحساسية"); expect(t).toContain("أكّد"); expect(t).toContain("ارفض");
  });
});

describe("deciding", () => {
  it("a warning is confirmed as printed, or corrected line by line; the person is recorded, and the row leaves the queue", async () => {
    const lead = await who("ops_lead", "Maya warn");
    const page = await lead.b.get("/label-queue");
    const id = /\/label-queue\/field\/([0-9a-f-]{36})\/confirm"/.exec(page.text.slice(page.text.indexOf('data-group="3"')))![1]!;
    const row = await one(`select field_key, product_id from product_field_values where id = $1`, [id]);
    expect(["hazard_warnings", "warnings_as_printed"]).toContain(row.field_key);
    const done = await lead.b.post(`/label-queue/field/${id}/confirm`, { corrected: "Contains caffeine.\nNot for children." });
    expect(flashOf(done.text)).toMatch(/Confirmed/);
    expect(await one(`select status, approved_by, value, detail->>'corrected_by_person' as c from product_field_values where id = $1`, [id]))
      .toEqual({ status: "approved", approved_by: lead.partyId, value: ["Contains caffeine.", "Not for children."], c: "true" });
    expect(done.text).not.toContain(`/label-queue/field/${id}/confirm`);
    expect((await r.actions()).find((a) => a.action === "label_queue_confirm" && a.phase === "done")).toMatchObject({ party_id: lead.partyId });
  });
  it("an allergen is confirmed with what the pack says (the person may change the reading); a rejection keeps nothing", async () => {
    const lead = await who("admin", "Rasheed q");
    const page = await lead.b.get("/label-queue");
    const milk = /\/label-queue\/fact\/([0-9a-f-]{36})\/confirm"/.exec(page.text.slice(page.text.indexOf('data-group="1"')))![1]!;
    const done = await lead.b.post(`/label-queue/fact/${milk}/confirm`, { value: "may_contain" });
    expect(flashOf(done.text)).toMatch(/Confirmed/);
    expect(await one(`select value, approved_by, source from product_facts where product_id = $1 and attribute = 'milk' and approved_at is not null and superseded_at is null`, [A]))
      .toEqual({ value: "may_contain", approved_by: lead.partyId, source: "label" });
    const halal = (await one(`select id from product_facts where product_id = $1 and attribute = 'halal' and approved_at is null and superseded_at is null`, [A])).id;
    expect(flashOf((await lead.b.post(`/label-queue/fact/${halal}/reject`, { note: "not on the pack" })).text)).toMatch(/Rejected/);
    expect(await one(`select count(*)::int as n from product_facts where product_id = $1 and attribute = 'halal' and approved_at is not null`, [A])).toEqual({ n: 0 });
  });
  it("a claim and a certificate; a picker's post is refused by the console and the database", async () => {
    const lead = await who("ops_lead", "Maya claim");
    const claim = (await one(`select id from product_claims where product_id = $1 and status = 'proposed'`, [B])).id;
    const ev = (await one(`insert into evidence_documents(kind, product_id, media_path) values ('certificate', $1, 'media/evidence/c.jpg') returning id`, [D])).id;
    const cert = (await one(`insert into product_certificates(product_id, kind, evidence_id) values ($1, 'halal', $2) returning id`, [D, ev])).id;
    await lead.b.get("/label-queue");
    expect(flashOf((await lead.b.post(`/label-queue/claim/${claim}/confirm`)).text)).toMatch(/Confirmed/);
    expect(flashOf((await lead.b.post(`/label-queue/certificate/${cert}/confirm`)).text)).toMatch(/Confirmed/);
    expect(await one(`select status from product_claims where id = $1`, [claim])).toEqual({ status: "approved" });
    expect(await one(`select status, approved_by from product_certificates where id = $1`, [cert])).toEqual({ status: "approved", approved_by: lead.partyId });
    const picker = await who("picker", "Pia decide");
    expect((await picker.b.post(`/label-queue/fact/${claim}/confirm`)).status).toBe(403);
    await expect(r.db.rpc("review_field_value", { p_value: claim, p_by: picker.partyId, p_decision: "confirm" })).rejects.toThrow(/NOT_AUTHORISED/);
  });
  it("a refusal from the database is said plainly, and nothing is half done", async () => {
    const lead = await who("ops_lead", "Maya twice");
    await lead.b.get("/label-queue");
    const stale = (await one(`select id from product_field_values where status = 'approved' limit 1`)).id;
    expect(flashOf((await lead.b.post(`/label-queue/field/${stale}/confirm`)).text)).toMatch(/already decided/i);
    expect(flashOf((await lead.b.post(`/label-queue/field/not-an-id/confirm`)).text)).toMatch(/not valid/i);
  });
  it("empty: says so", async () => {
    await r.db.pg.query(`update product_facts set superseded_at = now() where approved_at is null and superseded_at is null`);
    await r.db.pg.query(`update product_field_values set status = 'rejected' where status = 'proposed'`);
    await r.db.pg.query(`update product_claims set status = 'rejected' where status = 'proposed'`);
    await r.db.pg.query(`update product_certificates set status = 'rejected' where status = 'proposed'`);
    const lead = await who("ops_lead", "Maya empty");
    expect((await lead.b.get("/label-queue")).text).toContain("Nothing waits for a person");
  });
});
