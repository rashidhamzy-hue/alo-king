// A tiny PostgREST client for public pages. It keeps supabase-js (64 KB gzipped) out of the public bundle (§37.5) and
// uses only the anon key: public data only, through the site_* functions and public tables.
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

const TIMEOUT_MS = 5000;

/** Calls a Postgres function. Returns null on any failure: a public page degrades, it never throws a 500. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
