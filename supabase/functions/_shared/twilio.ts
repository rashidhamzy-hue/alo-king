// Automated cellular call for layer 3 of the escalation (DECISIONS §13, §23): an Arabic voice reads the
// order; press 1 to accept, 2 to reject, 3 to repeat. Twilio Programmable Voice, switched on only when the
// account exists and `voice_calls_enabled` is true (the per-minute price to Lebanese mobiles is checked
// first, §13). Pure helpers plus a thin REST call; Web Crypto only, so it runs in Deno and Node.

import type { OrderCardData } from "./merchant-cards.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What the voice says: no customer data, only the order code, the item count and the total. */
export function callScript(card: Pick<OrderCardData, "code" | "items" | "total_usd">): string {
  const items = card.items.reduce((n, i) => n + i.quantity, 0);
  const code = card.code.split("").join(" ");
  return (
    `طلب جديد من ألو كينغ. رقم الطلب ${code}. ${items} أصناف. المجموع ${Number(card.total_usd).toFixed(2)} دولار. ` +
    "للقبول اكبس واحد. للرفض اكبس اتنين. للإعادة اكبس تلاتة. التفاصيل على واتساب."
  );
}

export function gatherTwiml(script: string, actionUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" timeout="8" action="${esc(actionUrl)}" method="POST">` +
    `<Say language="ar-XA">${esc(script)}</Say></Gather><Say language="ar-XA">${esc("ما وصلنا جواب. رح نتصل مرة تانية إذا لزم.")}</Say></Response>`
  );
}

export function sayTwiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ar-XA">${esc(text)}</Say></Response>`;
}

/**
 * Twilio's request signature: base64(HMAC-SHA1(auth token, full URL + each POST param name and value,
 * sorted by name)). Compared in constant time.
 */
export async function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function verifyTwilio(
  authToken: string | undefined,
  url: string,
  params: Record<string, string>,
  header: string | null,
): Promise<boolean> {
  if (!authToken || !header) return false;
  const want = await twilioSignature(authToken, url, params);
  if (want.length !== header.length) return false;
  let diff = 0;
  for (let k = 0; k < want.length; k++) diff |= want.charCodeAt(k) ^ header.charCodeAt(k);
  return diff === 0;
}

export type TwilioConfig = { accountSid: string; authToken: string; from: string };

/** Starts the call. The TwiML is inline, so Twilio only calls us back for the keypress. */
export async function placeCall(
  cfg: TwilioConfig,
  to: string,
  twiml: string,
  fetchFn: typeof fetch = fetch,
) {
  const res = await fetchFn(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: cfg.from, Twiml: twiml, Timeout: "25" }).toString(),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true as const, id: String(body.sid ?? "") };
  return {
    ok: false as const,
    retry: res.status >= 500,
    error: `twilio ${res.status} ${String(body.message ?? "").slice(0, 120)}`,
  };
}
