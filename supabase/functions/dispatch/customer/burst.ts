// Five messages in a row get one reply (CUSTOMER-EXPERIENCE §3.1 #6). A customer's typed message waits until
// inbound_debounce_ms (dated config, 2 s) after their latest one; then one of the waiting messages leads and answers all of
// them in one turn (the database decides under a per-customer lock: customer_burst). Taps, pins, voice notes and photos never
// wait. Dependencies are injected; tests run without a database.

import { deterministicIntent } from "./intents.ts";
import type { CustomerInbound } from "./turn.ts";

export type Burst =
  /** Answer it as it is. */
  | { kind: "single" }
  /** It leads: these texts, oldest first, are answered in one turn. */
  | { kind: "burst"; texts: string[] }
  /** Another message of the burst answers it: nothing to do. */
  | { kind: "folded" }
  /** The customer is still typing: put it back on the queue for this long. */
  | { kind: "wait"; seconds: number };

/** Asks the database what to do with one claimed customer message. Anything unexpected answers the message alone. */
export async function inboundBurst(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>,
  eventId: unknown,
  m: CustomerInbound,
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void,
): Promise<Burst> {
  const id = Number(eventId);
  if (m.type !== "text" || !m.text || !Number.isSafeInteger(id) || id <= 0)
    return { kind: "single" };
  // STOP and deletion never wait for the rest of a burst: they are answered at once (the texts still waiting lead their
  // own burst).
  const urgent = deterministicIntent(m.text)?.kind;
  if (urgent === "stop" || urgent === "delete_data" || urgent === "forget_history")
    return { kind: "single" };
  const r = await rpc("customer_burst", { p_event_id: id }).catch((e: unknown) => {
    log?.("customer_burst failed", { error: String(e).slice(0, 120) });
    return null;
  });
  switch (r?.status) {
    case "folded":
      return { kind: "folded" };
    case "wait": {
      const s = Number(r.wait_s);
      return Number.isFinite(s) && s > 0
        ? { kind: "wait", seconds: Math.min(s, 30) }
        : { kind: "single" };
    }
    case "burst": {
      const texts = (Array.isArray(r.texts) ? r.texts : []).filter(
        (t: unknown): t is string => typeof t === "string" && t.trim().length > 0,
      );
      return texts.length > 1 ? { kind: "burst", texts } : { kind: "single" };
    }
    default:
      return { kind: "single" };
  }
}

/** The leader's message carrying the whole burst: `text` joins the texts (at most 2000 characters), `burst` keeps them. */
export function withBurst(m: CustomerInbound, texts: string[]): CustomerInbound {
  return { ...m, text: texts.join("\n").slice(0, 2000), burst: texts.map((t) => t.slice(0, 2000)) };
}
