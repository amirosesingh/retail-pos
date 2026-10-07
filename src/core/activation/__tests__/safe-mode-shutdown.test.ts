/**
 * A till that has never been configured must land on the repair screen, not
 * disappear. The desktop shell cannot be imported in a test (it starts
 * Electron), so the ordering rules are read out of the source, and the
 * quit rule itself is re-created here and checked.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const main = readFileSync(require_.resolve("../../../../electron/main.cjs"), "utf8");
const recovery = readFileSync(require_.resolve("../../../../electron/recovery.cjs"), "utf8");

/** Mirror of the `window-all-closed` rule in the shell. */
function shouldQuit(repairWindowOpen: boolean): boolean {
  return !repairWindowOpen;
}

const safeModeBody = main.slice(
  main.indexOf("function enterSafeMode"),
  main.indexOf("/* ------------------------- local app server"),
);

describe("desktop safe mode", () => {
  it("opens the repair window before closing the till windows", () => {
    const opened = safeModeBody.indexOf("recovery.open()");
    const destroyed = safeModeBody.indexOf("win.destroy()");
    expect(opened).toBeGreaterThan(-1);
    expect(destroyed).toBeGreaterThan(-1);
    expect(opened).toBeLessThan(destroyed);
  });

  it("never destroys the repair window along with the till", () => {
    expect(safeModeBody).toContain("recovery.isOwn(win)");
    expect(recovery).toContain("isOwn");
  });

  it("stays running while the repair window is on screen", () => {
    expect(main).toContain("if (recovery.isOpen()) return;");
    expect(shouldQuit(true)).toBe(false);
    expect(shouldQuit(false)).toBe(true);
  });

  it("treats a painted page as a started app, whatever screen it shows", () => {
    expect(main).toContain('win.webContents.on("did-finish-load", () => markStartupSettled())');
  });

  it("goes to the repair screen when the local app server dies", () => {
    expect(main).toContain(
      "if (!quitting && !safeMode && !intentionallyStoppedServers.has(child))",
    );
    expect(main).toContain('enterSafeMode("The local app server stopped")');
    expect(main).toContain("intentionallyStoppedServers.add(child)");
    expect(main).toContain("await stopAppServer()");
  });
});
