import { describe, expect, it } from "vitest";
import { askToJoinUrl } from "./join";

describe('"Ask them to join" link (DECISIONS §39.3)', () => {
  it("points at the counting edge function, web channel, in the page language", () => {
    expect(askToJoinUrl("kaak-abou-salim", "ar", "https://x.supabase.co/")).toBe(
      "https://x.supabase.co/functions/v1/site-claim?action=join&slug=kaak-abou-salim&lang=ar&ch=web",
    );
  });
  it("carries no visitor key and no phone: the function derives the key itself", () => {
    const u = new URL(askToJoinUrl("a-b", "fr", "https://x.supabase.co"));
    expect([...u.searchParams.keys()].sort()).toEqual(["action", "ch", "lang", "slug"]);
  });
});
