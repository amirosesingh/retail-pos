import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const transition = z.object({
  entityType: z.string().min(1).max(60),
  entityId: z.string().min(1).max(120),
  statusKind: z.string().max(60).default("status"),
  previousStatus: z.string().max(80).nullish(),
  newStatus: z.string().min(1).max(80),
  reason: z.string().max(600).nullish(),
  actorId: z.string().max(120).nullish(),
  actorName: z.string().max(200).nullish(),
  actorRole: z.string().max(60).nullish(),
  storeId: z.string().max(64).nullish(),
  branchId: z.string().max(60).nullish(),
  terminalId: z.string().max(120).nullish(),
  relatedEntityType: z.string().max(60).nullish(),
  relatedEntityId: z.string().max(120).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  clientEventId: z.string().max(120).nullish(),
  occurredAt: z.string().max(40).optional(),
});

const proof = {
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
};

const recordInput = z.object({
  transitions: z.array(transition).min(1).max(50),
  ...proof,
});

/**
 * Record one or more state changes centrally.
 *
 * History is an audit trail, so an unattested caller must not be able to
 * invent transitions. The branch is taken from the caller's own proof unless
 * they are a supervisor, exactly as the activity feed does.
 */
export const recordStatusHistory = createServerFn({ method: "POST" })
  .validator((input: unknown) => recordInput.parse(input))
  .handler(async ({ data }) => {
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
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

    const { writeStatusHistory } = await import("./status-history.server");
    const now = new Date().toISOString();
    const rows = data.transitions.map((t) => ({
      entity_type: t.entityType,
      entity_id: t.entityId,
      status_kind: t.statusKind || "status",
      previous_status: t.previousStatus ?? null,
      new_status: t.newStatus,
      reason: t.reason ?? null,
      actor_id: scope.staffUserId ?? null,
      actor_name: scope.actorName ?? null,
      actor_role: scope.role,
      store_id: scope.isSupervisor ? (t.storeId ?? scope.storeId ?? null) : (scope.storeId ?? null),
      branch_id: scope.storeId ?? null,
      terminal_id: scope.terminalId ?? null,
      related_entity_type: t.relatedEntityType ?? null,
      related_entity_id: t.relatedEntityId ?? null,
      metadata: { ...(t.metadata ?? {}), client_reported: true } as Record<
        string,
        import("./status-history.server").Json
      >,
      client_event_id: t.clientEventId ?? null,
      occurred_at: t.occurredAt ?? now,
    }));
    return await writeStatusHistory(rows);
  });

const readInput = z.object({
  entityType: z.string().min(1).max(60),
  entityId: z.string().min(1).max(120),
  limit: z.number().int().min(1).max(500).optional(),
  ...proof,
});

/** Read one record's timeline for the history panel. */
export const loadStatusHistory = createServerFn({ method: "POST" })
  .validator((input: unknown) => readInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const { auditReadBranch } = await import("./audit-read-scope.server");
      const storeId = await auditReadBranch(data, data.entityType);
      const { readStatusHistory } = await import("./status-history.server");
      const entries = await readStatusHistory(
        data.entityType,
        data.entityId,
        data.limit ?? 200,
        storeId,
      );
      return { ok: true as const, entries };
    } catch {
      return { ok: false as const, error: "History access denied", entries: [] };
    }
  });
