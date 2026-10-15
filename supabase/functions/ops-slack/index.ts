// ops-slack: the Slack app's endpoint (DECISIONS §32.1; handler and rules in ./handler.ts). verify_jwt is off
// (supabase/config.toml): Slack's signing secret is the authentication. Function secrets, synced by the deploy job from
// GitHub secrets of the same name: SLACK_SIGNING_SECRET (required; without it every request is refused) and
// SLACK_BOT_TOKEN (confirm modals). Slack reaches this function at
// …/functions/v1/ops-slack?forceFunctionRegion=eu-central-1 (slack/manifest.yml).

import { handleOpsSlack } from "./handler.ts";
import { restRpc } from "../_shared/rest-rpc.ts";
import { reportError } from "../_shared/sentry.ts";

const env = (k: string) => Deno.env.get(k) || undefined;
const log = (msg: string, fields?: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ fn: "ops-slack", msg, ...fields }));
const rpc = restRpc({
  url: env("SUPABASE_URL") ?? "",
  key: env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  log,
});
const token = env("SLACK_BOT_TOKEN");

async function openModal(triggerId: string, view: Record<string, unknown>): Promise<boolean> {
  const res = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
    signal: AbortSignal.timeout(2500),
  }).catch(() => null);
  const j = await res?.json().catch(() => null);
  return !!j?.ok;
}

Deno.serve(async (req) => {
  try {
    return await handleOpsSlack(
      {
        rpc,
        signingSecret: env("SLACK_SIGNING_SECRET") ?? null,
        openModal: token ? openModal : null,
        log,
      },
      req,
    );
  } catch (e) {
    log("ops-slack failed", { error: String(e).slice(0, 200) });
    await reportError(env("SENTRY_DSN"), e, { fn: "ops-slack" });
    return new Response("", { status: 200 });
  }
});
