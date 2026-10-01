/**
 * Saving register rules when the central system cannot be reached.
 *
 * A rule change is stored on the till first — through the same gateway every
 * other change uses, so the background sync worker uploads it, retries on its
 * own and only clears it once the central database has confirmed it. The till
 * applies the change immediately, and keeps applying it after a restart,
 * because the pending set is written to the encrypted device store as well.
 *
 * Nothing here decides who may change a rule: the screen has already checked
 * that, and the central save re-checks it on the server when the change is
 * uploaded.
 */
import { dbRouter } from "@/core/api/db-router";
import { writeCachedRules } from "./pos-rules-cache";
import { logRules } from "./pos-rules-log";
import type { PosRules } from "./pos-rules";

import { PENDING_REVISION_PREFIX } from "./pos-rules-pending";

export { PENDING_REVISION_PREFIX, rulesEqual, pendingExpired, PENDING_MAX_AGE_MS } from "./pos-rules-pending";

export type QueuedRules = {
  /** Where the change was actually stored. */
  target: string;
  savedAt: number;
};

/**
 * Park a rule change on this terminal and queue it for the central database.
 *
 * Throws when the change could not be stored anywhere at all — the caller
 * must then tell the operator the change was not kept.
 */
export async function queueRulesSave(input: {
  terminalId: string;
  branchId: string;
  rules: PosRules;
  patch: Record<string, boolean | number>;
  actor?: string | null;
  expectedVersion: number;
}): Promise<QueuedRules> {
  const savedAt = Date.now();
  // A pending local edit is a new revision. Reusing the cloud revision makes
  // the next pull look equally new and can restore the old central values.
  const nextVersion = Math.max(0, input.expectedVersion) + 1;
  const row: Record<string, unknown> = {
    store_id: input.branchId || "",
    ...input.patch,
    updated_at: new Date(savedAt).toISOString(),
    row_version: nextVersion,
    base_version: input.expectedVersion,
  };
  if (input.actor) row["updated_by"] = input.actor;

  const target = await dbRouter.upsert(
    "pos_store_settings",
    row,
    "store_id",
    "Saving register rules",
  );

  // The till must obey the new rules straight away, and still obey them after
  // a restart, so the pending set replaces the last confirmed one locally.
  await writeCachedRules({
    terminalId: input.terminalId,
    branchId: input.branchId,
    revision: `${PENDING_REVISION_PREFIX}${savedAt}`,
    syncedAt: savedAt,
    rules: input.rules,
    pending: true,
    rowVersion: nextVersion,
    updatedAt: new Date(savedAt).toISOString(),
    updatedBy: input.actor ?? null,
  });

  logRules("POS_RULES_SAVE_QUEUED", {
    terminal_id: input.terminalId,
    branch_id: input.branchId,
    category: String(target),
  });

  return { target: String(target), savedAt };
}
