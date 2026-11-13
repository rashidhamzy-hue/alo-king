// Staff roles are `parties.role` values (0001). The console reads them on every request; the SQL functions check them again.
export type Role = "admin" | "ops_lead" | "picker";
export const STAFF_ROLES: readonly Role[] = ["admin", "ops_lead", "picker"];
/** Payment, cash and approval decisions: the ops lead or the admin (invariant 4). */
export const LEADS: readonly Role[] = ["admin", "ops_lead"];
export const ALL: readonly Role[] = STAFF_ROLES;
export const ADMIN: readonly Role[] = ["admin"];
