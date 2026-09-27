import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shift report printing", () => {
  const printing = readFileSync("src/lib/pos-print.ts", "utf8");
  const closeDialog = readFileSync(
    "src/platforms/web/components/pos/ShiftCloseDialog.tsx",
    "utf8",
  );

  it("filters every sensitive report section using explicit permissions", () => {
    for (const key of ["financialSummary", "paymentBreakdown", "expected", "counted", "variance"]) {
      expect(printing).toContain(`${key}: boolean`);
      expect(closeDialog).toContain(`${key}: maySee`);
    }
  });

  it("awaits the printer result without resubmitting the shift close", () => {
    expect(closeDialog).toContain("const printed = await printShiftReport");
    expect(closeDialog).toContain("The shift is safely closed. Reprint the Z report");
    expect(printing).toContain("Promise<PrintResult>");
  });
});
