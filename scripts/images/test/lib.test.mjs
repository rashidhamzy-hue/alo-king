import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { brandDomains, classifyHit, customerUsable, LICENCE_FOR } from "../lib/licence.mjs";
import { offFolder, offCandidates, offLookup } from "../lib/off.mjs";
import { queryFor, parseBrave, braveImages, brandCandidates, openCandidates } from "../lib/search.mjs";
import { decide, checkPicture, CHECK_TOOL } from "../lib/vision.mjs";
import { signedImageLink } from "../sign.mjs";
import { fetchRetry } from "../lib/http.mjs";
import { readFileSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../brand-sites.json", import.meta.url), "utf8"));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("licence rules (5.17 step 4)", () => {
  it("the source decides the licence; a hit with no page address (unknown) never reaches customers, a public page may (founder decision, 14 Nov)", () => {
    expect(LICENCE_FOR).toEqual({ open_food_facts: "cc_by_sa", brand_site: "brand_own", web_search: "unknown", intake_photo: "own_photo", public_page: "public_page" });
    expect(["cc_by_sa", "brand_own", "own_photo", "public_page"].every(customerUsable)).toBe(true);
    expect(customerUsable("unknown")).toBe(false);
    expect(customerUsable(undefined)).toBe(false);
  });
  it("a search hit is the brand's own only when page and picture are both on the brand's listed host", () => {
    const own = { pageUrl: "https://www.nutella.com/lb/en/products/x", imageUrl: "https://www.nutella.com/img/x.jpg" };
    expect(classifyHit(own, "Nutella", sites)).toBe("brand_site");
    expect(classifyHit({ pageUrl: own.pageUrl, imageUrl: "https://cdn.shop.example/x.jpg" }, "Nutella", sites)).toBe("public_page");
    expect(classifyHit({ pageUrl: "https://shop.example/nutella", imageUrl: "https://www.nutella.com/img/x.jpg" }, "Nutella", sites)).toBe("public_page");
    expect(classifyHit({ pageUrl: "https://nutella.com.evil.test/p", imageUrl: "https://nutella.com.evil.test/i.jpg" }, "Nutella", sites)).toBe("public_page");
    expect(classifyHit({ pageUrl: "https://notnutella.com/p", imageUrl: "https://notnutella.com/i.jpg" }, "Nutella", sites)).toBe("public_page");
    // A listed site for another brand does not count.
    expect(classifyHit(own, "Pepsi", sites)).toBe("public_page");
    // An unlisted brand's own site is just a public page: the page address is stored, so it can be withdrawn.
    expect(classifyHit({ pageUrl: "https://libanlait.com/p", imageUrl: "https://libanlait.com/i.jpg" }, "Liban Lait", sites)).toBe("public_page");
    // No https page address: licence unknown, never shown to a customer.
    expect(classifyHit({ pageUrl: null, imageUrl: "https://shop.example/x.jpg" }, "Nutella", sites)).toBe("web_search");
    expect(classifyHit({ pageUrl: "http://shop.example/p", imageUrl: "https://shop.example/x.jpg" }, "Nutella", sites)).toBe("web_search");
  });
  it("local and private-label items have no brand site", () => {
    expect(brandDomains("Local (unbranded)", { "local (unbranded)": ["x.com"] })).toEqual([]);
    expect(brandDomains("Private", { private: ["x.com"] })).toEqual([]);
    expect(brandDomains("7Up", sites)).toEqual(["7up.com"]);
  });
});

describe("Open Food Facts (step 2)", () => {
  it("builds the image folder from the barcode", () => {
    expect(offFolder("3017620422003")).toBe("301/762/042/2003");
    expect(offFolder("5287000220293")).toBe("528/700/022/0293");
    expect(offFolder("12345678")).toBe("12345678");
    expect(offFolder("0012345678905")).toBe("001/234/567/8905");
  });
  const product = {
    selected_images: { front: { display: { en: "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.400.400.jpg".replace(".400.400.", ".400.") } } },
    image_front_url: "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.4.400.jpg",
    images: { front_en: { rev: 4 }, front_fr: { rev: 7 }, 1: { sizes: { full: { w: 1000 } } }, 2: { sizes: { full: { w: 400 } } }, 3: { sizes: { full: { w: 2000 } } }, 4: { sizes: { full: { w: 900 } } }, 5: { sizes: { full: { w: 900 } } } },
  };
  it("lists front pictures at full size first, then big uploads, at most five, with the attribution", () => {
    const c = offCandidates("3017620422003", product);
    expect(c.length).toBe(5);
    expect(c[0].imageUrl).toMatch(/front_en\.4?0?0?\.?full\.jpg$|\.full\.jpg$/);
    expect(new Set(c.map((x) => x.imageUrl)).size).toBe(5);
    expect(c.every((x) => x.sourceKind === "open_food_facts" && /CC BY-SA/.test(x.attribution) && x.attribution.includes("3017620422003"))).toBe(true);
    expect(c.some((x) => /\/2\.jpg$/.test(x.imageUrl))).toBe(false);   // 400 px wide: cannot pass
  });
  it("an unknown barcode gives nothing; a short one is not asked", async () => {
    const calls = [];
    const f = async (u) => { calls.push(u); return json({ status: 0 }); };
    expect(await offLookup("5287000220293", { fetchImpl: f })).toEqual({ found: false, candidates: [] });
    expect(await offLookup("12", { fetchImpl: f })).toEqual({ found: false, candidates: [] });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("/api/v2/product/5287000220293.json");
  });
  it("sends an identifying User-Agent and no personal detail", async () => {
    let ua = "";
    await offLookup("5287000220293", { fetchImpl: async (_u, o) => { ua = o.headers["user-agent"]; return json({ status: 0 }); } });
    expect(ua).toMatch(/^AloKing-catalog-images\/1\.0/);
    expect(ua).not.toMatch(/@/);
  });
});

describe("search (step 2)", () => {
  it("queries by brand and name, and restricts a brand-site query to the site", () => {
    expect(queryFor({ brand: "Nutella", name_en: "Nutella Hazelnut Spread 350G" })).toBe("Nutella Hazelnut Spread 350G pack shot");
    expect(queryFor({ brand: "Liban Lait", name_en: "Laban 1Kg" })).toBe("Liban Lait Laban 1Kg pack shot");
    expect(queryFor({ brand: "Local (unbranded)", name_en: "Potato" })).toBe("Potato white background");
    expect(queryFor({ brand: "Nutella", name_en: "Nutella 350G" }, "nutella.com")).toBe("site:nutella.com Nutella 350G product");
  });
  it("reads Brave image results and drops non-https pictures", () => {
    const r = parseBrave({ results: [
      { url: "https://a.test/p", properties: { url: "https://a.test/i.jpg", width: 900 } },
      { url: "https://b.test/p", properties: { url: "http://b.test/i.jpg" } },
      { url: "https://c.test/p" }, {}] });
    expect(r).toEqual([{ imageUrl: "https://a.test/i.jpg", pageUrl: "https://a.test/p", hintWidth: 900 }]);
  });
  it("sends the key as a header, never in the address", async () => {
    let seen;
    await braveImages("x", "SECRET-KEY", { fetchImpl: async (u, o) => { seen = { u, h: o.headers }; return json({ results: [] }); } });
    expect(seen.h["x-subscription-token"]).toBe("SECRET-KEY");
    expect(seen.u).not.toContain("SECRET-KEY");
    expect(seen.u).toContain("api.search.brave.com/res/v1/images/search");
  });
  it("classifies every hit: a brand's own host is brand_site, any other page is public_page", async () => {
    const f = async () => json({ results: [
      { url: "https://www.nutella.com/p", properties: { url: "https://www.nutella.com/i.jpg" } },
      { url: "https://shop.test/p", properties: { url: "https://shop.test/i.jpg" } }] });
    const item = { brand: "Nutella", name_en: "Nutella 350G" };
    expect((await openCandidates(item, "k", sites, { fetchImpl: f })).map((c) => c.sourceKind)).toEqual(["brand_site", "public_page"]);
    expect((await brandCandidates(item, "k", sites, { fetchImpl: f })).map((c) => c.sourceKind)).toEqual(["brand_site", "public_page"]);
    expect(await brandCandidates({ brand: "Liban Lait", name_en: "x" }, "k", sites, { fetchImpl: f })).toEqual([]);
  });
});

describe("search hits that are not worth a paid check (PIX)", () => {
  it("drops stock-photo and picture-sharing hosts, narrow pictures and non-https addresses before anything is downloaded", () => {
    const hit = (page, img, w = 1000) => ({ url: page, properties: { url: img, width: w } });
    const out = parseBrave({ results: [
      hit("https://shop.test/p", "https://shop.test/a.jpg"),
      hit("https://www.shutterstock.com/x", "https://image.shutterstock.com/x.jpg"),
      hit("https://www.pinterest.com/pin/1", "https://i.pinimg.com/x.jpg"),
      hit("https://shop.test/q", "https://cdn.shop.test/b.jpg", 640),
      hit("https://shop.test/r", "http://cdn.shop.test/c.jpg"),
      hit("https://shop.test/s", "https://cdn.shop.test/d.jpg", undefined)] });
    expect(out.map((h) => h.imageUrl)).toEqual(["https://shop.test/a.jpg", "https://cdn.shop.test/d.jpg"]);
  });
  it("packed items are searched as a pack shot, loose ones on white", () => {
    expect(queryFor({ brand: "Nutella", name_en: "Nutella 350G" })).toBe("Nutella 350G pack shot");
    expect(queryFor({ brand: "Local (unbranded)", name_en: "Potato" })).toBe("Potato white background");
    expect(queryFor({ brand: "Nutella", name_en: "Nutella 350G" }, "nutella.com")).toBe("site:nutella.com Nutella 350G product");
  });
  it("counts each request it makes", async () => {
    let n = 0;
    await braveImages("x", "k", { fetchImpl: async () => json({ results: [] }), onRequest: () => n++ });
    expect(n).toBe(1);
  });
});

describe("vision decision (step 3)", () => {
  const good = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no" };
  it("keeps only when every condition is a clear yes and the picture is wide enough", () => {
    expect(decide(good, 800)).toEqual({ keep: true, reasons: [] });
    expect(decide(good, 799).reasons).toEqual(["narrow"]);
  });
  it("cannot_tell is a no, for brand, product and size", () => {
    for (const k of ["same_brand", "same_product", "same_size"]) expect(decide({ ...good, [k]: "cannot_tell" }, 1000).keep).toBe(false);
  });
  it("each failure names its reason", () => {
    expect(decide({ ...good, one_pack: "no" }, 1000).reasons).toEqual(["not_one_pack"]);
    expect(decide({ ...good, plain_background: "no" }, 1000).reasons).toEqual(["background"]);
    expect(decide({ ...good, watermark_or_overlay_text: "yes" }, 1000).reasons).toEqual(["watermark_or_text"]);
    expect(decide({ ...good, price_tag_or_shop_logo: "yes" }, 1000).reasons).toEqual(["price_or_logo"]);
  });
  it("a missing or odd report is a no", () => {
    expect(decide(undefined, 1000).keep).toBe(false);
    expect(decide({ ...good, watermark_or_overlay_text: undefined }, 1000).keep).toBe(false);
    expect(decide({ ...good, same_brand: "YES" }, 1000).keep).toBe(false);
  });
  it("asks the model by tool call, with the picture and the item, and reads the tool input", async () => {
    let body;
    const f = async (_u, o) => { body = JSON.parse(o.body); return json({ content: [{ type: "tool_use", name: CHECK_TOOL.name, input: good }] }); };
    const r = await checkPicture({ name_en: "Nutella 350G", brand: "Nutella", sell_unit: "each", barcode: "1" }, Buffer.from("x"), { apiKey: "k", model: "m", fetchImpl: f });
    expect(r).toEqual(good);
    expect(body.model).toBe("m");
    expect(body.tool_choice).toEqual({ type: "tool", name: CHECK_TOOL.name });
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content[1].text).toContain("Nutella 350G");
    await expect(checkPicture({}, Buffer.from("x"), { apiKey: "k", model: "m", fetchImpl: async () => json({ content: [] }) })).rejects.toThrow("vision_no_report");
  });
});

describe("signed link", () => {
  it("asks Storage for a link that lives the stated time and builds the full address", async () => {
    let seen;
    const f = async (u, o) => { seen = { u, o }; return json({ signedURL: "/object/sign/media/product_images/AK-1/a.jpg?token=t" }); };
    const link = await signedImageLink({ url: "https://p.supabase.co", key: "k", path: "product_images/AK-1/a.jpg", seconds: 300, fetchImpl: f });
    expect(seen.u).toBe("https://p.supabase.co/storage/v1/object/sign/media/product_images/AK-1/a.jpg");
    expect(JSON.parse(seen.o.body)).toEqual({ expiresIn: 300 });
    expect(link).toBe("https://p.supabase.co/storage/v1/object/sign/media/product_images/AK-1/a.jpg?token=t");
  });
  it("refuses a path that climbs out, and caps the lifetime at an hour", async () => {
    await expect(signedImageLink({ url: "u", key: "k", path: "../x" })).rejects.toThrow("bad_path");
    let body;
    await signedImageLink({ url: "u", key: "k", path: "a/b.jpg", seconds: 99999, fetchImpl: async (_u, o) => { body = JSON.parse(o.body); return json({ signedURL: "/x" }); } });
    expect(body.expiresIn).toBe(3600);
  });
});

describe("retries", () => {
  it("waits as long as the host's Retry-After says (up to 20 s), then succeeds", async () => {
    const waits = []; let n = 0;
    const f = async () => (++n < 3 ? new Response("slow down", { status: 429, headers: { "retry-after": "7" } }) : json({ ok: true }));
    const res = await fetchRetry("https://x.test/", {}, { fetchImpl: f, retries: 3, sleep: async (ms) => { waits.push(ms); } });
    expect(res.status).toBe(200);
    expect(waits).toEqual([7000, 7000]);
    const big = []; let m = 0;
    await fetchRetry("https://x.test/", {}, { fetchImpl: async () => (++m < 2 ? new Response("", { status: 429, headers: { "retry-after": "600" } }) : json({})), retries: 2, sleep: async (ms) => big.push(ms) });
    expect(big).toEqual([20000]);
  });
  it("gives up with the status after the last try", async () => {
    await expect(fetchRetry("https://x.test/", {}, { fetchImpl: async () => new Response("", { status: 503 }), retries: 1, sleep: async () => {} })).rejects.toThrow("HTTP 503");
  });
});
