import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ accessToken: z.string().min(10) });

/** Clear telemetry/sync history only. Registrations and business audit stay intact. */
export const clearTelemetryHistory = createServerFn({ method: "POST" })
  .validator((value: unknown) => input.parse(value))
  .handler(async ({ data }) => {
    const { verifyAdminToken, describeAccessToken } = await import("./system-audit-access.server");
    if (!(await verifyAdminToken(data.accessToken))) {
      return { ok: false as const, error: "Administrator access required" };
    }
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("offline_sync_audit_log?id=not.is.null", {
      method: "DELETE",
    });
    if (!response.ok) {
      return { ok: false as const, error: (await response.text()).slice(0, 300) };
    }
    const actor = await describeAccessToken(data.accessToken);
    const { writeSystemAudit } = await import("./system-audit.server");
    await writeSystemAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actionType: "TELEMETRY_HISTORY_CLEARED",
      entityAffected: "offline_sync_audit_log",
      note: "Telemetry history cleared; terminal registrations and financial audit records retained.",
    });
    return { ok: true as const };
  });
