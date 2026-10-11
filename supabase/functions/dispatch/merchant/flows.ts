// Merchant WhatsApp Flows on the Merchant number (DECISIONS §12): "hours" opens merchant_hours, "profile"
// opens merchant_claim (business details after a claim), and their submissions are applied by flow_submit.
// While Flows are off (not yet published on the number) the same requests get a short text answer.

import { clampInteractive } from "../../_shared/meta-limits.ts";
import { flowMessage, type FlowName } from "../../_shared/flows.ts";
import { menuImportHelp } from "../../_shared/menu-cards.ts";

type SendResult = { ok: true; id?: string } | { ok: false; retry: boolean; error: string };
type Member = { member_id: string; vendor_id: string; role: string; vendor_name?: string | null };

export type MerchantFlowDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  send: (payload: Record<string, unknown>) => Promise<SendResult>;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

const HOURS =
  /^\s*(hours|opening hours|change hours|دوام|الدوام|ساعات|ساعات الدوام|غيّر الدوام|horaires|dawem)\s*$/i;
const PROFILE =
  /^\s*(profile|my profile|business details|ملف المحل|معلومات المحل|بروفايل|profil|mon profil)\s*$/i;

const FLOWS = ["merchant_hours", "merchant_claim"] as const;

/** Which branch a Flow is for, when the sender owns or manages several (tap id MFL|<flow>|<member id>). */
export function branchPicker(to: string, flow: FlowName, editors: Member[]) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "لأي فرع؟ / Which branch?" },
      action: {
        button: "الفروع · Branches",
        sections: [
          {
            title: "Branches",
            rows: editors.slice(0, 10).map((e) => ({
              id: `MFL|${flow === "merchant_hours" ? "H" : "P"}|${e.member_id}`,
              title: String(e.vendor_name ?? e.vendor_id).slice(0, 24),
            })),
          },
        ],
      },
    },
  };
}

export function parseBranchTap(
  id: string | null | undefined,
): { flow: FlowName; memberId: string } | null {
  const m = String(id ?? "").match(/^MFL\|([HP])\|([0-9a-f-]{36})$/i);
  return m ? { flow: m[1].toUpperCase() === "H" ? FLOWS[0] : FLOWS[1], memberId: m[2] } : null;
}

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
    buttonId?: string | null;
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
    if (r?.status === "duplicate") {
      out.push(
        txt(
          m.from,
          "وصلنا هالنموذج من قبل. ابعت «دوام» أو «profile» لتفتح واحد جديد. / We already have this form; send “hours” or “profile” for a new one.",
        ),
      );
    } else if (r?.status === "saved" && r.flow === "merchant_claim") {
      out.push(txt(m.from, "✅ حفظنا معلومات المحل والدوام. / Business details and hours saved."));
      if (r.menu_photos && r.vendor_id && r.member_id) {
        // The branch the Flow was opened for, not the sender's first membership.
        await deps.rpc("onboarding_session_set", {
          p_phone: m.from,
          p_step: "menu_import",
          p_data: { vendor_id: r.vendor_id, member_id: r.member_id },
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
    } else if (r?.status === "rejected" && r.reason === "expired") {
      out.push(
        txt(
          m.from,
          "⌛ هالنموذج قديم. ابعت «دوام» أو «profile» لتفتح واحد جديد. / This form expired; send “hours” or “profile” for a new one.",
        ),
      );
    } else if (r?.status === "rejected" && r.reason === "hours") {
      out.push(
        txt(
          m.from,
          "وقت الفتح والسكّرة لازم يكونوا مختلفين. ابعت «دوام» وجرّب من جديد. / Opening and closing times must differ; send “hours” to try again.",
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
      out.push(
        txt(
          m.from,
          "ما قدرنا نحفظ. ابعت «دوام» أو «profile» وجرّب من جديد. / Could not save; send “hours” or “profile” to try again.",
        ),
      );
    }
  } else {
    const tap = parseBranchTap(m.buttonId);
    const flow = tap?.flow ?? merchantFlowRequest(m.text);
    if (!flow) return false;
    const editors = members.filter((x) => x.role === "owner" || x.role === "manager");
    const editor = tap
      ? editors.find((x) => x.member_id === tap.memberId)
      : editors.length === 1
        ? editors[0]
        : null;
    if (!tap && editors.length > 1) {
      out.push(branchPicker(m.from, flow, editors));
    } else if (!editor) {
      out.push(
        txt(
          m.from,
          "الدوام والمعلومات بيغيّرها صاحب المحل أو المدير بس. / Only the owner or a manager can change these.",
        ),
      );
    } else {
      const lang = tap || /[؀-ۿ]/.test(String(m.text)) ? "ar" : "en";
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
