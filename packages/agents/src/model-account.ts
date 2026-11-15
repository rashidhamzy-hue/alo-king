// A refusal from the model provider that is about our ACCOUNT, not about one message: a usage limit, a spent balance, a bad or revoked key.
// Every customer turn fails until a person acts, so it must wake someone (OPS1, 0140). On 15 November 2026 the provider answered
// 400 "You have reached your specified API usage limits ... 2026-12-01" and it was treated like any other error: a hand-off, no alert.
//
// Not about the account, and never classified here: overload (529), ordinary rate limits (429), 5xx, timeouts (those are capacity,
// see capacity.ts: they clear by themselves), and a 400 that means our request was wrong (that is our bug and stays one).
import type { ModelClient } from "./concierge";

export type ModelAccountReason = "usage_limit" | "billing" | "invalid_key";

const USAGE = /usage limits?|spend(ing)? limit|monthly (spend|usage)|reached your (specified |workspace |organization'?s? )?(api )?(usage|spend)/i;
const BILLING = /credit balance|billing|payment required|purchase credits|plans & billing/i;
const KEY = /invalid x-api-key|invalid api key|api key.{0,40}(invalid|revoked|disabled|expired|does not have permission)|authentication_error|permission_error|organization (has been )?disabled|account (has been )?disabled/i;

export function modelAccountReason(err: unknown): ModelAccountReason | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : undefined;
  const text = typeof e.message === "string" ? e.message : "";
  if (status === 402) return "billing";
  if (status === 401) return "invalid_key";
  if (status === 403) return KEY.test(text) || text === "" ? "invalid_key" : USAGE.test(text) ? "usage_limit" : BILLING.test(text) ? "billing" : "invalid_key";
  // The usage limit arrived as a 400 on 15 November, so the words decide. Never on a server error, and never an ordinary rate limit.
  if (status !== undefined && (status >= 500 || status === 408 || status === 404 || status === 413 || status === 529)) return null;
  if (status !== undefined && status !== 400 && status !== 429) return null;
  if (USAGE.test(text)) return "usage_limit";
  if (BILLING.test(text)) return "billing";
  if (status === 400 && KEY.test(text)) return "invalid_key";
  return null;
}

/** What goes into the alert: the provider's own words (they carry the date access returns), with any key removed. */
export function scrub(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").replace(/\s+/g, " ").slice(0, 300);
}

/** Thrown in place of the provider's error once the refusal has been reported. The cause stays attached. */
export class ModelAccountRefused extends Error {
  constructor(public readonly reason: ModelAccountReason, public readonly cause: unknown) {
    super(`MODEL_ACCOUNT_REFUSED ${reason}`);
    this.name = "ModelAccountRefused";
  }
}

const WRAPPED = Symbol.for("alo-king.accountAlarm");

/**
 * Wraps the raw model client, inside the capacity wrapper (which would otherwise see the error first and call it a bug of ours).
 * On an account refusal it reports (the Worker raises the exception) and throws ModelAccountRefused. Reporting never throws and
 * never delays the caller past `reportMs`: the customer's hand-off must not wait for the alarm. Every other error passes through.
 */
export function withAccountAlarm(client: ModelClient, report: (reason: ModelAccountReason, message: string) => Promise<unknown>, reportMs = 4000): ModelClient {
  if ((client as unknown as Record<symbol, unknown>)[WRAPPED]) return client;      // wrapped once, at the door the client came in by: a refusal is counted once
  const wrapped: ModelClient = { messages: { create: async (body) => {
    try { return await client.messages.create(body); }
    catch (err) {
      const reason = modelAccountReason(err);
      if (!reason) throw err;
      const message = scrub(String((err as { message?: unknown }).message ?? err));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.resolve().then(() => report(reason, message)).catch(() => undefined),
        new Promise((r) => { timer = setTimeout(r, reportMs); }),
      ]);
      clearTimeout(timer);
      throw new ModelAccountRefused(reason, err);
    }
  } } };
  (wrapped as unknown as Record<symbol, unknown>)[WRAPPED] = true;
  return wrapped;
}
