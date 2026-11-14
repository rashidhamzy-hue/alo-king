// Names review (session D4): the 282 names and sizes from data/proposals/names.json, loaded by migration 0110, reviewed one at a time
// through the console's request handler. Approving writes the product's name (size after it) and queues its search words again;
// each decision is made once on a double tap; rejecting an approved one puts the earlier name back; pickers are refused twice.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); }, 120_000);

const proposalId = async (sku: string) => (await r.db.one(`select id from product_name_proposals where sku = $1`, [sku])).id as string;
const product = (sku: string) => r.db.one(`select name_en, name_ar from products where sku = $1`, [sku]);

describe("Names review", () => {
  it("loads the 282 proposals from the file, and changes no product until a person decides", async () => {
    const file = JSON.parse(readFileSync(fileURLToPath(new URL("../../../data/proposals/names.json", import.meta.url)), "utf8"));
    expect(file.proposals).toHaveLength(282);
    expect(Number((await r.db.one(`select count(*) as n from product_name_proposals`)).n)).toBe(282);
    expect(Number((await r.db.one(`select count(*) as n from product_name_proposals where status = 'proposed'`)).n)).toBe(282);
    // every proposal is the file's, to the letter
    const row = await r.db.one(`select name_en, name_ar, size_en, size_ar, ar_source, current_name_en from product_name_proposals where sku = 'AK-0031'`);
    const f = file.proposals.find((p: any) => p.sku === "AK-0031");
    expect(row).toEqual({ name_en: f.proposed.name_en, name_ar: f.proposed.name_ar, size_en: f.proposed.size_en, size_ar: f.proposed.size_ar, ar_source: f.ar_source, current_name_en: f.current.name_en });
    // the nine the checks refused have no proposal and keep their names
    for (const x of file.rejected) expect(await r.db.one(`select 1 as x from product_name_proposals where sku = $1`, [x.sku])).toBeFalsy();
    // and the catalog is untouched: the product still has the name the proposal started from
    expect((await product("AK-0031")).name_en).toBe("Tanmia Fresh Chicken Filet 500G");
    expect(Number((await r.db.one(`select count(*) as n from products p join product_name_proposals n on n.sku = p.sku where p.name_en is distinct from n.current_name_en`)).n)).toBe(0);
  });

  it("shows current and proposed side by side with a progress counter, fifteen to a page", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const first = (await b.get("/names")).text;
    expect(first).toContain("<strong>0 of 282</strong> decided");
    expect(first).toContain('id="AK-0001"');
    const page = (await b.get("/names?q=tanmia")).text;
    expect(page).toContain("Tanmia Fresh Chicken Filet 500G");            // in the catalog now
    expect(page).toContain("Tanmia Fresh Chicken Filet 500 g");           // will be saved as
    expect(page).toContain("500 غ");
    expect(page).toContain("The Arabic was written by a model");
    expect(first).toContain("The Arabic is the catalog's own.");
    expect((first.match(/class="pair"/g) ?? [])).toHaveLength(15);
    expect((await b.get("/names?page=19")).text).toContain("Page 19 of 19 (282 items)");
    const found = (await b.get("/names?q=ayran")).text;
    expect(found).toContain("AK-0041");
    expect(found).toContain("Candia Ayran 250Ml");
    expect(found).toContain("Open Food Facts calls it: Ayran · Candia · 25cl");
  });

  it("approve: the product takes the name with its size, its search words are queued again, and a double tap decides once", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await r.db.pg.exec(`update search_word_jobs set status = 'done' where sku = 'AK-0031'`);
    const id = await proposalId("AK-0031");
    await b.get("/names");
    const res = await b.post(`/names/${id}`, { decision: "approve" });
    expect(flashOf(res.text)).toBe("Approved: AK-0031 is now “Tanmia Fresh Chicken Filet 500 g”. Its search words are queued again.");
    expect(await product("AK-0031")).toEqual({ name_en: "Tanmia Fresh Chicken Filet 500 g", name_ar: "فيليه دجاج طازج تنمية 500 غ" });
    expect(await r.db.one(`select status, reason from search_word_jobs where sku = 'AK-0031'`)).toEqual({ status: "pending", reason: "changed" });
    const decided = await r.db.one(`select status, decided_by, decided_at, previous_name_en from product_name_proposals where id = $1`, [id]);
    expect(decided).toMatchObject({ status: "approved", decided_by: lead.partyId, previous_name_en: "Tanmia Fresh Chicken Filet 500G" });

    // the second tap: nothing moves
    expect(flashOf((await b.post(`/names/${id}`, { decision: "approve" })).text)).toBe("Already approved.");
    expect((await r.db.one(`select decided_at from product_name_proposals where id = $1`, [id])).decided_at).toEqual(decided.decided_at);
    // two taps at the same instant: one decides, one is told it was done
    const id2 = await proposalId("AK-0033");
    const both = await Promise.all([1, 2].map(() => r.db.rpc("review_product_name", { p_proposal: id2, p_by: lead.partyId, p_decision: "approve" })));
    expect(both.map((x: any) => x.already).sort()).toEqual([false, true]);
    // and the page: the approved one has left the waiting list and the counter moved
    const page = (await b.get("/names")).text;
    expect(page).toContain("<strong>2 of 282</strong> decided");
    expect(page).not.toContain('id="AK-0031"');
    expect((await b.get("/names?status=approved")).text).toContain("Undo (reject)");
  });

  it("an approval that does not change the name says so and queues nothing new", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/names");
    const id = await proposalId("AK-0001");              // Potato → Potato
    await r.db.pg.exec(`update search_word_jobs set status = 'done' where sku = 'AK-0001'`);
    expect(flashOf((await b.post(`/names/${id}`, { decision: "approve" })).text)).toBe("Approved: AK-0001 is now “Potato”. The name did not change.");
    expect(await r.db.one(`select status from search_word_jobs where sku = 'AK-0001' and status <> 'done'`)).toBeFalsy();
  });

  it("correct: the person's words are saved and applied in one step; a praise or health word cannot be added", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/names");
    const id = await proposalId("AK-0032");
    const typed = { decision: "correct", name_en: "Tanmia Breaded Chicken Fillet", size_en: "loose", name_ar: "فيليه دجاج مقرمش تنمية", size_ar: "", note: "pack says loose" };
    expect(flashOf((await b.post(`/names/${id}`, { ...typed, name_en: "Tanmia Healthy Breaded Chicken Fillet" })).text)).toBe("A name may not praise, or make a health, diet or religion claim. Remove: healthy.");
    expect(flashOf((await b.post(`/names/${id}`, { ...typed, name_en: "" })).text)).toBe("Write the name.");
    expect(flashOf((await b.post(`/names/${id}`, { ...typed, name_ar: "chicken" })).text)).toBe("The Arabic name or size has no Arabic letters.");
    expect((await product("AK-0032")).name_en).toBe("Tanmia Breaded Chicken Fillet Loose");        // nothing moved
    expect(flashOf((await b.post(`/names/${id}`, typed)).text)).toBe("Saved your correction: AK-0032 is now “Tanmia Breaded Chicken Fillet loose”. Its search words are queued again.");
    expect(await product("AK-0032")).toEqual({ name_en: "Tanmia Breaded Chicken Fillet loose", name_ar: "فيليه دجاج مقرمش تنمية" });
    expect(await r.db.one(`select status, corrected, name_en, size_en, review_note, original->>'name_en' as was from product_name_proposals where id = $1`, [id]))
      .toEqual({ status: "approved", corrected: true, name_en: "Tanmia Breaded Chicken Fillet", size_en: "loose", review_note: "pack says loose", was: "Tanmia Breaded Chicken Fillet, Loose" });
    expect(flashOf((await b.post(`/names/${id}`, typed)).text)).toBe("Already approved.");                      // the same correction twice is once
    // A word the catalog's own name already had is not an "added" claim: "Fresh" was in AK-0031's name, so keeping it is allowed.
    const kept = await proposalId("AK-0031");
    expect(flashOf((await b.post(`/names/${kept}`, { decision: "correct", name_en: "Tanmia Fresh Chicken Filet", size_en: "500 g", name_ar: "فيليه دجاج طازج تنمية", size_ar: "500 غ" })).text)).toBe("Already approved.");
  });

  it("reject: a waiting proposal keeps the catalog's name; an approved one is undone and the earlier name is back; either is decided once", async () => {
    const lead = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/names");
    const waiting = await proposalId("AK-0035");
    const before = await product("AK-0035");
    expect(flashOf((await b.post(`/names/${waiting}`, { decision: "reject", note: "not this one" })).text)).toBe("Rejected: AK-0035 keeps the catalog's name.");
    expect(await product("AK-0035")).toEqual(before);
    expect(flashOf((await b.post(`/names/${waiting}`, { decision: "reject" })).text)).toBe("Already rejected.");
    // a rejected one can be approved after all
    expect(flashOf((await b.post(`/names/${waiting}`, { decision: "approve" })).text)).toContain("Approved: AK-0035");

    const approved = await proposalId("AK-0036");
    const was = await product("AK-0036");
    await b.post(`/names/${approved}`, { decision: "approve" });
    expect(await product("AK-0036")).not.toEqual(was);
    expect(flashOf((await b.post(`/names/${approved}`, { decision: "reject", note: "wrong size" })).text)).toBe("Undone: the earlier name of AK-0036 is back.");
    expect(await product("AK-0036")).toEqual(was);
    expect(flashOf((await b.post(`/names/${approved}`, { decision: "reject" })).text)).toBe("Already rejected.");
    expect((await r.db.one(`select name_en from products where sku = 'AK-0036'`)).name_en).toBe(was.name_en);

    // not put back over a name somebody changed since
    const edited = await proposalId("AK-0038");
    await b.post(`/names/${edited}`, { decision: "approve" });
    await r.db.pg.exec(`update products set name_en = 'Changed by hand' where sku = 'AK-0038'`);
    expect(flashOf((await b.post(`/names/${edited}`, { decision: "reject" })).text)).toBe("The catalog name was changed after this approval, so it is not put back from here.");
    expect((await product("AK-0038")).name_en).toBe("Changed by hand");
    expect((await r.db.one(`select status from product_name_proposals where id = $1`, [edited])).status).toBe("approved");
  });

  it("an item missing from the catalog database is refused plainly", async () => {
    const lead = await r.staff("ops_lead");
    const b = r.browser();
    await b.signIn(lead);
    const { id } = await r.db.one(`insert into product_name_proposals(sku, current_name_en, name_en, ar_source) values ('AK-9999', 'Ghost', 'Ghost', 'catalog') returning id`);
    await b.get("/names");
    expect(flashOf((await b.post(`/names/${id}`, { decision: "approve" })).text)).toBe("That item is not in the catalog database, so no name can be applied.");
  });

  it("pickers are refused by the page and by the database; every decision is in the action log with who made it", async () => {
    const picker = await r.staff("picker", "Pia");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/names")).status).toBe(403);
    expect((await p.get("/")).text).not.toContain('href="/names"');
    const id = await proposalId("AK-0050");
    expect((await p.post(`/names/${id}`, { decision: "approve" }, { follow: false })).status).toBe(403);
    await expect(r.db.rpc("review_product_name", { p_proposal: id, p_by: picker.partyId, p_decision: "approve" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(r.db.rpc("review_product_name", { p_proposal: id, p_by: null, p_decision: "approve" })).rejects.toThrow(/NOT_AUTHORISED/);
    expect((await r.db.one(`select status from product_name_proposals where id = $1`, [id])).status).toBe("proposed");

    const log = (await r.actions()).filter((a) => a.action.startsWith("name_"));
    expect(log.length).toBeGreaterThan(6);
    expect(log.every((a) => a.party_id !== null && ["ops_lead", "admin"].includes(a.role))).toBe(true);
    expect(log.filter((a) => a.action === "name_approve" && a.phase === "intent")[0]!.args.proposal).toBeTruthy();
  });

  it("a database without migration 0110 (staging can lag the Worker) gets a plain note, not an error page", async () => {
    const lag = await rig();
    await lag.db.pg.exec(`drop table product_name_proposals`);
    const b = lag.browser();
    await b.signIn(await lag.staff("ops_lead"));
    const page = await b.get("/names");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Not available yet: the database has no product_name_proposals table");
  });
});
