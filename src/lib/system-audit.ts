/**
 * Client helper for the immutable edit history. Fire-and-forget: recording an
 * action must never slow down or block the person performing it.
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

export function logSystemAction(entry: SystemAuditInput): void {
  // The server only accepts a line it can attribute, so the device's proof
  // goes with it.
  void (async () => {
    const credentials = await readCredentials();
    await recordSystemAudit({ data: { ...entry, ...credentials } });
  })().catch(() => {});
}
