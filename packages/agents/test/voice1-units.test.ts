// VOICE1: the place guess (by spelling, script and sound) and the Scribe client (keyterms, the request, the cost). No network.
import { describe, expect, it, vi } from "vitest";
import { guessPlace, soundKey } from "@ak/agents/place-guess";
import { cleanKeyterms, scribeCostUsd, scribeProvider } from "@ak/agents/scribe";
import { catalogueAsked } from "@ak/agents/catalog-messages";

const PLACES = [
  { source_id: "a", name: "Safa Chicken", names: ["Safa Chicken", "صفا", "صفا تشيكن", "safa"] },
  { source_id: "b", name: "Alo King test kitchen", names: ["Alo King test kitchen", "مطبخ التجربة", "test kitchen"] },
];

describe("the place guess", () => {
  it("hears the same name in both scripts", () => {
    expect(soundKey("صفا")).toBe(soundKey("safa"));
    expect(soundKey("تشيكن")).toBe(soundKey("chicken"));
    expect(soundKey("فروج")).toBe(soundKey("farrouj"));
  });
  it.each([["عنفطة Chicken Tin", "a"], ["سفا", "a"], ["صافا", "a"], ["مطبخ التجرية", "b"], ["test kichen", "b"]])("«%s» → %s", (said, id) => {
    expect(guessPlace(said, PLACES)?.source_id).toBe(id);
  });
  it.each(["بيت الشاورما", "Barbar", "مطعم الكوكب الأزرق", "restaurant"])("«%s» → nothing", (said) => {
    expect(guessPlace(said, PLACES)).toBeNull();
  });
  it("two places equally close: no guess", () => {
    expect(guessPlace("chicken", [{ source_id: "x", name: "Safa Chicken", names: [] }, { source_id: "y", name: "Kabab Chicken", names: [] }])).toBeNull();
  });
});

describe("Scribe", () => {
  it("keyterms: trimmed, forbidden characters out, at most 50 characters and 5 words, no repeats, at most 100", () => {
    const many = Array.from({ length: 150 }, (_, i) => `term ${i}`);
    expect(cleanKeyterms([" صفا ", "صفا", "a<b>", "one two three four five six", "x".repeat(51)])).toEqual(["صفا", "a b"]);
    expect(cleanKeyterms(many)).toHaveLength(100);
  });
  it("sends the file, the model and one keyterms part per term with the key header; returns the text", async () => {
    const fetch = vi.fn(async (_u: string, init: RequestInit) => new Response(JSON.stringify({ text: "بدي فروج من صفا", language_code: "ara" }), { status: 200 }));
    const p = scribeProvider({ apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await p.transcribe(new Uint8Array([1, 2]).buffer, { keyterms: ["صفا", "Safa Chicken"] })).toBe("بدي فروج من صفا");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.getAll("keyterms")).toEqual(["صفا", "Safa Chicken"]);
  });
  it("an error answer throws with the status only", async () => {
    const p = scribeProvider({ apiKey: "k", fetch: (async () => new Response("secret body", { status: 422 })) as unknown as typeof fetch });
    await expect(p.transcribe(new ArrayBuffer(2), { keyterms: [] })).rejects.toThrow(/^SCRIBE_422$/);
  });
  it("costs USD 0.25 an hour with keyterms, 0.20 without", () => {
    expect(scribeCostUsd(60, { usd_per_hour: 0.2, keyterms_usd_per_hour: 0.05 }, 10)).toBeCloseTo(0.25 / 60, 6);
    expect(scribeCostUsd(3600, {}, 0)).toBeCloseTo(0.2, 6);
  });
});

describe("the catalogue asked for", () => {
  it.each(["بدي شوف الكتالوج", "الكتالوج", "show me the catalogue", "le catalogue", "je veux voir le catalogue", "فرجيني الكاتالوج"])("«%s»", (s) => expect(catalogueAsked(s)).toBe(true));
  it.each(["الكتالوج تبع الألبان", "بدي لبنة", "catalogue des produits laitiers", "مرحبا"])("not «%s»", (s) => expect(catalogueAsked(s)).toBe(false));
});
