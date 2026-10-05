import { describe, expect, it } from "vitest";
import { buildClaimCard, maskPhone, parseClaimTap } from "./claims";

const id = "8872435b-34f7-4fde-b43e-d8c5dcea2445";
describe("buildClaimCard", () => {
  const card: any = buildClaimCard("96170000001", { claimId: id, vendorName: "Al Tahouneh", village: "Baakleen", contactName: "Rami K", contactPhone: "96171123456", evidence: "I am the owner" });
  it("is an interactive button message with Approve and Reject carrying the claim id", () => {
    expect(card.type).toBe("interactive");
    const b = card.interactive.action.buttons.map((x: any) => x.reply);
    expect(b).toEqual([{ id: `CLAIM|OK|${id}`, title: "✅ Approve" }, { id: `CLAIM|NO|${id}`, title: "❌ Reject" }]);
    for (const x of b) expect(x.title.length).toBeLessThanOrEqual(20);
  });
  it("shows the business, claimant and phone", () => {
    const t = card.interactive.body.text;
    expect(t).toContain("Al Tahouneh");
    expect(t).toContain("Rami K");
    expect(t).toContain("+96171123456");
  });
});
describe("parseClaimTap", () => {
  it("parses approve/reject", () => {
    expect(parseClaimTap(`CLAIM|OK|${id}`)).toEqual({ approve: true, claimId: id });
    expect(parseClaimTap(`CLAIM|NO|${id}`)).toEqual({ approve: false, claimId: id });
  });
  it("rejects anything else", () => {
    for (const s of ["CLAIM|OK|nope", "CLAIM|MAYBE|" + id, "ORD|v|i", "", `claim|ok|${id}`]) expect(parseClaimTap(s)).toBeNull();
  });
});
describe("maskPhone", () => {
  it("hides the middle digits", () => expect(maskPhone("96171123456")).toBe("+961 ••• ••• 56"));
});
