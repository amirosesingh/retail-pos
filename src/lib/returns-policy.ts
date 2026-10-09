import type { CartLine } from "@/core/types/pos-types";

export const CUSTOMER_REFUNDS_ALLOWED: boolean = false;
export const NO_REFUND_MESSAGE = "Company policy allows exchanges only; customer refunds are not available.";

export function exchangePolicyError(lines: CartLine[], total: number, exchangeRef: string | null): string | null {
  if (total < 0) return "Choose an equal or higher-value replacement. Exchange differences cannot be refunded.";
  if (exchangeRef && !lines.some(line => line.qty > 0 && !line.credit))
    return "Add a replacement item before completing the exchange.";
  return null;
}
