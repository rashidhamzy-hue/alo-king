import { describe, expect, it } from "vitest";
import { missingTemplates, productionNumbers, syncRows } from "./number";
import { TEMPLATES } from "../../supabase/functions/_shared/whatsapp-templates";

describe("kapso-number (DECISIONS §39.8)", () => {
  it("only a production number counts: the shared sandbox changes nothing", () => {
    expect(productionNumbers([{ id: "597907523413541", kind: "sandbox" }])).toEqual([]);
    expect(
      productionNumbers([
        { phone_number_id: "597907523413541", kind: "sandbox" },
        {
          phone_number_id: "15550001111",
          kind: "production",
          business_account_id: "9001",
          display_phone_number_normalized: "+15550001111",
        },
      ]),
    ).toEqual([
      {
        phone_number_id: "15550001111",
        business_account_id: "9001",
        kind: "production",
        display_phone_number: "+15550001111",
      },
    ]);
  });
  it("submits each registry template once per language", () => {
    expect(missingTemplates([])).toHaveLength(TEMPLATES.length * 3);
    const one = missingTemplates([{ name: "alo_order_confirmed", language: "ar" }]);
    expect(one).toHaveLength(TEMPLATES.length * 3 - 1);
    expect(one.some((x) => x.t.name === "alo_order_confirmed" && x.lang === "ar")).toBe(false);
  });
  it("mirrors only our templates, with Meta's id, lower-case status and a real rejection reason", () => {
    expect(
      syncRows([
        {
          id: "77",
          name: "alo_order_confirmed",
          language: "fr",
          status: "REJECTED",
          category: "UTILITY",
          rejected_reason: "INVALID_FORMAT",
        },
        {
          id: "78",
          name: "alo_order_confirmed",
          language: "ar",
          status: "APPROVED",
          category: "UTILITY",
          rejected_reason: "NONE",
        },
        { id: "79", name: "hello_world", language: "en_US", status: "APPROVED" },
      ]),
    ).toEqual([
      {
        name: "alo_order_confirmed",
        language: "fr",
        category: "UTILITY",
        status: "rejected",
        meta_template_id: "77",
        reason: "INVALID_FORMAT",
      },
      {
        name: "alo_order_confirmed",
        language: "ar",
        category: "UTILITY",
        status: "approved",
        meta_template_id: "78",
        reason: null,
      },
    ]);
  });
});
