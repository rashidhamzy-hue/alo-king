// Cloudflare Worker entry for the staff console (docs/DECISIONS.md: hosted on Cloudflare next to the gateway).
import { createClient } from "@supabase/supabase-js";
import { send } from "@ak/wa/gateway";
import { handle, type Deps } from "./app";
import { supabaseDb } from "./db";
import { goTrue } from "./auth";
import { supabaseMedia } from "./media";
import { labelReader } from "./label";
import { registry } from "./pages";
import { sendDayClose } from "./pages/dayclose";
import { pushConfigured, pushNewExceptions } from "./push";

/** The cron that checks for new high-priority exceptions to push (wrangler.jsonc); the other cron is the day-close report. */
export const PUSH_CRON = "*/2 * * * *";

export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  CONSOLE_SESSION_SECRET: string;
  KAPSO_BASE_URL: string;
  KAPSO_API_KEY: string;
  PHONE_NUMBER_ID_CUSTOMER: string;
  PHONE_NUMBER_ID_OPS: string;
  /** Optional (5.15): the label reader. Without it, intake is typed by hand. */
  ANTHROPIC_API_KEY?: string;
  MODEL_FAST?: string;
  /** Web push (D5): the VAPID key pair and a contact (`mailto:` or `https:`), as Worker secrets. Absent, push is off and nothing else changes. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export function depsFor(env: Env): Deps {
  if (!env.CONSOLE_SESSION_SECRET || env.CONSOLE_SESSION_SECRET.length < 32) throw new Error("CONSOLE_SESSION_SECRET missing or short");
  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const opts = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY };
  return {
    db: supabaseDb(supa, opts),
    auth: goTrue(opts),
    media: supabaseMedia(opts),
    send: (req) => send(supa, env, req),
    secret: env.CONSOLE_SESSION_SECRET,
    environment: env.ENVIRONMENT || "development",
    supabaseUrl: env.SUPABASE_URL,
    now: () => new Date(),
    ...(pushConfigured(env) ? { pushPublicKey: env.VAPID_PUBLIC_KEY! } : {}),
    ...(env.ANTHROPIC_API_KEY ? { readLabel: labelReader({ apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL_FAST || "claude-haiku-5-5" }), labelModel: env.MODEL_FAST || "claude-haiku-5-5" } : {}),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let deps: Deps;
    try { deps = depsFor(env); }
    catch (e) {
      console.error(JSON.stringify({ level: "error", event: "console_misconfigured", err: String(e).slice(0, 200) }));
      return new Response("console not configured", { status: 503 });
    }
    return handle(req, deps, registry);
  },
  // 3.11: the day-close report to the founder, nightly (the cron in wrangler.jsonc). One message per admin per day, keyed in the outbox.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === PUSH_CRON) {
      // D5: a phone alert for each new high-priority exception, once. An extra: the WhatsApp ops alert is not touched.
      ctx.waitUntil((async () => {
        try {
          const run = await pushNewExceptions(depsFor(env).db, env, new Date());
          if (run.claimed || run.failed || run.skipped === undefined) console.log(JSON.stringify({ level: "info", event: "push_run", ...run }));
        } catch (e) { console.error(JSON.stringify({ level: "error", event: "push_run_failed", err: String(e).slice(0, 300) })); }
      })());
      return;
    }
    ctx.waitUntil((async () => {
      try {
        const out = await sendDayClose(depsFor(env));
        console.log(JSON.stringify({ level: "info", event: "day_close_sent", sent: out.filter((o) => o.result.ok).length, of: out.length,
          refused: out.filter((o) => !o.result.ok).map((o) => (o.result as { refused: string }).refused) }));
      } catch (e) {
        console.error(JSON.stringify({ level: "error", event: "day_close_send_failed", err: String(e).slice(0, 300) }));
      }
    })());
  },
};
