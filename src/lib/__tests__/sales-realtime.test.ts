import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("sales realtime refresh", () => {
  it("uses the shared channel as a notification and refetches canonical sales", () => {
    const engine = readFileSync("src/lib/sync-engine.ts", "utf8");
    const store = readFileSync("src/lib/pos-store.tsx", "utf8");
    expect(engine).toMatch(/BRANCH_LIVE_TABLES[\s\S]*"sales"/);
    expect(engine).toContain("announceSalesChange(change.table, change.storeId)");
    expect(engine).toContain("pendingLiveChanges");
    expect(engine).toContain("for (const change of changes)");
    for (const table of [
      "integration_settings",
      "pos_settings",
      "pos_store_settings",
      "secure_settings",
      "settings_overrides",
      "settings_locks",
      "settings_scoped",
    ]) {
      expect(engine).toContain(`"${table}"`);
    }
    expect(engine).toContain('announceSettingsChange("desktop:pull-complete")');
    expect(store).toContain("subscribeSalesChange");
    expect(store).toContain("subscribeSettingsChange");
    expect(store).toContain('change.table !== "pos_settings"');
    expect(store).toContain('change.reason !== "desktop:pull-complete"');
    expect(store).toContain("loadSalesPage(active, null, 500)");
    expect(store).toContain("loadCloudSettings()");
    expect(store).toContain("subscribeDataChange");
    expect(store).toContain("loadCloudProduct(change.entityId!)");
    expect(store).toContain('App.addListener("appStateChange"');
    expect(store).toContain('window.addEventListener("focus", resume)');
    expect(store).toContain('window.addEventListener("focus", focus)');
    expect(store).toContain("if (cancelled) void handle.remove()");
  });

  it("broadcasts a value-free wake signal after web settings writes", () => {
    const settings = readFileSync("src/lib/branch-settings.ts", "utf8");
    const engine = readFileSync("src/lib/sync-engine.ts", "utf8");
    const appShell = readFileSync("src/platforms/web/components/pos/AppShell.tsx", "utf8");
    const db = readFileSync("src/core/api/pos-db.ts", "utf8");
    const rules = readFileSync("src/routes/settings.rules.tsx", "utf8");

    expect(settings).toContain('broadcastSettingsChange("settings_overrides")');
    expect(settings).toContain('broadcastSettingsChange("settings_locks")');
    expect(appShell).toContain("useEffect(() => startSyncEngine(), [])");
    expect(db).toContain('broadcastSettingsChange("pos_settings")');
    expect(rules).toContain('broadcastSettingsChange("pos_store_settings")');
    expect(engine).toContain("await broadcastSettingsChange(op.table)");
    expect(engine).toContain('next.on("broadcast", { event: "settings_changed" }');
    expect(engine).toContain("payload: { table }");
    expect(engine).not.toContain("payload: { table, patch");
    expect(engine).toContain("queueLiveChange({ reason: `broadcast:${table}`");
  });
});
