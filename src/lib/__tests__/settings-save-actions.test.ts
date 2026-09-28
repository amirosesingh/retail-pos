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

  it("uses each independently authorized page's granular permission", () => {
    const frame = read("src/platforms/web/components/pos/settings/SettingsFrame.tsx");
    const database = read("src/routes/settings.database.tsx");
    const sessions = read("src/routes/settings.sessions.tsx");
    const cloud = read(
      "src/platforms/web/components/pos/settings/panels/CloudConnectionPanel.tsx",
    );

    expect(frame).toContain("permission?: PermissionFlag");
    expect(frame).toContain("const canSettings = isAdmin || can(requiredPermission)");
    expect(database).toContain('permission="can_manage_sync_backup"');
    expect(sessions).toContain('permission="can_manage_terminals"');
    expect(cloud).toContain('auth?.can("can_manage_sync_backup")');
    expect(cloud).not.toContain("auth?.isSupervisor || auth?.isAdmin");
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
