import { describe, expect, it } from "vitest";
import { buildReadReceipt, shouldAck } from "./receipts.ts";

describe("buildReadReceipt (Cloud API: POST /{phone_number_id}/messages, status=read, no `to`)", () => {
  it("marks read and shows the typing indicator", () => {
    expect(buildReadReceipt("wamid.ABC", true)).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.ABC", typing_indicator: { type: "text" } });
  });
  it("marks read only when no typing indicator is wanted", () => {
    const p = buildReadReceipt("wamid.ABC", false)!;
    expect(p).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.ABC" });
    expect("typing_indicator" in p).toBe(false);
  });
  it("never carries a recipient", () => { expect("to" in buildReadReceipt("wamid.ABC", true)!).toBe(false); });
  it.each([undefined, "", "   ", "dry.123", "abc"])("returns null for a non-WhatsApp id %j", (id) => expect(buildReadReceipt(id as any, true)).toBeNull());
});

describe("shouldAck", () => {
  const base = { id: "wamid.X", dry: false, fromAdmin: false };
  it("acks real inbound messages with a typing indicator", () => expect(shouldAck(base)).toEqual({ read: true, typing: true }));
  it("never calls Meta in dry runs", () => expect(shouldAck({ ...base, dry: true })).toEqual({ read: false, typing: false }));
  it("no message id, nothing to ack", () => expect(shouldAck({ ...base, id: undefined })).toEqual({ read: false, typing: false }));
  it("the admin's own messages are marked read but never get a typing indicator (they are relayed or silent)", () => expect(shouldAck({ ...base, fromAdmin: true })).toEqual({ read: true, typing: false }));
});
