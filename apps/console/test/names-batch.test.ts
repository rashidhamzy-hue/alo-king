// Names review, D5's additions: the keys (tested in shell.test.ts), and "Approve all shown": exactly the items on the screen, at most
// 20, each through review_product_name() one at a time and logged, skipped if they changed after the page was drawn, undone as a batch.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";
import { MAX_BATCH } from "../src/pages/names";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); }, 120_000);

const proposalId = async (sku: string) => (await r.db.one(`select id from product_name_proposals where sku = $1`, [sku])).id as string;
const nameOf = async (sku: string) => (await r.db.one(`select name_en, name_ar from products where sku = $1`, [sku]));
const status = async (sku: string) => (await r.db.one(`select status from product_name_proposals where sku = $1`, [sku])).status as string;
/** What the page put in its "Approve all shown" form: the signed list and who it was drawn for. */
const formOf = (page: string) => {
  const items = /name="items" value="([^"]+)"/.exec(page)?.[1]; const sig = /name="sig" value="([^"]+)"/.exec(page)?.[1];
  return { items: items!, sig: sig!, count: Number(/Approve all shown \((\d+)\)/.exec(page)?.[1]) };
};
const shownSkus = (page: string) => [...page.matchAll(/class="pair" id="(AK-\d+)"/g)].map((m) => m[1]!);

describe("Approve all shown", () => {
  it("offers exactly the fifteen on the screen, with the keys beside it, and nothing on the approved or rejected tabs", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text;
    const f = formOf(page);
    expect(f.count).toBe(15); expect(MAX_BATCH).toBe(20); expect(f.items.split(",")).toHaveLength(15);
    expect(page).toContain("data-names"); expect(page).toContain('data-sku="AK-0001"'); expect(page).toContain("<kbd>a</kbd> approve");
    expect(page).toContain("Approves only the 15 on this screen");
    expect((await b.get("/names?status=approved")).text).not.toContain("Approve all shown");
    expect((await b.get("/names?status=rejected")).text).not.toContain("Approve all shown");
    // a search narrows the screen, and the button with it
    const q = (await b.get("/names?q=ayran")).text;
    expect(formOf(q).count).toBe(shownSkus(q).length);
    // the model-written Arabic is counted beside the button, because the founder reads it before he taps
    expect((await b.get("/names?q=tanmia")).text).toMatch(/\d+ of them have Arabic written by a model: read it first\./);
  });

  it("approves those fifteen and no other, one at a time, each logged in the action log, with the names applied", async () => {
    const lead = await r.staff("admin", "Rasheed"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text;
    const shown = shownSkus(page); const f = formOf(page);
    const before = await Promise.all(shown.map(nameOf));
    const after16 = await nameOf("AK-0016");                                  // the sixteenth is on the next page, not on this screen
    await r.db.pg.exec(`update search_word_jobs set status = 'done'`);
    const res = await b.post("/names/batch/approve", { items: f.items, sig: f.sig, back_status: "proposed", back_q: "", back_page: 1 });
    expect(flashOf(res.text)).toContain("Approve all shown: approved 15 of 15.");
    for (const sku of shown) expect(await status(sku), sku).toBe("approved");
    expect(await status("AK-0016")).toBe("proposed"); expect(await nameOf("AK-0016")).toEqual(after16);
    expect(Number((await r.db.one(`select count(*) as n from product_name_proposals where status = 'approved'`)).n)).toBe(15);
    const decidedBy = await r.db.all(`select distinct decided_by from product_name_proposals where status = 'approved'`);
    expect(decidedBy).toEqual([{ decided_by: lead.partyId }]);
    // approving queues the search words again for every name that changed, as a single approval does (and for none that did not)
    const nowNames = await Promise.all(shown.map(nameOf));
    const changed = nowNames.filter((n, k) => n.name_en !== before[k]!.name_en || n.name_ar !== before[k]!.name_ar).length;
    expect(Number((await r.db.one(`select count(*) as n from search_word_jobs where status = 'pending' and reason = 'changed' and sku = any($1::text[])`, [shown])).n)).toBe(changed);
    const log: any[] = (await r.actions()).filter((a: any) => a.party_id === lead.partyId);
    const each = log.filter((a: any) => a.action === "name_approve" && a.phase === "done" && a.ok);
    expect(each).toHaveLength(15);
    expect(log.filter((a: any) => a.action === "name_approve" && a.phase === "intent")).toHaveLength(15);
    const batch = log.find((a: any) => a.action === "names_batch_approve" && a.phase === "done")!;
    expect(batch.args.approved).toHaveLength(15); expect(batch.ok).toBe(true);
    expect(each.every((a: any) => (log.find((i: any) => i.ref === a.ref && i.phase === "intent").args.batch) === batch.ref)).toBe(true);
    // the decided ones leave the waiting list and the next screen is the next fifteen
    const next = (await b.get("/names")).text;
    expect(next).toContain("<strong>15 of 282</strong> decided"); expect(shownSkus(next)).not.toContain(shown[0]);
    expect(before.length).toBe(15);
  });

  it("refuses a list that is not the one that was drawn: an extra item, a swapped signature, or another person's screen", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const f = formOf((await b.get("/names")).text);
    const extra = `${f.items},${await proposalId("AK-0200")}:${"0".repeat(12)}`;
    expect(flashOf((await b.post("/names/batch/approve", { items: extra, sig: f.sig })).text)).toBe("That list is not the one on your screen. Reload the page and try again.");
    expect(flashOf((await b.post("/names/batch/approve", { items: f.items, sig: f.sig.slice(1) + "x" })).text)).toContain("not the one on your screen");
    expect(flashOf((await b.post("/names/batch/approve", { items: "", sig: "" })).text)).toContain("not the one on your screen");
    const other = await r.staff("ops_lead", "Hassan"); const ob = r.browser(); await ob.signIn(other); await ob.get("/names");
    expect(flashOf((await ob.post("/names/batch/approve", { items: f.items, sig: f.sig })).text)).toContain("not the one on your screen");
    expect(await status("AK-0200")).toBe("proposed");
    // a picker is refused by role
    const p = await r.staff("picker", "Pia"); const pb = r.browser(); await pb.signIn(p);
    expect((await pb.post("/names/batch/approve", { items: f.items, sig: f.sig }, { csrf: "x", follow: false })).status).toBe(403);
  });

  it("skips an item that was decided or changed after the page was drawn, and says so; approves the rest", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text; const f = formOf(page); const shown = shownSkus(page);
    const [decidedMeanwhile, correctedMeanwhile, catalogMoved] = shown;
    await r.db.rpc("review_product_name", { p_proposal: await proposalId(decidedMeanwhile!), p_by: lead.partyId, p_decision: "reject" });      // someone rejected it
    await r.db.pg.query(`update product_name_proposals set name_en = name_en || ' (edited)' where sku = $1`, [correctedMeanwhile]);                // its words changed
    await r.db.pg.query(`update products set name_en = name_en || ' x' where sku = $1`, [catalogMoved]);                                           // the catalog moved
    const res = await b.post("/names/batch/approve", { items: f.items, sig: f.sig });
    expect(flashOf(res.text)).toContain(`approved ${shown.length - 3} of ${shown.length}, skipped 3.`);
    expect(flashOf(res.text)).toContain("Skipped items changed or were decided after the page was drawn.");
    expect(await status(decidedMeanwhile!)).toBe("rejected");
    expect(await status(correctedMeanwhile!)).toBe("proposed"); expect(await status(catalogMoved!)).toBe("proposed");
    for (const sku of shown.slice(3)) expect(await status(sku), sku).toBe("approved");
  });

  it("an item whose catalog name drifted is not offered at all", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const was = await b.get("/names");
    const before = formOf(was.text).items.split(",").length;
    const first = (await r.db.one(`select sku from product_name_proposals where id = $1`, [formOf(was.text).items.split(",")[0]!.split(":")[0]])).sku as string;   // one that is on offer
    await r.db.pg.query(`update products set name_en = name_en || ' drifted' where sku = $1`, [first]);
    const page = (await b.get("/names")).text;
    expect(shownSkus(page)).toContain(first);
    expect(formOf(page).items.split(",")).toHaveLength(before - 1);
    expect(page).toContain("The catalog name has changed since this was proposed");
  });

  it("undoes the whole batch: the earlier names are back, each undo is logged, and it cannot be done twice", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text; const f = formOf(page); const skus = f.items.split(",").map((x) => x.split(":")[0]!);
    const ids = new Map((await r.db.all(`select id, sku from product_name_proposals where id = any($1::uuid[])`, [skus])).map((x: any) => [x.id, x.sku]));
    const before = await Promise.all([...ids.values()].map(nameOf));
    await b.post("/names/batch/approve", { items: f.items, sig: f.sig });
    const changed = await Promise.all([...ids.values()].map(nameOf));
    expect(changed).not.toEqual(before);
    const top = (await b.get("/names")).text;
    const batch = /name="batch" value="([^"]+)"/.exec(top)![1]!;
    expect(top).toMatch(new RegExp(`Your last “Approve all shown” approved ${skus.length} names`)); expect(top).toContain(`Undo this batch (${skus.length})`);
    const undone = await b.post("/names/batch/undo", { batch, back_status: "proposed", back_q: "", back_page: 1 });
    expect(flashOf(undone.text)).toContain(`Undo: undone ${skus.length} of ${skus.length}. The earlier names are back`);
    expect(await Promise.all([...ids.values()].map(nameOf))).toEqual(before);
    for (const sku of ids.values()) expect(await status(sku), sku).toBe("rejected");
    const log = (await r.actions()).filter((a: any) => a.action === "name_undo" && a.phase === "done" && a.ok);
    expect(log.length).toBeGreaterThanOrEqual(skus.length);
    expect((await b.get("/names")).text).not.toContain("Undo this batch");
    expect(flashOf((await b.post("/names/batch/undo", { batch })).text)).toBe("That batch was already undone.");
  });

  it("does not put back a name somebody changed since, and says how many it could not", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text; const f = formOf(page);
    const offered = f.items.split(",").map((x) => x.split(":")[0]!);
    const skus = (await r.db.all(`select sku from product_name_proposals where id = any($1::uuid[]) order by sku`, [offered])).map((x: any) => x.sku as string);
    await b.post("/names/batch/approve", { items: f.items, sig: f.sig });
    await r.db.pg.query(`update products set name_en = 'Changed by hand' where sku = $1`, [skus[0]]);
    const batch = /name="batch" value="([^"]+)"/.exec((await b.get("/names")).text)![1]!;
    const res = await b.post("/names/batch/undo", { batch });
    expect(flashOf(res.text)).toBe(`Undo: undone ${skus.length - 1} of ${skus.length}, 1 could not be put back (changed since).`);
    expect((await nameOf(skus[0]!)).name_en).toBe("Changed by hand"); expect(await status(skus[0]!)).toBe("approved");
  });

  it("is undone only by the person who made it, or the admin; and a made-up batch is refused", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const f = formOf((await b.get("/names")).text);
    await b.post("/names/batch/approve", { items: f.items, sig: f.sig });
    const batch = /name="batch" value="([^"]+)"/.exec((await b.get("/names")).text)![1]!;
    const other = await r.staff("ops_lead", "Hassan"); const ob = r.browser(); await ob.signIn(other); await ob.get("/names");
    expect(flashOf((await ob.post("/names/batch/undo", { batch })).text)).toBe("Only the person who approved the batch, or the admin, can undo it.");
    expect(flashOf((await b.post("/names/batch/undo", { batch: "nope-nope-nope" })).text)).toBe("That batch was not found.");
    expect(flashOf((await b.post("/names/batch/undo", { batch: "!" })).text)).toBe("That batch is not valid.");
    const admin = await r.staff("admin", "Rasheed"); const ab = r.browser(); await ab.signIn(admin); await ab.get("/names");
    expect(flashOf((await ab.post("/names/batch/undo", { batch })).text)).toContain("Undo: undone");
  });

  it("does nothing when the action log cannot be written", async () => {
    const lead = await r.staff("ops_lead", "Maya"); const b = r.browser(); await b.signIn(lead);
    const page = (await b.get("/names")).text; const f = formOf(page); const skus = shownSkus(page);
    r.media.failPut = true;
    try {
      const res = await b.post("/names/batch/approve", { items: f.items, sig: f.sig });
      expect(flashOf(res.text)).toBe("Not done: the action log could not be written. Try again in a minute.");
    } finally { r.media.failPut = false; }
    for (const sku of skus) expect(await status(sku), sku).toBe("proposed");
  });
});
