/**
 * The open ticket.
 *
 * Everything that makes up what the cashier has rung up — the lines, the bill
 * discount, an exchange reference, the attached member, a coupon and the
 * reserved bill number — plus the handlers that change it. Lifted out of the
 * register screen unchanged so the till behaves exactly as before; the screen
 * now reads this instead of holding it all itself.
 */
import { useState } from "react";
import { toast } from "sonner";
import { availableAt, stockAt } from "@/lib/pos-store";
import { flushTicketDrafts } from "@/lib/session-draft";
import { blocksOutOfStockSale } from "@/lib/register/stock-guard";
import { logger } from "@/lib/audit-log";
import { TICKET_ACTIONS, logTicketEvent } from "@/lib/ticket-audit";
import type {
  BarcodeVariant,
  Booking,
  CartLine,
  DiscountType,
  Product,
  Store,
} from "@/core/types/pos-types";

/** A coupon or voucher applied to the open ticket. */
export type CartCoupon = {
  code: string;
  promoId: string;
  scope: "bill" | "item";
  discount: number;
  productId?: string;
  productName?: string;
  appliedAt: string;
  /** campaign title, printed on the slip */
  name?: string;
  /** unused value left on a fixed-amount voucher */
  remaining?: number;
};

type CartDeps = {
  /** Selling is blocked until a shift is open. */
  hasShift: boolean;
  /** Prompt the cashier to open a shift. */
  onNeedShift: () => void;
  products: Product[];
  bookings: Booking[];
  currentStore: Store;
  requirePermission: (flag: string) => Promise<boolean>;
  /** Read at the moment of clearing, for the audit line. */
  getTotal: () => number;
  getMemberName: () => string | null;
  /** Fired when the ticket is emptied, so one-off unlocks do not linger. */
  onReset?: (reason: "completed" | "voided" | "cleared" | "held") => void;
  /** The effective business tax rate, stored as a decimal on every new sale line. */
  taxRate: number;
  /**
   * The register setting "Prevent negative stock sale". The till used to block
   * an out-of-stock item outright, whatever the branch had chosen, so the
   * setting could never be honoured. The register settings now decide, and
   * they are the only thing that decides.
   */
  preventNegativeStock: boolean;
};

export function useCart(deps: CartDeps) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [cartDiscountType, setCartDiscountType] = useState<DiscountType>("percent");
  const [exchangeRef, setExchangeRef] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [billNo, setBillNo] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<CartCoupon | null>(null);

  function addLine(productId: string, variant?: BarcodeVariant) {
    if (!deps.hasShift) {
      toast.error("Open a shift before ringing up a sale");
      deps.onNeedShift();
      return;
    }
    const product = deps.products.find((p) => p.id === productId);
    if (!product) return;
    const onHand = availableAt(product, deps.currentStore.id, deps.bookings);
    if (onHand <= 0) {
      const reserved = stockAt(product, deps.currentStore.id) > 0;
      const message = reserved
        ? `${product.name} is fully reserved by open bookings at ${deps.currentStore.name}`
        : `${product.name} is out of stock at ${deps.currentStore.name}`;
      if (blocksOutOfStockSale(onHand, deps.preventNegativeStock)) {
        toast.error(message);
        return;
      }
      toast.warning(`${message} — sold anyway`);
    }
    setLines((ls) => {
      const variantCode = variant?.code;
      const found = ls.find(
        (l) => l.productId === productId && l.variantCode === variantCode && !l.credit,
      );
      if (found)
        return ls.map((l) =>
          l.productId === productId && l.variantCode === variantCode && !l.credit
            ? { ...l, qty: l.qty + 1 }
            : l,
        );
      return [
        ...ls,
        {
          productId,
          name: variant?.label ? `${product.name} · ${variant.label}` : product.name,
          variantCode,
          variantLabel: variant?.label,
          price: variant?.price ?? product.price,
          cost: variant?.cost ?? product.cost,
          qty: 1,
          taxRate: deps.taxRate,
          discount: 0,
          discountType: "percent",
        },
      ];
    });
  }

  async function setQty(index: number, delta: number) {
    const line = lines[index];
    const removes = line && !line.credit && line.qty + delta <= 0;
    // Removing a line, or reducing a quantity, needs manager approval unless
    // the cashier holds the right themselves.
    if (removes) {
      if (!(await deps.requirePermission("can_delete_line"))) return;
      logger.log("refund", "Line deleted from the cart", "register", {
        product: line?.name,
        productId: line?.productId,
        qty: line?.qty,
        price: line?.price,
        storeId: deps.currentStore.id,
      });
    } else if (delta < 0 && line && !line.credit) {
      if (!(await deps.requirePermission("can_reduce_qty"))) return;
      logger.log("sale", "Item quantity reduced", "register", {
        product: line.name,
        productId: line.productId,
        from: line.qty,
        to: line.qty - 1,
        storeId: deps.currentStore.id,
      });
    }
    if (removes && lines.length === 1) {
      if (!(await deps.requirePermission("can_void_cart"))) return;
      try { await flushTicketDrafts("cancel"); }
      catch { toast.error("The draft could not be cancelled. Your item is still in the cart."); return; }
    }
    setLines((ls) => {
      const next = ls
        .map((l, i) => (i === index ? { ...l, qty: l.credit ? l.qty - delta : l.qty + delta } : l))
        .filter((l) => (l.credit ? l.qty < 0 : l.qty > 0));
      if (!next.length) {
        setBillNo(null);
        void flushTicketDrafts("release");
      }
      return next;
    });
  }

  function patchLine(index: number, patch: Partial<CartLine>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function resetCart(reason: "completed" | "voided" | "cleared" | "held" = "completed") {
    setLines([]);
    setCartDiscount(0);
    setCartDiscountType("percent");
    setExchangeRef(null);
    deps.onReset?.(reason);
    setCoupon(null);
    setBillNo(null);
    void flushTicketDrafts("release");
  }

  async function clearCart(source: "clear" | "void" = "void") {
    if (lines.length && !(await deps.requirePermission("can_void_cart"))) return;
    if (lines.length) {
      try { await flushTicketDrafts("cancel"); }
      catch { toast.error("The draft could not be cancelled. The cart was kept; check the database connection."); return; }
      logTicketEvent(source === "clear" ? TICKET_ACTIONS.cleared : TICKET_ACTIONS.voided, {
        lines: lines.length,
        value: deps.getTotal(),
        coupon: coupon?.code ?? null,
        storeId: deps.currentStore.id,
        member: deps.getMemberName(),
        items: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
      });
    }
    resetCart(source === "void" ? "voided" : "cleared");
  }

  return {
    lines,
    setLines,
    cartDiscount,
    setCartDiscount,
    cartDiscountType,
    setCartDiscountType,
    exchangeRef,
    setExchangeRef,
    memberId,
    setMemberId,
    billNo,
    setBillNo,
    coupon,
    setCoupon,
    addLine,
    setQty,
    patchLine,
    resetCart,
    clearCart,
  };
}
