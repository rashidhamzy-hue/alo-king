// 3.10 Merchants: a menu import is applied by a person, then a merchant is approved; nothing else opens a restaurant.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());

describe("Merchants", () => {
  it("a merchant cannot be approved before a menu is applied; after it, approval opens it with the commission", async () => {
    const r = await rig();
    await r.db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500)`);
    const src = (await r.db.one(`insert into sources(kind, name) values ('merchant', 'Test Kitchen') returning id, is_open`)).id;
    const imp = (await r.db.one(`insert into merchant_menu_imports(source_id, media_path, extracted) values ($1, 'menus/test.jpg', $2) returning id`, [src,
      JSON.stringify({ items: [{ name_en: "Manakish zaatar", section: "Bakery", price: 89500, currency: "LBP", confidence: 0.95 },
                               { name_en: "Blurry line", price: 3, currency: "USD", confidence: 0.3 }] })])).id;
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/merchants")).text;
    expect(page).toContain("Test Kitchen");
    expect(page).toContain("Manakish zaatar");
    expect(page).toContain("not orderable");
    expect(page).toContain("https://media.test/menus/test.jpg");

    const early = await b.post(`/merchants/${src}/approve`, { commission_pct: 8, terms_accepted: "2026-11-01" });
    expect(flashOf(early.text)).toBe("Apply an approved menu with prices first.");
    expect((await r.db.one(`select is_open from sources where id = $1`, [src])).is_open).toBe(false);

    expect(flashOf((await b.post(`/merchants/import/${imp}`)).text)).toMatch(/^Menu applied: 1 new items, 0 prices updated/);
    expect(flashOf((await b.post(`/merchants/${src}/approve`, { commission_pct: 8, terms_accepted: "2099-01-01" })).text)).toBe("The terms date cannot be in the future.");
    page = (await b.post(`/merchants/${src}/approve`, { commission_pct: 8, terms_accepted: "2026-11-01" })).text;
    expect(flashOf(page)).toBe("Approved: 1 items orderable, commission 8%.");
    expect(await r.db.one(`select is_open, approved_by, commission_pct from sources where id = $1`, [src])).toMatchObject({ is_open: true, approved_by: lead.partyId, commission_pct: "8.00" });
  });

  it("a learned word is approved by a person", async () => {
    const r = await rig();
    const p = (await r.db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
    await r.db.pg.query(`insert into alias_candidates(alias_folded, product_id, alias, hits, customers, status) values ('lbne', $1, 'lbne', 5, $2, 'ready')`,
      [p, `{${crypto.randomUUID()},${crypto.randomUUID()}}`]);
    const lead = await r.staff("admin");
    const b = r.browser();
    await b.signIn(lead);
    expect((await b.get("/merchants")).text).toContain("lbne");
    expect(flashOf((await b.post(`/aliases/${p}`, { alias_folded: "lbne", decision: "approve" })).text)).toBe("Approved: search now knows this word.");
    expect((await r.db.one(`select status, reviewed_by from alias_candidates where alias_folded = 'lbne'`))).toEqual({ status: "promoted", reviewed_by: lead.partyId });
  });

  it("is closed to pickers", async () => {
    const r = await rig();
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/merchants")).status).toBe(403);
  });
});
