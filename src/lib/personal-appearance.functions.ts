import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { personalAppearanceSchema } from "./personal-appearance-schema";

const proof = z.object({
  owner: z.string().min(1).max(160),
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});

export const loadPersonalAppearance = createServerFn({ method: "POST" })
  .validator((input: unknown) => proof.parse(input))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || !scope.staffUserId || scope.staffUserId !== data.owner) throw new Error("Sign in to load your preferences.");
    const response = await serviceRest(`settings_scoped?scope=eq.PRIVATE&scope_id=eq.${encodeURIComponent(scope.staffUserId)}&key=eq.personal_appearance&select=value&limit=1`);
    if (!response.ok) throw new Error("Your appearance preferences could not be loaded.");
    const rows = await response.json() as Array<{ value: unknown }>;
    const parsed = personalAppearanceSchema.safeParse(rows[0]?.value);
    return { owner: scope.staffUserId, profile: parsed.success ? parsed.data : null };
  });

export const savePersonalAppearance = createServerFn({ method: "POST" })
  .validator((input: unknown) => proof.extend({ profile: personalAppearanceSchema }).parse(input))
  .handler(async ({ data }) => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const scope = await requireCallerScope(data);
    if (scope.kind === "terminal" || !scope.staffUserId || scope.staffUserId !== data.owner) throw new Error("Sign in to save your preferences.");
    if (scope.role !== "admin" && scope.roleSlug !== "admin" && scope.permissions.can_customize_display === false)
      throw new Error("Your administrator disabled personal appearance changes.");
    // The owner comes exclusively from verified credentials, never the payload.
    const response = await serviceRest("settings_scoped?on_conflict=scope,scope_id,key", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ scope: "PRIVATE", scope_id: scope.staffUserId, key: "personal_appearance", value: data.profile, is_overridden: true, updated_by: scope.staffUserId }),
    });
    if (!response.ok) throw new Error("Your appearance preferences could not be saved centrally.");
    return { owner: scope.staffUserId };
  });
