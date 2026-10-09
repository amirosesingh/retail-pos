import { effectivePagePermissions } from "@/lib/permission-pages";
/**
 * Fast path for working out a caller's branch and permissions.
 *
 * A staff access token already carries everything the relay needs in its
 * signed claims, so the common case costs no database round-trip. The claims
 * are only ever read *after* the token itself has been proven against the
 * auth server, so nothing here is trusted on its own.
 */
export type CallerClaims = {
  storeId: string | null;
  role: string | null;
  roleSlug: string | null;
  staffUserId: string | null;
  actorName: string | null;
  permissions: Record<string, boolean> | null;
};

export function normalisePermissions(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = value === true || value === "true";
  }
  return effectivePagePermissions(out);
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Read the interesting fields out of an already-verified token payload. */
export function claimsFromPayload(payload: unknown): CallerClaims | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const meta = {
    ...((p["app_metadata"] as Record<string, unknown> | undefined) ?? {}),
    ...((p["user_metadata"] as Record<string, unknown> | undefined) ?? {}),
  };
  const pick = (key: string) => str(p[key]) ?? str(meta[key]);
  const storeId = pick("store_id") ?? pick("branch_id");
  const role = pick("role") ?? pick("app_role");
  const roleSlug = pick("role_slug");
  const permissions = p["permissions"] ?? meta["permissions"];
  if (!storeId && !role && !permissions) return null;
  return {
    storeId,
    role,
    roleSlug,
    staffUserId: pick("user_id") ?? pick("staff_user_id"),
    actorName: pick("full_name") ?? pick("name") ?? pick("email"),
    permissions: permissions ? normalisePermissions(permissions) : null,
  };
}

/** Decode (never verify) a JWT body. Only used on tokens the auth server accepted. */
export function claimsFromJwt(token: string): CallerClaims | null {
  const body = token.split(".")[1];
  if (!body) return null;
  try {
    const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return claimsFromPayload(JSON.parse(json));
  } catch {
    return null;
  }
}