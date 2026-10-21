import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/pos-store", () => ({ usePos: () => { throw new Error("No POS provider in Recovery"); } }));
import { RecoveryPrinterSettings } from "@/platforms/web/components/pos/ReceiptPrinterSettings";
it("renders recovery printer and drawer controls without mounting POS business state", () => {
  const html = renderToStaticMarkup(createElement(RecoveryPrinterSettings));
  expect(html).toContain("Test drawer kick");
  expect(html).toContain("Test receipt");
  expect(html).toContain("Refresh printers");
});
