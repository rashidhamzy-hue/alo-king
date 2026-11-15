// Supabase Auth (GoTrue), called from the Worker only. The browser never sees a Supabase key or token:
// it talks to the console, and the console talks to Supabase with the service key.
//
// A staff member is an Auth user whose app_metadata.party_id names a party with role admin, ops_lead or picker.
// app_metadata can only be written with the service key (users cannot edit it), so the link cannot be forged from a browser.
// Staff are added from the console's Staff page (OPS1: set_staff() decides who is staff, this makes the sign-in) or by the
// `console` workflow (add-staff), which also links an account that already exists.
export interface AuthUser { id: string; email: string | null; partyId: string | null }

export interface StaffAuth {
  /** Email and password. null when they do not match (the reason is not told to the browser). */
  signIn(email: string, password: string): Promise<AuthUser | null>;
  /** The user behind an access token from an emailed link (password recovery or invitation). */
  userFromToken(accessToken: string): Promise<AuthUser | null>;
  setPassword(userId: string, password: string): Promise<void>;
  /** OPS1: makes the sign-in account for a staff party (app_metadata.party_id) and emails the link to choose a password.
   *  "exists": an account with that email is already there (link it with the console workflow's add-staff); nothing was changed. */
  inviteStaff(email: string, partyId: string, redirectTo: string): Promise<{ created: boolean; mailed: boolean }>;
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
    async inviteStaff(email, partyId, redirectTo) {
      const made = await f(`${base}/admin/users`, { method: "POST", headers: headers(), body: JSON.stringify({ email, email_confirm: true, app_metadata: { party_id: partyId } }) });
      if (made.status === 422 || made.status === 409) return { created: false, mailed: false };         // email_exists
      if (!made.ok) throw new AuthUnavailable(`auth_${made.status}`);
      // Supabase's built-in mail reaches few addresses (docs/HANDOFF.md, Console); a refusal here is not an error: the account exists.
      const mail = await f(`${base}/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", headers: headers(), body: JSON.stringify({ email }) }).catch(() => null);
      return { created: true, mailed: !!mail?.ok };
    },
  };
}

export const MIN_PASSWORD = 12;
