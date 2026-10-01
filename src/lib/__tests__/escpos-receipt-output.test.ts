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

  it("emits a length-prefixed Code 39 barcode", () => {
    const bytes = slipToBytes([{ text: "Receipt" }], { barcode: "RCPT-123" });
    const command = bytes.findIndex(
      (_, index) => bytes[index] === 0x1d && bytes[index + 1] === 0x6b && bytes[index + 2] === 69,
    );
    expect(command).toBeGreaterThan(-1);
    expect(bytes[command + 3]).toBe(8);
    expect(String.fromCharCode(...bytes.slice(command + 4, command + 12))).toBe("RCPT-123");
  });

  it("prints browser barcodes as SVG with scanner quiet zones", () => {
    const html = barcodeSvg("RCPT-123");
    expect(html).toContain("<svg");
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('<rect x="20"');
    expect(html).toContain("RCPT-123");
  });
});
