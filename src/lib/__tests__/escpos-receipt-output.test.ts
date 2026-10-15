import { describe, expect, it } from "vitest";
import { encodeText, slipToBytes } from "@/lib/escpos";
import { barcodeSvg } from "@/lib/pos-print";

describe("thermal receipt output", () => {
  it("transliterates receipt punctuation instead of printing question marks", () => {
    const text = "Approval — 22% · item → total…";
    const output = String.fromCharCode(...encodeText(text, "ascii"));
    expect(output).toBe("Approval - 22%  |  item -> total...");
    expect(output).not.toContain("?");
  });

  it("keeps the middle dot when the selected printer code page supports it", () => {
    expect(encodeText("A · B", "cp437")).toEqual([0x41, 0x20, 0xfa, 0x20, 0x42]);
  });

  it("renders a width-bounded barcode image instead of an oversized printer barcode command", () => {
    const bytes = slipToBytes([{ text: "Receipt" }], { barcode: "RCPT-123", barcodeWidthDots: 320 });
    const command = bytes.findIndex((_, index) => bytes[index] === 0x1d && bytes[index + 1] === 0x76 && bytes[index + 2] === 0x30);
    expect(command).toBeGreaterThan(-1);
    expect((bytes[command + 4] + bytes[command + 5] * 256) * 8).toBeLessThanOrEqual(320);
    expect(bytes.some((byte, index) => byte === 0x1d && bytes[index + 1] === 0x6b)).toBe(false);
    expect(String.fromCharCode(...bytes)).toContain("RCPT-123");
  });

  it("prints browser barcodes as SVG with scanner quiet zones", () => {
    const html = barcodeSvg("RCPT-123");
    expect(html).toContain("<svg");
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('<rect x="20"');
    expect(html).toContain("RCPT-123");
  });
});
