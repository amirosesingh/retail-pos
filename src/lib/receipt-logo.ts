import type { ReceiptSettings } from "@/core/types/pos-types";

const MAX_EDGE = 512;
const MAX_FILE_BYTES = 2_000_000;
const MAX_DATA_URL_CHARS = 200_000;

export const DEFAULT_RECEIPT_LOGO_LAYOUT: ReceiptSettings["logoLayout"] = {
  position: "above-name",
  alignment: "center",
  widthPercent: 60,
  maxHeightMm: 22,
};

const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Keep synchronized or legacy JSON safe for inline print styles. */
export function normalizeReceiptLogoLayout(value: unknown): ReceiptSettings["logoLayout"] {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const position = ["above-name", "below-name", "after-details"].includes(String(source.position))
    ? (source.position as ReceiptSettings["logoLayout"]["position"])
    : DEFAULT_RECEIPT_LOGO_LAYOUT.position;
  const alignment = ["left", "center", "right"].includes(String(source.alignment))
    ? (source.alignment as ReceiptSettings["logoLayout"]["alignment"])
    : DEFAULT_RECEIPT_LOGO_LAYOUT.alignment;
  return {
    position,
    alignment,
    widthPercent: numberInRange(source.widthPercent, 60, 20, 100),
    maxHeightMm: numberInRange(source.maxHeightMm, 22, 6, 40),
  };
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });

const readImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be opened"));
    image.src = source;
  });

/** Prepare one transparent PNG that is small enough to synchronize to every till. */
export async function prepareReceiptLogo(file: File): Promise<string> {
  if (file.type !== "image/png") {
    throw new Error("Use a PNG file so the transparent background prints correctly");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Logo must be smaller than 2 MB");
  }

  const raw = await readDataUrl(file);
  const image = await readImage(raw);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  if (scale === 1 && raw.length <= MAX_DATA_URL_CHARS) return raw;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This device could not prepare the logo");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const result = canvas.toDataURL("image/png");
  if (result.length > MAX_DATA_URL_CHARS) {
    throw new Error("That logo is too detailed; use a simpler PNG under about 150 KB");
  }
  return result;
}
