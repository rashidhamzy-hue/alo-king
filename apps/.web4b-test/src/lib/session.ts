// The visitor's anonymous session for the two writes the Food pages make ("I want to order from here", "Remove this listing"). The cookie holds the
// token only; the database keeps its hash (0129). A visitor with no cookie, or one the database no longer knows, gets a new session: browsing needs
// none, and nothing here asks who the visitor is. WEB2's cart and sign-in use the same cookie.
import { postgrestSource, type WebEnv } from "./db";
import { webCommerce } from "@ak/commerce/index";

export const SESSION_COOKIE = "ak_session";
export const tokenOf = (cookie: string | null | undefined): string | null => /(?:^|;\s*)ak_session=([0-9a-f]{64})(?:;|$)/.exec(cookie ?? "")?.[1] ?? null;
export const sessionCookie = (token: string, expiresAt: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.max(60, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000) || 30 * 86400)}; SameSite=Lax; Secure; HttpOnly`;

/** Runs `run` with the visitor's session token, starting a session first when there is none or the database refused the one in the cookie (one retry). */
export async function withSession<T extends { ok: boolean }>(env: WebEnv, cookie: string | null, run: (token: string) => Promise<T>): Promise<{ result: T; setCookie: string | null }> {
  const commerce = webCommerce(postgrestSource(env));
  let token = tokenOf(cookie); let setCookie: string | null = null;
  const fresh = async () => { const s = await commerce.startSession("web"); token = s.token; setCookie = sessionCookie(s.token, s.expires_at); };
  if (!token) await fresh();
  let result = await run(token!);
  if (!result.ok && (result as unknown as { error?: string }).error === "no_session") { await fresh(); result = await run(token!); }
  return { result, setCookie };
}

/** A form post is accepted only from this site: a request that names another origin is refused. (The cookie is SameSite=Lax as well.) */
export const sameOrigin = (req: Request, url: URL): boolean => { const o = req.headers.get("origin"); return !o || o === url.origin; };
