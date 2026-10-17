import { rolePermissions, type StaffPermissions, type StaffRole } from "./permissions";

/** Start from the saved built-in role preset, falling back only if it is absent. */
export function roleStartingPermissions(roles: readonly { slug: string; permissions: StaffPermissions }[], base: StaffRole): StaffPermissions {
  return { ...(roles.find(role => role.slug === base)?.permissions ?? rolePermissions(base)) };
}
