// SELL1 (0226): the readiness page shows, per item, whether it is packaged and label-ready; per template, packaged items label-ready out of
// total; and the packaged items that are not ready, with what each misses. Read only; ops lead and admin.
import { beforeAll, describe, expect, it } from "vitest";
import { rig, type Rig } from "./kit";

let r: Rig;
beforeAll(async () => { r = await rig(); }, 120_000);
const gate = (on: boolean) => r.db.pg.query(`update settings set value = $1::jsonb where key = 'sell_requires_label'`, [JSON.stringify({ enabled: on })]);

describe("Readiness page: packaged items and their labels", () => {
  it("states the setting, and per template the packaged items that are label-ready out of the packaged total", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser(); await b.signIn(lead);
    await gate(false);
    let t = (await b.get("/readiness")).text;
    expect(t).toContain("Selling requires a label: off");
    expect(t).toMatch(/packaged food<\/td><td>\d+<\/td><td>0 of \d+/i);
    await gate(true);
    t = (await b.get("/readiness")).text;
    expect(t).toContain("Selling requires a label: on");
    // a template with no packaged item is not in the table (fresh produce is loose)
    const table = t.slice(t.indexOf("Packaged items and their labels"), t.indexOf("<form"));
    expect(table).not.toMatch(/fresh produce/i);
    await gate(false);
  });

  it("lists the packaged items that are not label-ready under their own filter, each with what it misses; an item that is ready is not on it", async () => {
    const lead = await r.staff("ops_lead", "Maya2");
    const b = r.browser(); await b.signIn(lead);
    const rows = (await r.db.rpc("readiness_summary", {})).packaged_not_ready as any[];
    expect(rows.length).toBeGreaterThan(100);
    const one = rows.find((x) => x.template === "water")!;
    const list = (await b.get(`/readiness?show=label&q=${one.sku}`)).text;
    expect(list).toContain("packaged, not label-ready (");
    expect(list).toContain(one.sku);
    expect(list).toContain(String(one.missing[0]).replace(/_/g, " "));
    // a loose item is never under it
    const veg = (await r.db.one(`select sku from products where category = 'Fruits & Vegetables' and is_active order by sku limit 1`)).sku;
    expect((await b.get(`/readiness?show=label&q=${veg}`)).text).toContain("Nothing here.");
  });

  it("each item says whether it is packaged: loose or packaged, and label-ready or what is missing", async () => {
    const lead = await r.staff("ops_lead", "Maya3");
    const b = r.browser(); await b.signIn(lead);
    const veg = (await r.db.one(`select sku from products where category = 'Fruits & Vegetables' and is_active order by sku limit 1`)).sku;
    const water = (await r.db.one(`select sku from products where category = 'Water' and is_active order by sku limit 1`)).sku;
    expect((await b.get(`/readiness?q=${veg}`)).text).toContain("loose");
    const w = (await b.get(`/readiness?q=${water}`)).text;
    expect(w).toContain("packaged");
    expect(w).toContain("label missing:");
    expect(w).toContain("volume ml");
  });

  it("the page is for ops leads and admins only", async () => {
    const picker = await r.staff("picker", "Rana");
    const b = r.browser(); await b.signIn(picker);
    expect((await b.get("/readiness")).status).toBeGreaterThanOrEqual(300);
  });
});
