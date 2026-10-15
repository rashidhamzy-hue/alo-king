import { describe, expect, it } from "vitest";
import { connectedCatalog, ownerBusiness, why } from "./catalog";

describe("kapso-catalog (DECISIONS §39.12)", () => {
  it("reads the connected catalogue and the owning portfolio from Meta's answers", () => {
    expect(connectedCatalog({ data: [{ id: "123456789012", name: "Alo King" }] })).toEqual({
      id: "123456789012",
      name: "Alo King",
    });
    expect(connectedCatalog({ data: [] })).toBeNull();
    expect(connectedCatalog({ data: [{ id: "x" }] })).toBeNull();
    expect(ownerBusiness({ owner_business_info: { id: "998877665544", name: "Memo Tiles" } })).toBe(
      "998877665544",
    );
    expect(ownerBusiness({})).toBeNull();
  });
  it("explains a refusal with Meta's message and codes only", () => {
    expect(
      why({
        ok: false,
        status: 400,
        body: { error: { message: "Unsupported post request", code: 100, error_subcode: 33 } },
      }),
    ).toBe("400 Unsupported post request (code 100/33)");
    expect(why({ ok: false, status: 0, body: { error: "META_CATALOG_TOKEN is not set" } })).toBe(
      "0 META_CATALOG_TOKEN is not set",
    );
  });
});
