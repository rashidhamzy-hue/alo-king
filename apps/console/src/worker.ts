// Cloudflare Worker entry for the staff console (docs/DECISIONS.md: hosted on Cloudflare next to the gateway).
import { createClient } from "@supabase/supabase-js";
import { send } from "@ak/wa/gateway";
import { handle, type Deps } from "./app";
import { supabaseDb } from "./db";
import { goTrue } from "./auth";
import { supabaseMedia } from "./media";
import { registry } from "./pages";
import { sendDayClose } from "./pages/dayclose";

export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  CONSOLE_SESSION_SECRET: string;
  KAPSO_BASE_URL: string;
  KAPSO_API_KEY: string;
  PHONE_NUMBER_ID_CUSTOMER: string;
  PHONE_NUMBER_ID_OPS: string;
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
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
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
