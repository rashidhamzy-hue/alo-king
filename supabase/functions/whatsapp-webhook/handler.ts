// Phase one of the WhatsApp webhook (DECISIONS §4): verify, dedupe, persist, enqueue, return 200.
// No business logic and no model call here; consumers process the queue later.
// Dependencies are injected so the handler is tested without a network or a database.

import { sha256Hex, verifySignature } from "../_shared/webhook-signature.ts";
import { eventsFromDelivery, type IntakeEvent } from "./intake.ts";

export type IntakeResult = { event_key: string; event_id: number; duplicate: boolean };

export type HandlerDeps = {
  /** Kapso webhook secret; when missing every request is refused (fail closed). */
  secret: string | undefined;
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

export function makeHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? (() => {});
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: "body too large" });
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) return json(413, { error: "body too large" });

    const check = await verifySignature(deps.secret, raw, req.headers.get("x-webhook-signature"));
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
