/**
 * Only supervisors and above may read the edit history, so the signed-in
 * user's role is re-checked on the server for every request.
 */
import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "@/lib/external-supabase-config";

const SUPERVISOR_ROLES = new Set(["admin", "owner", "manager", "supervisor"]);

/** Who is behind an access token, for attribution in the edit history. */
export async function describeAccessToken(
  accessToken: string,
): Promise<{ id: string | null; name: string | null; role: string | null }> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { id: null, name: null, role: null };
  const user = (await res.json()) as { id?: string; email?: string };
  if (!user.id) return { id: null, name: null, role: null };
  const rows = await serviceRest(
    `app_users?auth_user_id=eq.${encodeURIComponent(user.id)}&select=user_id,full_name,role,role_slug&limit=1`,
  );
  const list = rows.ok
    ? ((await rows.json()) as {
        user_id?: string;
        full_name?: string;
        role?: string;
        role_slug?: string | null;
      }[])
    : [];
  const row = list[0];
  return {
    id: row?.user_id ?? user.id,
    name: row?.full_name ?? user.email ?? null,
    role: row?.role_slug ?? row?.role ?? null,
  };
}

export async function verifySupervisorToken(accessToken: string): Promise<boolean> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return false;
  const user = (await res.json()) as { id?: string };
  if (!user.id) return false;
  const rows = await serviceRest(
    `app_users?auth_user_id=eq.${encodeURIComponent(user.id)}&select=role,role_slug,is_active`,
  );
  if (!rows.ok) return false;
  const list = (await rows.json()) as {
    role?: string;
    role_slug?: string | null;
    is_active?: boolean;
  }[];
  return list.some(
    (r) =>
      r.is_active !== false &&
      (SUPERVISOR_ROLES.has(String(r.role ?? "")) ||
        SUPERVISOR_ROLES.has(String(r.role_slug ?? ""))),
  );
}

/** Destructive operational cleanup is reserved for an active administrator. */
export async function verifyAdminToken(accessToken: string): Promise<boolean> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return false;
  const user = (await res.json()) as { id?: string };
  if (!user.id) return false;
  const rows = await serviceRest(
    `app_users?auth_user_id=eq.${encodeURIComponent(user.id)}&select=role,role_slug,is_active`,
  );
  if (!rows.ok) return false;
  const list = (await rows.json()) as {
    role?: string;
    role_slug?: string | null;
    is_active?: boolean;
  }[];
  return list.some((row) => {
    const role = String(row.role_slug ?? row.role ?? "");
    return row.is_active !== false && (role === "admin" || role === "owner");
  });
}
