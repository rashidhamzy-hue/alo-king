import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicSite, profileBody, profileProblems, type Profile } from "./profile";

describe("the WhatsApp business profile (session 5e)", () => {
  const file = JSON.parse(readFileSync("whatsapp/business-profile.json", "utf8"));
  const p: Profile = { ...file, websites: file.website_candidates };

  it("fits Meta's limits", () => {
    expect(profileProblems(p)).toEqual([]);
    expect(
      readFileSync(
        JSON.parse(readFileSync("whatsapp/business-profile.json", "utf8")).profile_picture,
      ).length,
    ).toBeGreaterThan(1000);
  });

  it("catches what Meta refuses", () => {
    expect(
      profileProblems({ ...p, about: "x".repeat(140), websites: ["a", "b", "c"] }),
    ).toHaveLength(5);
  });

  it("lists a website only when it is the public Alo King site", () => {
    expect(isPublicSite(200, "<title>Alo King</title>")).toBe(true);
    expect(isPublicSite(401, "<title>Alo King</title>")).toBe(false);
    expect(isPublicSite(200, "<title>Authentication Required</title> Alo King")).toBe(false);
  });

  it("sends the photo handle only when there is one", () => {
    expect(profileBody(p, null)).not.toHaveProperty("profile_picture_handle");
    expect(profileBody(p, "4::abc").profile_picture_handle).toBe("4::abc");
  });
});
