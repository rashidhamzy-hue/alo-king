// Phase one of the WhatsApp webhook (DECISIONS §4): verify, dedupe, persist, enqueue, return 200.
// No business logic and no model call here; consumers process the queue later.
// Dependencies are injected so the handler is tested without a network or a database.

import { sha256Hex, verifySignature } from "../_shared/webhook-signature.ts";
import { eventsFromDelivery, type IntakeEvent } from "./intake.ts";

export type IntakeResult = { event_key: string; event_id: number; duplicate: boolean };

export type HandlerDeps = {
  /** Kapso webhook secret; when missing every request is refused (fail closed). */
  secret: string | undefined;
  /**
   * Staging simulator secret (DECISIONS §36), set only while an e2e run is in progress. A delivery signed with it is
   * accepted only when every message in it comes from a +999 test number; it can never inject a real person's message.
   */
  e2eSecret?: string | undefined;
  /** Calls the `webhook_intake` RPC. */
  intake: (events: IntakeEvent[]) => Promise<IntakeResult[]>;
  /** Redacted operational log: never bodies, phones, secrets or signatures. */
  log?: (msg: string, fields?: Record<string, string | number | boolean>) => void;
};

export const MAX_BODY_BYTES = 1_000_000;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** True when every message in the delivery (one item or a batch) comes from a +999 simulator number. */
export function onlySimNumbers(body: unknown): boolean {
  const items: unknown[] = Array.isArray(body) ? body : [body];
  if (!items.length) return false;
  return items.every((it) => {
    const o = it as {
      message?: { from?: unknown };
      conversation?: { phone_number?: unknown };
    } | null;
    const from = String(o?.conversation?.phone_number ?? o?.message?.from ?? "");
    return /^\+?999[0-9]{6,12}$/.test(from);
  });
}

export function makeHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? (() => {});
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: "body too large" });
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) return json(413, { error: "body too large" });

    const sig = req.headers.get("x-webhook-signature");
    let check = await verifySignature(deps.secret, raw, sig);
    let simOnly = false;
    if (!check.ok && deps.e2eSecret) {
      const sim = await verifySignature(deps.e2eSecret, raw, sig);
      if (sim.ok) {
        check = sim;
        simOnly = true;
      }
    }
    if (!check.ok) {
      log("webhook rejected", { reason: check.reason });
      // 503 when we are misconfigured, so the provider retries once the secret is set.
      return check.reason === "no_secret"
        ? json(503, { error: "not configured" })
        : json(401, { error: "invalid signature" });
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      log("webhook rejected", { reason: "invalid_json" });
      return json(400, { error: "invalid json" });
    }

    if (simOnly && !onlySimNumbers(body)) {
      log("webhook rejected", { reason: "e2e_secret_real_number" });
      return json(403, { error: "simulator secret is for +999 numbers only" });
    }

    const events = eventsFromDelivery(
      body,
      {
        event: req.headers.get("x-webhook-event"),
        batch: req.headers.get("x-webhook-batch"),
        idempotencyKey: req.headers.get("x-idempotency-key"),
      },
      await sha256Hex(raw),
    );

    try {
      const results = await deps.intake(events);
      const duplicates = results.filter((r) => r.duplicate).length;
      log("webhook accepted", { events: results.length, duplicates });
      return json(200, { accepted: results.length - duplicates, duplicates });
    } catch (e) {
      // Not persisted: a non-200 makes Kapso retry (10 s, 40 s, 90 s), and the dedupe key absorbs repeats.
      log("webhook intake failed", {
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      return json(500, { error: "intake failed" });
    }
  };
}
