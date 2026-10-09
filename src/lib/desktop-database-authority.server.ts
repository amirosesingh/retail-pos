import { effectivePagePermissions } from "./permission-pages";
import { serviceRest } from "@/core/api/pos-relay.server";

type Account = {
  user_id: string;
  auth_user_id?: string | null;
  role: string | null;
  role_slug: string | null;
  permissions: Record<string, unknown> | null;
  store_id: string | null;
  is_active: boolean;
};

/** Re-read the staff row for a privileged desktop unlock. Signed claims may be stale. */
export async function databaseAuthority(identity: {
  userId?: string | null;
  authUserId?: string | null;
  email?: string | null;
}): Promise<{
  subject: string;
  level: "admin" | "supervisor" | "staff";
  permissions: Record<string, boolean>;
  branchId: string | null;
} | null> {
  const filters = [
    identity.authUserId && `auth_user_id=eq.${encodeURIComponent(identity.authUserId)}`,
    identity.userId && `user_id=eq.${encodeURIComponent(identity.userId)}`,
    identity.email && `email=eq.${encodeURIComponent(identity.email)}`,
  ].filter((value): value is string => Boolean(value));
  let account: Account | undefined;
  for (const filter of filters) {
    const response = await serviceRest(
      `app_users?${filter}&select=user_id,role,role_slug,permissions,store_id,is_active&limit=1`,
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as Account[];
    account = rows[0];
    if (account) break;
  }
  if (!account?.is_active) return null;
  const admin = account.role === "admin" || account.role_slug === "admin";
  const supervisor = account.role === "manager" || account.role_slug === "supervisor";
  const permissions: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(account.permissions ?? {})) {
    if (typeof value === "boolean") permissions[key] = value;
  }
  // The application-wide permission resolver always grants the complete
  // preset to an administrator. Keep the desktop gate on that same source of
  // truth instead of allowing a stale per-user false to create a second role.
  if (admin) permissions.can_manage_sync_backup = true;
  return {
    subject: account.user_id,
    level: admin ? "admin" : supervisor ? "supervisor" : "staff",
    permissions: effectivePagePermissions(permissions),
    branchId: account.store_id,
  };
}
