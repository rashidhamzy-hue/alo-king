// 3.18 Picture review: item and picture side by side with source and licence; approve or reject through review_product_image().
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

afterEach(() => vi.unstubAllGlobals());
let n = 0;
async function propose(r: Rig, product: string, kind: "open_food_facts" | "web_search", pageUrl = `https://world.openfoodfacts.org/product/${++n}`) {
  return (await r.db.rpc("propose_product_image", {
    p_product: product, p_source_kind: kind, p_source_url: `https://images.example.test/${n}.jpg`, p_page_url: pageUrl,
    p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: `product_images/test/${n}.jpg`, p_sha256: `sha-${n}`, p_width: 1200, p_height: 900, p_bytes: 120000, p_vision: { keep: true },
  })).image_id as string;
}

describe("Product pictures", () => {
  it("shows the item and its picture as a signed link with source and licence; approving makes it the customer's picture", async () => {
    const r = await rig();
    const [p1, p2] = (await r.db.all(`select id, name_en from products where is_active order by sku limit 2`));
    const ok = await propose(r, p1.id, "open_food_facts");
    const unknown = await propose(r, p2.id, "web_search", "javascript:alert(1)");
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const page = (await b.get("/pictures")).text;
    expect(page).toContain(p1.name_en);
    expect(page).toContain("https://media.test/product_images/test/");
    expect(page).toContain("CC BY-SA (Open Food Facts): attribution must be shown");
    expect(page).toContain("Open Food Facts contributors, CC BY-SA 3.0");
    expect(page).toContain("Never shown to customers");
    expect(page).not.toContain("javascript:");                           // a stored address is only linked when it is http(s)

    expect(flashOf((await b.post(`/pictures/${ok}`, { decision: "approve", note: "matches the pack" })).text)).toBe("Approved. Customers can now see it.");
    expect((await r.db.rpc("product_image_for_customer", { p_product: p1.id })).image_id).toBe(ok);
    expect((await r.db.one(`select reviewed_by from product_images where id = $1`, [ok])).reviewed_by).toBe(lead.partyId);

    expect(flashOf((await b.post(`/pictures/${unknown}`, { decision: "approve" })).text)).toBe("Approved. Kept as a guide only: customers never see a licence-unknown picture.");
    expect(await r.db.rpc("product_image_for_customer", { p_product: p2.id })).toBeNull();

    expect((await b.get("/pictures?status=approved")).text).toContain(p1.name_en);
    expect(flashOf((await b.post(`/pictures/${ok}`, { decision: "reject", note: "wrong size after all" })).text)).toBe("Rejected.");
    expect(await r.db.rpc("product_image_for_customer", { p_product: p1.id })).toBeNull();
  });

  it("is closed to pickers, by the page and by the database", async () => {
    const r = await rig();
    const p = (await r.db.one(`select id from products where is_active order by sku limit 1`)).id;
    const img = await propose(r, p, "open_food_facts");
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/pictures")).status).toBe(403);
    await expect(r.db.rpc("review_product_image", { p_image: img, p_by: picker.partyId, p_decision: "approve" })).rejects.toThrow(/NOT_AUTHORISED/);
  });

  it("lists the fastest sellers first, 20 at a time, and the next 20 follow when those are decided (PIX2)", async () => {
    const r = await rig();
    const prods = await r.db.all(`select id, name_en from products where is_active order by sku limit 25`);
    // Rank 1 is the fastest seller. Propose in the opposite order, so the sort has to do the work; the last one has no stored rank.
    const ids: string[] = [];
    for (let k = 0; k < prods.length; k++) {
      const id = await propose(r, prods[k].id, "open_food_facts");
      await r.db.all(`update product_images set vision = $2::jsonb where id = $1 returning id`, [id, JSON.stringify(k === prods.length - 1 ? {} : { rank: prods.length - k })]);
      ids.push(id);
    }
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const first = (await b.get("/pictures")).text;
    expect(first).toContain("25 proposed, fastest sellers first. Page 1 of 2");
    expect(first.match(/name="decision" value="approve"/g)?.length).toBe(20);
    expect(first.indexOf(prods[23].name_en)).toBeLessThan(first.indexOf(prods[22].name_en));   // rank 2 before rank 3
    expect(first).toMatch(/#2 \S+ <strong>/);                                // the stored rank is shown beside the name
    expect(first).not.toContain(`/pictures/${ids[24]}`);                 // the unranked one is on page 2
    const second = (await b.get("/pictures?page=2")).text;
    expect(second).toContain(`/pictures/${ids[24]}`);
    expect(second.match(/name="decision" value="approve"/g)?.length).toBe(5);
    expect((await b.get("/pictures?page=99")).text).toContain("Page 2 of 2");
    await b.post(`/pictures/${ids[23]}`, { decision: "reject" });         // rank 2 decided: it leaves the list
    expect((await b.get("/pictures")).text).toContain("24 proposed");
  });
});
