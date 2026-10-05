import { describe, expect, it } from "vitest";
import { buildOtpPayload } from "./otp";

describe("buildOtpPayload", () => {
  const p = buildOtpPayload("96171000000", "alo_verify_code", "ar", "123456");
  it("targets the template and language", () => {
    expect(p.template.name).toBe("alo_verify_code");
    expect(p.template.language.code).toBe("ar");
  });
  it("sends the code as both the body and the copy-code button parameter", () => {
    const [body, button] = p.template.components;
    expect(body).toEqual({ type: "body", parameters: [{ type: "text", text: "123456" }] });
    expect(button).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] });
  });
});
