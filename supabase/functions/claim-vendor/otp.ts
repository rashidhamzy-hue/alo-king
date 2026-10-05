// WhatsApp authentication (copy-code) templates need the code twice: once as the
// body parameter and once as the button parameter (sub_type "url", index "0").
// Omitting either makes Meta reject the send (#132000 parameter mismatch).
export function buildOtpPayload(to: string, template: string, language: string, code: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}
