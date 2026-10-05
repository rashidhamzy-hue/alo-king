// Shared by claim-vendor (sends the review card) and kapso-brain (handles the admin's tap).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maskPhone = (p: string) => `+${p.slice(0, 3)} ••• ••• ${p.slice(-2)}`;

/** Interactive Approve / Reject card for one pending vendor claim (WhatsApp limits: body <= 1024, titles <= 20). */
export function buildClaimCard(to: string, o: { claimId: string; vendorName: string; village?: string | null; contactName: string; contactPhone: string; evidence?: string | null }) {
  const lines = [
    "🆕 *Vendor claim to review*",
    "",
    `🏪 *${o.vendorName.slice(0, 80)}*${o.village ? ` · ${o.village}` : ""}`,
    `👤 ${o.contactName.slice(0, 60)}`,
    `📞 +${o.contactPhone}`,
    ...(o.evidence ? ["", `📝 ${o.evidence.replace(/\s+/g, " ").slice(0, 300)}`] : []),
    "",
    "Approving links this number as the owner console and gives the claimant merchant access.",
  ];
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
    interactive: {
      type: "button",
      body: { text: lines.join("\n").slice(0, 1024) },
      footer: { text: "Alo King · claim review" },
      action: { buttons: [
        { type: "reply", reply: { id: `CLAIM|OK|${o.claimId}`, title: "✅ Approve" } },
        { type: "reply", reply: { id: `CLAIM|NO|${o.claimId}`, title: "❌ Reject" } },
      ] },
    },
  };
}

/** `CLAIM|OK|<uuid>` / `CLAIM|NO|<uuid>` → decision, anything else (or a malformed id) → null. */
export function parseClaimTap(id: string): { approve: boolean; claimId: string } | null {
  const [kind, act, claimId] = String(id ?? "").split("|");
  if (kind !== "CLAIM" || (act !== "OK" && act !== "NO") || !UUID.test(claimId ?? "")) return null;
  return { approve: act === "OK", claimId };
}
