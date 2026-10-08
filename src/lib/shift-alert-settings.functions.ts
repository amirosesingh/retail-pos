import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shiftAlertSettingsSchema } from "./shift-alert-settings-schema";
const proof = z.object({
  sessionToken: z.string().max(400).optional(), cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(), accessToken: z.string().max(4000).optional(),
});
export const saveGlobalShiftAlerts = createServerFn({ method: "POST" })
  .validator((input: unknown) => proof.extend({ settings: shiftAlertSettingsSchema }).parse(input))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
      throw new Error("Only administrators may change global shift notifications.");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const result = await serviceRest("rpc/save_global_shift_alerts", { method: "POST", body: JSON.stringify({ p_settings: data.settings }) });
    if (!result.ok) throw new Error("Global shift notification settings could not be saved.");
    return { ok: true };
  });
