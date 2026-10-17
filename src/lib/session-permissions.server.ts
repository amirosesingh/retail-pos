import { serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";
import type { CallerProof } from "./privileged-caller.server";
import type { AppRole } from "./pos-auth";

export async function readSessionPermissionsServer(proof: CallerProof) {
  try {
    const caller = await verifyRelayCaller(proof);
    const filter = caller.authUserId
      ? `auth_user_id=eq.${encodeURIComponent(caller.authUserId)}`
      : caller.kind !== "terminal" && caller.staffUserId
        ? `user_id=eq.${encodeURIComponent(caller.staffUserId)}` : null;
    if (!filter) return { status: "unavailable" as const };
    const response = await serviceRest(`app_users?${filter}&select=user_id,full_name,email,role,role_slug,store_id,permissions,is_active&limit=1`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { status: "unavailable" as const };
    const [profile] = await response.json() as {
      user_id: string; full_name: string; email: string; role: AppRole;
      role_slug: string | null; store_id: string | null;
      permissions: Record<string, boolean> | null; is_active: boolean;
    }[];
    // Missing provisioned rows must not eject an offline bootstrap operator.
    if (!profile) return { status: "unavailable" as const };
    if (!profile.is_active) return { status: "revoked" as const };
    if (caller.storeId && profile.store_id && caller.storeId.toLowerCase() !== profile.store_id.toLowerCase())
      return { status: "branch_changed" as const };
    return { status: "ok" as const, profile };
  } catch {
    // A failed network or verification request cannot destroy an offline login.
    return { status: "unavailable" as const };
  }
}
