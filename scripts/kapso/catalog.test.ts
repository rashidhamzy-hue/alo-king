import { describe, expect, it } from "vitest";
import { connectedCatalog, ownedCatalog, ownerBusiness, readCatalog, why } from "./catalog";

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
    // An "Alo King" catalogue made by an earlier run is reused, never created twice.
    expect(
      ownedCatalog(
        {
          data: [
            { id: "111111111111", name: "Tiles" },
            { id: "222222222222", name: "Alo King" },
          ],
        },
        "Alo King",
      ),
    ).toBe("222222222222");
    expect(ownedCatalog({ data: [] }, "Alo King")).toBeNull();
  });
  it("accepts the owner's catalogue read directly, only when Meta answers with that id (#181)", () => {
    expect(readCatalog({ id: "1684040949979106", name: "Alo King" }, "1684040949979106")).toEqual({
      id: "1684040949979106",
      name: "Alo King",
    });
    expect(readCatalog({ id: "999" }, "1684040949979106")).toBeNull();
    expect(readCatalog({ error: { code: 100 } }, "1684040949979106")).toBeNull();
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
