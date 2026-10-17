import { FULL_PERMISSIONS, normalizePermissions } from "./permissions";

/** Use the verified PIN identity's saved matrix, including explicit denials. */
export function terminalUserPermissions(identity: {
  role: string;
  roleSlug?: string | null;
  permissions?: Record<string, unknown> | null;
}) {
  if (identity.role === "admin" || identity.roleSlug === "admin") return FULL_PERMISSIONS;
  const supervisor = identity.role === "manager" || identity.roleSlug === "supervisor";
  return normalizePermissions(identity.permissions ?? {}, supervisor ? "supervisor" : "cashier");
}
