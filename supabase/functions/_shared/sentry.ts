// Minimal Sentry reporter for edge functions (project alo-king-functions). Sends one error event through
// the envelope endpoint when SENTRY_DSN is set; never sends request bodies, phones or message text, only
// the error message (clipped) and tags. Does nothing without a DSN.

export async function reportError(
  dsn: string | undefined,
  err: unknown,
  tags: Record<string, string> = {},
  fetchFn: typeof fetch = fetch,
) {
  const parsed = parseDsn(dsn);
  if (!parsed) return false;
  const message = (err instanceof Error ? err.message : String(err))
    .replace(/\+?\d{8,15}/g, "<phone>")
    .slice(0, 500);
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    tags,
    exception: { values: [{ type: err instanceof Error ? err.name : "Error", value: message }] },
  };
  const body = `${JSON.stringify({ event_id: eventId, dsn })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  try {
    const res = await fetchFn(`https://${parsed.host}/api/${parsed.project}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=alo-king-edge/1.0`,
      },
      body,
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

export function parseDsn(
  dsn: string | undefined,
): { key: string; host: string; project: string } | null {
  const m = dsn?.match(/^https:\/\/([0-9a-f]+)@([a-z0-9.-]+)\/(\d+)$/i);
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}
