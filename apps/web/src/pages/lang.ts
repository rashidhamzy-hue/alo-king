// "Change language": a plain link (no JavaScript). Sets the preference cookie and goes back to the page the visitor was on.
import { isLang } from "../lib/i18n";

/** Only a path on this site: never another host, never a protocol-relative address. */
export const safeNext = (v: string | null): string => (v && /^\/(?![/\\])/.test(v) && !/[\r\n]/.test(v) ? v : "/");

export function GET({ url }: { url: URL }): Response {
  const set = url.searchParams.get("set");
  const headers = new Headers({ Location: safeNext(url.searchParams.get("next")), "Cache-Control": "no-store" });
  if (isLang(set)) headers.append("Set-Cookie", `lang=${set}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
  return new Response(null, { status: 303, headers });
}
