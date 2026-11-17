// WEB2: one basket line, from a form with no script: the aisle, product and search pages' "Add to basket" (add=1), the basket's own quantity
// buttons (qty) and Remove (qty=0). The database keeps the line (cart_set_line, 0130) and prices nothing here; the page shown next reads the
// price again. A post that names another origin is refused (and Astro checks the origin of every form post).
import { sameOrigin } from "../../lib/session";
import { basketCookie, commerce, safeBack, seeOther, tokenForWrite, visitorOf } from "../../lib/order";
import { t } from "../../lib/i18n";

export async function POST({ request, locals, url }: { request: Request; locals: App.Locals; url: URL }): Promise<Response> {
  if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const form = await request.formData();
  // A card's button sends "sku:price" (the price that page showed); the basket's own forms send the sku and the price apart.
  const [sku = "", shown] = String(form.get("sku") ?? "").split(":");
  const back = safeBack(String(form.get("back") ?? ""), "/cart");
  if (!/^AK-\d{1,8}$/.test(sku)) return seeOther(back);
  try {
    const v = await visitorOf(locals.env, request.headers.get("cookie"));
    const { token, setCookie } = await tokenForWrite(locals.env, v);
    const c = commerce(locals.env);
    let qty = Number(form.get("qty"));
    if (form.get("add")) {
      const now = await c.viewCart(token);
      qty = Number(now.lines?.find((l) => l.sku === sku)?.qty ?? 0) + 1;
    }
    if (!Number.isInteger(qty) || qty < 0) return seeOther(back, setCookie);
    const seen = Number(shown ?? form.get("price"));
    const cart = await c.setLine(token, sku, Math.min(qty, 99), Number.isFinite(seen) && seen > 0 ? seen : null);
    const to = form.get("add") && back !== "/cart" ? `${back}${back.includes("?") ? "&" : "?"}added=${encodeURIComponent(sku)}` : back;
    const r = seeOther(to, setCookie);
    r.headers.append("Set-Cookie", basketCookie((cart.lines ?? []).reduce((a, l) => a + Number(l.qty), 0)));
    return r;
  } catch {
    return new Response(`${t(locals.lang, "unavailable")}. ${t(locals.lang, "unavailable_text")}`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
