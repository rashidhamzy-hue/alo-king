// WEB2: the basket's "Your village": kept in a cookie (no personal data: one of the served villages), so the basket can show that village's
// delivery fee from the database. The checkout's pin decides the real village and fee.
import { sameOrigin } from "../../lib/session";
import { seeOther } from "../../lib/order";

export async function POST({ request, url }: { request: Request; url: URL }): Promise<Response> {
  if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const v = String((await request.formData()).get("village") ?? "");
  const ok = /^[0-9a-f-]{36}$/.test(v);
  return seeOther("/cart", ok ? `ak_village=${v}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax; Secure; HttpOnly` : "ak_village=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly");
}
