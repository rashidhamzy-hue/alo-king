// "I want to order from here" (LV1): one tap, a form post with no field. The place is counted as demand once per anonymous session or signed-in customer
// (web_listing_want, 0224, which calls log_demand with kind listing); a repeat counts nothing and is told the same. No contact detail is asked for or kept.
// The visitor goes back to the place with a thank-you. A post that names another origin is refused.
import { sameOrigin, withSession } from "../../../lib/session";
import { placeHref, validListingId } from "../../../lib/food";
import { t } from "../../../lib/i18n";

export async function POST({ request, params, locals, url }: { request: Request; params: { id?: string }; locals: App.Locals; url: URL }): Promise<Response> {
  const id = String(params.id ?? "");
  if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!validListingId(id)) return new Response(null, { status: 303, headers: { Location: "/food", "Cache-Control": "no-store" } });
  try {
    const { result, setCookie } = await withSession(locals.env, request.headers.get("cookie"), (token) => locals.listings().want(token, id));
    const headers = new Headers({ Location: result.ok ? `${placeHref(id)}?asked=1` : placeHref(id), "Cache-Control": "no-store" });
    if (setCookie) headers.append("Set-Cookie", setCookie);
    return new Response(null, { status: 303, headers });
  } catch {
    return new Response(`${t(locals.lang, "unavailable")}. ${t(locals.lang, "unavailable_text")}`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
