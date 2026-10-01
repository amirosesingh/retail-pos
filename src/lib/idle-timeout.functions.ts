/**
 * Idle session limits: one default per branch (falling back to the global
 * rule) plus optional per-person overrides.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function rpc(accessToken: string, name: string, args: Record<string, unknown>) {
  const { supabaseConfig } = await import("./external-supabase-config");
  const res = await fetch(`${supabaseConfig().url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: supabaseConfig().key,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || "Request refused");
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

/** The default idle limit that applies to a branch. */
export const getIdleTimeout = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        storeId: z.string().max(64).optional(),
        sessionToken: z.string().max(400).optional(),
        cashierToken: z.string().max(2000).optional(),
        terminalToken: z.string().max(200).optional(),
        accessToken: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const scope = await requireCallerScope(data);
    if (!scope.isSupervisor && data.storeId && data.storeId !== scope.storeId)
      throw new Error("You cannot read another branch's timeout.");
    const { resolveIdleMinutes } = await import("./session-guard.server");
    const minutes = await resolveIdleMinutes({ branchId: data.storeId ?? scope.storeId ?? null });
    return { minutes };
  });

export const saveIdleTimeout = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        accessToken: z.string().max(4000),
        storeId: z.string().max(64).optional(),
        minutes: z.number().int().min(1).max(1440),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      await rpc(data.accessToken, "pos_rules_save_idle", {
        _store_id: data.storeId ?? "",
        _minutes: data.minutes,
      });
      return { ok: true as const, error: "" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Per-person override. `minutes: 0` clears it and falls back to the branch. */
export const saveStaffIdleTimeout = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        accessToken: z.string().max(4000),
        kind: z.enum(["account", "cashier"]),
        key: z.string().min(1).max(64),
        minutes: z.number().int().min(0).max(1440),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      if (data.kind === "cashier")
        await rpc(data.accessToken, "set_cashier_idle_timeout", {
          p_id: data.key,
          p_minutes: data.minutes || null,
        });
      else
        await rpc(data.accessToken, "set_app_user_idle_timeout", {
          p_user_id: data.key,
          p_minutes: data.minutes || null,
        });
      return { ok: true as const, error: "" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
