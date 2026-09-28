/**
 * Server side of the session system.
 *
 * Every privileged call arrives with a raw token. We fingerprint it, find the
 * matching row in `user_sessions`, and only continue when the row is live and
 * has been used within its idle limit. A stale or revoked row is marked
 * revoked and the caller is refused with 401.
 */
import { hashSessionToken, mintSessionToken } from "./session-token.server";
import { serviceRest } from "@/core/api/pos-relay.server";

export type SessionRow = {
  id: string;
  staff_user_id: string | null;
  user_id: string | null;
  kind: string;
  label: string | null;
  branch_id: string | null;
  terminal_id: string | null;
  idle_timeout_minutes: number;
  last_activity_at: string;
  is_revoked: boolean;
};

export type SessionCheck =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: "unknown" | "revoked" | "idle" | "unavailable" };

const DEFAULT_IDLE_MINUTES = 30;

const one = <T>(rows: unknown): T | null =>
  Array.isArray(rows) && rows.length ? (rows[0] as T) : null;

/**
 * How long this person may sit idle: their own override first, then the
 * branch's rule, then the global default.
 */
export async function resolveIdleMinutes(input: {
  staffUserId?: string | null;
  cashierId?: string | null;
  branchId?: string | null;
}): Promise<number> {
  const clamp = (n: unknown): number | null => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(1440, Math.round(v)) : null;
  };

  try {
    // Cashiers are app_users now. The legacy cashiers table never owned this
    // column, and probing it produced a guaranteed 400 on every PIN login.
    if (input.staffUserId) {
      const res = await serviceRest(
        `app_users?user_id=eq.${encodeURIComponent(input.staffUserId)}&select=idle_timeout_minutes&limit=1`,
      );
      if (res.ok) {
        const row = one<{ idle_timeout_minutes: number | null }>(await res.json());
        const own = clamp(row?.idle_timeout_minutes);
        if (own) return own;
      }
    }

    const scopes = [input.branchId?.trim() || "", ""].filter((v, i, a) => a.indexOf(v) === i);
    for (const scope of scopes) {
      const res = await serviceRest(
        `pos_store_settings?store_id=eq.${encodeURIComponent(scope)}&select=idle_timeout_minutes&limit=1`,
      );
      if (!res.ok) continue;
      const row = one<{ idle_timeout_minutes: number | null }>(await res.json());
      const value = clamp(row?.idle_timeout_minutes);
      if (value) return value;
    }
  } catch {
    /* fall through to the shipped default */
  }
  return DEFAULT_IDLE_MINUTES;
}

/** Create a session and return the raw token — the only time it exists. */
export async function startSession(input: {
  kind: "staff" | "cashier" | "terminal";
  label?: string | null;
  userId?: string | null;
  staffUserId?: string | null;
  cashierId?: string | null;
  branchId?: string | null;
  terminalId?: string | null;
  platform?: string | null;
}): Promise<{ token: string; idleMinutes: number }> {
  const token = mintSessionToken();
  const idleMinutes = await resolveIdleMinutes({
    ...(input.staffUserId ? { staffUserId: input.staffUserId } : {}),
    ...(input.cashierId ? { cashierId: input.cashierId } : {}),
    ...(input.branchId ? { branchId: input.branchId } : {}),
  });

  const res = await serviceRest("user_sessions", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([
      {
        session_token_hash: hashSessionToken(token),
        kind: input.kind,
        label: input.label ?? null,
        user_id: input.userId ?? null,
        staff_user_id: input.staffUserId ?? null,
        branch_id: input.branchId ?? null,
        terminal_id: input.terminalId ?? null,
        platform: input.platform ?? null,
        idle_timeout_minutes: idleMinutes,
        last_activity_at: new Date().toISOString(),
      },
    ]),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || "Could not start the session");
  return { token, idleMinutes };
}

async function markRevoked(hash: string, reason: string): Promise<void> {
  await serviceRest(`user_sessions?session_token_hash=eq.${encodeURIComponent(hash)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({
      is_revoked: true,
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    }),
  }).catch(() => undefined);
}

/**
 * Validate a raw token. Only a separately identified human/operator action may
 * stamp it as active; background reads, sync, polling and token validation must
 * not extend an abandoned session.
 */
export async function touchSession(
  raw: string | undefined | null,
  options: { operatorActivity?: boolean } = {},
): Promise<SessionCheck> {
  if (!raw?.trim()) return { ok: false, reason: "unknown" };
  const hash = hashSessionToken(raw);

  let res: Response;
  try {
    res = await serviceRest(
      `user_sessions?session_token_hash=eq.${encodeURIComponent(hash)}&select=*&limit=1`,
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" };

  const row = one<SessionRow>(await res.json());
  if (!row) return { ok: false, reason: "unknown" };
  if (row.is_revoked) return { ok: false, reason: "revoked" };

  const limit = Math.max(1, Number(row.idle_timeout_minutes) || DEFAULT_IDLE_MINUTES);
  const idleMs = Date.now() - new Date(row.last_activity_at).getTime();
  if (Number.isFinite(idleMs) && idleMs > limit * 60_000) {
    await markRevoked(hash, "idle timeout");
    return { ok: false, reason: "idle" };
  }

  if (options.operatorActivity) {
    await serviceRest(`user_sessions?session_token_hash=eq.${encodeURIComponent(hash)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ last_activity_at: new Date().toISOString() }),
    }).catch(() => undefined);
  }

  return { ok: true, session: row };
}

/** Sign-out: the row stops proving anything at once. */
export async function revokeSession(raw: string): Promise<void> {
  if (!raw?.trim()) return;
  await markRevoked(hashSessionToken(raw), "signed out");
}

/** Remote reset / branch removal. */
export async function revokeSessionsFor(
  scope: { branchId?: string | null; terminalId?: string | null },
  reason: string,
): Promise<number> {
  const filters: string[] = [];
  if (scope.branchId) filters.push(`branch_id=eq.${encodeURIComponent(scope.branchId)}`);
  if (scope.terminalId) filters.push(`terminal_id=eq.${encodeURIComponent(scope.terminalId)}`);
  if (!filters.length) return 0;

  const res = await serviceRest(`user_sessions?${filters.join("&")}&is_revoked=eq.false`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({
      is_revoked: true,
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    }),
  });
  if (!res.ok) return 0;
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}
