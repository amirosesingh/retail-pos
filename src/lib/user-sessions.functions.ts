/**
 * Session lifecycle for every client (web, Windows, Android):
 * start on sign-in, end on sign-out, list for admins, revoke remotely.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type DeviceSession = {
  id: string;
  kind: string;
  label: string | null;
  staff_user_id: string | null;
  branch_id: string | null;
  branch_name?: string | null;
  terminal_id: string | null;
  terminal_name?: string | null;
  platform: string | null;
  idle_timeout_minutes: number;
  last_activity_at: string;
  is_revoked: boolean;
  created_at: string;
};

const proof = {
  cashierToken: z.string().max(2000).optional(),
  accessToken: z.string().max(4000).optional(),
  terminalToken: z.string().max(200).optional(),
};

const startSchema = z.object({
  ...proof,
  kind: z.enum(["staff", "cashier", "terminal"]).default("staff"),
  label: z.string().max(120).optional(),
  staffUserId: z.string().max(120).optional(),
  cashierId: z.string().max(64).optional(),
  branchId: z.string().max(64).optional(),
  terminalId: z.string().max(64).optional(),
  platform: z.string().max(40).optional(),
});

/** Mint a session record for a caller that has already proved itself. */
export const startDeviceSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => startSchema.parse(input))
  .handler(async ({ data }) => {
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    const { startSession } = await import("./session-guard.server");
    try {
      await verifyRelayCaller({
        ...(data.cashierToken ? { cashierToken: data.cashierToken } : {}),
        ...(data.accessToken ? { accessToken: data.accessToken } : {}),
        ...(data.terminalToken ? { terminalToken: data.terminalToken } : {}),
      });
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }

    try {
      const { token, idleMinutes } = await startSession({
        kind: data.kind,
        label: data.label ?? null,
        staffUserId: data.staffUserId ?? null,
        cashierId: data.cashierId ?? null,
        branchId: data.branchId ?? null,
        terminalId: data.terminalId ?? null,
        platform: data.platform ?? null,
      });
      return { ok: true as const, token, idleMinutes };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Sign out: the record stops proving anything immediately. */
export const endDeviceSession = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ sessionToken: z.string().max(400) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { revokeSession } = await import("./session-guard.server");
    await revokeSession(data.sessionToken);
    return { ok: true as const };
  });

async function assertSupervisor(accessToken: string): Promise<void> {
  const { supabaseConfig } = await import("./external-supabase-config");
  const res = await fetch(`${supabaseConfig().url}/rest/v1/rpc/is_app_supervisor`, {
    method: "POST",
    headers: {
      apikey: supabaseConfig().key,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok || (await res.json()) !== true)
    throw new Error("Only administrators can manage active terminals.");
}

/** Everything currently signed in, newest activity first. */
export const listDeviceSessions = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ accessToken: z.string().max(4000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    try {
      await assertSupervisor(data.accessToken);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, sessions: [] as DeviceSession[] };
    }
    const res = await serviceRest(
      "user_sessions?select=id,kind,label,staff_user_id,branch_id,terminal_id,platform," +
        "idle_timeout_minutes,last_activity_at,is_revoked,created_at" +
        "&order=last_activity_at.desc&limit=200",
    );
    if (!res.ok)
      return { ok: false as const, error: "Could not read sessions", sessions: [] as DeviceSession[] };
    const sessions = (await res.json()) as DeviceSession[];
    const [storesRes, terminalsRes] = await Promise.all([
      serviceRest("stores?select=id,name"),
      serviceRest("terminal_tokens?select=id,device_name"),
    ]);
    const stores = storesRes.ok
      ? new Map(((await storesRes.json()) as { id: string; name: string }[]).map((row) => [row.id, row.name]))
      : new Map<string, string>();
    const terminals = terminalsRes.ok
      ? new Map(((await terminalsRes.json()) as { id: string; device_name: string }[]).map((row) => [row.id, row.device_name]))
      : new Map<string, string>();
    return {
      ok: true as const,
      error: "",
      sessions: sessions.map((session) => ({
        ...session,
        branch_name: session.branch_id ? (stores.get(session.branch_id) ?? null) : null,
        terminal_name: session.terminal_id ? (terminals.get(session.terminal_id) ?? null) : null,
      })),
    };
  });

/** Remote reset: end one session, or everything on a terminal or branch. */
export const revokeDeviceSessions = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        accessToken: z.string().max(4000),
        sessionId: z.string().max(64).optional(),
        terminalId: z.string().max(64).optional(),
        branchId: z.string().max(64).optional(),
        reason: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const { revokeSessionsFor } = await import("./session-guard.server");
    try {
      await assertSupervisor(data.accessToken);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, revoked: 0 };
    }

    const reason = data.reason ?? "remote reset";
    let revoked = 0;
    if (data.sessionId) {
      const res = await serviceRest(
        `user_sessions?id=eq.${encodeURIComponent(data.sessionId)}&is_revoked=eq.false`,
        {
          method: "PATCH",
          prefer: "return=representation",
          body: JSON.stringify({
            is_revoked: true,
            revoked_at: new Date().toISOString(),
            revoked_reason: reason,
          }),
        },
      );
      if (res.ok) revoked += ((await res.json()) as unknown[]).length;
    }
    if (data.terminalId || data.branchId) {
      revoked += await revokeSessionsFor(
        {
          ...(data.terminalId ? { terminalId: data.terminalId } : {}),
          ...(data.branchId ? { branchId: data.branchId } : {}),
        },
        reason,
      );
    }
    return { ok: true as const, revoked };
  });
