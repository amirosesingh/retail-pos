import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("checkout post-commit safety", () => {
  it("restores the register before optional integrations run", () => {
    const checkout = readFileSync("src/lib/register/use-checkout.ts", "utf8");
    const reset = checkout.indexOf("deps.resetCart();", checkout.indexOf("attemptId.current = null"));
    const print = checkout.indexOf('printSaleReceipt(sale, member, "sale")', reset);
    expect(reset).toBeGreaterThan(-1);
    expect(print).toBeGreaterThan(reset);
    expect(checkout).toContain('notifyError(error, "Sale saved, but printing failed")');
  });

  it("catches asynchronous printer and drawer failures", () => {
    const printing = readFileSync("src/lib/pos-print.ts", "utf8");
    expect(printing).toContain('toast.error("Printing failed"');
    expect(printing).toContain('toast.error("Drawer did not open"');
    expect(printing).toContain("const res = await rawPulse(bytes)");
    expect(printing).toMatch(/async function printHtml[\s\S]*?try \{[\s\S]*?catch \(error: unknown\)/);
  });
});
