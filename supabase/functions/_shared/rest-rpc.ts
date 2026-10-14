// PostgREST RPC client for the edge functions, with a deadline on every request (session E, issue #139).
//
// Why: on staging about 1 in 2,000 requests from an edge function to /rest/v1 stalls for 20-100 s between the
// function and the API gateway, while PostgREST and Postgres answer it in milliseconds (edge logs: origin time
// 20-100 s, upstream time 30-60 ms; no other client is affected). A fetch without a deadline then holds the
// dispatch worker until the 150 s wall clock kills it, nothing is logged, and the queue only retries the
// event after its 90 s visibility timeout.
//
// Each attempt now has a deadline. A stalled call to a function that is read-only (declared stable or
// immutable) or idempotent is retried once on a new request; any other function is never sent twice
// from here (it may already have run): the caller gets an RpcStalled error, the inbound event fails, and
// the queue replays it within seconds (webhook_finish). scripts/function-contract.test.ts keeps RETRY_SAFE
// honest against the migrations.

/** The turn is still held by another attempt (#139): the event fails and the queue tries again shortly. */
export class TurnBusy extends Error {
  constructor(readonly messageId: string) {
    super(`turn ${messageId} is still running in another attempt`);
    this.name = "TurnBusy";
  }
}

export class RpcStalled extends Error {
  constructor(
    readonly fn: string,
    readonly ms: number,
  ) {
    super(`${fn}: no answer within ${ms} ms (request stalled)`);
    this.name = "RpcStalled";
  }
}

/** Declared `stable` or `immutable` in the migrations: retrying cannot change anything. */
export const RETRY_SAFE_READS = new Set([
  "basket_fulfilment_options",
  "basket_substitution_needed",
  "claims_for_phone",
  "config_value",
  "dispatch_secret_ok",
  "menu_item_options",
  "menu_item_vendor",
  "merchant_member_for",
  "merchant_members_by_phone",
  "onboarding_session_get",
  "order_brief",
  "order_call_card",
  "order_card_image",
  "test_side_get",
  "vendor_menu",
  "vendor_search_unclaimed",
  "vendor_sections",
  "whatsapp_sender",
]);

/**
 * Writes that leave the same state when repeated with the same arguments (an upsert to a value, a setter, a
 * keyed outbox insert, a finish that only moves forward).
 */
export const RETRY_SAFE_WRITES = new Set([
  "app_reply", // outbox key = ref + payload hash: a repeat is the same row
  "basket_cash_state", // normalises the cash currency to the same value each time
  "basket_set_cash_currency",
  "basket_set_checkout",
  "basket_set_substitution",
  "customer_turn_end", // overwrites the session with the same value
  "customer_turn_release", // gives the turn's lease back
  "order_place", // idempotency key wa:<basket>:<menu version>: a repeat returns the same order
  "whatsapp_seen", // upsert of "now"
  "webhook_finish", // takes the attempt it finishes: a late repeat never touches a later attempt
]);

export const retrySafe = (fn: string) => RETRY_SAFE_READS.has(fn) || RETRY_SAFE_WRITES.has(fn);

export type RpcClientOptions = {
  url: string;
  key: string;
  /** Per attempt; a healthy call takes under 0.5 s (p99 280 ms on staging). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;

export function restRpc(o: RpcClientOptions): Rpc {
  const timeoutMs = o.timeoutMs ?? 8000;
  const doFetch = o.fetch ?? fetch;
  const once = async (fn: string, args: Record<string, unknown>) => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new RpcStalled(fn, timeoutMs));
      }, timeoutMs);
    });
    try {
      // The deadline covers the whole exchange (headers and body), not only the connection.
      return await Promise.race([
        (async () => {
          const res = await doFetch(`${o.url}/rest/v1/rpc/${fn}`, {
            method: "POST",
            headers: {
              apikey: o.key,
              authorization: `Bearer ${o.key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(args),
            signal: ctl.signal,
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 300)}`);
          return text ? JSON.parse(text) : null;
        })(),
        deadline,
      ]);
    } catch (e) {
      // An abort or a dropped connection is a stall; an HTTP error from PostgREST is an answer.
      if (e instanceof RpcStalled) throw e;
      if (e instanceof Error && /^[a-z_0-9]+: \d{3} /.test(e.message)) throw e;
      throw new RpcStalled(fn, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  };
  return async (fn, args) => {
    try {
      return await once(fn, args);
    } catch (e) {
      if (!(e instanceof RpcStalled)) throw e;
      o.log?.("rpc stalled", { fn, ms: timeoutMs, retry: retrySafe(fn) });
      if (!retrySafe(fn)) throw e;
      return await once(fn, args);
    }
  };
}
