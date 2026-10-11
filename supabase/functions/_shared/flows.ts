// WhatsApp Flows (DECISIONS §12): the message that opens a published static Flow with server-built data
// (navigate action), and the parser for its `nfm_reply`. The Flow JSON lives in whatsapp/flows/ (one file
// per Flow and language, tested with Flowso in CI); Meta knows each by name, e.g. `alo_address_capture_ar`.
// The server re-validates everything a Flow returns (flow_submit); prices never come from a Flow.

export type FlowName = "address_capture" | "item_options" | "merchant_claim" | "merchant_hours";

/** The published name of a Flow version on Meta/Kapso (whatsapp-flows.yml uses the same names). */
export const publishedFlowName = (flow: FlowName, lang: "ar" | "en") => `alo_${flow}_${lang}`;

const CTA: Record<FlowName, { ar: string; en: string; bodyAr: string; bodyEn: string }> = {
  address_capture: {
    ar: "تفاصيل العنوان",
    en: "Address details",
    bodyAr: "📍 كمّل تفاصيل العنوان (البناية، الطابق، رقم للسائق).",
    bodyEn: "📍 Add your address details (building, floor, a number for the driver).",
  },
  item_options: {
    ar: "اختار الخيارات",
    en: "Choose options",
    bodyAr: "اختار الحجم والإضافات.",
    bodyEn: "Choose the size and extras.",
  },
  merchant_claim: {
    ar: "معلومات المحل",
    en: "Business details",
    bodyAr: "أكّد معلومات المحل، الدوام، مسافة التوصيل والعملة.",
    bodyEn: "Confirm your business details, hours, delivery distance and cash currencies.",
  },
  merchant_hours: {
    ar: "دوام المحل",
    en: "Opening hours",
    bodyAr: "غيّر الدوام أو سكّر مؤقتا.",
    bodyEn: "Change your hours or close for a while.",
  },
};

/** The interactive message that opens a Flow on a given screen with the server's data. */
export function flowMessage(
  to: string,
  open: { flow: FlowName; lang: "ar" | "en"; token: string; screen: string; data: Record<string, unknown> },
) {
  const c = CTA[open.flow];
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: open.lang === "ar" ? c.bodyAr : c.bodyEn },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: open.token,
          flow_name: publishedFlowName(open.flow, open.lang),
          flow_cta: open.lang === "ar" ? c.ar : c.en,
          flow_action: "navigate",
          flow_action_payload: { screen: open.screen, data: open.data },
        },
      },
    },
  };
}

/** A Flow submission (`interactive.type = nfm_reply`): its token and the completion payload, or null. */
export function parseFlowReply(msg: any): { token: string; payload: Record<string, unknown> } | null {
  const r = msg?.interactive?.nfm_reply;
  if (msg?.type !== "interactive" || msg?.interactive?.type !== "nfm_reply" || !r) return null;
  let body: unknown = r.response_json;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;
  const { flow_token, ...payload } = body as Record<string, unknown>;
  if (typeof flow_token !== "string" || !/^[a-z_]+:[0-9a-f]{32}$/.test(flow_token)) return null;
  return { token: flow_token, payload };
}
