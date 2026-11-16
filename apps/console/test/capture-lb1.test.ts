// LB1: the label day's capture page, for a phone: scan the barcode (or type it, or pick the item from a list), then front, back and one
// optional side photo into the private media bucket, then the next item not yet captured; a counter of items done and left by aisle.
// Server side, on the real migrations through the console's own routes (the page's script, and the retry of a photo that fails to
// upload, are held by test/screens/capture-lb1.test.ts in a real browser).
import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/app";
import { registry } from "../src/pages";
import { CAPTURE_JS } from "../src/capture-js";
import { flashOf, rig, type Rig } from "./kit";

let r: Rig;
beforeAll(async () => { r = await rig(); }, 120_000);

const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 2, 3, 4, 5, 6, 7, 8]);
const who = async (role: "admin" | "ops_lead" | "picker", name: string) => { const w = await r.staff(role, name); const b = r.browser(); await b.signIn(w); return { ...w, b }; };
type Who = Awaited<ReturnType<typeof who>>;
const cookie = (b: Who["b"]) => [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; ");

/** A photo as the page's script (or a plain form) posts it. */
async function send(w: Who, fields: Record<string, string>, file: { name?: string; type?: string; bytes?: Uint8Array<ArrayBuffer> } | null, opts: { json?: boolean } = {}) {
  const fd = new FormData();
  fd.set("_csrf", w.b.csrf); fd.set("_key", crypto.randomUUID());
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("photo", new File([file.bytes ?? JPEG(1)], file.name ?? "p.jpg", { type: file.type ?? "image/jpeg" }));
  const res = await handle(new Request("https://console.test/capture/photo", { method: "POST", body: fd,
    headers: { cookie: cookie(w.b), referer: "https://console.test/capture", accept: opts.json === false ? "text/html" : "application/json" } }), r.deps, registry);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
const firstItem = async (w: Who) => {
  const html = (await w.b.get("/capture")).text;
  const id = /data-product="([0-9a-f-]{36})"/.exec(html)?.[1]!;
  return { html, id };
};
const rows = (product: string) => r.db.all(`select shot, media_path, superseded_at is not null as old from label_captures where product_id = $1 order by captured_at, shot`, [product]);

describe("who may use the capture page", () => {
  it("a picker, an ops lead and an admin; nobody signed out", async () => {
    for (const role of ["picker", "ops_lead", "admin"] as const) {
      const w = await who(role, `Cap ${role}`);
      const p = await w.b.get("/capture");
      expect(p.status, role).toBe(200);
      expect(p.text).toContain("data-capture");
    }
    const out = await r.browser().get("/capture");
    expect(out.status).toBe(303);
    expect(out.location).toBe("/sign-in");
    const post = await handle(new Request("https://console.test/capture/photo", { method: "POST", body: new FormData(), headers: { accept: "application/json" } }), r.deps, registry);
    expect(post.status).toBe(401);
  });
  it("a rider's or a customer's login is not a staff login at all", async () => {
    const rider = await r.staff("driver", "Rider cap");
    const b = r.browser();
    await b.signIn(rider);
    expect((await b.get("/capture")).status).toBe(303);
  });
});

describe("the page, on a phone", () => {
  it("shows the counter, the first item with three photo slots, the ways to find another item, and runs no inline script", async () => {
    const w = await who("picker", "Pia cap");
    const { html, id } = await firstItem(w);
    expect(html).toMatch(/<h1>Label day: photograph the packs<\/h1>/);
    expect(html).toMatch(/data-count-done>0</); expect(html).toMatch(/data-count-left>291</);
    expect(html).toMatch(/<progress[^>]*value="0"[^>]*max="291"/);
    expect(html).toContain("By aisle");
    expect(html).toMatch(/data-slot="front"[\s\S]*data-slot="back"[\s\S]*data-slot="side"/);
    for (const shot of ["front", "back", "side"]) expect(html).toMatch(new RegExp(`<input[^>]*type="file"[^>]*accept="image/\\*"[^>]*capture="environment"[^>]*data-shot="${shot}"`));
    expect(html).toContain('action="/capture/photo"');                               // without script the form still works
    expect(html).toMatch(/name="product" value="[0-9a-f-]{36}"/);
    expect(html).toMatch(/Optional: the side with the nutrition panel or the directions/);
    expect(html).toContain('href="/capture/list"');
    expect(html).toMatch(/<form[^>]*method="get"[^>]*action="\/capture"/);            // typed barcode
    expect(html).toContain("data-scan");                                              // the camera button (the script hides it where there is no camera scanner)
    expect(html).toContain('<script src="/capture.js" defer></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)|<style|\sstyle="/);
    expect(id).toBeTruthy();
  });

  it("in Arabic: right to left, the words in Arabic, the item's Arabic name where it has one", async () => {
    const w = await who("picker", "Pia cap ar");
    w.b.cookies.set("ak_lang", "ar");
    const html = (await w.b.get("/capture")).text;
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(html).toContain("يوم الملصقات");
    expect(html).toContain("تم"); expect(html).toContain("بقي"); expect(html).toMatch(/data-count-done>\d+</);
    expect(html).toContain("الواجهة"); expect(html).toContain("الخلف");
    expect(html).toContain("اختر من القائمة");
  });

  it("is in the Stock group of the menu, for every staff role", async () => {
    const w = await who("picker", "Pia cap nav");
    expect((await w.b.get("/stock")).text).toContain('href="/capture"');
    const lead = await who("ops_lead", "Maya cap nav");
    expect((await lead.b.get("/stock")).text).toContain('href="/capture"');
  });
});

describe("saving a photo", () => {
  it("stores it in the private bucket under the item's own folder, writes the capture log, and says when the item is done", async () => {
    const w = await who("picker", "Pia photo");
    const { id } = await firstItem(w);
    const front = await send(w, { product: id, shot: "front" }, { bytes: JPEG(10) });
    expect(front.status).toBe(200);
    expect(front.json).toMatchObject({ ok: true, shot: "front", done: false, product_id: id });
    expect(front.json.progress).toEqual(expect.objectContaining({ total: 291 }));
    const back = await send(w, { product: id, shot: "back" }, { bytes: JPEG(11) });
    expect(back.json).toMatchObject({ ok: true, shot: "back", done: true });
    expect(back.json.next_url).toMatch(new RegExp(`^/capture/next\\?after=${id}$`));
    const got = await rows(id);
    expect(got.map((x) => x.shot)).toEqual(["front", "back"]);
    for (const g of got) {
      expect(g.media_path).toMatch(new RegExp(`^labels/${id}/\\d{4}-\\d\\d-\\d\\d/[0-9a-f]{64}\\.jpg$`));
      expect(r.media.objects.has(g.media_path)).toBe(true);
    }
    const log = (await r.actions()).filter((a) => a.action === "label_capture");
    expect(log.length).toBeGreaterThanOrEqual(4);                                  // intent and done, twice
    expect(log.find((a) => a.phase === "done")).toMatchObject({ party_id: w.partyId });
  });

  it("the same photo sent again (a retry after a failed upload) is one stored photo and one record, and says so", async () => {
    const w = await who("picker", "Pia retry");
    const { id } = await firstItem(w);
    const a = await send(w, { product: id, shot: "front" }, { bytes: JPEG(21) });
    const b = await send(w, { product: id, shot: "front" }, { bytes: JPEG(21) });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ ok: true, already: true });
    expect((await rows(id)).filter((x) => x.shot === "front").length).toBe(1);
    // a retake is a different photo: it replaces the shot and the old one stays as history
    await send(w, { product: id, shot: "front" }, { bytes: JPEG(22) });
    expect((await rows(id)).filter((x) => x.shot === "front").map((x) => x.old)).toEqual([true, false]);
  });

  it("without script a plain form works: it comes back to the same item until front and back are in, then on to the next", async () => {
    const w = await who("picker", "Pia plain");
    const { id } = await firstItem(w);
    const one = await send(w, { product: id, shot: "front" }, { bytes: JPEG(31) }, { json: false });
    expect(one.status).toBe(303);
    expect(one.location).toBe(`/capture?item=${id}`);
    const two = await send(w, { product: id, shot: "back" }, { bytes: JPEG(32) }, { json: false });
    expect(two.status).toBe(303);
    expect(two.location).toBe(`/capture/next?after=${id}`);
    const next = await w.b.get(two.location!);
    expect(next.status).toBe(303);
    expect(next.location).toMatch(/^\/capture\?item=[0-9a-f-]{36}$/);
    expect(next.location).not.toContain(id);
  });

  it("a refusal that retrying cannot fix says so (422): not a photo, no photo, a shot that does not exist, an item that does not exist", async () => {
    const w = await who("picker", "Pia refused");
    const { id } = await firstItem(w);
    expect((await send(w, { product: id, shot: "front" }, { type: "application/pdf", name: "x.pdf" })).status).toBe(422);
    expect((await send(w, { product: id, shot: "front" }, null)).status).toBe(422);
    expect((await send(w, { product: id, shot: "top" }, { bytes: JPEG(41) })).status).toBe(422);
    expect((await send(w, { product: "00000000-0000-4000-8000-00000000abcd", shot: "front" }, { bytes: JPEG(42) })).status).toBe(422);
    expect((await send(w, { product: "not-an-id", shot: "front" }, { bytes: JPEG(43) })).status).toBe(422);
    const big = await send(w, { product: id, shot: "front" }, { bytes: new Uint8Array(9 * 1024 * 1024) });
    expect(big.status).toBe(422);
    expect(big.json).toMatchObject({ ok: false, retry: false });
    expect(await r.db.one(`select count(*)::int as n from label_captures where product_id = $1`, [id])).toEqual({ n: 0 });
  });

  it("a storage failure or a log that cannot be written says to try again (5xx, retry), and keeps nothing half done", async () => {
    const w = await who("picker", "Pia down");
    const { id } = await firstItem(w);
    const put = r.media.put.bind(r.media), sign = r.media.sign.bind(r.media);
    r.media.put = async () => { throw new Error("storage_503"); };
    r.media.sign = async () => null as unknown as string;                                               // the real bucket cannot sign what it does not hold
    const down = await send(w, { product: id, shot: "front" }, { bytes: JPEG(51) });
    r.media.put = put; r.media.sign = sign;
    expect(down.status).toBe(502);
    expect(down.json).toMatchObject({ ok: false, retry: true });
    expect(await r.db.one(`select count(*)::int as n from label_captures where product_id = $1`, [id])).toEqual({ n: 0 });
    r.media.failPut = true;                                                        // the action log refuses: nothing runs
    const nolog = await send(w, { product: id, shot: "front" }, { bytes: JPEG(52) });
    r.media.failPut = false;
    expect(nolog.status).toBe(503);
    expect(nolog.json).toMatchObject({ ok: false, retry: true });
    // and the same photo goes through once things are back
    expect((await send(w, { product: id, shot: "front" }, { bytes: JPEG(52) })).json).toMatchObject({ ok: true });
  });
});

describe("finding an item, the next item, and the counter", () => {
  it("a typed or scanned barcode finds the item, in any written form; an unknown one says so and keeps the page", async () => {
    const w = await who("picker", "Pia find");
    const it0 = await r.db.one(`select id, sku, barcode, name_en from products where is_active and intake_barcode_key(barcode) is not null order by sku offset 30 limit 1`);
    const byCode = (await w.b.get(`/capture?code=${encodeURIComponent(it0.barcode)}`)).text;
    expect(byCode).toContain(`data-product="${it0.id}"`);
    expect((await w.b.get(`/capture?code=0${it0.barcode}`)).text).toContain(`data-product="${it0.id}"`);
    expect((await w.b.get(`/capture?code=${it0.sku}`)).text).toContain(`data-product="${it0.id}"`);
    const none = (await w.b.get("/capture?code=99999999999999")).text;
    expect(none).toMatch(/No item has this barcode/);
    expect(none).toMatch(/data-product="[0-9a-f-]{36}"/);                           // the next item is still there to photograph
    expect((await w.b.get(`/capture?item=${it0.id}`)).text).toContain(it0.name_en.replace(/&/g, "&amp;"));
    expect((await w.b.get("/capture?item=not-an-id")).text).toContain("data-capture");
  });

  it("the list: items that cannot be scanned (no barcode, or only the store's own code), the others behind a link, a search, done ones marked", async () => {
    const w = await who("picker", "Pia list");
    const list = (await w.b.get("/capture/list")).text;
    const open = ((await r.db.rpc("label_capture_items", { p_only_missing: true, p_no_barcode: true })) as unknown[]).length;
    expect(open).toBeGreaterThan(0); expect(open).toBeLessThanOrEqual(63);
    expect(list).toContain(`${open} items to pick from the list`);
    expect((list.match(/<a href="\/capture\?item=/g) ?? []).length).toBeGreaterThan(0);
    expect(list).toContain('href="/capture/list?all=1"');
    const all = (await w.b.get("/capture/list?all=1")).text;
    expect((all.match(/<a href="\/capture\?item=/g) ?? []).length).toBe(291);
    const sku = (await r.db.one(`select sku, name_en from products where is_active order by sku offset 7 limit 1`));
    const q = (await w.b.get(`/capture/list?all=1&q=${encodeURIComponent(sku.sku)}`)).text;
    expect((q.match(/<a href="\/capture\?item=/g) ?? []).length).toBe(1);
    // an item done shows as done and leaves the short list
    const id = (await r.db.one(`select id from products where sku = $1`, [sku.sku])).id;
    await send(w, { product: id, shot: "front" }, { bytes: JPEG(61) }); await send(w, { product: id, shot: "back" }, { bytes: JPEG(62) });
    expect((await w.b.get(`/capture/list?all=1&q=${encodeURIComponent(sku.sku)}`)).text).toMatch(/data-state="done"/);
  });

  it("counts done and left, by aisle, and the numbers add up", async () => {
    const w = await who("picker", "Pia count");
    const before = (await r.db.rpc("label_capture_progress")) as { done: number; left: number; by_aisle: { aisle: string; done: number; total: number }[] };
    const html = (await w.b.get("/capture")).text;
    expect(html).toContain(`data-count-done>${before.done}<`); expect(html).toContain(`data-count-left>${before.left}<`);
    for (const a of before.by_aisle.slice(0, 3)) expect(html).toContain(a.aisle.replace(/&/g, "&amp;"));
    const m = [...html.matchAll(/data-aisle-done="(\d+)" data-aisle-total="(\d+)"/g)];
    expect(m.reduce((a, x) => a + Number(x[2]), 0)).toBe(291);
    expect(m.reduce((a, x) => a + Number(x[1]), 0)).toBe(before.done);
  });

  it("when every item has its front and back, the page says so and offers the list to redo one", async () => {
    const w = await who("ops_lead", "Maya all");
    for (const x of await r.db.all(`select id from products where is_active and owner_source_id is null`)) {
      await r.db.rpc("record_label_capture", { p_product: x.id, p_shot: "front", p_media_path: `labels/${x.id}/all/f.jpg`, p_by: w.partyId });
      await r.db.rpc("record_label_capture", { p_product: x.id, p_shot: "back", p_media_path: `labels/${x.id}/all/b.jpg`, p_by: w.partyId });
    }
    const html = (await w.b.get("/capture")).text;
    expect(html).toMatch(/Every item has its front and back photographed/);
    expect(html).not.toMatch(/data-slot="front"/);
    expect((await w.b.get(`/capture/next?after=${(await r.db.one(`select id from products limit 1`)).id}`)).location).toBe("/capture?done=1");
    await r.db.pg.query(`delete from label_captures`);
  });
});

describe("the page's script", () => {
  it("is served from this site's own address, to anyone (nothing in it is a person's data), and is not cached by the phone's shell", async () => {
    const res = await handle(new Request("https://console.test/capture.js"), r.deps, registry);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(await res.text()).toBe(CAPTURE_JS);
    const { SHELL_ASSETS } = await import("../src/pwa");
    expect(SHELL_ASSETS as readonly string[]).not.toContain("/capture.js");
  });
  it("keeps every photo in the phone until the server has it, and retries; it never throws a photo away", () => {
    expect(CAPTURE_JS).toMatch(/indexedDB\.open\(/);
    expect(CAPTURE_JS).toMatch(/online/);                                          // retries when the network is back
    expect(CAPTURE_JS).toMatch(/setTimeout\(/);                                    // and on a timer
    expect(CAPTURE_JS).toMatch(/BarcodeDetector/);
    expect(CAPTURE_JS).not.toMatch(/eval\(|new Function|innerHTML\s*=/);          // CSP: no script from strings, no markup from text
    expect(CAPTURE_JS).not.toMatch(/https?:\/\//);                                // no other host is asked for anything
  });
});
