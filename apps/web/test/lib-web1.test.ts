// The Worker's small pure parts (WEB1): language, wording of facts, the limiter, the database connection.
import { describe, expect, it } from "vitest";
import { DICTS, LANGS, negotiate, nameIn, t, unitLabel } from "../src/lib/i18n";
import { groupFacts } from "../src/lib/facts";
import { makeLimiter } from "../src/lib/rate";
import { NotConfigured, pictureUrl, postgrestSource } from "../src/lib/db";
import type { CatalogFact } from "@ak/commerce/index";

describe("languages", () => {
  it("every string exists in all three languages, with the same placeholders", () => {
    const keys = Object.keys(DICTS.en).sort();
    for (const l of LANGS) expect(Object.keys(DICTS[l]).sort(), l).toEqual(keys);
    for (const k of keys) {
      const ph = (l: "en" | "ar" | "fr") => (DICTS[l][k]!.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph("ar"), k).toBe(ph("en")); expect(ph("fr"), k).toBe(ph("en"));
    }
  });
  it("the cookie wins, then the browser's order of preference, then Arabic", () => {
    expect(negotiate("a=1; lang=fr", "ar")).toBe("fr");
    expect(negotiate("lang=xx", "en-US,en;q=0.9")).toBe("en");
    expect(negotiate(null, "de,fr;q=0.8,ar;q=0.6")).toBe("fr");
    expect(negotiate(null, "ar;q=0.2,en;q=0.9")).toBe("en");
    expect(negotiate(null, "")).toBe("ar");
    expect(negotiate(undefined, undefined)).toBe("ar");
  });
  it("names fall back to English; units are worded; placeholders are filled", () => {
    expect(nameIn("ar", "Milk", "حليب")).toBe("حليب"); expect(nameIn("ar", "Milk", null)).toBe("Milk"); expect(nameIn("fr", "Milk", "حليب")).toBe("Milk");
    expect(unitLabel("en", "each")).toBe(""); expect(unitLabel("ar", "kg")).toBe("كغ");
    expect(t("en", "items", { n: 5 })).toBe("5 items");
  });
});

const fact = (o: Partial<CatalogFact>): CatalogFact => ({ attribute: "milk", kind: "allergen", name_en: "Milk", name_ar: "حليب", verified: false, value: null, detail: null,
  status: "not_verified", source: null, reviewed_at: null, ...o });
describe("facts wording", () => {
  it("an unchecked attribute is listed as not verified and never as free", () => {
    const g = groupFacts("en", [fact({}), fact({ attribute: "gluten", name_en: "Gluten" })]);
    expect(g[0]).toMatchObject({ kind: "allergen", empty: true, lines: [], notVerified: ["Milk", "Gluten"] });
    expect(JSON.stringify(g)).not.toMatch(/free/i);
  });
  it("a verified one is stated with its status, source and date; the rest stay listed as not verified", () => {
    const g = groupFacts("en", [fact({ verified: true, value: "may_contain", status: "declared", source: "label", reviewed_at: "2026-11-10T09:00:00Z" }),
                                fact({ attribute: "eggs", name_en: "Eggs" })]);
    expect(g[0]!.lines).toEqual([{ text: "May contain: Milk", how: "declared, pack label, checked 2026-11-10" }]);
    expect(g[0]!.notVerified).toEqual(["Eggs"]);
  });
  it("Arabic wording and the Arabic ingredient text when there is one", () => {
    const g = groupFacts("ar", [fact({ attribute: "ingredients", kind: "ingredients", name_en: "Ingredients", name_ar: "المكوّنات", verified: true, status: "declared",
      source: "supplier", detail: { text: "milk", ar: "حليب" } })]);
    expect(g[0]!.lines[0]!.text).toBe("حليب");
    expect(g[0]!.lines[0]!.how).toContain("المورّد");
  });
});

describe("the limiter", () => {
  it("allows a number of hits a window per key, then lets the window pass", () => {
    let now = 0; const ok = makeLimiter(3, 1000, () => now);
    expect([ok("a"), ok("a"), ok("a"), ok("a")]).toEqual([true, true, true, false]);
    expect(ok("b")).toBe(true);
    now = 1001; expect(ok("a")).toBe(true);
  });
});

describe("the database connection", () => {
  const env = { SUPABASE_URL: "https://x.supabase.co/", SUPABASE_ANON_KEY: "anon", WEB_CHANNEL_JWT: "jwt" };
  it("is not made without all three secrets", () => { expect(() => postgrestSource({ SUPABASE_URL: "u" })).toThrow(NotConfigured); });
  it("posts named arguments with the key and the token, and maps an error to a message", async () => {
    const seen: any[] = [];
    const ok = postgrestSource(env, (async (u: any, init: any) => { seen.push([u, init]); return new Response(JSON.stringify({ a: 1 }), { status: 200 }); }) as any);
    expect(await ok.rpc("web_catalog_home", {})).toEqual({ data: { a: 1 }, error: null });
    expect(seen[0][0]).toBe("https://x.supabase.co/rest/v1/rpc/web_catalog_home");
    expect(seen[0][1].headers).toMatchObject({ apikey: "anon", authorization: "Bearer jwt" });
    const bad = postgrestSource(env, (async () => new Response(JSON.stringify({ message: "boom", code: "P0001" }), { status: 400 })) as any);
    expect(await bad.rpc("f", {})).toEqual({ data: null, error: { message: "boom", code: "P0001" } });
    const down = postgrestSource(env, (async () => { throw new Error("net"); }) as any);
    expect((await down.rpc("f", {})).error?.message).toBe("network");
  });
  it("builds picture addresses in the public catalog bucket, resized only when the plan allows", () => {
    expect(pictureUrl({ SUPABASE_URL: "https://x.supabase.co" }, "AK-1-a b.jpg", 400)).toBe("https://x.supabase.co/storage/v1/object/public/catalog/AK-1-a%20b.jpg");
    expect(pictureUrl({ SUPABASE_URL: "https://x.supabase.co", PICTURE_TRANSFORMS: "on" }, "AK-1.jpg", 400)).toContain("/render/image/public/catalog/AK-1.jpg?width=400");
  });
});
