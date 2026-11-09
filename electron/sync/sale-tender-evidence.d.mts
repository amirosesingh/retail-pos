export const extendedTenderFields: readonly string[];
export function extendedPayments(sale: Record<string, unknown>, tenders: Record<string, unknown>[]): unknown[] | null;
export function decodeTenderJson(value: unknown): unknown;
