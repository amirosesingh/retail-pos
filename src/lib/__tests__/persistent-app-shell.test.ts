import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bypassPersistentAppShell } from "@/lib/app-shell-routes";

describe("persistent application shell", () => {
  it("keeps protected application routes in the shared shell", () => {
    expect(bypassPersistentAppShell("/")).toBe(false);
    expect(bypassPersistentAppShell("/settings/payment")).toBe(false);
    expect(bypassPersistentAppShell("/reports/sales")).toBe(false);
    expect(bypassPersistentAppShell("/inventory")).toBe(false);
  });

  it("leaves public, customer-display and recovery surfaces unwrapped", () => {
    expect(bypassPersistentAppShell("/display")).toBe(true);
    expect(bypassPersistentAppShell("/join")).toBe(true);
    expect(bypassPersistentAppShell("/claim/summer-sale")).toBe(true);
    expect(bypassPersistentAppShell("/c/member-token")).toBe(true);
    expect(bypassPersistentAppShell("/recovery")).toBe(true);
    expect(bypassPersistentAppShell("/database-startup")).toBe(true);
  });

  it("owns the shell above the route outlet", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    const shell = readFileSync("src/platforms/web/components/pos/AppShell.tsx", "utf8");
    expect(root).toContain("<PersistentRouteOutlet />");
    expect(root).toContain("<AppShell>");
    expect(root).toContain("<Outlet />");
    expect(shell).toContain("if (nested) return <>{children}</>");
  });
});
