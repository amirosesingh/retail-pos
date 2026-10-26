import { paperCss, printableWidthMm, saleReceiptPreview, setPreviewReceiptCfg } from "../pos-print";
import { defaultReceiptSettings } from "../pos-seed";
import type { Sale } from "@/core/types/pos-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnsForPaper } from "../escpos";
import { getPrinterPrefs, setSharedPrinterPrefs } from "../receipt-printer";

afterEach(() => { setSharedPrinterPrefs(undefined); setPreviewReceiptCfg(defaultReceiptSettings, { enabled: false, rate: 0, mode: "exclusive" }); vi.unstubAllGlobals(); });
describe("shared printer profiles", () => {
  it("supports the narrow 30mm roll without changing existing column counts", () => {
    expect(columnsForPaper("30mm")).toBe(16);
    expect(columnsForPaper("58mm")).toBe(32);
    expect(columnsForPaper("80mm")).toBe(42);
  });
  it("uses the selected paper width and subtracts margins only once", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    setSharedPrinterPrefs({ deviceName: "", share: "", margins: { top: 0, bottom: 0, left: 4, right: 4 },
      printWidth: { "30mm": 24, "58mm": 48, "80mm": 72 } });
    expect(paperCss("30mm").page).toBe("30mm auto");
    expect(printableWidthMm("30mm")).toBe(22);
    expect(printableWidthMm("58mm")).toBe(50);
    expect(printableWidthMm("80mm")).toBe(72);
  });
  it("uses full roll width with zero margins despite legacy width calibration", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    setSharedPrinterPrefs({ deviceName: "", share: "", margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printWidth: { "30mm": 24, "58mm": 48, "80mm": 72 }, printOffset: 5 });
    for (const [paper, width] of [["30mm", 30], ["58mm", 58], ["80mm", 80]] as const) {
      expect(printableWidthMm(paper)).toBe(width);
      expect(paperCss(paper).width).toBe(`${width}mm`);
    }
  });
  it("uses the current scope and falls back to the device profile when cleared", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ deviceName: "Local" }) } });
    setSharedPrinterPrefs({ deviceName: "Branch 1", share: "", printWidth: { "30mm": 24, "58mm": 48, "80mm": 72 } });
    expect(getPrinterPrefs().deviceName).toBe("Branch 1");
    expect(getPrinterPrefs().printWidth?.["30mm"]).toBe(24);
    setSharedPrinterPrefs({ deviceName: "Branch 2", share: "" });
    expect(getPrinterPrefs().deviceName).toBe("Branch 2");
    setSharedPrinterPrefs(undefined);
    expect(getPrinterPrefs().deviceName).toBe("Local");
  });
  it("renders the full paper and configured margins for screen and print without a hidden offset", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    setSharedPrinterPrefs({ deviceName: "", share: "", margins: { top: 1, right: 2, bottom: 3, left: 4 }, printOffset: 5 });
    setPreviewReceiptCfg({ ...defaultReceiptSettings, paper: "58mm", fonts: {
      ...defaultReceiptSettings.fonts, body: { family: "arial", size: 11.5, spacing: 0, bold: false },
    } }, { enabled: false, rate: 0, mode: "exclusive" });
    const sale: Sale = { id: "preview", storeId: "preview-store", shiftId: "preview-shift", memberId: null, receiptNo: "PREVIEW-1", createdAt: "2026-10-26T00:00:00Z", cashier: "Preview", method: "cash", subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, change: 0, pointsEarned: 0, lines: [] };
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html).toContain("@page { size: 58mm auto; margin: 1mm 2mm 3mm 4mm;");
    expect(html).toContain("padding: 1mm 2mm 3mm 4mm; width: 58mm");
    expect(html).toContain("body { width: 52mm; margin: 0 auto; padding: 0;");
    expect(html).toContain("font-family: Arial, Helvetica, sans-serif; font-size: 11.5px;");
    expect(html).not.toContain("margin: 0 0 0 5mm");
    expect(html).not.toContain("window.print()");
  });
});
