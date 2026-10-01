import { describe, expect, it } from "vitest";
import { encodeText, slipToBytes } from "@/lib/escpos";

describe("thermal receipt output", () => {
  it("transliterates receipt punctuation instead of printing question marks", () => {
    const text = "Approval — 22% · item → total…";
    const output = String.fromCharCode(...encodeText(text, "ascii"));
    expect(output).toBe("Approval - 22%  |  item -> total...");
    expect(output).not.toContain("?");
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
});
