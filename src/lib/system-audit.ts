/**
 * Client helper for unverified event reports in the immutable history.
 * Fire-and-forget: reporting must never block the person performing an action.
 */
import { recordSystemAudit } from "./system-audit-client";
import { readCredentials } from "./pos-credentials";

export type SystemAuditInput = {
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  actionType: string;
  entityAffected?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  terminalId?: string | null;
  storeId?: string | null;
  note?: string | null;
};

export function logSystemAction(entry: SystemAuditInput): Promise<void> {
  // The server only accepts a line it can attribute, so the device's proof
  // goes with it.
  return (async () => {
    const credentials = await readCredentials();
    await recordSystemAudit({ data: { ...entry, ...credentials } });
  })().catch(() => {});
}
