/** Sign-in authority never grants settings, action or cross-branch authority. */
export function managementDeviceAllowed(person: {
  role?: string | null; roleSlug?: string | null;
  permissions?: Record<string, unknown> | null;
}, mobile: boolean) {
  if (person.role === "admin" || person.roleSlug === "admin") return true;
  const flag = mobile ? "can_use_management_mobile" : "can_use_management_pc";
  const value = person.permissions?.[flag];
  if (value !== undefined) return value === true;
  // Preserve access for existing supervisors whose record predates this flag.
  return person.role === "manager" || person.roleSlug === "supervisor";
}
