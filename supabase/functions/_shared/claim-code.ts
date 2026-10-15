// The claim code to a shop's own number (§18.1 B) by WhatsApp: free-form inside the 24-hour window on the sending number,
// else Meta's one-tap authentication template once it is approved (DECISIONS §39.8). Without either, the free-form message
// is still tried; Meta refuses it outside the window and the claim moves to documents, as before.
import { claimCodeText } from "./onboarding-cards.ts";
import { templateByName, templateLang, templateMessage } from "./whatsapp-templates.ts";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;

export async function claimCodePayload(
  rpc: Rpc,
  sender: string,
  to: string,
  code: string,
): Promise<Record<string, unknown>> {
  const open = await rpc("whatsapp_window_open", { p_phone_e164: to, p_phone_number_id: sender }).catch(
    () => null,
  );
  if (open === false) {
    const t = await rpc("whatsapp_template_for", {
      p_key: "claim_code",
      p_lang: "ar",
      p_target: to,
      p_audience: "merchant",
    }).catch(() => null);
    const def = templateByName("alo_claim_code");
    if (def && t?.name === def.name) return templateMessage(to, def, templateLang(t.lang), { code });
  }
  return claimCodeText(to, code);
}
