// Staff and roles (OPS1, strategy 05 section A "Settings"). Admin only. Who is staff, and in which role, is decided by one SQL function,
// set_staff() (0141): it checks the admin, refuses what would lock the console, and logs every change with before and after.
// The console adds the sign-in account (Supabase Auth) and emails the link to choose a password. A blocked party is out on its next
// request: the console reads the party on every request, so there is nothing else to switch off. The email address is never logged.
import { act, html, id, render, UserError, type Ctx, type Section } from "../app";
import { form } from "../html";
import { ADMIN, STAFF_ROLES, type Role } from "../roles";

interface Row { id: string; display_name: string | null; role: string; is_blocked: boolean; is_probe: boolean; created_at: string }
const LABEL: Record<Role, string> = { admin: "Admin (everything)", ops_lead: "Ops lead (payments, cash, approvals)", picker: "Picker (stock and returns)" };

async function page(c: Ctx) {
  const rows = (await c.deps.db.rows<Row>("parties", { select: "id,display_name,role,is_blocked,is_probe,created_at", where: { role: { in: [...STAFF_ROLES] } }, order: [{ col: "created_at" }] })).filter((r) => !r.is_probe);
  const options = (sel: string) => STAFF_ROLES.map((r) => html`<option value="${r}"${r === sel ? html` selected` : ""}>${LABEL[r]}</option>`);
  return render(c, "Staff and roles", html`
<p class="muted">Staff sign in with their email and a password they choose. A blocked person is out on their next click. Every change here is logged.</p>
<h2>Add a person</h2>
${form(c.f, "/staff/add", html`<p><label>Email <input type="email" name="email" required autocomplete="off"></label>
 <label>Name <input name="name" required maxlength="80"></label>
 <label>Role <select name="role">${options("picker")}</select></label> <button>Add and send the link</button></p>`)}
<p class="muted">They get an email with a link to choose a password. If the email does not arrive (Supabase's own mail reaches few addresses until SMTP is set up), send the link from the Supabase dashboard: Authentication, Users, Send password recovery.</p>
<h2>Staff</h2>
<table><tr><th>Name</th><th>Role</th><th>Blocked</th><th></th></tr>
${rows.map((r) => html`<tr><td colspan="4">${form(c.f, `/staff/${r.id}`, html`
 <input name="name" value="${r.display_name ?? ""}" required maxlength="80" aria-label="Name">
 <select name="role" aria-label="Role">${options(r.role)}</select>
 <label><input type="checkbox" name="blocked" value="1"${r.is_blocked ? html` checked` : ""}> Blocked</label>
 <button>Save</button>`)}</td></tr>`)}</table>`);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const roleOf = (c: Ctx): Role => {
  const r = (c.form.role ?? "") as Role;
  if (!(STAFF_ROLES as readonly string[]).includes(r)) throw new UserError("Pick admin, ops lead or picker.");
  return r;
};

async function add(c: Ctx) {
  const email = (c.form.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = (c.form.name ?? "").trim().slice(0, 80);
  const role = roleOf(c);
  if (!EMAIL.test(email)) throw new UserError("Type a valid email address.");
  if (!name) throw new UserError("Write the name.");
  // The intent is logged with the name and role, never the email address.
  return act(c, "staff_add", { name, role }, async () => {
    const r = await c.deps.db.rpc<{ party_id: string }>("set_staff", { p_by: c.staff.partyId, p_party: null, p_name: name, p_role: role, p_blocked: false });
    const invited = await c.deps.auth.inviteStaff(email, r.party_id, `${c.url.origin}/auth/callback`);
    if (!invited.created) {
      // The party exists but nobody can sign in as it yet. Block it again so a half-made person is not left active, and say what to do.
      await c.deps.db.rpc("set_staff", { p_by: c.staff.partyId, p_party: r.party_id, p_name: name, p_role: role, p_blocked: true });
      throw new UserError("That email already has a sign-in account. Link it with the console workflow (action add-staff); nothing was added here.");
    }
    return invited.mailed ? `${name} added. An email with a link to choose a password was sent.`
      : `${name} added, but the password email was not sent. Send it from the Supabase dashboard (Authentication, Users, Send password recovery).`;
  }, "/staff");
}

async function change(c: Ctx) {
  const party = id(c, "party");
  const name = (c.form.name ?? "").trim().slice(0, 80);
  const role = roleOf(c);
  const blocked = (c.form.blocked ?? "") === "1";
  return act(c, "staff_change", { party, name, role, blocked }, async () => {
    const r = await c.deps.db.rpc<{ changed: boolean; action?: string }>("set_staff", { p_by: c.staff.partyId, p_party: party, p_name: name, p_role: role, p_blocked: blocked });
    return r.changed ? `Saved (${r.action}).` : "Nothing changed.";
  }, "/staff");
}

export const staffSection: Section = {
  nav: { href: "/staff", label: "Staff and roles", roles: ADMIN },
  routes: [
    { method: "GET", path: "/staff", roles: ADMIN, handler: page },
    { method: "POST", path: "/staff/add", roles: ADMIN, handler: add },
    { method: "POST", path: "/staff/:party", roles: ADMIN, handler: change },
  ],
};
