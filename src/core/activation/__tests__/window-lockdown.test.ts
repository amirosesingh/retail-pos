/**
 * The window that holds the till bridge must stay on the till's own pages.
 *
 * The desktop shell cannot be imported in a test (it starts Electron), so the
 * two guards are read out of the source and their behaviour is checked against
 * the same rule the shell applies: same origin stays, anything else is turned
 * away and handed to the operator's normal browser.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const main = readFileSync(require_.resolve("../../../../electron/main.cjs"), "utf8");

/** Mirror of `sameApp()` in the shell, used to check the rule itself. */
function sameApp(target: string, baseUrl: string): boolean {
  try {
    const url = new URL(target);
    if (url.protocol === "data:" || url.protocol === "about:") return true;
    if (!baseUrl) return false;
    return url.origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

describe("desktop window lockdown", () => {
  it("keeps the guards wired into every window the shell instruments", () => {
    expect(main).toContain("lockDownNavigation(win, route)");
    expect(main).toMatch(/will-navigate/);
    expect(main).toMatch(/setWindowOpenHandler/);
    expect(main).toMatch(/will-attach-webview/);
    expect(main).toMatch(/Content-Security-Policy/);
    expect(main).toContain('"content-security-policy-report-only"');
    expect(main).toContain("name.toLowerCase()");
    expect(main).toMatch(/frame-ancestors 'none'/);
  });

  it("allows the app's own pages and refuses anywhere else", () => {
    const base = "http://127.0.0.1:4173";
    expect(sameApp("http://127.0.0.1:4173/settings", base)).toBe(true);
    expect(sameApp("data:text/html,receipt", base)).toBe(true);
    expect(sameApp("https://example.com/pay", base)).toBe(false);
    expect(sameApp("file:///C:/Windows/system32/", base)).toBe(false);
    expect(sameApp("not a url", base)).toBe(false);
  });

  it("never opens a second window that would inherit the bridge", () => {
    expect(main).toMatch(/setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]{0,400}action: "deny"/);
  });

  it("does not load stylesheets that the desktop policy blocks", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).not.toContain("fonts.googleapis.com");
    expect(root).not.toContain("fonts.gstatic.com");
  });
});
