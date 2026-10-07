// Turns one verified Kapso webhook delivery into the events `webhook_intake` stores.
// Pure: no I/O, no environment, so it runs under vitest and Deno alike.
//
// Dedupe key per event:
//   * `<event type>:<WhatsApp message id>` when the payload carries a message id. Retries of the same
//     delivery and the same status reported twice collapse; sent, delivered and read of one message stay
//     separate events.
//   * otherwise `<event type>:idem:<X-Idempotency-Key>`, else `<event type>:sha256:<body hash>`.
// Kapso's inbound buffer stays off (DECISIONS §13); if a batch arrives anyway, each item becomes an event,
// and a batch in an unknown shape is stored whole so nothing is lost.

export type IntakeEvent = {
  event_key: string;
  event_type: string;
  phone_number_id: string | null;
  payload: unknown;
};

export type DeliveryHeaders = {
  event: string | null;
  batch: string | null;
  idempotencyKey: string | null;
};

const MAX_KEY = 300;
const EVENT_TYPE = /^[a-z0-9_.-]{1,100}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function eventTypeOf(item: unknown, header: string | null): string {
  const fromBody = isObj(item) ? (str(item.event) ?? str(item.type)) : null;
  const t = header ?? fromBody ?? "unknown";
  return EVENT_TYPE.test(t) ? t : "unknown";
}

function messageIdOf(item: unknown): string | null {
  if (!isObj(item)) return null;
  if (isObj(item.message)) return str(item.message.id);
  return null;
}

function phoneNumberIdOf(item: unknown): string | null {
  if (!isObj(item)) return null;
  return (
    str(item.phone_number_id) ??
    (isObj(item.conversation) ? str(item.conversation.phone_number_id) : null)
  );
}

function clampKey(key: string): string {
  return key.length <= MAX_KEY ? key : key.slice(0, MAX_KEY);
}

function toEvent(
  item: unknown,
  eventType: string,
  fallbackKey: string,
  phoneFallback: string | null,
): IntakeEvent {
  const messageId = messageIdOf(item);
  return {
    event_key: clampKey(messageId ? `${eventType}:${messageId}` : `${eventType}:${fallbackKey}`),
    event_type: eventType,
    phone_number_id: phoneNumberIdOf(item) ?? phoneFallback,
    payload: item,
  };
}

/** `bodyHash` is the hex SHA-256 of the raw body, computed by the caller. */
export function eventsFromDelivery(
  body: unknown,
  headers: DeliveryHeaders,
  bodyHash: string,
): IntakeEvent[] {
  const fallback = headers.idempotencyKey ? `idem:${headers.idempotencyKey}` : `sha256:${bodyHash}`;
  const isBatch = headers.batch?.toLowerCase() === "true" || Array.isArray(body);

  if (!isBatch) {
    return [toEvent(body, eventTypeOf(body, headers.event), fallback, null)];
  }

  const items = Array.isArray(body)
    ? body
    : isObj(body) && Array.isArray(body.data)
      ? body.data
      : isObj(body) && Array.isArray(body.events)
        ? body.events
        : null;
  const batchType = eventTypeOf(isObj(body) ? body : null, headers.event);
  if (!items || items.length === 0 || items.length > 100) {
    return [
      {
        event_key: clampKey(`${batchType}.batch_unparsed:sha256:${bodyHash}`),
        event_type: `${batchType}.batch_unparsed`.slice(0, 100),
        phone_number_id: phoneNumberIdOf(body),
        payload: body,
      },
    ];
  }
  const phoneFallback = phoneNumberIdOf(body);
  return items.map((item, i) =>
    toEvent(item, eventTypeOf(item, headers.event), `sha256:${bodyHash}:${i}`, phoneFallback),
  );
}
