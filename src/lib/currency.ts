/** Display currency only; changing it never converts stored amounts. */
export const CURRENCIES = ["USD", "BND", "MYR", "SGD", "THB", "IDR", "PHP", "HKD", "INR", "AED", "PKR", "JPY", "AUD", "GBP", "EUR", "KES"] as const;
let currency = "USD";
export function currencyCode(value?: string): string {
  return CURRENCIES.includes(value as typeof CURRENCIES[number]) ? value! : "USD";
}
export function setPosCurrency(value?: string) { currency = currencyCode(value); }
export function posCurrency() { return currency; }
const formatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(value: number, code = currency): string {
  const valid = currencyCode(code);
  let formatter = formatters.get(valid);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: valid, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(valid, formatter);
  }
  return formatter.format(Number.isFinite(value) ? value : 0);
}
