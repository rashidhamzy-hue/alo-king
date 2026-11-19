// DOC2: the console's Screens page. Any staff role may look; it lists the screenshots in the private `screens` bucket by session, each page beside
// the design reference's matching screen, through short-lived signed links; it writes nothing; a bucket that is missing or down is said plainly.
import { beforeAll, describe, expect, it } from "vitest";
import { rig, type Rig } from "./kit";
import { chooseShot } from "../src/pages/screens";
import { parseShot } from "@ak/core/screens.mjs";

const PATHS = [
  "ds2/ref-ops-dispatch-390.webp", "ds2/ref-ops-dispatch-1280.webp", "ds2/ref-web-aisle-390.webp", "ds2/ref-ops-riders-390.webp",
  "ds1/console-inbox-390.webp",
  "web2/web2-aisle-390-en.webp", "web2/web2-aisle-390-ar.webp", "web2/web2-aisle-1280-en.webp", "web2/web2-cart-390-en.webp",
  "wh1a/wh1a-bins-390-en.png", "wh1a/wh1a-bins-390-ar.png", "wh1a/wh1a-print-en-390.png",
  "ux3/ux3-riders-roster-390-en.png", "ux3/ux3-riders-roster-1280-en.png",
];
let r: Rig;
beforeAll(async () => { r = await rig(); }, 120_000);
const withScreens = (list: () => Promise<string[]>) => {
  const signed: string[][] = [];
  r.deps.screens = { list, sign: async (paths) => { signed.push(paths); return paths.map((p) => ({ path: p, url: `https://project.supabase.test/storage/v1/object/sign/screens/${p}?token=t` })); } };
  return signed;
};

describe("Screens", () => {
  it("opens for every staff role", async () => {
    withScreens(async () => PATHS);
    for (const role of ["admin", "ops_lead", "picker"] as const) {
      const b = r.browser(); await b.signIn(await r.staff(role));
      expect((await b.get("/screens")).status, role).toBe(200);
    }
  });

  it("lists the sessions newest first with their page counts and opens on the newest", async () => {
    withScreens(async () => PATHS);
    const b = r.browser(); await b.signIn(await r.staff("ops_lead")); const res = await b.get("/screens");
    const order = [...res.text.matchAll(/href="\/screens\?session=([a-z0-9]+)&/g)].map((m) => m[1]);
    expect([...new Set(order)]).toEqual(["wh1a", "web2", "ux3", "ds1"]);
    expect(res.text).toContain("<h2>wh1a-bins</h2>");           // the newest session's page
    expect(res.text).not.toContain("<h2>web2-cart</h2>");        // another session's, until chosen
  });

  it("shows a page beside the reference's matching screen at the chosen width and language, signed, and opens in a new tab", async () => {
    const signed = withScreens(async () => PATHS);
    const b = r.browser(); await b.signIn(await r.staff("admin"));
    const res = await b.get("/screens?session=web2&w=390&lang=ar");
    expect(res.text).toContain("web2-aisle-390-ar.webp");        // the language asked for
    expect(res.text).toContain("ref-web-aisle-390.webp");        // the reference beside it, same width
    expect(res.text).toMatch(/Reference|المرجع/);
    expect(res.text).toContain("ref-web-aisle");                 // named
    expect(res.text).toContain('target="_blank" rel="noopener"');
    expect(res.text).toContain("<h2>web2-cart</h2>");            // a page with no reference says so
    expect(res.text).toMatch(/has no matching screen|ليس للمرجع شاشة مطابقة/);
    expect(signed.length).toBe(1);                               // one signing call, never one per image
    const wide = await b.get("/screens?session=web2&w=wide&lang=en");
    expect(wide.text).toContain("web2-aisle-1280-en.webp");
    expect(wide.text).toMatch(/No screenshot at this width|لا توجد صورة بهذا العرض/);   // the cart has none at 1280
  });

  it("pairs a dispatch or riders screen with its reference by the page's name", async () => {
    withScreens(async () => PATHS);
    const b = r.browser(); await b.signIn(await r.staff("admin"));
    expect((await b.get("/screens?session=ux3&w=390&lang=en")).text).toContain("ref-ops-riders-390.webp");
    expect((await b.get("/screens?session=ux3&w=wide&lang=en")).text).not.toContain("ref-ops-riders-390.webp");   // 390's reference is not shown at 1280
  });

  it("is read only: no form, no button, no write", async () => {
    withScreens(async () => PATHS);
    const b = r.browser(); await b.signIn(await r.staff("admin")); const res = await b.get("/screens?session=wh1a");
    const body = res.text.slice(res.text.indexOf("<main"), res.text.indexOf("</main>"));
    expect(body).not.toMatch(/<form|<button|method="post"/i);
    expect((await b.post("/screens", {}, { follow: false })).status).toBeGreaterThanOrEqual(400);
  });

  it("says plainly when there is no bucket, nothing in it, or it does not answer", async () => {
    const b = r.browser(); await b.signIn(await r.staff("ops_lead"));
    delete r.deps.screens;
    expect((await b.get("/screens")).text).toMatch(/not connected here/);
    withScreens(async () => []);
    expect((await b.get("/screens")).text).toMatch(/No screenshots yet/);
    withScreens(async () => { throw new Error("storage_503"); });
    const down = await b.get("/screens");
    expect(down.status).toBe(200);
    expect(down.text).toMatch(/cannot be read/);
    expect(down.text).not.toContain("storage_503");
  });

  it("is in the menu (Settings, Advanced, on More), in Arabic as «الشاشات», and has no inline style or script; a picker opens it by its address", async () => {
    withScreens(async () => PATHS);
    const p = r.browser(); await p.signIn(await r.staff("picker"));
    expect((await p.get("/screens")).status).toBe(200);                                 // CON1: a picker sees Pick and Stock only; the page stays open to them
    expect((await p.get("/more")).text).not.toContain('href="/screens"');
    const b = r.browser(); await b.signIn(await r.staff("ops_lead"));
    const res = await b.get("/more");
    expect(res.text).toContain('href="/screens"');
    expect(res.text).not.toMatch(/\sstyle="/);
    b.cookies.set("ak_lang", "ar");
    const ar = await b.get("/more");
    expect(ar.text).toContain("الشاشات");
    expect((await b.get("/screens")).text).toContain("المنفّذ");   // the page's own words follow the language too
  });
});

describe("which screenshot of a page", () => {
  const shots = ["p/x-390-ar-dark.png", "p/x-390-ar-light.png", "p/x-390-en.png", "p/x-1280-en.png", "p/x-1440-ar.png"].map((p) => parseShot(p)!);
  it("takes the language asked for, light before dark, within the width class", () => {
    expect(chooseShot(shots, "390", "ar")?.file).toBe("x-390-ar-light.png");
    expect(chooseShot(shots, "390", "en")?.file).toBe("x-390-en.png");
    expect(chooseShot(shots, "wide", "ar")?.file).toBe("x-1440-ar.png");
    expect(chooseShot(shots, "wide", "en")?.file).toBe("x-1280-en.png");
  });
  it("falls back to the other language when a page was shot in one only, and to nothing when no width fits", () => {
    expect(chooseShot([parseShot("p/y-390-en.png")!], "390", "ar")?.file).toBe("y-390-en.png");
    expect(chooseShot([parseShot("p/y-390-en.png")!], "wide", "en")).toBeNull();
  });
});
