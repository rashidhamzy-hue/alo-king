import { describe, expect, it } from "vitest";
import {
  classifySubmitError,
  missingTemplates,
  productionNumbers,
  statusReport,
  syncRows,
  tierLimit,
} from "./number";
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
        messaging_tier: null,
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
  it("an authentication template on a number below the 2K tier is blocked, any other refusal fails the run", () => {
    const auth = {
      code: 10,
      error_subcode: 2388185,
      message: "Application does not have permission for this action",
    };
    expect(tierLimit("TIER_250")).toBe(250);
    expect(tierLimit("TIER_2K")).toBe(2000);
    expect(tierLimit("TIER_UNLIMITED")).toBe(Infinity);
    expect(classifySubmitError("AUTHENTICATION", auth, "TIER_250").kind).toBe("blocked");
    expect(classifySubmitError("AUTHENTICATION", auth, "TIER_10K").kind).toBe("refused");
    expect(classifySubmitError("UTILITY", auth, "TIER_250").kind).toBe("refused");
    const emoji = {
      code: 100,
      error_subcode: 2388060,
      error_user_msg: "Buttons can't have any variables, newlines, emoji",
    };
    expect(classifySubmitError("UTILITY", emoji, "TIER_250")).toEqual({
      kind: "refused",
      reason: "Buttons can't have any variables, newlines, emoji",
    });
  });
  it("reports every registry version: Meta's status, or blocked, refused or missing", () => {
    const rows = [
      {
        name: "alo_order_confirmed",
        language: "ar",
        category: "UTILITY",
        status: "approved",
        reason: null,
      },
      {
        name: "alo_staff_welcome",
        language: "en",
        category: "MARKETING",
        status: "pending",
        reason: null,
      },
    ];
    const r = statusReport(
      rows,
      new Map([["alo_claim_code/ar", "tier"]]),
      new Map([["alo_order_delivered/en", "emoji"]]),
    );
    expect(r).toHaveLength(TEMPLATES.length * 3);
    const at = (n: string, l: string) => r.find((x) => x.name === n && x.language === l)!;
    expect(at("alo_order_confirmed", "ar").status).toBe("approved");
    expect(at("alo_staff_welcome", "en")).toMatchObject({
      ours: "UTILITY",
      meta_category: "MARKETING",
    });
    expect(at("alo_claim_code", "ar")).toMatchObject({ status: "blocked", note: "tier" });
    expect(at("alo_order_delivered", "en")).toMatchObject({ status: "refused", note: "emoji" });
    expect(at("alo_order_on_the_way", "fr").status).toBe("missing");
  });
});
