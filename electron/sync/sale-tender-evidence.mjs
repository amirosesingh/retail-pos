const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = value => typeof value === "string" && UUID.test(value);
export const extendedTenderFields = ["client_transaction_id", "reference", "cashier_name"];
const paymentFields = ["id", "method", "amount", "bankName", "ref", "reference", "referenceNote", "requiresReference", "accountId"];
const metadataFields = ["bill", "voucher_reference", "reference_note", "bank", "captured_at", "captured_by"];
const method = value => value === "cash" || value === "card";
const cents = value => {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,12})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (/[^0]/.test(fraction.slice(2))) return null;
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};
const object = value => !!value && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length <= 500 && !/\p{Cc}/u.test(value);
export function decodeTenderJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

// A v2 receipt retains the checkout's payment account and its reconciliation
// fields. The ledger rows are ordered by the existing per-tender attempt key.
export function extendedPayments(sale, tenders) {
  const payments = decodeTenderJson(sale.payments);
  if (!Array.isArray(payments) || payments.length !== tenders.length || !payments.length || payments.length > 16 ||
      new Set(tenders.map(tender => tender.id)).size !== tenders.length ||
      !payments.some(payment => payment?.method === "card") ||
      new Set(payments.map(payment => typeof payment?.id === "string" ? payment.id.toLowerCase() : null)).size !== payments.length) return null;
  let sum = 0n;
  let headline = null;
  let biggest = -1n;
  for (const [index, payment] of payments.entries()) {
    const tender = tenders[index];
    const amount = cents(payment?.amount);
    const expectedKey = `${sale.client_transaction_id}:pay:${index}`;
    const metadata = decodeTenderJson(tender.metadata);
    if (!object(payment) || !uuid(payment.id) || !method(payment.method) || amount === null || amount <= 0 ||
        Object.entries(payment).some(([key, value]) => !paymentFields.includes(key) ||
          (!["id", "method", "amount"].includes(key) && (key === "requiresReference" ? typeof value !== "boolean" : !text(value)))) ||
        (payment.requiresReference === true && !payment.reference?.trim()) ||
        tender.client_transaction_id !== expectedKey || tender.method !== payment.method || cents(tender.amount) !== amount ||
        !text(tender.reference) || (tender.cashier_name !== null && !text(tender.cashier_name)) ||
        !object(metadata) || Object.entries(metadata).some(([key, value]) => !metadataFields.includes(key) || !text(value)) ||
        tender.reference !== ((payment.reference ?? payment.ref ?? "").trim() || sale.bill_number) ||
        metadata.bill !== sale.bill_number ||
        (metadata.voucher_reference ?? "") !== (payment.reference ?? payment.ref ?? "").trim() ||
        (metadata.reference_note ?? "") !== (payment.referenceNote ?? "").trim() ||
        (metadata.bank ?? "") !== (payment.bankName ?? "").trim()) return null;
    sum += amount;
    if (amount > biggest) { biggest = amount; headline = payment.method; }
  }
  return headline === sale.payment_type && sum === cents(sale.paid_amount) && sum === cents(sale.total_amount) ? payments : null;
}
