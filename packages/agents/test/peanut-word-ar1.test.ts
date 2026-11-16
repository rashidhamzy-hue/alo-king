// AR1: peanuts are «فستق عبيد» in Arabic, never «فول سوداني» (the founder's read, 16 November 2026).
import { describe, expect, it } from "vitest";
import { readSearch } from "@ak/agents/search-reading";
import { messages } from "@ak/agents/messages";

describe("AR1: the peanut word", () => {
  it("the reading side takes «فستق عبيد» as peanuts, and not as tree nuts", () => {
    const r = readSearch("بدي سناكس بلا فستق عبيد");
    expect(r.filters.free_of).toEqual(["peanuts"]);
  });
  it("the reading side still takes the old word the customer may say", () => {
    expect(readSearch("بلا فول سوداني").filters.free_of).toEqual(["peanuts"]);
  });
  it("the Arabic answer says «فستق عبيد»", () => {
    const text = messages("ar").honest.cannotConfirm("إنّو بلا فستق عبيد", ["سناكس"]);
    expect(text).not.toContain("فول سوداني");
  });
});
