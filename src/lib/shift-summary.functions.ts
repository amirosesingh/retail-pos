import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const publishCompleteShiftSummary = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    shiftId: z.string().uuid(), sessionToken: z.string().max(400).optional(),
    cashierToken: z.string().max(2000).optional(), terminalToken: z.string().max(200).optional(),
    accessToken: z.string().max(4000).optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || !scope.staffUserId || (scope.role !== "admin" && scope.roleSlug !== "admin" && scope.permissions.can_close_shift !== true))
      throw new Error("Shift closing permission is required.");
    const response = await serviceRest(`shifts?id=eq.${data.shiftId}&select=store_id,closed_at&limit=1`);
    const rows = response.ok ? await response.json() as Array<{ store_id: string; closed_at: string | null }> : [];
    if (!rows[0]?.closed_at || (scope.role !== "admin" && scope.roleSlug !== "admin" && rows[0].store_id !== scope.storeId && scope.permissions.can_manage_other_shifts !== true))
      throw new Error("This closed shift is unavailable to your account.");
    const result = await serviceRest("rpc/publish_complete_shift_summary", { method: "POST", body: JSON.stringify({ p_shift: data.shiftId }) });
    if (!result.ok) throw new Error("The shift summary could not be published.");
    const { shiftAlertSettingsSchema } = await import("./shift-alert-settings-schema");
    const configResponse = await serviceRest("pos_settings?id=eq.1&select=notification_settings&limit=1");
    const configRows = configResponse.ok ? await configResponse.json() as Array<{ notification_settings?: { shiftAlerts?: unknown } }> : [];
    const alerts = shiftAlertSettingsSchema.safeParse(configRows[0]?.notification_settings?.shiftAlerts);
    if (alerts.success && alerts.data.whatsapp && alerts.data.recipients.length) {
      const cfg = alerts.data;
      const now = new Date();
      const minutes = now.getHours()*60+now.getMinutes();
      const parse = (value: string) => Number(value.slice(0,2))*60+Number(value.slice(3));
      const from = parse(cfg.quietFrom), to = parse(cfg.quietTo);
      const quiet = cfg.quietHours && (from < to ? minutes >= from && minutes < to : from > to && (minutes >= from || minutes < to));
      if (!quiet) {
        const claim = await serviceRest("rpc/claim_shift_summary_whatsapp", { method: "POST", body: JSON.stringify({ p_shift: data.shiftId }) });
        const summary = claim.ok ? await claim.json() as string | null : null;
        if (summary) {
          const { sendWhatsApp } = await import("./activity-events.server");
          const outcomes = await Promise.all(cfg.recipients.map((to) => sendWhatsApp(to, summary).catch(() => "Delivery failed")));
          if (outcomes.some(Boolean)) {
            await serviceRest(`shift_notifications?shift_id=eq.${data.shiftId}`, { method: "PATCH", body: JSON.stringify({ channels: ["in_app", "whatsapp_failed"] }) });
          }
        }
      }
    }
    return { ok: true };
  });
