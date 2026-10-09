import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("shift sync boundaries", () => {
  it("awaits the Electron final sync barrier before completing the UI close", () => {
    const dialog = read("src/platforms/web/components/pos/ShiftCloseDialog.tsx");
    const closing = read("src/lib/shift-closing.ts");
    const main = read("electron/main.cjs");
    const store = read("src/lib/pos-store.tsx");
    expect(dialog.indexOf("await synchronizeShiftClose(shift.id)")).toBeLessThan(
      dialog.indexOf("await closeShift("),
    );
    expect(dialog.indexOf("await closeShift(")).toBeLessThan(
      dialog.indexOf("await localDb()?.closeWindow?.()"),
    );
    expect(closing).toContain("sync?.finalizeShiftClose");
    expect(main).toContain('ipcMain.handle("sync:finalize-shift-close"');
    expect(main).toContain("syncCoordinator.runFinal");
    expect(main).toContain("pendingShiftCloseSync.size");
    expect(main).toContain("if (result?.ok === false)");
    expect(main).not.toContain("ok: true, offline: true");
    expect(store).toContain("await Promise.all([transitionWritten, activityWritten, summaryWritten])");
    expect(store.indexOf("await Promise.all([transitionWritten")).toBeLessThan(
      store.indexOf("return closed;"),
    );
    expect(dialog.indexOf("await logSystemAction({")).toBeLessThan(
      dialog.indexOf("await localDb()?.closeWindow?.()"),
    );
  });

  it("contains every asynchronous close action and always clears its busy state", () => {
    const dialog = read("src/platforms/web/components/pos/ShiftCloseDialog.tsx");
    expect(dialog).toContain("async function runBusy(");
    expect(dialog).toContain("if (busyRef.current) return");
    expect(dialog).toContain("busyRef.current = true");
    expect(dialog).toContain("try {");
    expect(dialog).toContain('notifyError(error, context)');
    expect(dialog).toContain("finally {");
    expect(dialog).toContain("busyRef.current = false");
    expect(dialog).toContain("setBusy(false)");
    for (const context of [
      "Starting shift close",
      "Submitting the shift cash count",
      "Submitting the authorised recount",
      "Approving the shift variance",
    ]) {
      expect(dialog).toContain(context);
    }
  });

  it("sends protected shift writes and summaries through the existing relay", () => {
    const engine = read("src/lib/sync-engine.ts");
    expect(engine).toContain('op.table === "shifts"');
    expect(engine).toContain('op.table === "shift_notifications"');

    const policy = read("src/core/api/relay-policy.server.ts");
    expect(policy).toContain('shift_notifications: "store_id"');
    expect(policy).toMatch(/appendOnlyTables[\s\S]*"shift_notifications"/);

    const relay = read("src/core/api/pos-relay.server.ts");
    expect(relay).toMatch(/RELAY_TABLES[\s\S]*"shift_notifications"/);
    expect(relay).toMatch(/RELAY_CONFLICT_KEYS[\s\S]*shift_notifications: "shift_id"/);
  });

  it("installs a branch-scoped, RLS-protected central summary table", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.shift_notifications");
    expect(sql).toContain("CONSTRAINT shift_notifications_shift_key UNIQUE (shift_id)");
    expect(sql).toContain("ALTER TABLE public.shift_notifications ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Branch staff publish shift summaries"');
    expect(sql).toContain('CREATE POLICY "Variance viewers read shift summaries"');
    expect(sql).toContain("public.has_perm('can_shift_variance_view')");
    expect(sql).toContain("public.store_visible(store_id)");
  });

  it("includes every live shift summary column in the local SQL Server installer", () => {
    const registry = JSON.parse(read("database/sqlserver/schema-registry.json"));
    const localSql = read("database/sqlserver/retail-pos-local-database.sql");
    const table = registry.tables.find(
      (candidate: { cloudTable: string }) => candidate.cloudTable === "shift_notifications",
    );
    const expectedColumns = [
      "id",
      "shift_id",
      "store_id",
      "store_name",
      "terminal_name",
      "closed_by",
      "opened_at",
      "closed_at",
      "total_sales",
      "transactions",
      "discounts",
      "refunds",
      "expected_cash",
      "counted_cash",
      "payment_breakdown",
      "summary",
      "channels",
      "created_at",
    ];

    expect(table).toMatchObject({
      scope: "branch",
      direction: "bidirectional",
      retentionClass: "historical",
      updateRule: "append_only",
      deleteRule: "none",
    });
    expect(table.columns.map((column: { cloudColumn: string }) => column.cloudColumn)).toEqual(
      expectedColumns,
    );
    expect(localSql).toContain("dbo.[shift_notifications]");
    expect(localSql).toContain("[shift_id] uniqueidentifier NOT NULL");
    expect(localSql).toContain("[payment_breakdown] nvarchar(max) NOT NULL");
    expect(localSql).toContain("[channels] nvarchar(max) NOT NULL");
  });

  it("publishes idempotently through the relay instead of the missing REST table", () => {
    const alerts = read("src/lib/shift-alerts.ts");
    expect(alerts).toContain('table: "shift_notifications"');
    expect(alerts).toContain('onConflict: "shift_id"');
    expect(alerts).not.toContain("notifications().insert(");
  });
});
