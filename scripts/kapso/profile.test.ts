import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILD_MARKER,
  MAX_WEBSITES,
  isPublicSite,
  profileBody,
  profileProblems,
  type Profile,
} from "./profile";

describe("the WhatsApp business profile (session 5e)", () => {
  const file = JSON.parse(readFileSync("whatsapp/business-profile.json", "utf8"));
  const candidates: string[] = file.website_candidates;
  // What the script sends: the public candidates, two at most (publicWebsites); here every candidate as if public.
  const p: Profile = { ...file, websites: candidates.slice(0, MAX_WEBSITES) };

  it("fits Meta's limits", () => {
    expect(profileProblems(p)).toEqual([]);
    expect(
      readFileSync(
        JSON.parse(readFileSync("whatsapp/business-profile.json", "utf8")).profile_picture,
      ).length,
    ).toBeGreaterThan(1000);
  });

  it("every website candidate is a well-formed https address Meta takes", () => {
    expect(candidates.length).toBeGreaterThan(0);
    for (const url of candidates) {
      expect(url).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/);
      expect(profileProblems({ ...p, websites: [url] })).toEqual([]);
    }
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("catches what Meta refuses", () => {
    expect(
      profileProblems({ ...p, about: "x".repeat(140), websites: ["a", "b", "c"] }),
    ).toHaveLength(5);
  });

  it("lists a website only when it is the public, rebuilt Alo King site", () => {
    const rebuilt =
      '<head><meta name="alo-king-build" content="rebuild"/><title>Alo King</title></head>';
    expect(isPublicSite(200, rebuilt)).toBe(true);
    expect(isPublicSite(200, rebuilt.replace("/>", ">"))).toBe(true);
    // The 6 October build says "Alo King" too, without the tag: left out.
    expect(isPublicSite(200, "<title>Alo King</title>")).toBe(false);
    expect(
      isPublicSite(200, '<meta name="alo-king-build" content="old"><title>Alo King</title>'),
    ).toBe(false);
    expect(isPublicSite(401, rebuilt)).toBe(false);
    expect(isPublicSite(200, `<title>Authentication Required</title> ${rebuilt}`)).toBe(false);
  });

  it("the site's root head carries the tag the script looks for", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain('{ name: "alo-king-build", content: "rebuild" }');
    expect(BUILD_MARKER.test('<meta name="alo-king-build" content="rebuild"/>')).toBe(true);
  });

  it("sends the photo handle only when there is one", () => {
    expect(profileBody(p, null)).not.toHaveProperty("profile_picture_handle");
    expect(profileBody(p, "4::abc").profile_picture_handle).toBe("4::abc");
  });
});
