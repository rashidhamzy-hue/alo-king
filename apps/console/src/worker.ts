// Cloudflare Worker entry for the staff console (docs/DECISIONS.md: hosted on Cloudflare next to the gateway).
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/cloudflare";
import { scrubEvent } from "@ak/core/scrub";
import { send } from "@ak/wa/gateway";
import { handle, type Deps } from "./app";
import { supabaseDb } from "./db";
import { goTrue } from "./auth";
import { supabaseMedia } from "./media";
import { screensStore } from "../../../scripts/screens/storage.mjs";
import { labelReader } from "./label";
import { registry } from "./pages";
import { sendDayClose } from "./pages/dayclose";
import { runTemperatureCheck } from "./temperature-check";
import { pushConfigured, pushNewExceptions, pushTestAlert } from "./push";
import { anthropicModel } from "./assistant/run";
import { githubReader, sentryReader } from "./assistant/tools";
import { writeDigest } from "./assistant/digest";

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
  /** OPS1: Sentry. A public client key (a Worker variable, not a secret). Absent (production until A3, local, tests), nothing is sent. */
  SENTRY_DSN?: string;
  /**
   * CON1: Today's "errors in the last 24 hours". A Sentry auth token with the read-only scopes `event:read` and `org:read` (a Worker secret),
   * and the organisation and its region's API (Worker variables). Absent, Today says Sentry is not connected; nothing else changes.
   */
  SENTRY_READ_TOKEN?: string;
  SENTRY_ORG?: string;
  SENTRY_API?: string;
  /** AST1: failed GitHub Actions runs for the assistant. A read-only token (Worker secret, scope actions:read) and the repository (a variable). */
  GITHUB_READ_TOKEN?: string;
  GITHUB_REPO?: string;
}

/** CON1: the count of error events in the last 24 hours (this environment), read from Sentry's events API; null if Sentry did not answer in 4 s. */
export function sentryErrors(env: Pick<Env, "SENTRY_READ_TOKEN" | "SENTRY_ORG" | "SENTRY_API" | "ENVIRONMENT">, fetcher: typeof fetch = fetch) {
  const org = env.SENTRY_ORG ?? "";
  if (!env.SENTRY_READ_TOKEN || !/^[a-z0-9-]{1,60}$/.test(org)) return undefined;
  const api = /^https:\/\/[a-z0-9.-]+\.sentry\.io$/.test(env.SENTRY_API ?? "") ? env.SENTRY_API! : "https://de.sentry.io";
  const query = `event.type:error${env.ENVIRONMENT ? ` environment:${env.ENVIRONMENT}` : ""}`;
  const link = `https://${org}.sentry.io/issues/?statsPeriod=24h&query=${encodeURIComponent(env.ENVIRONMENT ? `environment:${env.ENVIRONMENT}` : "")}`;
  return async (): Promise<{ count: number; link: string } | null> => {
    try {
      const u = `${api}/api/0/organizations/${org}/events/?field=count()&dataset=errors&statsPeriod=24h&query=${encodeURIComponent(query)}`;
      const r = await fetcher(u, { headers: { authorization: `Bearer ${env.SENTRY_READ_TOKEN}` }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const body = (await r.json()) as { data?: Record<string, unknown>[] };
      const n = Number(body.data?.[0]?.["count()"]);
      return Number.isFinite(n) ? { count: n, link } : null;
    } catch { return null; }
  };
}

// OPS1: errors and failed runs to Sentry, scrubbed like the gateway's (packages/core/src/scrub.ts). Tagged service=console so they are told
// apart from the gateway's in the shared staging project. No traces; the free tier is for errors.
const sentryOptions = (env: Env): Sentry.CloudflareOptions => ({
  dsn: env.SENTRY_DSN, environment: env.ENVIRONMENT ?? "unknown", tracesSampleRate: 0,
  initialScope: { tags: { service: "console" } },
  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (b) => (b.category === "fetch" || b.category === "console" ? null : b),
});
let testCheckIns = 0;
const DEPLOY_MONITOR = { schedule: { type: "interval" as const, value: 1, unit: "year" as const }, checkinMargin: 1440, maxRuntime: 5, timezone: "UTC" };

export function depsFor(env: Env): Deps {
  if (!env.CONSOLE_SESSION_SECRET || env.CONSOLE_SESSION_SECRET.length < 32) throw new Error("CONSOLE_SESSION_SECRET missing or short");
  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const opts = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY };
  const db = supabaseDb(supa, opts);
  return {
    db,
    auth: goTrue(opts),
    media: supabaseMedia(opts),
    screens: screensStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY }),
    send: (req) => send(supa, env, req),
    secret: env.CONSOLE_SESSION_SECRET,
    environment: env.ENVIRONMENT || "development",
    supabaseUrl: env.SUPABASE_URL,
    now: () => new Date(),
    ...(sentryErrors(env) ? { errorsLast24h: sentryErrors(env)! } : {}),
    // AST1: the assistant (its model, and its two outside reads, each only with a read-only token)
    ...(env.ANTHROPIC_API_KEY ? { assistantModel: anthropicModel(env.ANTHROPIC_API_KEY) } : {}),
    ...(sentryReader(env) ? { assistantSentry: sentryReader(env)! } : {}),
    ...(githubReader(env, () => new Date()) ? { assistantGithub: githubReader(env, () => new Date())! } : {}),
    ...(pushConfigured(env) ? { pushPublicKey: env.VAPID_PUBLIC_KEY!, pushTest: (partyId: string) => pushTestAlert(db, env, partyId, new Date()) } : {}),
    ...(env.ANTHROPIC_API_KEY ? { readLabel: labelReader({ apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL_FAST || "claude-haiku-5-5" }), labelModel: env.MODEL_FAST || "claude-haiku-5-5" } : {}),
  };
}

const handler = {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Staging only, at most three per Worker instance: lets the deploy prove the console reaches Sentry. A check-in to its own monitor, not an
    // error, so it opens no issue (the A4 rule, as in the gateway).
    if (env.ENVIRONMENT === "staging" && new URL(req.url).pathname === "/__sentry-test" && req.method === "GET") {
      if (testCheckIns++ >= 3) return new Response("sent (limit reached for this instance)");
      const id = Sentry.captureCheckIn({ monitorSlug: "deploy-smoke-console-staging", status: "ok" }, DEPLOY_MONITOR);
      const flushed = await Sentry.flush(3000);
      return new Response(`sent ${id} flushed=${flushed}`);
    }
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
        // WH1a: a temperature reading time that passed with no reading becomes an alert first, so this run pushes it (0240).
        try { await runTemperatureCheck(depsFor(env).db); }
        catch (e) { Sentry.captureException(e, { tags: { where: "temperature_log_check" } }); console.error(JSON.stringify({ level: "error", event: "temperature_check_failed", err: String(e).slice(0, 300) })); }
        try {
          const run = await pushNewExceptions(depsFor(env).db, env, new Date());
          if (run.claimed || run.failed || run.skipped === undefined) console.log(JSON.stringify({ level: "info", event: "push_run", ...run }));
        } catch (e) { Sentry.captureException(e, { tags: { where: "push_run" } }); console.error(JSON.stringify({ level: "error", event: "push_run_failed", err: String(e).slice(0, 300) })); }
      })());
      return;
    }
    // AST1: the nightly digest, with the day close's cron. Written to a table only (nothing is sent); only while the assistant is on and under its caps.
    if (env.ANTHROPIC_API_KEY) ctx.waitUntil((async () => {
      try {
        const deps = depsFor(env);
        const r = await writeDigest(deps.db, deps.assistantModel!, new Date());
        console.log(JSON.stringify({ level: "info", event: "assistant_digest", ...r }));
      } catch (e) {
        Sentry.captureException(e, { tags: { where: "assistant_digest" } });
        console.error(JSON.stringify({ level: "error", event: "assistant_digest_failed", err: String(e).slice(0, 300) }));
      }
    })());
    ctx.waitUntil((async () => {
      try {
        const out = await sendDayClose(depsFor(env));
        console.log(JSON.stringify({ level: "info", event: "day_close_sent", sent: out.filter((o) => o.result.ok).length, of: out.length,
          refused: out.filter((o) => !o.result.ok).map((o) => (o.result as { refused: string }).refused) }));
      } catch (e) {
        Sentry.captureException(e, { tags: { where: "day_close" } });
        console.error(JSON.stringify({ level: "error", event: "day_close_send_failed", err: String(e).slice(0, 300) }));
      }
    })());
  },
} as unknown as ExportedHandler<Env>;

export default Sentry.withSentry(sentryOptions, handler);
