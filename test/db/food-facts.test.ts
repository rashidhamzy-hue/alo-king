// Build plan 1.11, and the acceptance test "Restriction check: unknown fails, sponsored item must pass".
// Facts come only from approved records with their status; unknown is never safe; a paid placement changes nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let ops: string; let picker: string; let labneh: string; let sponsored: string;
const check = (p: string, r: string[]) => db.rpc("product_meets_restrictions", { p_product: p, p_restrictions: r });
const propose = (p: string, attribute: string, value: string | null, status: string, source = "label", extra: Record<string, unknown> = {}) =>
  db.rpc<string>("propose_product_fact", { p_product: p, p_attribute: attribute, p_value: value, p_status: status, p_source: source, p_by: picker, ...extra });
const approve = (fact: string) => db.rpc("approve_product_fact", { p_fact: fact, p_by: ops });
const resultOf = (r: any, code: string) => r.checks.find((c: any) => c.restriction === code);

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  labneh = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  // A product with a paid placement: the restriction check must treat it exactly like any other.
  sponsored = (await db.one(`select p.id from products p join offers o on o.product_id = p.id where p.id <> $1 order by p.name_en limit 1`, [labneh])).id;
  await db.one(`update offers set sponsored_rank = 1 where product_id = $1 returning id`, [sponsored]);
});

describe("food facts (1.11)", () => {
  it("no record is unknown, and unknown fails", async () => {
    const r = await check(labneh, ["peanuts", "halal"]);
    expect(r.meets).toBe(false);
    expect(resultOf(r, "peanuts")).toMatchObject({ result: "unknown", reason: "no_approved_record" });
    expect(resultOf(r, "halal")).toMatchObject({ result: "unknown", reason: "no_approved_record" });
  });

  it("a proposed fact is not used until a person approves it, and only the ops lead or an admin can", async () => {
    const f = await propose(labneh, "peanuts", "free", "declared");
    expect((await check(labneh, ["peanuts"])).meets).toBe(false);
    await expect(db.rpc("approve_product_fact", { p_fact: f, p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await approve(f);
    const r = await check(labneh, ["peanuts"]);
    expect(r.meets).toBe(true);
    expect(resultOf(r, "peanuts")).toMatchObject({ result: "pass", status: "declared", source: "label" });
  });

  it("every restriction must pass: one unknown among passes still fails", async () => {
    const r = await check(labneh, ["peanuts", "sesame"]);
    expect(r.meets).toBe(false);
    expect(resultOf(r, "peanuts").result).toBe("pass");
    expect(resultOf(r, "sesame").result).toBe("unknown");
  });

  it("may contain fails an allergy; a stated 'contains' fails; diet 'no' fails", async () => {
    await approve(await propose(labneh, "tree_nuts", "may_contain", "declared"));
    await approve(await propose(labneh, "milk", "contains", "declared"));
    await approve(await propose(labneh, "vegan", "no", "declared"));
    const r = await check(labneh, ["tree_nuts", "milk", "vegan"]);
    expect(r.meets).toBe(false);
    expect(resultOf(r, "tree_nuts")).toMatchObject({ result: "fails", reason: "may_contain" });
    expect(resultOf(r, "milk")).toMatchObject({ result: "fails", reason: "contains" });
    expect(resultOf(r, "vegan")).toMatchObject({ result: "fails", reason: "no" });
  });

  it("status partial or unknown, an expired fact, and an unrecognised restriction are all unknown", async () => {
    await approve(await propose(labneh, "gluten", "free", "partial"));
    await approve(await propose(labneh, "sesame", null, "unknown"));
    await approve(await propose(labneh, "eggs", "free", "declared", "label", { p_expires_at: "2020-01-01T00:00:00Z" }));
    const r = await check(labneh, ["gluten", "sesame", "eggs", "pork_free", "ingredients"]);
    expect(r.meets).toBe(false);
    expect(resultOf(r, "gluten")).toMatchObject({ result: "unknown", reason: "status_partial" });
    expect(resultOf(r, "sesame")).toMatchObject({ result: "unknown", reason: "status_unknown" });
    expect(resultOf(r, "eggs")).toMatchObject({ result: "unknown", reason: "expired" });
    expect(resultOf(r, "pork_free")).toMatchObject({ result: "unknown", reason: "unknown_restriction" });
    expect(resultOf(r, "ingredients")).toMatchObject({ result: "unknown", reason: "not_a_restriction" });
  });

  it("certified needs evidence; halal from a certificate passes", async () => {
    await expect(propose(labneh, "halal", "yes", "certified", "certificate")).rejects.toThrow(/check constraint/);
    const ev = (await db.one(`insert into evidence_documents(kind, issuer, reference, media_path) values ('certificate', 'Issuer', 'H-123', 'media/evidence/h-123.jpg') returning id`)).id;
    await approve(await propose(labneh, "halal", "yes", "certified", "certificate", { p_evidence: ev }));
    expect(resultOf(await check(labneh, ["halal"]), "halal")).toMatchObject({ result: "pass", status: "certified" });
  });

  it("a new approved fact replaces the old one, which stays as history", async () => {
    await approve(await propose(labneh, "peanuts", "may_contain", "declared"));
    expect(resultOf(await check(labneh, ["peanuts"]), "peanuts").result).toBe("fails");
    const rows = await db.all(`select value, superseded_at is not null as old from product_facts where product_id = $1 and attribute = 'peanuts' order by proposed_at`, [labneh]);
    expect(rows).toEqual([{ value: "free", old: true }, { value: "may_contain", old: false }]);
  });

  it("values must fit the attribute; Open Food Facts alone is never approved", async () => {
    await expect(propose(labneh, "peanuts", "yes", "declared")).rejects.toThrow(/FACT_VALUE/);
    await expect(propose(labneh, "halal", "free", "declared")).rejects.toThrow(/FACT_VALUE/);
    const off = await propose(labneh, "soy", "free", "declared", "open_food_facts");
    await expect(approve(off)).rejects.toThrow(/SECOND_OPINION_ONLY/);
  });

  it("a sponsored item gets no pass: unknown fails, and it passes only on the same approved facts as any other", async () => {
    expect(await db.one(`select sponsored_rank from offers where product_id = $1`, [sponsored])).toEqual({ sponsored_rank: 1 });
    const before = await check(sponsored, ["peanuts"]);
    expect(before.meets).toBe(false);
    expect(resultOf(before, "peanuts").result).toBe("unknown");
    await approve(await propose(sponsored, "peanuts", "free", "declared"));
    expect((await check(sponsored, ["peanuts"])).meets).toBe(true);
  });

  it("no restrictions asked means nothing to fail; the facts list carries status and expiry", async () => {
    expect(await check(labneh, [])).toMatchObject({ meets: true, checks: [] });
    const facts = await db.rpc<any[]>("product_food_facts", { p_product: labneh });
    expect(facts.find((f) => f.attribute === "halal")).toMatchObject({ value: "yes", status: "certified", expired: false });
    expect(facts.find((f) => f.attribute === "eggs")).toMatchObject({ expired: true });
  });
});
