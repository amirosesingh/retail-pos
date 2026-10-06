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
    expect(gate).toContain("if (!desktop.ok)");
    expect(preload).toContain('recoveryUnlock: (code) => invoke("admin:recovery-unlock", code)');
    expect(main).toContain('ipcMain.handle("admin:recovery-unlock"');
  });
});
