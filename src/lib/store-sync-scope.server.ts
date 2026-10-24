/** A terminal's stores mutation must target the verified synchronization branch. */
export function assertStoreSyncScope(branchId: string, operations: {
  table: string; rows: Record<string, unknown>[]; changes: Record<string, unknown>[];
}[]): void {
  for (const op of operations.filter(operation => operation.table === "stores")) {
    if (op.rows.some(row => String(row.id ?? "") !== branchId)) throw new Error("SYNC_BRANCH_FORBIDDEN");
    for (const change of op.changes) {
      if (!["D", "DELETE"].includes(String(change.operation ?? "").toUpperCase())) continue;
      const key = change.key as Record<string, unknown> | null | undefined;
      let id = key?.id;
      if (id == null) {
        const encoded = change.entityId ?? change.entity_id;
        try { id = JSON.parse(String(encoded)).id; }
        catch { throw new Error("SYNC_BRANCH_FORBIDDEN"); }
      }
      if (String(id ?? "") !== branchId) throw new Error("SYNC_BRANCH_FORBIDDEN");
    }
  }
}
