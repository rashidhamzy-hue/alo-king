// WhatsApp admin commands (DECISIONS §32.1, mobile fallback to Slack): an operator's own number (public.operator_phones)
// on the Merchant number can ask for "status", pause or resume a merchant, approve or reject a claim, reply to the latest
// support case, and refund up to $20. Each change is an ops_actions row proposed first and done only on that operator's
// confirming tap; the server checks the operator, the limits and audits it. Everything else stays in Slack.

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;
type Operator = { user_id: string; role: string; name: string };

export type AdminCommand =
  | { kind: "status" }
  | { kind: "pause"; merchant: string; minutes: number }
  | { kind: "resume"; merchant: string }
  | { kind: "approve" | "reject"; claim: string }
  | { kind: "reply"; text: string }
  | { kind: "refund"; code: string; amount: number };

/** The admin command in a message, or null (most messages; then nothing else is asked of the database). */
export function parseAdminCommand(text: string | null | undefined): AdminCommand | null {
  const t = String(text ?? "").trim();
  let m: RegExpMatchArray | null;
  if (/^(status|حالة|الوضع|ops status)$/i.test(t)) return { kind: "status" };
  if (
    (m = t.match(
      /^(?:pause|وقّف|وقف)\s+(.+?)(?:\s+(\d{1,4})\s*(?:m|min|mins|minutes|د|دقيقة)?)?$/i,
    ))
  )
    return { kind: "pause", merchant: m[1].trim(), minutes: Number(m[2] ?? 60) };
  if ((m = t.match(/^(?:resume|شغّل|شغل)\s+(.+)$/i)))
    return { kind: "resume", merchant: m[1].trim() };
  if ((m = t.match(/^(approve|reject)\s+([0-9a-f]{4,36})$/i)))
    return { kind: m[1].toLowerCase() as "approve" | "reject", claim: m[2].toLowerCase() };
  if ((m = t.match(/^(?:reply|رد)\s*[:-]?\s+([\s\S]{1,1500})$/i)))
    return { kind: "reply", text: m[1].trim() };
  if ((m = t.match(/^refund\s+#?([A-Za-z0-9]{4,10})\s+\$?(\d{1,4}(?:\.\d{1,2})?)$/i)))
    return { kind: "refund", code: m[1].toUpperCase(), amount: Number(m[2]) };
  return null;
}

/** The confirm / cancel tap on an admin card: adm:<action id>:y|n. */
export function adminTap(
  id: string | null | undefined,
): { actionId: string; confirm: boolean } | null {
  const m = String(id ?? "").match(/^adm:([0-9a-f-]{36}):(y|n)$/);
  return m ? { actionId: m[1], confirm: m[2] === "y" } : null;
}

const card = (body: string, actionId: string) => ({
  interactive: {
    type: "button",
    body: { text: body.slice(0, 1000) },
    action: {
      buttons: [
        { type: "reply", reply: { id: `adm:${actionId}:y`, title: "✅ Confirm" } },
        { type: "reply", reply: { id: `adm:${actionId}:n`, title: "Cancel" } },
      ],
    },
  },
});

/** Handles a parsed command or a tap from an operator's phone; replies go through the outbox like every reply. */
export async function handleAdmin(
  deps: { rpc: Rpc },
  m: { from: string; messageId: string },
  op: Operator,
  tap: { actionId: string; confirm: boolean } | null,
  cmd: AdminCommand | null,
): Promise<void> {
  const reply = (p: string | Record<string, unknown>) =>
    deps.rpc("app_reply", {
      p_to: m.from,
      p_payload: typeof p === "string" ? { text: p } : p,
      p_ref: m.messageId,
    });
  const propose = async (action: string, args: Record<string, unknown>, question: string) => {
    const id = await deps.rpc("ops_action_propose", {
      p_actor_id: op.user_id,
      p_action: action,
      p_args: args,
    });
    return reply(card(question, String(id)));
  };
  if (tap) {
    const r = await deps.rpc("ops_action_decide", {
      p_action_id: tap.actionId,
      p_actor_id: op.user_id,
      p_confirm: tap.confirm,
    });
    return reply(
      r?.status === "done"
        ? `✅ Done (${r.action}${r.result ? `: ${r.result}` : ""}).`
        : r?.status === "cancelled"
          ? "Cancelled; nothing changed."
          : r?.status === "refused"
            ? `⚠️ Refused: ${String(r.error ?? "").slice(0, 160)}`
            : r?.status === "expired"
              ? "⌛ Too late (10 minutes); send the command again."
              : "Nothing to confirm.",
    );
  }
  if (!cmd) return;
  switch (cmd.kind) {
    case "status": {
      const s = await deps.rpc("ops_status", { p_actor_id: op.user_id });
      return reply(
        `📊 Today: ${s?.orders_today ?? 0} orders, ${s?.active ?? 0} active · ${s?.exceptions_open ?? 0} problems open · ${s?.cases_open ?? 0} support cases · ${s?.claims_waiting ?? 0} claims waiting.`,
      );
    }
    case "pause":
    case "resume": {
      const found: any[] =
        (await deps.rpc("ops_merchant", { p_actor_id: op.user_id, p_query: cmd.merchant })) ?? [];
      const v = found[0];
      if (!v) return reply(`No shop matches “${cmd.merchant}”.`);
      return cmd.kind === "pause"
        ? propose(
            "merchant_pause",
            { vendor_id: v.vendor_id, minutes: cmd.minutes },
            `⏸ Pause ${v.name} for ${cmd.minutes} min?`,
          )
        : propose(
            "merchant_resume",
            { vendor_id: v.vendor_id },
            `🟢 Take orders again at ${v.name}?`,
          );
    }
    case "approve":
    case "reject": {
      const claims: any[] = (await deps.rpc("ops_claims", { p_actor_id: op.user_id })) ?? [];
      const c = claims.filter((x) => String(x.claim_id).startsWith(cmd.claim));
      if (c.length !== 1)
        return reply(
          c.length ? "Several claims match; send more of the id." : "No waiting claim matches.",
        );
      return propose(
        cmd.kind === "approve" ? "claim_approve" : "claim_reject",
        { claim_id: c[0].claim_id },
        `${cmd.kind === "approve" ? "✅ Approve" : "❌ Reject"} the claim for ${c[0].vendor}?`,
      );
    }
    case "reply": {
      // The case is named: "reply <text>" only when one case is open, else "reply <short id> <text>"; the confirm card
      // says who receives it.
      const s = await deps.rpc("ops_status", { p_actor_id: op.user_id });
      const cases: { id: string; short: string; name: string }[] = s?.open_cases ?? [];
      if (!cases.length) return reply("No open support case.");
      const m = cmd.text.match(/^#?([0-9a-f]{4})\s+([\s\S]+)$/i);
      const named = m ? cases.find((c) => c.short.toLowerCase() === m[1].toLowerCase()) : undefined;
      const target = named ?? (cases.length === 1 ? cases[0] : undefined);
      if (!target)
        return reply(
          `Several open cases; send "reply <id> <text>":\n${cases.map((c) => `• ${c.short} ${c.name}`).join("\n")}`,
        );
      const text = named && m ? m[2] : cmd.text;
      return propose(
        "support_reply",
        { case_id: target.id, text },
        `💬 Send to ${target.name} (case ${target.short}):\n“${text.slice(0, 600)}”`,
      );
    }
    case "refund":
      return propose(
        "refund",
        { code: cmd.code, amount_usd: cmd.amount },
        `💵 Credit $${cmd.amount.toFixed(2)} to the customer of #${cmd.code}?`,
      );
  }
}
