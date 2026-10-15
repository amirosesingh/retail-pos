import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { receiptBarcode, receiptBarcodeBytes } from "../receipt-barcode";
import { htmlToEscPos, slipToBytes } from "../escpos";
import { barcodeSvg, setPrintSettings } from "../pos-print";
import { defaultSettings } from "../pos-seed";
const require = createRequire(import.meta.url);
const { BitArray, Code128Reader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader } = require("html5-qrcode/third_party/zxing-js.umd.js");
const { containsDrawerPulse } = require("../../../electron/receipt-command-guard.cjs");
const reference = "LC361D-WIN01-20261015-0001";

function decodeCode128(bitmap: NonNullable<ReturnType<typeof receiptBarcode>>): string {
  const row = new BitArray(bitmap.width);
  for (let x = 0; x < bitmap.width; x++) if (bitmap.pixels[x]) row.set(x);
  return new Code128Reader().decodeRow(0, row, new Map()).getText();
}
function decodeQr(bitmap: NonNullable<ReturnType<typeof receiptBarcode>>): string {
  const scale = 4;
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const luminance = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    luminance[y * width + x] = bitmap.pixels[Math.floor(y / scale) * bitmap.width + Math.floor(x / scale)] ? 0 : 255;
  const source = new RGBLuminanceSource(luminance, width, height);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
}

describe("receipt barcode printable width", () => {
  it.each(["RCPT-123", reference, "GIFT-" + reference, "lower_case:{receipt}", "12345678901234567890", "A123456B7", "0001"])
    ("round-trips the full scan value %s using an independent barcode decoder", value => {
      const bitmap = receiptBarcode(value, 512)!;
      expect(bitmap.kind).toBe("code128");
      expect(decodeCode128(bitmap)).toBe(value);
      expect(bitmap.pixels.slice(0, 10)).toEqual(new Uint8Array(10));
      expect(bitmap.pixels.slice(bitmap.width - 10, bitmap.width)).toEqual(new Uint8Array(10));
    });
  it.each([128, 320, 512, 576])("keeps normal and long references within a %i-dot print head", width => {
    for (const value of [reference, "GIFT-" + reference, "BK-LC361D-WIN01-20261015-0001-" + "A".repeat(80)]) {
      const bitmap = receiptBarcode(value, width)!;
      const bytes = receiptBarcodeBytes(bitmap);
      expect(bitmap.width).toBeLessThanOrEqual(width);
      expect((bytes[4] + bytes[5] * 256) * 8).toBeLessThanOrEqual(width);
      expect(bytes.length).toBe(8 + Math.ceil(bitmap.width / 8) * bitmap.height);
      expect(bitmap.kind === "code128" ? decodeCode128(bitmap) : decodeQr(bitmap)).toBe(value);
    }
  });
  it("falls back to a scannable square code instead of truncating a reference on narrow rolls", () => {
    const bitmap = receiptBarcode("GIFT-" + reference, 128)!;
    expect(bitmap.kind).toBe("qr");
    expect(decodeQr(bitmap)).toBe("GIFT-" + reference);
  });
  it("uses each paper width and honors a smaller configured printable band", () => {
    for (const [paper, maxDots] of [["30mm", 192], ["58mm", 384], ["80mm", 576]] as const) {
      const bytes = htmlToEscPos("", paper, { barcode: reference });
      const start = bytes.findIndex((_, index) => bytes[index] === 0x1d && bytes[index + 1] === 0x76);
      expect((bytes[start + 4] + bytes[start + 5] * 256) * 8).toBeLessThanOrEqual(maxDots);
    }
    const bytes = slipToBytes([], { barcode: reference, barcodeWidthDots: 128 });
    expect(containsDrawerPulse(bytes)).toBe(false);
  });
  it("draws a bounded SVG and preserves receipt/gift references in driver printing", () => {
    setPrintSettings({ ...defaultSettings.receipt, paper: "58mm" }, defaultSettings.tax);
    try {
      expect(barcodeSvg(reference)).toContain('data-symbology="code128"');
      expect(barcodeSvg(reference)).toContain(reference);
      expect(barcodeSvg(reference)).toContain("max-width:100%");
      setPrintSettings({ ...defaultSettings.receipt, paper: "30mm" }, defaultSettings.tax);
      expect(barcodeSvg("GIFT-" + reference)).toContain('data-symbology="qr"');
      expect(barcodeSvg("GIFT-" + reference)).toContain("GIFT-" + reference);
    } finally { setPrintSettings(defaultSettings.receipt, defaultSettings.tax); }
  });
  it("does not mistake image pixels for drawer commands but rejects actual pulses after an image", () => {
    const pixels = [0x1b,0x70,0,0x19,0xfa];
    const image = [0x1d,0x76,0x30,0,5,0,1,0,...pixels];
    expect(containsDrawerPulse(image)).toBe(false);
    expect(containsDrawerPulse([...image,...pixels])).toBe(true);
    expect(containsDrawerPulse([0x1d,0x76,0x30,0,255,0,1,0,...pixels])).toBe(true);
    expect(containsDrawerPulse(pixels)).toBe(true);
  });
});
