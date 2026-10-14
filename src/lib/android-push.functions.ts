import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const input = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
  deviceId: z.string().uuid(),
  token: z.string().min(20).max(4096),
  action: z.enum(["register", "remove"]),
});
export const updateAndroidPushDevice = createServerFn({ method: "POST" })
  .validator((value: unknown) => input.parse(value))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || !scope.staffUserId)
      throw new Error("Sign in to manage phone alerts.");
    const { centralPushRequest, centralPushConfig } = await import("./central-push.server");
    await centralPushRequest({
      action: data.action,
      deviceId: data.deviceId,
      token: data.token,
      userId: scope.staffUserId,
    });
    return { ok: true, tenant: centralPushConfig().tenant };
  });
