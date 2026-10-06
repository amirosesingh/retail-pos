import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("offline connection recovery", () => {
  it("enables the connection editor only after the emergency PIN gate opens", () => {
    const recovery = readFileSync(
      "src/platforms/web/components/pos/RecoveryHub.tsx",
      "utf8",
    );
    const panel = readFileSync(
      "src/platforms/web/components/pos/settings/panels/CloudConnectionPanel.tsx",
      "utf8",
    );
    const gate = readFileSync(
      "src/platforms/web/components/pos/EmergencyPinGate.tsx",
      "utf8",
    );
    const preload = readFileSync("electron/preload.cjs", "utf8");
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(recovery).toContain("<CloudConnectionPanel recoveryUnlocked />");
    expect(panel).toContain("firstRun || privileged || unlocked || recoveryUnlocked");
    expect(gate).toContain("submitAdministrator");
    expect(preload).toContain('recoveryUnlock: (username, pin) => invoke("admin:recovery-unlock", username, pin)');
    expect(main).toContain('ipcMain.handle("admin:recovery-unlock"');
    expect(main).toContain("verifySyncedApprovalPin(databaseManager.pool, user, secret");
    expect(main).toContain('/auth/v1/token?grant_type=password');
    expect(main).toContain('/api/v1/pos/ipc-adopt');
    expect(main).toContain('setTimeout(() => authController.abort(), 8_000)');
    expect(main).not.toContain("grantRecovery(guard.text(code");
    expect(gate).toContain("Verifying administrator…");
    expect(gate).toContain('{error && <p className="text-sm text-destructive">{error}</p>}');
  });
});
