// WEB2: the header's basket count, for the one small script (catalog pages are cached for everyone, so they cannot print it). Never cached.
import { tokenOf } from "../../lib/session";
import { ordering } from "../../lib/order";

export async function GET({ request, locals }: { request: Request; locals: App.Locals }): Promise<Response> {
  const token = tokenOf(request.headers.get("cookie"));
  let n = 0;
  try { if (token) n = await ordering(locals.env).cartCount(token); } catch { n = 0; }
  return new Response(JSON.stringify({ n }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
