import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("terminal command permissions", () => {
  it("does not query the protected command table through an anonymous browser session", () => {
    const source = readFileSync("src/platforms/web/components/pos/TelemetryAgent.tsx", "utf8");
    expect(source).toContain("if (!hasStaffSession()) return;");
    expect(source.indexOf("if (!hasStaffSession()) return;")).toBeLessThan(
      source.indexOf("await runPendingCommands(refreshCatalogue)"),
    );
  });
});
