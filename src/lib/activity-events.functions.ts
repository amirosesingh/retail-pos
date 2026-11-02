import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shiftClosureStatusMessage, unconfirmedShiftClosureActivity } from "../../electron/shift-closure-activity.mjs";

const eventInput = z.object({
  type: z.string().min(1).max(60),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  title: z.string().min(1).max(200),
  message: z.string().max(1000).optional(),
  actorId: z.string().max(120).nullish(),
  actorName: z.string().max(160).nullish(),
  actorRole: z.string().max(60).nullish(),
  terminalId: z.string().max(120).nullish(),
  terminalName: z.string().max(160).nullish(),
  storeId: z.string().max(64).nullish(),
  entityType: z.string().max(60).nullish(),
  entityId: z.string().max(160).nullish(),
  amount: z.number().finite().nullish(),
  meta: z.record(z.string(), z.unknown()).optional(),
  clientEventId: z.string().max(80).optional(),
  createdAt: z.string().max(40).optional(),
  // Proof of who is raising the event. Without it nothing is written.
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});

export const pushActivityEvent = createServerFn({ method: "POST" })
  .validator((input: unknown) => eventInput.parse(input))
  .handler(async ({ data }) => {
    if (data.type === "soft_token_approval")
      return { ok: false as const, error: "Approval notifications are generated from verified approval records" };
    // The feed is an audit trail: an unattested caller must not be able to
    // invent sign-ins, refunds or branch activity in it.
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    const { resolveRelayScope, canCrossBranches } = await import("@/core/api/relay-policy.server");
    let scope: Awaited<ReturnType<typeof resolveRelayScope>>;
    try {
      const caller = await verifyRelayCaller({
        ...(data.sessionToken ? { sessionToken: data.sessionToken } : {}),
        ...(data.cashierToken ? { cashierToken: data.cashierToken } : {}),
        ...(data.terminalToken ? { terminalToken: data.terminalToken } : {}),
        ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      });
      scope = await resolveRelayScope(caller);
      if (scope.kind === "terminal" || scope.stale || !scope.staffUserId)
        throw new Error("Staff identity required");
    } catch {
      return { ok: false as const, error: "Not signed in" };
    }
    // Only a supervisor may file an event against another branch; everyone
    // else is stamped with the branch their proof belongs to.
    // Closing reports from a branch-locked terminal keep that branch even if
    // a management-role user signs in. Broader event behavior stays unchanged.
    const maySelectStore = data.type === "shift_close" ? canCrossBranches(scope) : scope.isSupervisor;
    const storeId = maySelectStore
      ? (data.storeId ?? scope.storeId ?? null)
      : (scope.storeId ?? null);
    const { writeActivityEvent } = await import("./activity-events.server");
    const safeMeta = Object.fromEntries(Object.entries(data.meta ?? {}).filter(([key]) =>
      !key.startsWith("notification_") && !key.startsWith("audience") && key !== "in_app_disabled"));
    let report = unconfirmedShiftClosureActivity({ ...data, meta: safeMeta });
    if (data.type === "shift_close" && storeId && data.entityType === "shift" &&
        typeof data.entityId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.entityId)) {
      try {
        const { serviceRest } = await import("@/core/api/pos-relay.server");
        const response = await serviceRest(`shifts?id=eq.${encodeURIComponent(data.entityId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,store_id,status,state,closed_at&limit=1`, { signal: AbortSignal.timeout(2_000) });
        if (response.ok) {
          const rows: unknown = await response.json();
          const row = Array.isArray(rows) && rows.length === 1 ? rows[0] as Record<string, unknown> : null;
          if (row && row.id === data.entityId && row.store_id === storeId &&
              row.status === "CLOSED" && row.state === "CLOSED" &&
              typeof row.closed_at === "string" && Number.isFinite(Date.parse(row.closed_at))) {
            report = { ...report, title: "Shift closure confirmed",
              message: shiftClosureStatusMessage(data.message, "Central record confirmed closed."),
              meta: { ...report.meta, shift_closure_status: "central_confirmed", shift_closure_closed_at: row.closed_at } };
          }
        }
      } catch {
        // The durable report still records the event if central verification
        // times out or fails; it explicitly does not claim confirmed closure.
      }
    }
    const res = await writeActivityEvent({
      event_type: data.type,
      severity: data.severity,
      title: data.type === "shift_close" ? report.title : `Reported activity: ${data.title}`,
      message: report.message ?? "",
      actor_id: scope.staffUserId ?? null,
      actor_name: scope.actorName ?? null,
      actor_role: scope.roleSlug ?? scope.role,
      terminal_id: scope.terminalId ?? null,
      terminal_name: null,
      store_id: storeId,
      entity_type: data.entityType ?? null,
      entity_id: data.entityId ?? null,
      amount: data.amount ?? null,
      meta: { ...report.meta, client_reported: true } as Record<string, unknown>,
      client_event_id: data.clientEventId ?? null,
      created_at: data.createdAt ?? new Date().toISOString(),
    });
    return res;
  });

const settingsInput = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().max(30)).max(20),
  criticalOnly: z.boolean(),
  quietFrom: z.string().max(5),
  quietTo: z.string().max(5),
  channels: z.record(z.string(), z.enum(["off", "app", "whatsapp"])),
  inApp: z.record(z.string().min(1).max(60), z.boolean()).optional(),
  androidPush: z
    .object({
      enabled: z.boolean(),
      events: z.array(z.string().max(60)).max(100),
      recipients: z.array(z.string().max(64)).max(500),
      branches: z.array(z.string().max(64)).max(500),
      criticalOnly: z.boolean(),
    })
    .optional(),
});

const callerProof = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});

export const loadNotificationSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => callerProof.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      const scope = await requireCallerScope(data);
      if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
        throw new Error("Only an administrator can manage global notification settings.");
      const { readNotificationSettings } = await import("./activity-events.server");
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const users = await serviceRest(
        "app_users?is_active=eq.true&select=user_id,full_name&order=full_name.asc&limit=500",
      );
      if (!users.ok) throw new Error("Could not load notification recipients.");
      let pushConfigured = false;
      try {
        const { centralPushConfig } = await import("./central-push.server");
        centralPushConfig();
        pushConfigured = true;
      } catch {
        /* Not yet provisioned. */
      }
      return {
        ok: true as const,
        settings: await readNotificationSettings(),
        staff: (await users.json()) as { user_id: string; full_name: string }[],
        pushConfigured,
      };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  });

export const saveNotificationSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    callerProof
      .extend({ settings: settingsInput, section: z.enum(["android", "whatsapp", "app"]).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      const scope = await requireCallerScope(data);
      if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
        throw new Error("Only an administrator can manage global notification settings.");
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
    const { writeNotificationSettings, writeNotificationSection } =
      await import("./activity-events.server");
    try {
      const {readNotificationSettings} = await import("./activity-events.server");
      if (Array.isArray((await readNotificationSettings()).rules))
        return {ok: false as const, error: "Notification delivery is now managed in the notification rules table."};
      if (data.section) {
        const settings = await writeNotificationSection(data.settings, data.section);
        return { ok: true as const, settings };
      }
      await writeNotificationSettings(data.settings);
      return { ok: true as const, settings: data.settings };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
