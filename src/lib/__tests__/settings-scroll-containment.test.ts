import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings scroll containment", () => {
  it("keeps the window still while settings panels own scrolling", () => {
    const shell = readFileSync(
      "src/platforms/web/components/pos/settings/SettingsShell.tsx",
      "utf8",
    );
    expect(shell).toContain('document.documentElement.style.overflow = "hidden"');
    expect(shell).toContain('document.body.style.overflow = "hidden"');
    expect(shell).toContain('className="min-h-0 flex-1 overflow-y-auto"');
    expect(shell).toContain("max-h-full");
  });

  it("uses the root-owned app shell instead of duplicating the sidebar and header", () => {
    const shell = readFileSync(
      "src/platforms/web/components/pos/settings/SettingsShell.tsx",
      "utf8",
    );
    expect(shell).not.toContain('from "@/platforms/web/components/pos/AppShell"');
    expect(shell).not.toContain("<AppShell>");
  });
});
