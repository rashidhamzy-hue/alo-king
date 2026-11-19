// WEB4a: "Use my location". The phone's position comes once, from a tap (site.js asks the phone only then, never on page load), and is
// turned into a village by the database (web_locate_village: locate_pin, the checkout's rule). Nothing is stored and nothing is logged: the
// village's id goes in the `ak_village` cookie, and the position is forgotten with this request. Between two villages, the visitor picks one
// (/village?near=...); outside the area, /village says so.
import { sameOrigin } from "../../lib/session";
import { seeOther } from "../../lib/order";
import { backTo, villageCookie } from "../../lib/frame";

export async function POST({ request, locals, url }: { request: Request; locals: App.Locals; url: URL }): Promise<Response> {
  if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const form = await request.formData();
  const back = backTo(String(form.get("back") ?? ""), false);
  const lat = Number(form.get("lat")), lng = Number(form.get("lng"));
  const page = (q: string) => `/village?${q}&back=${encodeURIComponent(back)}`;
  if (!form.get("lat") || !form.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng)) return seeOther(page("failed=1"));
  try {
    const r = await locals.catalog().locateVillage(lat, lng);
    if (!r.ok) return seeOther(page("failed=1"));
    if (r.status === "located" && r.village?.served) {
      return seeOther(backTo(back, true), villageCookie(r.village.village_id));
    }
    if (r.choices.length > 0) return seeOther(page(`near=${r.choices.map((c) => c.village_id).join(",")}`));
    return seeOther(page("outside=1"));
  } catch {
    return seeOther(page("failed=1"));
  }
}
