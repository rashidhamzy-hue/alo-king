// Supabase Auth (GoTrue), called from the Worker only. The browser never sees a Supabase key or token:
// it talks to the console, and the console talks to Supabase with the service key.
//
// A staff member is an Auth user whose app_metadata.party_id names a party with role admin, ops_lead or picker.
// app_metadata can only be written with the service key (users cannot edit it), so the link cannot be forged from a browser.
// Staff are added by the `console` workflow (add-staff), never from the console itself.
export interface AuthUser { id: string; email: string | null; partyId: string | null }

export interface StaffAuth {
  /** Email and password. null when they do not match (the reason is not told to the browser). */
  signIn(email: string, password: string): Promise<AuthUser | null>;
  /** The user behind an access token from an emailed link (password recovery or invitation). */
  userFromToken(accessToken: string): Promise<AuthUser | null>;
  setPassword(userId: string, password: string): Promise<void>;
}

export class AuthUnavailable extends Error {}

type GoTrueUser = { id: string; email?: string | null; app_metadata?: { party_id?: string } | null; banned_until?: string | null };
const toUser = (u: GoTrueUser): AuthUser => ({ id: u.id, email: u.email ?? null, partyId: u.app_metadata?.party_id ?? null });

export function goTrue(opts: { url: string; key: string; fetchImpl?: typeof fetch }): StaffAuth {
  const f = opts.fetchImpl ?? fetch;
  const base = `${opts.url}/auth/v1`;
  const headers = (bearer = opts.key) => ({ apikey: opts.key, authorization: `Bearer ${bearer}`, "content-type": "application/json" });
  return {
    async signIn(email, password) {
      const res = await f(`${base}/token?grant_type=password`, { method: "POST", headers: headers(), body: JSON.stringify({ email, password }) });
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) return null;   // wrong pair, banned, unconfirmed
      if (!res.ok) throw new AuthUnavailable(`auth_${res.status}`);
      const body = (await res.json()) as { user?: GoTrueUser };
      return body.user ? toUser(body.user) : null;
    },
    async userFromToken(token) {
      const res = await f(`${base}/user`, { headers: headers(token) });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new AuthUnavailable(`auth_${res.status}`);
      return toUser((await res.json()) as GoTrueUser);
    },
    async setPassword(userId, password) {
      const res = await f(`${base}/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", headers: headers(), body: JSON.stringify({ password }) });
      if (!res.ok) throw new AuthUnavailable(`auth_${res.status}`);
    },
  };
}

export const MIN_PASSWORD = 12;
