import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  notificationRulesSchema,
  importNotificationRules,
  type NotificationDelivery,
} from "./notification-rules";

const proof = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});
async function requireAdmin(data: z.infer<typeof proof>) {
  const { requireCallerScope } = await import("./privileged-caller.server");
  const scope = await requireCallerScope(data);
  if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
    throw new Error("Only administrators may manage notification routing and delivery history.");
}
export const loadNotificationRuleTable = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    proof.extend({ offset: z.number().int().min(0).max(10000).default(0) }).parse(value),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data);
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const { DEFAULT_NOTIFICATION_SETTINGS } = await import("./activity-events.server");
      const [settingsResponse, users, roles, status] = await Promise.all([
        serviceRest("pos_settings?id=eq.1&select=notification_settings&limit=1"),
        serviceRest(
          "app_users?select=id,user_id,full_name,role,role_slug,is_active&order=full_name.asc&limit=1000",
        ),
        serviceRest("staff_roles?select=slug,name&order=name.asc&limit=100"),
        serviceRest("rpc/notification_rules_status", { method: "POST", body: "{}" }),
      ]);
      if (!settingsResponse.ok || !users.ok || !roles.ok)
        throw new Error("Could not load current notification settings, staff or roles. Try again.");
      const settingsRows = (await settingsResponse.json()) as {
        notification_settings?: import("./activity-events.server").NotificationSettings;
      }[];
      if (!settingsRows.length)
        throw new Error("Company notification settings are not initialized.");
      const settings = {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...settingsRows[0].notification_settings,
      };
      const saved =
        settings.rules === undefined ? null : notificationRulesSchema.parse(settings.rules);
      const { EVENT_CATALOG } = await import("./activity-events");
      const events = [
        ...EVENT_CATALOG.flatMap((group) => group.types),
        { type: "shift_summary", label: "Day-end shift summary" },
        { type: "approval_requested", label: "Approval requested" },
        { type: "approval_approved", label: "Approval accepted" },
        { type: "approval_granted", label: "Approval granted" },
        { type: "approval_rejected", label: "Approval rejected" },
        { type: "approval_expired", label: "Approval expired" },
        { type: "approval_denied", label: "Approval denied" },
        { type: "approval_completed", label: "Approval completed" },
      ];
      const history = status.ok
        ? await serviceRest(
            `notification_deliveries?select=id,event_id,rule_name,channel,recipient,recipient_user_id,status,reason,created_at,next_attempt,delivered_at&order=created_at.desc,id.desc&limit=100&offset=${data.offset}`,
          )
        : null;
      if (history && !history.ok) throw new Error("Could not load notification delivery history.");
      let pushConfigured = false;
      try {
        (await import("./central-push.server")).centralPushConfig();
        pushConfigured = true;
      } catch {
        /* Not provisioned. */
      }
      return {
        ok: true as const,
        rules: saved ?? importNotificationRules(settings, events),
        expected: saved,
        needsUpgrade: !status.ok,
        imported: saved === null,
        events,
        staff: (await users.json()) as {
          id: string;
          user_id: string;
          full_name: string;
          role: string;
          role_slug: string | null;
          is_active: boolean;
        }[],
        roles: (await roles.json()) as { slug: string; name: string }[],
        history: history ? ((await history.json()) as NotificationDelivery[]) : [],
        pushConfigured,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Could not load notification rules",
      };
    }
  });

export const saveNotificationRuleTable = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    proof
      .extend({ rules: notificationRulesSchema, expected: notificationRulesSchema.nullable() })
      .parse(value),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data);
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest("rpc/save_notification_rule_table", {
        method: "POST",
        body: JSON.stringify({ p_rules: data.rules, p_expected: data.expected }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          /changed on another device/.test(detail)
            ? "Rules changed on another device. Reload and review before saving."
            : /PGRST202|could not find.*function/i.test(detail)
              ? "The notification database upgrade must be deployed before saving rules."
              : "Could not save notification rules. Your changes have not been saved.",
        );
      }
      const saved = notificationRulesSchema.parse(await response.json());
      return { ok: true as const, rules: saved };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Could not save notification rules",
      };
    }
  });

export const processNotificationDeliveries = createServerFn({ method: "POST" })
  .validator((value: unknown) => proof.parse(value))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || !scope.staffUserId || scope.stale)
      throw new Error("A current staff session is required");
    // The caller cannot choose a message or a recipient. Only previously
    // committed company deliveries can be claimed by this bounded worker.
    const { drainNotificationWhatsApp } = await import("./notification-delivery.server");
    await drainNotificationWhatsApp(3);
    return { ok: true };
  });
