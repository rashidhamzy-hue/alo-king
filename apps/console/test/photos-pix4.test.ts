// PIX4: the Photos page. A big picture, name and size, Approve / Reject / Later, a "needs review" filter, the keys, the "needs a photo" list by
// aisle; every decision through the SQL functions; nothing shows to a customer before approval.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashOf, rig, type Rig } from "./kit";
import { noteWords, order, split } from "../src/pages/photos";

afterEach(() => vi.unstubAllGlobals());
let n = 0;
async function upload(r: Rig, product: string, extra: Record<string, unknown> = {}) {
  n++;
  return (await r.db.rpc("propose_picture_import", {
    p_product: product, p_media_path: `product_images/pix4/${n}.webp`, p_sha256: `pix4-${n}`, p_width: 1000, p_height: 1000, p_bytes: 41000,
    p_source_note: `founder's upload, release pictures-1: product_images/f${n}.jpg; the report records no picture address and no page address`, ...extra })).image_id as string;
}
async function setup() {
  const r = await rig();
  const ps = await r.db.all(`select id, sku, name_en from products where is_active order by sku limit 4`);
  const clean1 = await upload(r, ps[0].id);
  const clean2 = await upload(r, ps[1].id);
  const flagged = await upload(r, ps[2].id, { p_needs_review: true, p_check_notes: ["duplicate:AK-0099 (distance 1.2)", "note:enlarged from 800x800"] });
  const lead = await r.staff("ops_lead", "Maya");
  const b = r.browser(); await b.signIn(lead);
  return { r, ps, clean1, clean2, flagged, lead, b };
}

describe("Photos", () => {
  it("opens on the first clean picture: big picture, name, size, the three buttons and the keys; the count says how many wait", async () => {
    const { b, ps, flagged } = await setup();
    const p = (await b.get("/photos")).text;
    expect(p).toContain("3 pictures to approve");
    expect(p).toContain("1 of them need review");
    expect(p).toContain("https://media.test/product_images/pix4/");
    expect(p).toContain(ps[0].name_en);
    expect(p).toContain("1000 × 1000 px · 41 KB");
    expect(p).toMatch(/Picture 1 of 3/);
    for (const k of ["a", "r-now", "l"]) expect(p).toContain(`data-key="${k}"`);
    expect(p).toContain(">Approve<"); expect(p).toContain(">Reject<"); expect(p).toContain(">Later<");
    expect(p).toContain("Nothing shows on the website or WhatsApp until you approve it");
    expect(p).not.toContain("Why it needs a second look");               // the first one is clean; the flagged one comes after
    expect(p).toContain("founder&#39;s upload, release pictures-1");
    expect(p).toContain(`/photos?f=review`);
    expect((await b.get("/photos?f=review")).text).toContain("Why it needs a second look");
    expect(flagged).toBeTruthy();
  });

  it("the needs-review filter shows the reasons in words, with the other item named; a plain note is shown as a note", async () => {
    const { b } = await setup();
    const p = (await b.get("/photos?f=review")).text;
    expect(p).toMatch(/Picture 1 of 1/);
    expect(p).toContain("Looks like the picture of another item: AK-0099 (distance 1.2)");
    expect(p).toContain("Note: enlarged from 800x800.");
    expect(p).toContain("Needs review");
  });

  it("Approve asks the database to approve, comes back to the next picture, and only then does a customer see it", async () => {
    const { b, r, ps, clean1 } = await setup();
    expect(await r.db.rpc("product_image_for_customer", { p_product: ps[0].id })).toBeNull();
    const first = (await b.get("/photos")).text;
    expect(first).toContain(`action="/photos/${clean1}"`);
    const res = await b.post(`/photos/${clean1}`, { decision: "approve", return_to: "/photos?f=all" });
    expect(flashOf(res.text)).toBe("Approved. Customers can now see it.");
    expect(res.text).toMatch(/Picture 1 of 2/); expect(res.text).toContain("2 pictures to approve");
    expect((await r.db.rpc<any>("product_image_for_customer", { p_product: ps[0].id })).image_id).toBe(clean1);
  });

  it("Reject keeps the note; the picture is withdrawn and never shown", async () => {
    const { b, r, ps, clean2 } = await setup();
    const res = await b.post(`/photos/${clean2}`, { decision: "reject", note: "two packs", return_to: "/photos?f=all" });
    expect(flashOf(res.text)).toBe("Rejected.");
    expect(await r.db.rpc("product_image_for_customer", { p_product: ps[1].id })).toBeNull();
    expect((await r.db.one(`select status, review_note from product_images where id = $1`, [clean2]))).toEqual({ status: "rejected", review_note: "two packs" });
  });

  it("Later puts it at the back and in its own list; Bring back returns it", async () => {
    const { b, r, clean1 } = await setup();
    const res = await b.post(`/photos/${clean1}`, { decision: "later", return_to: "/photos?f=all" });
    expect(flashOf(res.text)).toBe("Put aside: it comes back at the end.");
    expect(res.text).not.toContain(`action="/photos/${clean1}"`);
    const later = (await b.get("/photos?f=later")).text;
    expect(later).toContain(`action="/photos/${clean1}"`); expect(later).toContain("Bring back");
    expect(flashOf((await b.post(`/photos/${clean1}`, { decision: "unlater", return_to: "/photos?f=later" })).text)).toBe("Brought back to the queue.");
    expect((await r.db.one(`select deferred_at from product_images where id = $1`, [clean1])).deferred_at).toBeNull();
  });

  it("an answer is only taken from this page's own return addresses; anything else goes back to the page", async () => {
    const { b, clean1 } = await setup();
    for (const bad of ["https://evil.test/", "//evil.test", "/photos?f=all&x=<script>", "/pictures"]) {
      const r = await b.post(`/photos/${clean1}`, { decision: "later", return_to: bad }, { follow: false });
      expect(r.location ?? "").toMatch(/^(https:\/\/console\.test)?\/photos(\?f=all)?$/);
      await b.post(`/photos/${clean1}`, { decision: "unlater" });
    }
  });

  it("lists the items with no picture by aisle, marked 'needs a photo', with the way to the label day page", async () => {
    const { b, r } = await setup();
    const p = (await b.get("/photos?f=missing")).text;
    const total = Number((await r.db.one(`select count(*) from products where is_active`)).count);
    expect(p).toContain(`${total - 3} items have no picture`);
    expect(p).toContain("needs a photo");
    expect(p).toContain('href="/capture"');
    expect((p.match(/<h2>/g) ?? []).length).toBeGreaterThan(1);              // several aisles, each with its own heading
  });

  it("is for ops leads and admins only", async () => {
    const { r } = await setup();
    const picker = await r.staff("picker"); const b = r.browser(); await b.signIn(picker);
    expect((await b.get("/photos")).status).toBe(403);
  });

  it("works on a phone: the page carries the viewport and the actions are one full-width row of three", async () => {
    const { b } = await setup();
    const p = (await b.get("/photos")).text;
    expect(p).toContain('name="viewport"');
    expect(p).toContain("ak-photo-actions");
  });

  it("orders clean pictures before the ones needing review, and keeps Later apart (pure)", () => {
    const row = (id: string, rank: number, extra: Record<string, unknown> = {}) => ({ image_id: id, sku: id, vision: { rank }, ...extra }) as any;
    const rows = [row("c", 3, { needs_review: true }), row("a", 2), row("b", 1), row("d", 4, { deferred_at: "2026-11-18" })];
    expect(order(rows.filter((x) => !x.deferred_at)).map((x) => x.image_id)).toEqual(["b", "a", "c"]);
    const s = split(rows);
    expect(s.all.map((x) => x.image_id)).toEqual(["b", "a", "c"]); expect(s.review.map((x) => x.image_id)).toEqual(["c"]); expect(s.later.map((x) => x.image_id)).toEqual(["d"]);
    expect(noteWords("en", "heavy:89 KB at quality 58 (limit 80 KB)").text).toBe("The file is heavy (89 KB at quality 58 (limit 80 KB)).");
    expect(noteWords("ar", "background:not near-white (40% of the edge)").text).toContain("الخلفية ليست بيضاء");
  });
});
