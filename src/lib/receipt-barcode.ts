import qrcode from "qrcode-generator";

// Code 128 symbol widths, including the 13-module stop pattern (ISO/IEC 15417).
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 " +
  "112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 " +
  "311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 " +
  "112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 " +
  "122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
  "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

export type ReceiptBarcode = {
  kind: "code128" | "qr";
  value: string;
  width: number;
  height: number;
  /** One monochrome pixel per entry; 1 means black. */
  pixels: Uint8Array;
};

/** Keep the complete reference and its casing, packing long numeric date/sequence runs in Code C. */
function code128Symbols(value: string): number[] | null {
  if (!value || !/^[\x20-\x7e]+$/.test(value)) return null;
  const symbols: number[] = [104]; // Start B.
  let numeric = false;
  let index = 0;
  while (index < value.length) {
    const digits = /^\d+/.exec(value.slice(index))?.[0].length ?? 0;
    if (numeric && digits >= 2) {
      symbols.push(Number(value.slice(index, index + 2)));
      index += 2;
      continue;
    }
    if (numeric) { symbols.push(100); numeric = false; }
    const switchToNumeric = digits >= 6 || (digits >= 4 && index + digits === value.length);
    if (switchToNumeric && digits % 2 === 0) {
      if (index === 0) symbols[0] = 105; // Start C avoids an unnecessary switch.
      else symbols.push(99);
      numeric = true;
      continue;
    }
    symbols.push(value.charCodeAt(index++) - 32);
  }
  const checksum = symbols.reduce((sum, symbol, index) => sum + symbol * (index || 1), 0) % 103;
  return [...symbols, checksum, 106];
}

/** Fit within the physical print head; never truncate a scan value or send an oversized native barcode. */
export function receiptBarcode(value: string, maxDots: number, barHeight = 80): ReceiptBarcode | null {
  if (!value) return null;
  // Raster rows are byte-aligned. Reserve padding inside the width budget.
  const budget = Math.floor(Math.max(0, maxDots) / 8) * 8;
  const symbols = code128Symbols(value);
  if (symbols) {
    const patterns = symbols.map(symbol => PATTERNS[symbol]);
    const modules = 20 + patterns.reduce((sum, pattern) => sum + [...pattern].reduce((n, w) => n + Number(w), 0), 0);
    const scale = Math.min(2, Math.floor(budget / modules));
    if (scale >= 1) {
      const width = modules * scale;
      const height = Math.max(24, Math.round(barHeight));
      const row = new Uint8Array(width);
      let x = 10 * scale; // Ten-module quiet zones on both sides.
      for (const pattern of patterns) for (let part = 0; part < pattern.length; part++) {
        const span = Number(pattern[part]) * scale;
        if (part % 2 === 0) row.fill(1, x, x + span);
        x += span;
      }
      const pixels = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) pixels.set(row, y * width);
      return { kind: "code128", value, width, height, pixels };
    }
  }
  // Very narrow rolls / long references need a square code instead of unreadably thin bars.
  const qr = qrcode(0, "M");
  const utf8 = Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join("");
  qr.addData(utf8, "Byte");
  try { qr.make(); } catch { return null; }
  const count = qr.getModuleCount();
  const scale = Math.min(4, Math.floor(budget / (count + 8)));
  if (scale < 1) return null;
  const size = (count + 8) * scale;
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    if (!qr.isDark(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++)
      pixels[((y + 4) * scale + dy) * size + (x + 4) * scale + dx] = 1;
  }
  return { kind: "qr", value, width: size, height: size, pixels };
}

/** GS v 0 raster pixels, bounded to the printable head width including byte padding. */
export function receiptBarcodeBytes(bitmap: ReceiptBarcode): number[] {
  const rowBytes = Math.ceil(bitmap.width / 8);
  const bytes = [0x1d, 0x76, 0x30, 0, rowBytes & 255, rowBytes >> 8, bitmap.height & 255, bitmap.height >> 8];
  for (let y = 0; y < bitmap.height; y++) for (let byte = 0; byte < rowBytes; byte++) {
    let bits = 0;
    for (let bit = 0; bit < 8; bit++) {
      const x = byte * 8 + bit;
      if (x < bitmap.width && bitmap.pixels[y * bitmap.width + x]) bits |= 0x80 >> bit;
    }
    bytes.push(bits);
  }
  return bytes;
}
