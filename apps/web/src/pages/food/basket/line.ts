// WEB4b: a food basket line's count changed (one less, one more, 0 takes it out), or the whole food basket emptied. A form post, no script;
// back to the basket. Only the cookie changes: the basket is read again from the database on the next view.
import { basketCookie, basketOf, setQty } from "../../../lib/food-basket";
import { seeOther } from "../../../lib/order";
import { sameOrigin } from "../../../lib/session";

export async function POST({ request, url }: { request: Request; url: URL }): Promise<Response> {
  if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const form = await request.formData();
  const basket = basketOf(request.headers.get("cookie"));
  if (form.get("do") === "clear" || !basket) return seeOther("/food/basket", basketCookie(null));
  const next = setQty(basket, Number(form.get("i")), Number(form.get("qty")));
  return seeOther("/food/basket", basketCookie(next.lines.length ? next : null));
}
export const GET = () => seeOther("/food/basket");
