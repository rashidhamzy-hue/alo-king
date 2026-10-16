import { describe, expect, it } from "vitest";
import {
  commerceState,
  connectedCatalog,
  ownedCatalog,
  ownerBusiness,
  permissionRefused,
  readCatalog,
  why,
} from "./catalog";

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
  it("accepts the owner's catalogue read directly only for that id in that portfolio (#181)", () => {
    const biz = { id: "131819648080461", name: "Memo Tiles" };
    expect(
      readCatalog(
        { id: "1684040949979106", name: "Alo King", business: biz },
        "1684040949979106",
        biz.id,
      ),
    ).toEqual({ id: "1684040949979106", name: "Alo King" });
    expect(
      readCatalog({ id: "1684040949979106", business: { id: "555" } }, "1684040949979106", biz.id),
    ).toBeNull();
    expect(readCatalog({ id: "1684040949979106" }, "1684040949979106", biz.id)).toBeNull();
    expect(readCatalog({ id: "999", business: biz }, "1684040949979106", biz.id)).toBeNull();
  });
  it("takes that path only when Meta refused for permission, never on an outage", () => {
    const refused = (status: number, error: any) => ({ ok: false, status, body: { error } });
    expect(permissionRefused(refused(403, { code: 200, message: "(#200) no permission" }))).toBe(
      true,
    );
    expect(permissionRefused(refused(400, { code: 100, error_subcode: 33 }))).toBe(true);
    expect(
      permissionRefused(refused(500, { code: 2, message: "Service temporarily unavailable" })),
    ).toBe(false);
    expect(permissionRefused({ ok: false, status: 0, body: { error: "TimeoutError" } })).toBe(
      false,
    );
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

  it("the catalogue icon stays on (§39.15.2): what the settings say after the POST and the read-back", () => {
    expect(commerceState(true, { is_cart_enabled: true, is_catalog_visible: true })).toMatchObject({
      header: "shown",
      commerceOn: true,
    });
    expect(commerceState(true, null)).toMatchObject({ header: "shown", commerceOn: true });
    expect(
      commerceState(false, { is_cart_enabled: true, is_catalog_visible: false }),
    ).toMatchObject({
      header: "hidden",
      commerceOn: false,
    });
    expect(commerceState(true, {})).toMatchObject({ header: "unverified", commerceOn: false });
    // Today: neither route may read or write the settings; the owner's setting stands and no issue opens.
    expect(commerceState(false, null)).toMatchObject({ header: "unverified", commerceOn: false });
  });
});
