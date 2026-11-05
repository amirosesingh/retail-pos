import { describe, expect, it } from "vitest";
import { settingsPatchRow } from "@/core/api/pos-db";
import { defaultSettings } from "../pos-seed";
import { normalizeReceiptHeaderLayout } from "../receipt-header";

describe("receipt field persistence", () => {
  it.each([
    ["css", "receipt_css"], ["qr", "qr"], ["fonts", "fonts"], ["customLines", "custom_lines"],
    ["headerLayout", "receipt_design"], ["logoLayout", "receipt_design"], ["footerText", "footer_text"],
  ] as const)("writes %s without overwriting unrelated receipt fields", (field, column) => {
    const receipt = { ...defaultSettings.receipt, headerLayout: normalizeReceiptHeaderLayout({ showCompany: false }) };
    const row = settingsPatchRow({ ...defaultSettings, receipt }, { receipt: { [field]: receipt[field] } });
    expect(Object.keys(row).sort()).toEqual(["id", column, "updated_at"].sort());
    if (column === "receipt_design") expect(row.receipt_design).toEqual({ logoLayout: receipt.logoLayout, headerLayout: receipt.headerLayout, documentLayouts: {}, documentSections: {} });
  });
  it("persists document switches with the heading without writing payment or font settings", () => {
    const receipt = { ...defaultSettings.receipt, headerLayout: normalizeReceiptHeaderLayout({ showCompany: false }), documentLayouts: { booking: { showPhone: false }, "racket-staff": { showRacket: false } } };
    const row = settingsPatchRow({ ...defaultSettings, receipt }, { receipt: { documentLayouts: receipt.documentLayouts } });
    expect(row.receipt_design).toEqual({ logoLayout: receipt.logoLayout, headerLayout: receipt.headerLayout, documentLayouts: receipt.documentLayouts, documentSections: {} });
    expect(row).not.toHaveProperty("fonts");
    expect(row).not.toHaveProperty("payment_details");
  });
  it("retains complete receipt snapshot saves when the complete section is supplied", () => {
    const row = settingsPatchRow(defaultSettings, { receipt: defaultSettings.receipt });
    expect(row).toHaveProperty("fonts");
    expect(row).toHaveProperty("receipt_design");
    expect(row).toHaveProperty("qr");
    expect(row).not.toHaveProperty("integration_settings");
  });
});
