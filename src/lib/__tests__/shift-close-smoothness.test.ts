import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const dialog = readFileSync("src/platforms/web/components/pos/ShiftCloseDialog.tsx", "utf8");
const printer = readFileSync("src/lib/receipt-printer.ts", "utf8");
describe("shift closing refresh and hardware boundaries", () => {
  it("retains totals during background refresh and scopes them to the operator and shift", () => {
    expect(dialog).toContain("expectedSnapshot?.owner === owner");
    expect(dialog).not.toContain("setExpected(null)");
    expect(dialog).not.toContain("[open,activeShift,step");
    expect(dialog).toContain("}, [open, owner]);");
  });
  it("authorizes closure before attempting hardware and continues after a drawer failure", () => {
    const start = dialog.indexOf("const res = await startShiftClose");
    const drawer = dialog.indexOf("const drawer = await openCashDrawer");
    expect(start).toBeLessThan(drawer);
    expect(dialog.slice(drawer, dialog.indexOf("Starting shift close", drawer))).not.toContain(
      "return;",
    );
    expect(dialog).toContain("if (canOpenDrawer())");
    expect(printer).toContain('return typeof printBridge()?.openDrawer === "function";');
  });
});
