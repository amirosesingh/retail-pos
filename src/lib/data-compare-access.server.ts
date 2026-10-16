/**
 * Who may read the server/shop comparison, and for which branch.
 *
 * Counts are still company data, so the caller must be a signed-in staff
 * account or an active cashier session. Everyone is pinned to their own
 * branch; only an admin may ask about a different one.
 */
export type CompareCaller =
  | { ok: false; error: string; storeId: null }
  | { ok: true; storeId: string | null; isAdmin: boolean };

async function branchOf(column: "user_id" | "id", value: string) {
  const { serviceRest } = await import("@/core/api/pos-relay.server");
  try {
    const res = await serviceRest(
      `app_users?select=store_id,role,is_active&${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}&limit=1`,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as
      { store_id: string | null; role: string | null; is_active: boolean | null }[] | null;
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function resolveCompareCaller(input: {
  accessToken?: string | undefined;
  cashierToken?: string | undefined;
  storeId?: string | null | undefined;
}): Promise<CompareCaller> {
  if (input.accessToken) {
    try {
      const { verifyPosStaff } = await import("./secure-settings.server");
      const staff = await verifyPosStaff(input.accessToken);
      const own = staff.storeId || null;
      if (!staff.isAdmin && !own) throw new Error("A branch scope is required");
      return {
        ok: true,
        isAdmin: staff.isAdmin,
        storeId: staff.isAdmin ? (input.storeId ?? own) : own,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Not signed in",
        storeId: null,
      };
    }
  }

  if (input.cashierToken) {
    const { verifyCashierSession } = await import("./pos-session.server");
    const session = verifyCashierSession(input.cashierToken);
    if (session) {
      const row = await branchOf("user_id", session.username);
      if (
        row?.is_active !== true ||
        !session.storeId ||
        (row.store_id && row.store_id.toLowerCase() !== session.storeId.toLowerCase())
      )
        return { ok: false, error: "Account or branch unavailable", storeId: null };
      return { ok: true, isAdmin: false, storeId: session.storeId };
    }
  }

  return { ok: false, error: "Not signed in", storeId: null };
}
