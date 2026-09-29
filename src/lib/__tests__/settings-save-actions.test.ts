import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("settings save actions", () => {
  const independentlySaved = [
    "settings.access.tsx",
    "settings.branch-telemetry.tsx",
    "settings.database.tsx",
    "settings.mobile-terminals.tsx",
    "settings.notifications.tsx",
    "settings.payment-methods.tsx",
    "settings.sessions.tsx",
    "settings.shift-alerts.tsx",
    "settings.sku.tsx",
    "settings.system.tsx",
    "settings.terminals.tsx",
  ];

  it.each(independentlySaved)("does not add an unrelated global save bar to %s", (file) => {
    expect(read(`src/routes/${file}`)).toContain("showSaveBar={false}");
  });

  it("keeps database recovery editable before scoped settings tables are available", () => {
    const frame = read("src/platforms/web/components/pos/settings/SettingsFrame.tsx");
    const route = read("src/routes/settings.database.tsx");

    expect(route).toContain("allowWhileScopeLoading");
    expect(frame).toContain("settingsScopeLoading && !allowWhileScopeLoading");
  });

  it("keeps the database settings page status-only and opens cloud configuration in a dialog", () => {
    const settings = read("src/platforms/web/components/pos/DatabaseConnectionSettings.tsx");
    const cloud = read("src/platforms/web/components/pos/settings/panels/CloudConnectionPanel.tsx");
    const firstRun = read("src/platforms/web/components/pos/ConnectDatabaseScreen.tsx");

    expect(settings).toContain('<CloudConnectionPanel presentation="dialog" />');
    expect(cloud).toContain('presentation = "panel"');
    expect(cloud).toContain("<DialogContent");
    expect(cloud).toContain("Configure connection");
    expect(cloud).toContain("Central database configured");
    expect(firstRun).toContain("<CloudConnectionPanel onConnected={continueStartup} />");
    expect(firstRun).not.toContain('presentation="dialog"');
  });

  it("uses each independently authorized page's granular permission", () => {
    const frame = read("src/platforms/web/components/pos/settings/SettingsFrame.tsx");
    const database = read("src/routes/settings.database.tsx");
    const sessions = read("src/routes/settings.sessions.tsx");
    const cloud = read("src/platforms/web/components/pos/settings/panels/CloudConnectionPanel.tsx");

    expect(frame).toContain("permission?: PermissionFlag");
    expect(frame).toContain("const canSettings = isAdmin || can(requiredPermission)");
    expect(database).toContain('permission="can_manage_sync_backup"');
    expect(sessions).toContain('permission="can_manage_terminals"');
    expect(cloud).toContain('auth?.can("can_manage_sync_backup")');
    expect(cloud).not.toContain("auth?.isSupervisor || auth?.isAdmin");
  });

  it("saves only the display profile and keeps synchronous UI stores idempotent", () => {
    const display = read("src/platforms/web/components/pos/DisplayScalingSettings.tsx");
    const scale = read("src/lib/use-ui-scale.ts");
    const accent = read("src/lib/accent.ts");

    expect(display).not.toContain("...state.settings.integrations,");
    expect(display).toContain("displayProfile:");
    expect(display).not.toContain("applyTheme(value)");
    expect(display).not.toContain("applyPalette(value)");
    expect(scale).toContain("next.registerZoom === prefs.registerZoom");
    expect(accent).toContain("if (next === accent) return");
  });
});

describe("shift status privacy", () => {
  it("does not expose the shift opener in shared status surfaces", () => {
    expect(read("src/platforms/web/components/pos/AppShell.tsx")).not.toContain(
      "activeShift.cashier",
    );
    expect(read("src/platforms/web/components/pos/ShiftGuard.tsx")).not.toContain(
      "Shift open · {activeShift.cashier}",
    );
    expect(read("src/routes/index.tsx")).not.toContain("`${activeShift.cashier} · shift open`");
  });
});
