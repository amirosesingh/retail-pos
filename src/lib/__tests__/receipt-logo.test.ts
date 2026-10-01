import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normalizeReceiptLogoLayout } from "../receipt-logo";
import { saleReceiptPreview, setPreviewReceiptCfg } from "../pos-print";
import { defaultReceiptSettings } from "../pos-seed";
import type { ReceiptSettings, Sale, TaxSettings } from "@/core/types/pos-types";

const sale: Sale = {
  id: "sale-logo",
  receiptNo: "TEST-001",
  storeId: "store-1",
  shiftId: "shift-1",
  cashier: "Tester",
  lines: [],
  subtotal: 0,
  discount: 0,
  tax: 0,
  total: 0,
  paid: 0,
  change: 0,
  method: "cash",
  memberId: null,
  pointsEarned: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const tax: TaxSettings = { enabled: false, rate: 0, mode: "exclusive" };

const render = (logoLayout: ReceiptSettings["logoLayout"]) => {
  setPreviewReceiptCfg(
    {
      ...defaultReceiptSettings,
      companyName: "Logo Company",
      logo: "data:image/png;base64,AAAA",
      showLogo: true,
      logoLayout,
    },
    tax,
  );
  return saleReceiptPreview(sale, null, "sale");
};

describe("receipt logo layout", () => {
  it("keeps image upload in Business identity and layout controls in Receipt designer", () => {
    const identity = readFileSync("src/routes/settings.identity.tsx", "utf8");
    const designer = readFileSync("src/routes/settings.receipt-designer.tsx", "utf8");
    const elements = readFileSync("src/routes/settings.elements.tsx", "utf8");
    expect(identity).toContain('type="file"');
    expect(identity).toContain("prepareReceiptLogo");
    expect(designer).not.toContain('type="file"');
    expect(designer).toContain("logoLayout");
    expect(elements).toContain('key: "showLogo"');
  });

  it("normalizes synchronized JSON before it reaches inline print styles", () => {
    expect(
      normalizeReceiptLogoLayout({
        position: "outside",
        alignment: "javascript:bad",
        widthPercent: 999,
        maxHeightMm: -2,
      }),
    ).toEqual({
      position: "above-name",
      alignment: "center",
      widthPercent: 100,
      maxHeightMm: 6,
    });
  });

  it("renders the configured responsive size and alignment", () => {
    const html = render({
      position: "above-name",
      alignment: "right",
      widthPercent: 40,
      maxHeightMm: 15,
    });
    expect(html).toContain("text-align:right");
    expect(html).toContain("width:40%;max-height:15mm");
  });

  it.each([
    ["above-name", true],
    ["below-name", false],
  ] as const)("places the logo at %s", (position, logoBeforeName) => {
    const html = render({ position, alignment: "center", widthPercent: 60, maxHeightMm: 22 });
    const logoAt = html.indexOf('<div class="logo"');
    const nameAt = html.indexOf("<h1>Logo Company</h1>");
    expect(logoAt < nameAt).toBe(logoBeforeName);
  });

  it("can place the logo after the business details", () => {
    const html = render({
      position: "after-details",
      alignment: "left",
      widthPercent: 60,
      maxHeightMm: 22,
    });
    expect(html.indexOf('<div class="logo"')).toBeGreaterThan(html.indexOf("VAT / Tax No."));
  });
});

describe("receipt tax visibility", () => {
  const taxableSale: Sale = {
    ...sale,
    subtotal: 100,
    tax: 8,
    total: 108,
    paid: 108,
  };

  it("does not print tax when the global tax switch is off", () => {
    setPreviewReceiptCfg(
      { ...defaultReceiptSettings, showTax: true },
      { enabled: false, rate: 8, mode: "exclusive" },
    );
    const html = saleReceiptPreview(taxableSale, null, "sale");
    expect(html).not.toContain("Tax 8%");
  });

  it("prints the configured global percentage when tax is on", () => {
    setPreviewReceiptCfg(
      { ...defaultReceiptSettings, showTax: true },
      { enabled: true, rate: 8, mode: "exclusive" },
    );
    const html = saleReceiptPreview(taxableSale, null, "sale");
    expect(html).toContain("Tax 8%");
  });
});
