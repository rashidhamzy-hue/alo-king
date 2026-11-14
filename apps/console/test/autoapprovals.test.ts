// Automatic approvals page (session I1): driven through the console's real request handler against PGlite with every migration.
// A rule starts off; its first sample, all right, switches it on; a wrong answer switches it off and undoes the approval;
// allergens, diet labels, prices and costs have no rule anywhere on the page or in the database.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); }, 120_000);

const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no" };

async function offPicture(sku: string, barcode: string) {
  const p = (await r.db.one(`update products set barcode = $2 where sku = $1 returning id`, [sku, barcode])).id as string;
  const path = barcode.replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, "$1/$2/$3/$4");
  return (await r.db.one(`insert into product_images(product_id, source_kind, licence, source_url, attribution, media_path, sha256, width_px, height_px, bytes, vision)
    values ($1, 'open_food_facts', 'cc_by_sa', $2, 'Open Food Facts, CC BY-SA', $3, $4, 1000, 1000, 5000, $5) returning id`,
    [p, `https://images.openfoodfacts.org/images/products/${path}/1.jpg`, `product_images/${sku}/a.jpg`, `sha-${sku}`, { report: GOOD, original_width: 1200 }])).id as string;
}

describe("Automatic approvals page", () => {
  it("shows the four rules off, the fields that are never automatic, and turns a rule on only through a passing spot check", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    let page = (await b.get("/auto-approvals")).text;
    expect(page).toContain("<strong>Never automatic:</strong> allergens, diet labels, price, cost.");
    for (const l of ["Pictures", "Names and size", "Search words", "Ingredients and nutrition"]) expect(page).toContain(`<strong>${l}</strong>`);
    expect(page.match(/waiting for its first passing spot check/g)).toHaveLength(4);

    // Switching on before a passing sample is refused by the database.
    page = (await b.post("/auto-approvals/rule/picture", { enabled: "on" })).text;
    expect(flashOf(page)).toMatch(/PASSING_SPOT_CHECK_NEEDED/);
    expect(flashOf((await b.post("/auto-approvals/rule/allergens", { enabled: "on" })).text)).toBe("No such rule. Allergens, diet labels, prices and costs are never automatic.");

    // The rule logs what it would approve; yesterday's log is sampled; a lead checks it.
    const img = await offPicture("AK-0042", "3017620422003");
    expect(await r.db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: img })).toMatchObject({ shadow: true });
    await r.db.pg.query(`update auto_approvals set created_at = now() - interval '1 day'`);
    await r.db.rpc("auto_approval_daily_sample", {});
    page = (await b.get("/auto-approvals")).text;
    expect(page).toContain("Spot checks waiting (1)");
    expect(page).toContain("the rule was off: it would have approved this");
    const check = (await r.db.one(`select id from auto_approval_spot_checks`)).id;
    expect(flashOf((await b.post(`/auto-approvals/check/${check}`, { verdict: "wrong" })).text)).toBe("Say what is wrong.");
    expect(flashOf((await b.post(`/auto-approvals/check/${check}`, { verdict: "correct" })).text)).toBe("Marked right: that was the Pictures rule's first passing sample, so it is now on.");
    expect((await r.db.one(`select enabled from auto_approval_rules where field = 'picture'`)).enabled).toBe(true);
    expect(flashOf((await b.post(`/auto-approvals/check/${check}`, { verdict: "correct" })).text)).toBe("Already checked (correct).");

    // On: the rule approves; a wrong spot check switches it off and withdraws the picture.
    expect(await r.db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: img })).toMatchObject({ approved: true });
    await r.db.pg.query(`update auto_approvals set created_at = now() - interval '2 days' where applied`);
    await r.db.rpc("auto_approval_daily_sample", {});
    const c2 = (await r.db.one(`select id from auto_approval_spot_checks where status = 'waiting'`)).id;
    page = (await b.post(`/auto-approvals/check/${c2}`, { verdict: "wrong", note: "the jar is 750 g" })).text;
    expect(flashOf(page)).toBe("Marked wrong: the Pictures rule is off, and picture withdrawn.");
    expect((await r.db.one(`select status from product_images where id = $1`, [img])).status).toBe("rejected");
    expect(page).toContain("spot check of");
    expect((await r.actions()).some((a) => a.action === "spot_check_wrong" && a.phase === "done" && a.ok && a.party_id === lead.partyId)).toBe(true);
  });

  it("records the Arabic reader's sample, lists jobs that failed three times and puts one back; pickers cannot open it", async () => {
    const lead = await r.staff("admin", "Rasheed");
    const b = r.browser();
    await b.signIn(lead);
    await b.get("/auto-approvals");
    expect(flashOf((await b.post("/auto-approvals/arabic", { checked: 50, errors: 0 })).text)).toBe("Recorded: passed. The names rule may approve model-written Arabic.");
    const job = (await r.db.one(`update product_intake_jobs set status = 'listed', attempts = 3, last_error = 'research: refused'
      where id = (select id from product_intake_jobs where step = 'identity' order by created_at limit 1) returning id`)).id;
    let page = (await b.get("/auto-approvals")).text;
    expect(page).toContain("Intake: failed three times (1)");
    expect(page).toContain("research: refused");
    page = (await b.post(`/auto-approvals/retry/${job}`)).text;
    expect(flashOf(page)).toBe("Back in the queue: the identity step runs again on the next intake run.");
    expect((await r.db.one(`select status, attempts from product_intake_jobs where id = $1`, [job]))).toEqual({ status: "ready", attempts: 0 });

    const picker = await r.staff("picker", "Ali");
    const p = r.browser();
    await p.signIn(picker);
    expect((await p.get("/auto-approvals")).status).toBe(403);
  });
});
