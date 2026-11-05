import qrcode from "qrcode-generator";

export function receiptQrError(value: string): string | null {
  if (!value.trim()) return "Enter the receipt QR link or text before saving.";
  try {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return null;
  } catch {
    return "The receipt QR text is too long. Shorten the link or text before saving.";
  }
}
