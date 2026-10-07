import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex, verifySignature } from "../_shared/webhook-signature.ts";
import { makeHandler, MAX_BODY_BYTES, type IntakeResult } from "./handler.ts";
import { eventsFromDelivery, type IntakeEvent } from "./intake.ts";

const SECRET = "test-secret-not-real";
const enc = new TextEncoder();

const received = {
  message: { id: "wamid.123", type: "text", text: { body: "badde shawarma" } },
  conversation: { id: "conv_1", phone_number: "+96170000001", phone_number_id: "555" },
  is_new_conversation: true,
  phone_number_id: "555",
};

async function signedRequest(
  body: string,
  headers: Record<string, string> = {},
  secret = SECRET,
): Promise<Request> {
  const sig = await hmacSha256Hex(secret, enc.encode(body));
  return new Request("https://example.test/functions/v1/whatsapp-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": sig,
      "x-webhook-event": "whatsapp.message.received",
      ...headers,
    },
    body,
  });
}

function fakeStore() {
  const seen = new Map<string, number>();
  const calls: IntakeEvent[][] = [];
  const intake = vi.fn(async (events: IntakeEvent[]): Promise<IntakeResult[]> => {
    calls.push(events);
    return events.map((e) => {
      const dup = seen.has(e.event_key);
      if (!dup) seen.set(e.event_key, seen.size + 1);
      return { event_key: e.event_key, event_id: seen.get(e.event_key)!, duplicate: dup };
    });
  });
  return { intake, calls };
}

describe("verifySignature", () => {
  const body = enc.encode('{"a":1}');

  it("accepts the HMAC of the raw body, with or without a sha256= prefix and in any case", async () => {
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await verifySignature(SECRET, body, sig)).toEqual({ ok: true });
    expect(await verifySignature(SECRET, body, `sha256=${sig.toUpperCase()}`)).toEqual({
      ok: true,
    });
  });

  it("fails closed without a secret", async () => {
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await verifySignature(undefined, body, sig)).toEqual({ ok: false, reason: "no_secret" });
    expect(await verifySignature("", body, sig)).toEqual({ ok: false, reason: "no_secret" });
  });

  it("rejects missing, malformed, wrong-secret and altered-body signatures", async () => {
    const sig = await hmacSha256Hex(SECRET, body);
    expect(await verifySignature(SECRET, body, null)).toMatchObject({ reason: "missing" });
    expect(await verifySignature(SECRET, body, "abc")).toMatchObject({ reason: "malformed" });
    expect(await verifySignature(SECRET, body, sig.slice(0, 63) + "g")).toMatchObject({
      reason: "malformed",
    });
    expect(
      await verifySignature(SECRET, body, await hmacSha256Hex("other-secret", body)),
    ).toMatchObject({ reason: "mismatch" });
    expect(await verifySignature(SECRET, enc.encode('{"a":2}'), sig)).toMatchObject({
      reason: "mismatch",
    });
  });
});

describe("eventsFromDelivery", () => {
  const h = { event: "whatsapp.message.received", batch: null, idempotencyKey: null };

  it("keys a message event by type and WhatsApp message id", () => {
    const [e] = eventsFromDelivery(received, h, "hash");
    expect(e).toMatchObject({
      event_key: "whatsapp.message.received:wamid.123",
      event_type: "whatsapp.message.received",
      phone_number_id: "555",
    });
  });

  it("keeps sent, delivered and read of one message as separate events", () => {
    const keys = ["sent", "delivered", "read"].map(
      (s) =>
        eventsFromDelivery(
          { message: { id: "wamid.9" } },
          { ...h, event: `whatsapp.message.${s}` },
          "x",
        )[0]!.event_key,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("falls back to the idempotency header, then to the body hash", () => {
    const noMsg = { phone_number_id: "555", conversation: { id: "c" } };
    expect(
      eventsFromDelivery(
        noMsg,
        { ...h, event: "whatsapp.conversation.ended", idempotencyKey: "k1" },
        "hh",
      )[0]!.event_key,
    ).toBe("whatsapp.conversation.ended:idem:k1");
    expect(
      eventsFromDelivery(noMsg, { ...h, event: "whatsapp.conversation.ended" }, "hh")[0]!.event_key,
    ).toBe("whatsapp.conversation.ended:sha256:hh");
  });

  it("splits a batch into one event per item", () => {
    const body = {
      data: [
        { message: { id: "wamid.a" }, phone_number_id: "555" },
        { message: { id: "wamid.b" } },
      ],
      phone_number_id: "555",
    };
    const events = eventsFromDelivery(body, { ...h, batch: "true" }, "hh");
    expect(events.map((e) => e.event_key)).toEqual([
      "whatsapp.message.received:wamid.a",
      "whatsapp.message.received:wamid.b",
    ]);
    expect(events[1]!.phone_number_id).toBe("555");
  });

  it("stores a batch of unknown shape whole instead of dropping it", () => {
    const events = eventsFromDelivery({ something: "else" }, { ...h, batch: "true" }, "hh");
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("whatsapp.message.received.batch_unparsed");
    expect(events[0]!.payload).toEqual({ something: "else" });
  });

  it("never takes an odd event type from the payload", () => {
    const [e] = eventsFromDelivery({ event: "drop table; --" }, { ...h, event: null }, "hh");
    expect(e!.event_type).toBe("unknown");
  });
});

describe("makeHandler", () => {
  it("accepts a signed delivery and returns 200", async () => {
    const store = fakeStore();
    const res = await makeHandler({ secret: SECRET, intake: store.intake })(
      await signedRequest(JSON.stringify(received)),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(store.calls[0]![0]!.event_key).toBe("whatsapp.message.received:wamid.123");
  });

  it("reports a retried delivery as a duplicate and still returns 200", async () => {
    const store = fakeStore();
    const handler = makeHandler({ secret: SECRET, intake: store.intake });
    await handler(await signedRequest(JSON.stringify(received)));
    const res = await handler(await signedRequest(JSON.stringify(received)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("rejects bad signatures with 401 without touching the store", async () => {
    const store = fakeStore();
    const handler = makeHandler({ secret: SECRET, intake: store.intake });
    const wrong = await signedRequest(JSON.stringify(received), {}, "attacker-secret");
    expect((await handler(wrong)).status).toBe(401);
    const unsigned = new Request("https://example.test/", { method: "POST", body: "{}" });
    expect((await handler(unsigned)).status).toBe(401);
    expect(store.intake).not.toHaveBeenCalled();
  });

  it("refuses everything with 503 when the secret is not configured", async () => {
    const store = fakeStore();
    const res = await makeHandler({ secret: undefined, intake: store.intake })(
      await signedRequest(JSON.stringify(received)),
    );
    expect(res.status).toBe(503);
    expect(store.intake).not.toHaveBeenCalled();
  });

  it("returns 405 for other methods, 400 for signed non-JSON, 413 for huge bodies", async () => {
    const store = fakeStore();
    const handler = makeHandler({ secret: SECRET, intake: store.intake });
    expect((await handler(new Request("https://example.test/", { method: "GET" }))).status).toBe(
      405,
    );
    expect((await handler(await signedRequest("not json"))).status).toBe(400);
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect((await handler(await signedRequest(big))).status).toBe(413);
    expect(store.intake).not.toHaveBeenCalled();
  });

  it("returns 500 when the database is unavailable so Kapso retries", async () => {
    const res = await makeHandler({
      secret: SECRET,
      intake: async () => {
        throw new Error("webhook_intake returned 503");
      },
    })(await signedRequest(JSON.stringify(received)));
    expect(res.status).toBe(500);
  });

  it("never logs the body, phone numbers, the signature or the secret", async () => {
    const lines: string[] = [];
    const log = (msg: string, fields?: Record<string, unknown>) =>
      lines.push(JSON.stringify({ msg, ...fields }));
    const store = fakeStore();
    const handler = makeHandler({ secret: SECRET, intake: store.intake, log });
    const req = await signedRequest(JSON.stringify(received));
    const sig = req.headers.get("x-webhook-signature")!;
    await handler(req);
    await handler(await signedRequest(JSON.stringify(received), {}, "attacker-secret"));
    const all = lines.join("\n");
    for (const secretish of [SECRET, sig, "+96170000001", "badde shawarma", "wamid.123"]) {
      expect(all).not.toContain(secretish);
    }
  });
});
