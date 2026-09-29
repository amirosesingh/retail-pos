import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const entryInput = z.object({
  actorId: z.string().max(120).nullish(),
  actorName: z.string().max(160).nullish(),
  actorRole: z.string().max(60).nullish(),
  actionType: z.string().min(1).max(80),
  entityAffected: z.string().max(120).nullish(),
  entityId: z.string().max(160).nullish(),
  oldValue: z.unknown().nullish(),
  newValue: z.unknown().nullish(),
  terminalId: z.string().max(120).nullish(),
  storeId: z.string().max(64).nullish(),
  note: z.string().max(400).nullish(),
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});

export const recordSystemAudit = createServerFn({ method: "POST" })
  .validator((input: unknown) => entryInput.parse(input))
  .handler(async ({ data }) => {
    // Authenticate the reporter. The reported action itself remains unverified.
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
    let scope: Awaited<ReturnType<typeof resolveRelayScope>>;
    try {
      scope = await resolveRelayScope(
        await verifyRelayCaller({
          ...(data.sessionToken ? { sessionToken: data.sessionToken } : {}),
          ...(data.cashierToken ? { cashierToken: data.cashierToken } : {}),
          ...(data.terminalToken ? { terminalToken: data.terminalToken } : {}),
          ...(data.accessToken ? { accessToken: data.accessToken } : {}),
        }),
      );
    } catch {
      return { ok: false as const, error: "Not signed in" };
    }
    const { writeSystemAuditReport } = await import("./system-audit.server");
    await writeSystemAuditReport(data, {
      actorId: scope.staffUserId ?? scope.label ?? null,
      actorName: scope.actorName ?? scope.label ?? null,
      actorRole: scope.roleSlug ?? scope.role ?? null,
      storeId: scope.storeId ?? null,
    });
    return { ok: true as const };
  });

export const listSystemAudit = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ accessToken: z.string().min(10), limit: z.number().int().min(1).max(1000).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { verifySupervisorToken } = await import("./system-audit-access.server");
    const ok = await verifySupervisorToken(data.accessToken);
    if (!ok) return { ok: false as const, error: "Supervisor access required", rows: [] };
    const { readSystemAudit } = await import("./system-audit.server");
    return { ok: true as const, rows: await readSystemAudit(data.limit ?? 200) };
  });
