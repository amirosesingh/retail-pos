import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rolePermissions, getEffectivePermissions } from "../permissions";
describe("shift history visibility", () => {
  it("keeps sign-in history off for cashiers unless explicitly granted", () => {
    expect(rolePermissions("cashier").can_shift_signin_history_view).toBe(false);
    expect(
      getEffectivePermissions("cashier", { can_shift_signin_history_view: true })
        .can_shift_signin_history_view,
    ).toBe(true);
    expect(
      getEffectivePermissions("cashier", { can_shift_signin_history_view: false })
        .can_shift_signin_history_view,
    ).toBe(false);
  });
  it("moves searchable histories into dialogs and removes the duplicate receipts table", () => {
    const route = readFileSync("src/routes/shifts.tsx", "utf8");
    expect(route).toContain("open={mayViewSignIns && signHistoryOpen}");
    expect(route).toContain("open={mayViewShiftHistory && shiftHistoryOpen}");
    expect(route).toContain('aria-label="Search sign-in history"');
    expect(route).toContain('aria-label="Search shift history"');
    expect(route).toContain("!mayViewSignIns || !signHistoryOpen");
    expect(route).not.toContain("storeSales.map((s)");
    expect(route).not.toContain("printSaleReceipt");
    expect(route).toContain("Current shift, drawer control and X / Z reports");
  });
});
