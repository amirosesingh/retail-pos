/** Historic/imported rows must never take the report centre down. */
export function safeReceiptNo(value: unknown, fallback: unknown): string {
  return String(value ?? fallback ?? "Unnumbered");
}

export function receiptSequence(value: unknown): number {
  const tail = String(value ?? "").split("-").pop();
  const parsed = Number(tail);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function safeCreatedAt(value: unknown): string {
  return typeof value === "string" && value ? value : new Date(0).toISOString();
}
