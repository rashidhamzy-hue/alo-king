// ops-slack (DECISIONS §32.1): the Slack app's one endpoint for slash commands (/ak …), buttons and modals
// (interactivity) and thread replies in #support (Events API). Every request is verified with Slack's signing secret
// (v0 HMAC over "v0:timestamp:body", at most 5 minutes old); the Slack user must map to an active `operators` row; every
// action calls the same server function the admin pages use, with the same limits, and is audited there. Money actions
// over $20, claim decisions and refunds open a confirm modal showing the exact effect. Nothing here can bypass a server
// rule: a refused call is answered with the server's reason. Dependencies are injected so it is tested without Slack.

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;
export type OpsSlackDeps = {
  rpc: Rpc;
  signingSecret: string | null;
  /** views.open with the bot token (confirm modals); null when no token. */
  openModal: ((triggerId: string, view: Record<string, unknown>) => Promise<boolean>) | null;
  now?: () => number;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Slack's request signature: v0=HMAC-SHA256(secret, "v0:" + timestamp + ":" + raw body), fresh within 5 minutes. */
export async function verifySlack(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  nowS: number,
): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowS - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const want = `v0=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${body}`)))}`;
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ephemeral = (text: string) => json({ response_type: "ephemeral", text: text.slice(0, 3000) });
const money = (v: unknown) => `$${Number(v ?? 0).toFixed(2)}`;
/** The server's refusal, in its own words (a check or a privilege error), never a stack. */
const refusal = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(/^.*?(?:ERROR:\s*)?/, "")
    .slice(0, 200);

export const HELP = [
  "*/ak* commands (Alo King ops):",
  "• `order <code>`: lifecycle and problems",
  "• `merchant <name>` · `merchant pause <name> [minutes]` · `merchant resume <name>`",
  "• `claim`: the claims queue",
  "• `driver <name>`",
  "• `refund <order code> <amount>` (confirm)",
  "• `credit <merchant> <amount> <reason>` (confirm over $20)",
  "• `place on|off <place>` (admin)",
  "• `finance` · `broadcast pause`",
].join("\n");

/** A confirm modal: the exact effect, Confirm / Cancel; the action travels in private_metadata and is re-checked on submit. */
export function confirmModal(title: string, effect: string, action: Record<string, unknown>) {
  return {
    type: "modal",
    callback_id: "ak_confirm",
    title: { type: "plain_text", text: title.slice(0, 24) },
    submit: { type: "plain_text", text: "Confirm" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify(action).slice(0, 3000),
    blocks: [{ type: "section", text: { type: "mrkdwn", text: effect.slice(0, 3000) } }],
  };
}

/** Runs a confirmed or direct action; returns the text for the operator. */
export async function runAction(rpc: Rpc, actor: string, a: Record<string, any>): Promise<string> {
  try {
    switch (a.do) {
      case "refund": {
        const r = await rpc("ops_refund", {
          p_actor_id: actor,
          p_code: a.code,
          p_amount_usd: a.amount,
          p_source: "slack",
        });
        return r?.status === "credited"
          ? `💵 ${money(r.amount_usd)} credited to the customer of #${r.code}.`
          : `No order #${a.code}.`;
      }
      case "credit": {
        const r = await rpc("ops_credit", {
          p_actor_id: actor,
          p_vendor_id: a.vendor_id,
          p_amount_usd: a.amount,
          p_reason: a.reason,
          p_source: "slack",
        });
        return `🎁 ${money(r?.amount_usd)} Alo King Credit for ${a.name}.`;
      }
      case "claim": {
        const r = await rpc("ops_claim_decide", {
          p_actor_id: actor,
          p_claim_id: a.claim_id,
          p_approve: a.approve,
          p_source: "slack",
        });
        return `Claim for ${a.name}: ${String(r?.status ?? "done")}.`;
      }
      case "pause": {
        const r = await rpc("ops_merchant_pause", {
          p_actor_id: actor,
          p_vendor_id: a.vendor_id,
          p_minutes: a.minutes,
          p_source: "slack",
        });
        return `⏸ ${a.name} paused until ${String(r?.until ?? "").slice(11, 16)} UTC.`;
      }
      case "resume": {
        const r = await rpc("ops_merchant_resume", {
          p_actor_id: actor,
          p_vendor_id: a.vendor_id,
          p_source: "slack",
        });
        return `🟢 ${a.name}: ${String(r?.status ?? "done")}.`;
      }
      default:
        return "Unknown action.";
    }
  } catch (e) {
    return `⚠️ Refused: ${refusal(e)}`;
  }
}

async function command(
  deps: OpsSlackDeps,
  actor: string,
  text: string,
  triggerId: string,
): Promise<Response> {
  const t = text.trim();
  const [verb, ...rest] = t.split(/\s+/);
  const arg = rest.join(" ");
  const rpc = deps.rpc;
  const pickMerchant = async (q: string) =>
    ((await rpc("ops_merchant", { p_actor_id: actor, p_query: q })) ?? [])[0] ?? null;
  const confirm = async (title: string, effect: string, action: Record<string, unknown>) => {
    if (!deps.openModal)
      return ephemeral("⚠️ Confirmations need the Slack bot token (SLACK_BOT_TOKEN).");
    const ok = await deps.openModal(triggerId, confirmModal(title, effect, action));
    return ok
      ? new Response("", { status: 200 })
      : ephemeral("⚠️ Could not open the confirmation; try again.");
  };
  try {
    switch ((verb ?? "").toLowerCase()) {
      case "order": {
        const r = await rpc("ops_order", { p_actor_id: actor, p_code: arg });
        if (r?.status !== "ok") return ephemeral(`No order #${arg}.`);
        const ev = (r.events ?? [])
          .map((e: any) => `${String(e.at).slice(11, 19)} ${e.from ?? "·"}→${e.to} (${e.by})`)
          .join("\n");
        const ex = (r.exceptions ?? [])
          .map((x: any) => `${x.kind}: ${x.status} (${x.recovery})`)
          .join("\n");
        return ephemeral(
          `*#${r.code}* ${r.order_status} · ${r.vendor} · ${r.fulfilment} · ${r.payment} · ${money(r.total_usd)} / ${Number(r.total_lbp ?? 0).toLocaleString("en-US")} LBP\n${ev}${ex ? `\n*Problems:*\n${ex}` : ""}`,
        );
      }
      case "merchant": {
        const sub = rest[0]?.toLowerCase();
        if (sub === "pause" || sub === "resume") {
          const m = rest
            .slice(1)
            .join(" ")
            .match(/^(.+?)(?:\s+(\d{1,4}))?$/);
          const v = m ? await pickMerchant(m[1]) : null;
          if (!v) return ephemeral("No shop matches.");
          const r = await runAction(
            rpc,
            actor,
            sub === "pause"
              ? { do: "pause", vendor_id: v.vendor_id, name: v.name, minutes: Number(m?.[2] ?? 60) }
              : { do: "resume", vendor_id: v.vendor_id, name: v.name },
          );
          return ephemeral(r);
        }
        const list: any[] = (await rpc("ops_merchant", { p_actor_id: actor, p_query: arg })) ?? [];
        return ephemeral(
          list.length
            ? list
                .map(
                  (v) =>
                    `• *${v.name}*${v.is_test ? " (test)" : ""}: ${v.claimed ? "claimed" : "unclaimed"}, ${v.orderable ? "orderable" : "not orderable"}${v.paused_until ? `, paused until ${String(v.paused_until).slice(11, 16)}` : ""}, ${v.orders_today} orders today`,
                )
                .join("\n")
            : "No shop matches.",
        );
      }
      case "claim":
      case "claims": {
        const list: any[] = (await rpc("ops_claims", { p_actor_id: actor })) ?? [];
        if (!list.length) return ephemeral("No claims waiting.");
        return json({
          response_type: "ephemeral",
          text: "Claims waiting",
          blocks: list.slice(0, 15).flatMap((c) => [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${c.vendor}* · ${c.status} · ${String(c.created_at).slice(0, 10)}`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  action_id: "claim_approve",
                  text: { type: "plain_text", text: "Approve" },
                  style: "primary",
                  value: JSON.stringify({ id: c.claim_id, name: c.vendor }),
                },
                {
                  type: "button",
                  action_id: "claim_reject",
                  text: { type: "plain_text", text: "Reject" },
                  style: "danger",
                  value: JSON.stringify({ id: c.claim_id, name: c.vendor }),
                },
              ],
            },
          ]),
        });
      }
      case "driver": {
        const list: any[] = (await rpc("ops_driver", { p_actor_id: actor, p_query: arg })) ?? [];
        return ephemeral(
          list.length
            ? list
                .map(
                  (d) =>
                    `• ${d.name} (${d.vendor}): ${(d.active_orders ?? []).join(", ") || "no active order"}`,
                )
                .join("\n")
            : "No driver matches.",
        );
      }
      case "refund": {
        const m = arg.match(/^#?([A-Za-z0-9]{4,10})\s+\$?(\d{1,4}(?:\.\d{1,2})?)$/);
        if (!m) return ephemeral("Usage: `/ak refund <order code> <amount>`");
        const code = m[1].toUpperCase();
        const amount = Number(m[2]);
        // Refunds always confirm (§32.1); the server re-checks the order, the total and the admin limit on submit.
        return confirm(
          "Refund",
          `Credit *${money(amount)}* to the customer of order *#${code}* (used on their next order; booked in the ledger).`,
          { do: "refund", code, amount },
        );
      }
      case "credit": {
        const m = arg.match(/^(.+?)\s+\$?(\d{1,4}(?:\.\d{1,2})?)\s+(.{3,200})$/);
        if (!m) return ephemeral("Usage: `/ak credit <merchant> <amount> <reason>`");
        const v = await pickMerchant(m[1]);
        if (!v) return ephemeral("No shop matches.");
        const action = {
          do: "credit",
          vendor_id: v.vendor_id,
          name: v.name,
          amount: Number(m[2]),
          reason: m[3],
        };
        const limit = Number((await rpc("config_value", { p_key: "ops_money_confirm_usd" })) ?? 20);
        if (action.amount > limit)
          return confirm(
            "Merchant credit",
            `Give *${money(action.amount)}* Alo King Credit to *${v.name}*: “${action.reason}”.`,
            action,
          );
        return ephemeral(await runAction(rpc, actor, action));
      }
      case "place": {
        const m = arg.match(/^(on|off)\s+(.+)$/i);
        if (!m) return ephemeral("Usage: `/ak place on|off <place>`");
        const r = await rpc("ops_place", {
          p_actor_id: actor,
          p_query: m[2],
          p_on: m[1].toLowerCase() === "on",
        });
        return ephemeral(
          r?.status === "unknown" ? "No place matches." : `📍 ${r?.place}: ${r?.status}.`,
        );
      }
      case "finance": {
        const r = (await rpc("ops_finance", { p_actor_id: actor })) ?? {};
        const lines = Object.entries(r).map(([k, v]) => `• ${k}: ${money(v)}`);
        return ephemeral(`*Ledger balances (USD)*\n${lines.join("\n") || "no entries yet"}`);
      }
      case "broadcast":
        if (rest[0]?.toLowerCase() !== "pause") return ephemeral("Usage: `/ak broadcast pause`");
        await rpc("broadcasts_pause", { p_actor_id: actor });
        return ephemeral("⏹ Broadcasts are off (kill switch). Approved ones wait.");
      default:
        return ephemeral(HELP);
    }
  } catch (e) {
    return ephemeral(`⚠️ Refused: ${refusal(e)}`);
  }
}

/** The whole request: verify, then route by kind. */
export async function handleOpsSlack(deps: OpsSlackDeps, req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await req.text();
  const nowS = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  if (
    !deps.signingSecret ||
    !(await verifySlack(
      deps.signingSecret,
      req.headers.get("x-slack-request-timestamp"),
      req.headers.get("x-slack-signature"),
      body,
      nowS,
    ))
  )
    return new Response("unauthorised", { status: 401 });
  const rpc = deps.rpc;
  const actorFor = async (slackUser: unknown) => {
    const op = await rpc("ops_operator", {
      p_slack_user_id: String(slackUser ?? ""),
      p_phone_e164: null,
    }).catch(() => null);
    return op?.user_id ? (String(op.user_id) as string) : null;
  };

  // Events API (JSON): the URL check, and thread replies in #support.
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    let ev: any;
    try {
      ev = JSON.parse(body);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (ev?.type === "url_verification") return json({ challenge: String(ev.challenge ?? "") });
    // Slack retries a delivery it thinks failed; the first one is the one that counts (no reply is sent twice).
    if (req.headers.get("x-slack-retry-num")) return new Response("", { status: 200 });
    const e = ev?.event;
    if (
      ev?.type === "event_callback" &&
      e?.type === "message" &&
      e.thread_ts &&
      e.thread_ts !== e.ts &&
      !e.bot_id &&
      !e.subtype
    ) {
      const actor = await actorFor(e.user);
      const caseId = await rpc("support_case_for_thread", { p_ts: String(e.thread_ts) }).catch(
        () => null,
      );
      if (actor && caseId && String(e.text ?? "").trim()) {
        const r = await rpc("support_reply", {
          p_case_id: caseId,
          p_actor_id: actor,
          p_text: String(e.text),
        }).catch((x: unknown) => {
          deps.log?.("support reply refused", { error: refusal(x) });
          return null;
        });
        deps.log?.("support reply", { status: String(r?.status ?? "refused") });
      }
    }
    return new Response("", { status: 200 });
  }

  const form = new URLSearchParams(body);
  // Interactivity: buttons and the confirm modal.
  if (form.has("payload")) {
    let p: any;
    try {
      p = JSON.parse(form.get("payload") ?? "");
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const actor = await actorFor(p?.user?.id);
    if (!actor) return ephemeral("⛔ Your Slack user is not an Alo King operator.");
    if (p.type === "view_submission" && p.view?.callback_id === "ak_confirm") {
      let action: Record<string, unknown> = {};
      try {
        action = JSON.parse(p.view.private_metadata ?? "{}");
      } catch {
        /* nothing to run */
      }
      const text = await runAction(rpc, actor, action);
      deps.log?.("confirmed action", {
        action: String(action.do ?? ""),
        result: text.slice(0, 60),
      });
      return json({
        response_action: "update",
        view: {
          type: "modal",
          title: { type: "plain_text", text: "Done" },
          blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
        },
      });
    }
    if (p.type === "block_actions") {
      const a = p.actions?.[0] ?? {};
      try {
        switch (a.action_id) {
          case "ack_alert":
            await rpc("ops_alert_ack", { p_actor_id: actor, p_alert_id: Number(a.value) });
            return ephemeral("👍 Acknowledged.");
          case "case_resolve": {
            const r = await rpc("support_resolve", {
              p_case_id: String(a.value),
              p_actor_id: actor,
            });
            return ephemeral(
              r?.status === "resolved"
                ? "✅ Resolved; the assistant is back."
                : "This case is already closed.",
            );
          }
          case "order_show":
            return command(deps, actor, `order ${String(a.value)}`, String(p.trigger_id ?? ""));
          case "claim_approve":
          case "claim_reject": {
            // Claim decisions always confirm (§32.1).
            const v = JSON.parse(String(a.value ?? "{}"));
            if (!deps.openModal) return ephemeral("⚠️ Confirmations need the Slack bot token.");
            await deps.openModal(
              String(p.trigger_id ?? ""),
              confirmModal(
                a.action_id === "claim_approve" ? "Approve claim" : "Reject claim",
                `${a.action_id === "claim_approve" ? "*Approve*" : "*Reject*"} the claim for *${v.name}*. The claimant is told on WhatsApp.`,
                {
                  do: "claim",
                  claim_id: v.id,
                  name: v.name,
                  approve: a.action_id === "claim_approve",
                },
              ),
            );
            return new Response("", { status: 200 });
          }
        }
      } catch (e) {
        return ephemeral(`⚠️ Refused: ${refusal(e)}`);
      }
    }
    return new Response("", { status: 200 });
  }

  // Slash command.
  if (form.get("command") === "/ak") {
    const actor = await actorFor(form.get("user_id"));
    if (!actor) return ephemeral("⛔ Your Slack user is not an Alo King operator.");
    return command(deps, actor, form.get("text") ?? "", form.get("trigger_id") ?? "");
  }
  return new Response("", { status: 200 });
}
