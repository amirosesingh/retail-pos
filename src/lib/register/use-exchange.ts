/**
 * Exchanges and refunds.
 *
 * Looks an old bill up by receipt number, lets the cashier pick the items
 * coming back, and drops them on the ticket as negative "credit" lines.
 * Lifted out of the register screen unchanged — the shift gate and the credit
 * maths behave exactly as before.
 */
import { useState } from "react";
import { toast } from "sonner";
import { lineUnitDiscount, lineDiscountTotal, r2 } from "@/core/types/pos-types";
import type { CartLine, DiscountType, Sale } from "@/core/types/pos-types";

type ExchangeDeps = {
  /** Past sales searched by receipt number. */
  sales: Sale[];
  /** No open shift = no exchange. */
  hasShift: () => boolean;
  setLines: (fn: (ls: CartLine[]) => CartLine[]) => void;
  setExchangeRef: (ref: string | null) => void;
  requirePermission: (permission: "can_process_exchange") => Promise<boolean>;
};

export const exchangeLineEligible = (line: CartLine) => line.qty > 0 && !line.credit;

/** Preserve the original bill discount instead of crediting the undiscounted price. */
export function exchangeUnitCredit(sale: Sale, line: CartLine): number {
  const eligible = sale.lines.filter(exchangeLineEligible);
  const base = eligible.reduce((sum, item) => sum + item.price * item.qty - lineDiscountTotal(item), 0);
  const lineDiscount = sale.lines.reduce((sum, item) => sum + lineDiscountTotal(item) * (item.qty < 0 ? -1 : 1), 0);
  const billDiscount = Math.max(0, sale.discount - lineDiscount);
  const ratio = base > 0 ? Math.max(0, base - billDiscount) / base : 0;
  return r2(Math.max(0, line.price - lineUnitDiscount(line)) * ratio);
}

export function exchangeBlockReason(sale: Sale): string | null {
  if (sale.refunded) return "This bill was refunded and cannot be exchanged.";
  if (sale.exchangedToReceiptNo)
    return `This bill was already exchanged to ${sale.exchangedToReceiptNo}.`;
  if (!sale.lines.some(exchangeLineEligible)) return "This bill has no exchangeable sold items.";
  return null;
}

export function findExchangeSale(sales: Sale[], query: string) {
  const ref = query.trim().toLowerCase();
  if (!ref) return { sale: null, error: "Enter the original bill number." };
  const exact = sales.find((sale) => sale.receiptNo.toLowerCase() === ref);
  if (exact) return { sale: exact, error: null };
  const partial = sales.filter((sale) => sale.receiptNo.toLowerCase().includes(ref));
  if (partial.length === 1) return { sale: partial[0]!, error: null };
  if (partial.length > 1)
    return { sale: null, error: "More than one bill matches. Enter or scan the complete bill number." };
  return { sale: null, error: `No bill found for “${query}”` };
}

export function useExchange(deps: ExchangeDeps) {
  const { sales, hasShift, setLines, setExchangeRef, requirePermission } = deps;

  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [billQuery, setBillQuery] = useState("");
  const [billHit, setBillHit] = useState<Sale | null>(null);
  /** Line index on the found bill → quantity coming back. */
  const [picks, setPicks] = useState<Record<number, number>>({});

  async function beginExchange() {
    if (!hasShift()) {
      toast.error("Open a shift before processing an exchange");
      return;
    }
    if (!(await requirePermission("can_process_exchange"))) return;
    setBillHit(null);
    setPicks({});
    setExchangeOpen(true);
  }

  function lookupBill() {
    const result = findExchangeSale(sales, billQuery);
    setBillHit(result.sale);
    setPicks({});
    if (result.error) toast.error(result.error);
  }

  function addExchangeCredits() {
    if (!billHit) return;
    if (!hasShift()) {
      toast.error("Open a shift before processing an exchange");
      return;
    }
    const blocked = exchangeBlockReason(billHit);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    if (Object.entries(picks).some(([index, qty]) => {
      const original = billHit.lines[Number(index)];
      return !Number.isFinite(qty) || qty < 0 || !original || qty > original.qty;
    })) {
      toast.error("Exchange quantity cannot exceed the quantity on the original bill");
      return;
    }
    const credits: CartLine[] = Object.entries(picks)
      .filter(([, qty]) => qty > 0)
      .flatMap(([idx, qty]) => {
        const src = billHit.lines[Number(idx)]!;
        if (!exchangeLineEligible(src)) return [];
        return [{
          productId: src.productId,
          name: src.name,
          price: exchangeUnitCredit(billHit, src),
          qty: -qty,
          taxRate: src.taxRate,
          discount: 0,
          discountType: "amount" as DiscountType,
          credit: true,
        }];
      });
    if (!credits.length) {
      toast.error("Select at least one item to exchange");
      return;
    }
    setLines((ls) => [...credits, ...ls.filter(line => !line.credit)]);
    setExchangeRef(billHit.receiptNo);
    setExchangeOpen(false);
    setBillQuery("");
    setBillHit(null);
    setPicks({});
    toast.success(`Credits from ${billHit.receiptNo} added to the ticket`);
  }

  return {
    exchangeOpen,
    setExchangeOpen,
    beginExchange,
    billQuery,
    setBillQuery,
    billHit,
    setBillHit,
    picks,
    setPicks,
    lookupBill,
    addExchangeCredits,
    billBlockReason: billHit ? exchangeBlockReason(billHit) : null,
  };
}
