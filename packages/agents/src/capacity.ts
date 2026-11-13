// Model capacity (build plan 1.15). When the model is overloaded, rate limited or unreachable, the customer hears one fixed
// "one moment", the call is retried with backoff, and if it still fails a person takes over. The customer is never left in silence.
import type { ModelClient } from "./concierge";

/** Overloaded (529), rate limited (429), server errors, timeouts and dropped connections. Not a bad request: that is our bug. */
export function isCapacityError(err: unknown): boolean {
  const e = err as { status?: number; name?: string; message?: string } | null;
  if (!e) return false;
  if (typeof e.status === "number") return e.status === 408 || e.status === 429 || e.status === 529 || (e.status >= 500 && e.status <= 504);
  return /APIConnection(Timeout)?Error|overloaded|rate.?limit|ECONNRESET|ETIMEDOUT|timed? ?out/i.test(`${e.name ?? ""} ${e.message ?? ""}`);
}

export class ModelUnavailable extends Error {
  constructor(public readonly cause: unknown) { super(`MODEL_UNAVAILABLE ${String(cause).slice(0, 200)}`); this.name = "ModelUnavailable"; }
}

export interface CapacityOptions {
  /** Waits between attempts, in ms. The default gives four attempts over about twenty seconds. */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** Called once, on the first capacity failure of the turn: send the fixed "one moment". */
  onFirstFailure: () => Promise<unknown>;
}
export const DEFAULT_BACKOFF_MS = [2_000, 5_000, 12_000];

/** Wraps the model client: capacity failures are retried with backoff; after the last one, ModelUnavailable is thrown. */
export function withCapacityFallback(client: ModelClient, opts: CapacityOptions): ModelClient {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let warned = false;
  return { messages: { create: async (body) => {
    for (let attempt = 0; ; attempt++) {
      try { return await client.messages.create(body); }
      catch (err) {
        if (!isCapacityError(err)) throw err;
        if (!warned) { warned = true; await opts.onFirstFailure(); }
        if (attempt >= backoff.length) throw new ModelUnavailable(err);
        await sleep(backoff[attempt]!);
      }
    }
  } } };
}
