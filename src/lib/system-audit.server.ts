/**
 * Immutable edit log (`system_audit_logs`).
 *
 * Server operations write their own entries. Client reports use a separate
 * unverified envelope; authenticating a reporter does not prove an action.
 * The table itself refuses updates and deletes.
 */
import { serviceRest } from "@/core/api/pos-relay.server";

export type SystemAuditEntry = {
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  actionType: string;
  entityAffected?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  terminalId?: string | null;
  ipAddress?: string | null;
  storeId?: string | null;
  note?: string | null;
};

/** Store client claims without turning them into authoritative edit entries. */
export async function writeSystemAuditReport(
  report: SystemAuditEntry,
  reporter: Pick<SystemAuditEntry, "actorId" | "actorName" | "actorRole" | "storeId">,
): Promise<void> {
  await writeSystemAudit({
    actorId: reporter.actorId,
    actorName: reporter.actorName,
    actorRole: reporter.actorRole,
    storeId: reporter.storeId,
    actionType: "CLIENT_REPORT_UNVERIFIED",
    note: "Client-reported event; the action and values have not been verified.",
    // Explicitly select claims: credentials and caller-supplied attribution
    // must never be copied into the stored report.
    newValue: {
      unverified_report: {
        actionType: report.actionType,
        entityAffected: report.entityAffected ?? null,
        entityId: report.entityId ?? null,
        oldValue: report.oldValue ?? null,
        newValue: report.newValue ?? null,
        terminalId: report.terminalId ?? null,
        storeId: report.storeId ?? null,
        note: report.note ?? null,
      },
    },
  });
}

export async function writeSystemAudit(entry: SystemAuditEntry): Promise<void> {
  try {
    await serviceRest("system_audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        actor_id: entry.actorId ?? null,
        actor_name: entry.actorName ?? null,
        actor_role: entry.actorRole ?? null,
        action_type: entry.actionType,
        entity_affected: entry.entityAffected ?? null,
        entity_id: entry.entityId ?? null,
        old_value: entry.oldValue ?? null,
        new_value: entry.newValue ?? null,
        terminal_id: entry.terminalId ?? null,
        ip_address: entry.ipAddress ?? null,
        store_id: entry.storeId ?? null,
        note: entry.note ?? null,
      }),
    });
  } catch {
    // The trail must never block the action a person is performing.
  }
}

export type SystemAuditRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action_type: string;
  entity_affected: string | null;
  entity_id: string | null;
  /** Serialised so the row travels safely to the browser. */
  old_value: string | null;
  new_value: string | null;
  terminal_id: string | null;
  ip_address: string | null;
  store_id: string | null;
  note: string | null;
  created_at: string;
};

export async function readSystemAudit(limit = 200): Promise<SystemAuditRow[]> {
  const res = await serviceRest(
    `system_audit_logs?select=*&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 1000)}`,
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as (Omit<SystemAuditRow, "old_value" | "new_value"> & {
    old_value?: unknown;
    new_value?: unknown;
  })[];
  const text = (v: unknown) =>
    v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v);
  return rows.map((r) => ({ ...r, old_value: text(r.old_value), new_value: text(r.new_value) }));
}
