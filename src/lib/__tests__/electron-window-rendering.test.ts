import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { configureWindowRendering } = require("../../../electron/window-rendering.cjs");
describe("Windows till rendering", () => {
  it("selects software rendering only on Windows", () => {
    const app = { disableHardwareAcceleration: vi.fn() };
    configureWindowRendering(app, "win32");
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    app.disableHardwareAcceleration.mockClear();
    configureWindowRendering(app, "darwin"); configureWindowRendering(app, "linux");
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
  });
  it("configures rendering before any windows or app-ready handlers and keeps the main window opaque", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main.indexOf('require("./window-rendering.cjs").configureWindowRendering(app)'))
      .toBeLessThan(main.indexOf("new BrowserWindow("));
    expect(main.indexOf('require("./window-rendering.cjs").configureWindowRendering(app)'))
      .toBeLessThan(main.indexOf("app.whenReady()"));
    expect(main).toContain("transparent: false");
    expect(main).toContain('frame: process.platform !== "win32"');
    expect(main).toContain("Menu.setApplicationMenu(null)");
    expect(main).toContain('titleBarStyle: "hidden"');
    expect(main).toContain("titleBarOverlay: false");
    expect(main).toContain("setVisualZoomLevelLimits(1, 1)");
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toMatch(/\.native-caption \{[^}]*-webkit-app-region: drag;/);
    expect(styles).toContain(".native-caption-controls { display: flex; -webkit-app-region: no-drag;");
    const caption = readFileSync("src/components/shared/NativeWindowFrame.tsx", "utf8");
    expect(caption).toContain('aria-label="Close window"');
    expect(caption).toContain('run(controls()?.closeWindow)');
    expect(main).toContain('owner(e)?.close()');
    expect(main).toContain('mainWindow.on("close", (event) =>');
    expect(styles).toContain("html, body {");
  });
});
