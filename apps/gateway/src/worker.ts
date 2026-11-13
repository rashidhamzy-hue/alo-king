// The Worker's entry point (wrangler.jsonc "main"). It wraps the gateway in Sentry and changes nothing about how it behaves.
// apps/gateway/src/index.ts stays the gateway; this file only adds error tracking around it (build plan 0.8), so the two
// sessions that edit index.ts never collide with it. Without SENTRY_DSN (production until 4.2, local dev, tests) Sentry sends nothing.
import * as Sentry from "@sentry/cloudflare";
import gateway, { ConversationDO as GatewayDO, type Env } from "./index";
import { scrubEvent } from "./observability";

type WorkerEnv = Env & { SENTRY_DSN?: string; ENVIRONMENT?: string };

const options = (env: WorkerEnv): Sentry.CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  environment: env.ENVIRONMENT ?? "unknown",
  tracesSampleRate: 0,                         // errors and failed cron runs only; the free tier is for errors
  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (b) => (b.category === "fetch" || b.category === "console" ? null : b),   // URLs and log lines can carry numbers and text
});

let testEvents = 0;
const handler = {
  ...gateway,
  async fetch(req: Request, env: WorkerEnv, ctx: ExecutionContext) {
    // Staging only, at most three per Worker instance: lets the deploy prove an error reaches Sentry. Production has no such route.
    if (env.ENVIRONMENT === "staging" && new URL(req.url).pathname === "/__sentry-test" && req.method === "GET") {
      if (testEvents++ < 3) Sentry.captureException(new Error("sentry smoke test from the staging deploy"));
      return new Response("sent");
    }
    return gateway.fetch(req, env, ctx);
  },
} as unknown as ExportedHandler<WorkerEnv>;   // the gateway's queue handler is typed with its own message shape

export default Sentry.withSentry(options, handler);
// The class itself is unchanged; the cast only bridges two copies of the DurableObject type (workers-types and cloudflare:workers).
export const ConversationDO = Sentry.instrumentDurableObjectWithSentry(options, GatewayDO as unknown as Parameters<typeof Sentry.instrumentDurableObjectWithSentry>[1]);
