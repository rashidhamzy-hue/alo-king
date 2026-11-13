// Cloudflare Worker entry for the staff console (docs/DECISIONS.md: hosted on Cloudflare next to the gateway).
import { createClient } from "@supabase/supabase-js";
import { send } from "@ak/wa/gateway";
import { handle, type Deps } from "./app";
import { supabaseDb } from "./db";
import { goTrue } from "./auth";
import { supabaseMedia } from "./media";
import { registry } from "./pages";

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
};
