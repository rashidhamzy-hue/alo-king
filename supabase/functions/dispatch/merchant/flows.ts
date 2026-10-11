// Merchant WhatsApp Flows on the Merchant number (DECISIONS §12): "hours" opens merchant_hours, "profile"
// opens merchant_claim (business details after a claim), and their submissions are applied by flow_submit.
// While Flows are off (not yet published on the number) the same requests get a short text answer.

import { clampInteractive } from "../../_shared/meta-limits.ts";
import { flowMessage, type FlowName } from "../../_shared/flows.ts";
import { menuImportHelp } from "../../_shared/menu-cards.ts";

type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };
type Member = { member_id: string; vendor_id: string; role: string };

export type MerchantFlowDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  send: (payload: Record<string, unknown>) => Promise<SendResult>;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

const HOURS =
  /^\s*(hours|opening hours|change hours|دوام|الدوام|ساعات|ساعات الدوام|غيّر الدوام|horaires|dawem)\s*$/i;
const PROFILE =
  /^\s*(profile|my profile|business details|ملف المحل|معلومات المحل|بروفايل|profil|mon profil)\s*$/i;

export function merchantFlowRequest(text: string | null | undefined): FlowName | null {
  const t = String(text ?? "");
  if (HOURS.test(t)) return "merchant_hours";
  if (PROFILE.test(t)) return "merchant_claim";
  return null;
}

const txt = (to: string, body: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
  type: "text",
  text: { body },
});

/** Handles a Flow submission or a Flow request from a member; false when the message is neither. */
export async function handleMerchantFlows(
  deps: MerchantFlowDeps,
  m: {
    from: string;
    text: string | null;
    flow: { token: string; payload: Record<string, unknown> } | null;
  },
  members: Member[],
): Promise<boolean> {
  const out: Record<string, unknown>[] = [];
  if (m.flow) {
    const r = await deps.rpc("flow_submit", {
      p_phone: m.from,
      p_token: m.flow.token,
      p_payload: m.flow.payload,
    });
    if (r?.status === "duplicate") return true;
    if (r?.status === "saved" && r.flow === "merchant_claim") {
      out.push(txt(m.from, "✅ حفظنا معلومات المحل والدوام. / Business details and hours saved."));
      if (r.menu_photos) {
        const editor = members.find((x) => x.role === "owner" || x.role === "manager");
        if (editor)
          await deps.rpc("onboarding_session_set", {
            p_phone: m.from,
            p_step: "menu_import",
            p_data: { vendor_id: editor.vendor_id, member_id: editor.member_id },
            p_lang: null,
          });
        out.push(menuImportHelp(m.from, true));
      }
    } else if (r?.status === "saved" && r.flow === "merchant_hours") {
      out.push(
        txt(
          m.from,
          r.paused_until
            ? "✅ حفظنا الدوام، والمحل مسكّر مؤقتا. ابعت «فتحنا» لترجع تفتح قبل. / Hours saved and you are closed for now; send “open” to reopen earlier."
            : "✅ حفظنا الدوام. / Hours saved.",
        ),
      );
    } else if (r?.status === "rejected" && r.reason === "closed every day") {
      out.push(
        txt(
          m.from,
          "ما فينا نسكّر كل الأيام. إذا المحل مسكّر نهائيا احكي مع رشيد. / You can't close every day; if the business closed, talk to Rasheed.",
        ),
      );
    } else {
      out.push(txt(m.from, "ما قدرنا نحفظ. جرّب مرة تانية. / Could not save; please try again."));
    }
  } else {
    const flow = merchantFlowRequest(m.text);
    if (!flow) return false;
    const editor = members.find((x) => x.role === "owner" || x.role === "manager");
    if (!editor) {
      out.push(
        txt(
          m.from,
          "الدوام والمعلومات بيغيّرها صاحب المحل أو المدير بس. / Only the owner or a manager can change these.",
        ),
      );
    } else {
      const lang = /[؀-ۿ]/.test(String(m.text)) ? "ar" : "en";
      const r = await deps.rpc("flow_open", {
        p_flow: flow,
        p_lang: lang,
        p_phone: m.from,
        p_customer_id: null,
        p_member_id: editor.member_id,
        p_context: {},
      });
      if (r?.status === "ok")
        out.push(
          flowMessage(m.from, { flow, lang, token: r.token, screen: r.screen, data: r.data }),
        );
      else
        out.push(
          txt(
            m.from,
            flow === "merchant_hours"
              ? "لتسكّر مؤقتا ابعت «مسكّر لـ ٦» أو «مسكّر ساعة»؛ وتغيير الدوام قريبا من هون. / To close for a while send “closed till 6” or “closed 1 hour”; changing hours here comes soon."
              : "تعديل معلومات المحل قريبا من هون ومن لوحة التحكم. / Editing business details here and on the dashboard comes soon.",
          ),
        );
    }
  }
  for (const p of out) {
    const res = await deps.send(clampInteractive(p));
    if (!res.ok) deps.log?.("merchant flow send failed", { error: res.error.slice(0, 120) });
  }
  return true;
}
