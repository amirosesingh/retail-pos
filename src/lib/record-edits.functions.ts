/**
 * Server functions behind "edit a posted record".
 *
 * The browser may ask to hold a record, ask what happened to its request, and
 * report what it changed. It may never decide any of those things itself.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const caller = z.object({
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  cashierToken: z.string().min(10).optional(),
});

const kind = z.enum(["stock_count", "purchase_order", "sale"]);

type Caller = { id: string; name: string; role: string; isSupervisor: boolean };

function requireAdmin(who: Caller): void {
  if (who.role.trim().toLowerCase() !== "admin") {
    throw new Error("Only an administrator can correct a posted record");
  }
}

/** Any signed-in till user: a staff account or a cashier PIN session. */
async function assertCaller(data: z.infer<typeof caller>): Promise<Caller> {
  if (data.accessToken) {
    const { verifyPosStaff } = await import("./secure-settings.server");
    const staff = await verifyPosStaff(data.accessToken);
    return { id: staff.userId, name: staff.userId, role: staff.role, isSupervisor: staff.isAdmin };
  }
  const sessionToken = data.cashierToken ?? data.terminalToken;
  if (sessionToken) {
    const { verifyCashierSession } = await import("./pos-session.server");
    const session = verifyCashierSession(sessionToken);
    if (session) {
      return { id: session.id, name: session.username, role: "cashier", isSupervisor: false };
    }
  }
  throw new Error("Not signed in");
}

/** Who the server thinks is asking — used to show "your" pending edits. */
export const whoAmI = createServerFn({ method: "POST" })
  .validator((data: unknown) => caller.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      return { ok: true as const, id: who.id, name: who.name, role: who.role };
    } catch {
      return { ok: false as const, id: "", name: "", role: "" };
    }
  });

/** Hold a posted record while its edit request waits for a decision. */
export const holdRecordForEdit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller
      .extend({ kind, recordId: z.string().min(1).max(64), requestId: z.string().uuid() })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      requireAdmin(who);
      const { getRequest } = await import("./authorization.server");
      const request = await getRequest(data.requestId);
      if (!request || request.requestedBy.toLowerCase() !== who.id.toLowerCase()) {
        return { ok: false as const, error: "That request is not yours" };
      }
      if (request.status !== "pending") {
        return { ok: false as const, error: `That request is already ${request.status}` };
      }
      const { setPendingEdit } = await import("./record-edits.server");
      const held = await setPendingEdit({
        kind: data.kind,
        recordId: data.recordId,
        requestId: data.requestId,
        by: who.id,
      });
      return held
        ? { ok: true as const }
        : { ok: false as const, error: "Someone else is already editing this record" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/**
 * What happened to the hold on a record.
 *
 * An approval is claimed here, so it can only ever open one editor; anything
 * that is no longer pending releases the record on the way out.
 */
export const resumeRecordEdit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller.extend({ kind, recordId: z.string().min(1).max(64) }).parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      requireAdmin(who);
      const { readPendingEdit, clearPendingEdit } = await import("./record-edits.server");
      const hold = await readPendingEdit(data.kind, data.recordId);
      if (!hold?.requestId) return { ok: true as const, status: "none" as const, grantToken: "" };
      if ((hold.by ?? "").toLowerCase() !== who.id.toLowerCase()) {
        return { ok: false as const, error: "Someone else asked to edit this record" };
      }
      const { getRequest, consumeRequest } = await import("./authorization.server");
      const { signOverrideGrant } = await import("./pos-rules.server");
      const request = await getRequest(hold.requestId);
      if (!request) {
        await clearPendingEdit(data.kind, data.recordId);
        return { ok: true as const, status: "none" as const, grantToken: "" };
      }
      if (request.status === "pending") {
        return { ok: true as const, status: "pending" as const, grantToken: "" };
      }
      if (request.status !== "approved") {
        await clearPendingEdit(data.kind, data.recordId);
        return {
          ok: true as const,
          status: request.status,
          grantToken: "",
          note: request.decisionNote ?? "",
        };
      }
      const claimed = await consumeRequest(request.id);
      if (!claimed) {
        await clearPendingEdit(data.kind, data.recordId);
        return { ok: false as const, error: "That approval has already been used" };
      }
      await clearPendingEdit(data.kind, data.recordId);
      return {
        ok: true as const,
        status: "approved" as const,
        approvedBy: request.decidedByName || request.decidedBy || "",
        requestId: request.id,
        grantToken: signOverrideGrant({
          action: request.actionKey,
          approvedBy: request.decidedBy ?? "approval",
          role: "approval",
          storeId: request.storeId,
          binding: `${data.kind}:${data.recordId}`,
          requestId: request.id,
        }),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/** The requester takes their own request back; the record unlocks. */
export const withdrawRecordEdit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller.extend({ kind, recordId: z.string().min(1).max(64) }).parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      requireAdmin(who);
      const { readPendingEdit, clearPendingEdit } = await import("./record-edits.server");
      const hold = await readPendingEdit(data.kind, data.recordId);
      if (!hold?.requestId) return { ok: true as const };
      if ((hold.by ?? "").toLowerCase() !== who.id.toLowerCase()) {
        return { ok: false as const, error: "That request belongs to someone else" };
      }
      const { cancelRequest } = await import("./authorization.server");
      await cancelRequest(hold.requestId, who.id).catch(() => false);
      await clearPendingEdit(data.kind, data.recordId);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

const jsonish = z.unknown();

/** Record what an authorised edit changed: the old values and the new ones. */
export const logRecordEdit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller
      .extend({
        kind,
        recordId: z.string().min(1).max(64),
        reference: z.string().max(64).optional(),
        storeId: z.string().max(64).optional(),
        terminalId: z.string().max(64).optional(),
        actionKey: z.string().min(1).max(64),
        requestId: z.string().uuid().optional(),
        authorizedBy: z.string().max(64).optional(),
        modeUsed: z.string().max(20).optional(),
        before: jsonish,
        after: jsonish,
        stockDeltas: z.record(z.string(), z.number()).default({}),
        note: z.string().max(400).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      requireAdmin(who);
      const { writeRecordEdit, clearPendingEdit } = await import("./record-edits.server");
      const written = await writeRecordEdit({
        recordType: data.kind,
        recordId: data.recordId,
        reference: data.reference ?? null,
        storeId: data.storeId ?? "",
        terminalId: data.terminalId ?? "",
        actionKey: data.actionKey,
        requestId: data.requestId ?? null,
        editedBy: who.id,
        editedByName: who.name,
        authorizedBy: data.authorizedBy ?? null,
        modeUsed: data.modeUsed ?? null,
        before: data.before ?? {},
        after: data.after ?? {},
        stockDeltas: data.stockDeltas,
        note: data.note ?? null,
      });
      await clearPendingEdit(data.kind, data.recordId).catch(() => undefined);
      return written.ok
        ? { ok: true as const }
        : { ok: false as const, error: written.error ?? "Could not write the edit history" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/** The before/after history of one record, for the audit trail. */
export const getRecordEdits = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller.extend({ kind, recordId: z.string().min(1).max(64) }).parse(data),
  )
  .handler(async ({ data }) => {
    try {
      await assertCaller(data);
      const { listRecordEdits } = await import("./record-edits.server");
      return { ok: true as const, edits: await listRecordEdits(data.kind, data.recordId) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300), edits: [] };
    }
  });

/** Management audit feed of recent corrections, scoped to the caller's branch. */
export const getRecentRecordEdits = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller
      .extend({ storeId: z.string().max(64).nullish(), limit: z.number().int().min(1).max(500) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const [{ verifyRelayCaller }, { resolveRelayScope }] = await Promise.all([
        import("@/core/api/pos-relay.server"),
        import("@/core/api/relay-policy.server"),
      ]);
      const verified = await verifyRelayCaller(data);
      const scope = await resolveRelayScope(verified);
      if (!scope.isSupervisor && scope.permissions.can_view_audit_trail !== true) {
        return { ok: false as const, error: "Audit-trail permission is required", edits: [] };
      }
      const allBranches = scope.roleSlug === "admin" || scope.role === "admin";
      if (!allBranches && !scope.storeId) {
        return { ok: false as const, error: "A branch scope is required", edits: [] };
      }
      const storeId = allBranches ? (data.storeId ?? null) : scope.storeId || null;
      if (!allBranches && data.storeId && data.storeId !== storeId) {
        return { ok: false as const, error: "Cross-branch access is not allowed", edits: [] };
      }
      const { listRecentRecordEdits } = await import("./record-edits.server");
      return { ok: true as const, edits: await listRecentRecordEdits(storeId, data.limit) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300), edits: [] };
    }
  });
