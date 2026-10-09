/**
 * How the ticket gets paid.
 *
 * Everything the payment dialog needs — the chosen method, the cash tendered,
 * the references some tenders demand, the bank name captured from a card
 * machine, and the split-bill workings — plus the small handlers that open the
 * dialog and clear it after a sale. Lifted out of the register screen
 * unchanged, so the till pays exactly as before.
 */
import { useState } from "react";
import { methodLabel } from "@/core/types/pos-types";
import { activePaymentTypes, usePaymentTypes } from "@/core/types/payment-types";
import type { Payment, PaymentMethod } from "@/core/types/pos-types";

type TenderDeps = {
  canProcessSale?: () => boolean;
  /** Nothing rung up means nothing to charge. */
  hasLines: () => boolean;
  /** Read at the moment the dialog opens, to prefill the cash box. */
  getTotal: (method: PaymentMethod) => number;
};

export function useTender(deps: TenderDeps) {
  const [payOpen, setPayOpen] = useState(false);
  const [tendered, setTendered] = useState("");
  const [method, updateMethod] = useState<PaymentMethod>("cash");
  const [transferRef, setTransferRef] = useState("");
  /** Serial / voucher number typed for a tender that demands one. */
  const [tenderRef, setTenderRef] = useState("");
  const [tenderRefNote, setTenderRefNote] = useState("");
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitWays, setSplitWays] = useState(2);
  /* Split tenders + card machine capture */
  const [tenders, setTenders] = useState<Payment[]>([]);
  const [bankName, setBankName] = useState("");

  // Tenders are configured centrally, so a new collection type (a government
  // voucher scheme, say) appears at the till without a new build.
  const { types: paymentTypes } = usePaymentTypes();
  const tenderOptions = activePaymentTypes(paymentTypes);
  const activeTender = tenderOptions.find((t) => t.code === method);
  const activeMethodName = activeTender?.name ?? methodLabel(method);
  /** Voucher / coupon tenders cannot complete without their serial number. */
  const needsTenderRef = !!activeTender?.requiresReference && method !== "bank_transfer";

  function setMethod(next: PaymentMethod) {
    // Update the automatic exact-payment amount, but preserve cash entered by
    // the operator (for example a 100 note against a smaller bill).
    setTendered(current => current === Math.max(0, deps.getTotal(method)).toFixed(2)
      ? Math.max(0, deps.getTotal(next)).toFixed(2) : current);
    updateMethod(next);
  }

  function openPayment(preset?: PaymentMethod) {
    if (!deps.hasLines() || deps.canProcessSale?.() === false) return;
    if (preset) updateMethod(preset);
    setTendered(Math.max(0, deps.getTotal(preset ?? method)).toFixed(2));
    setPayOpen(true);
  }

  /** Clear the payment entry after a completed sale. */
  function resetTender() {
    setTendered("");
    setTransferRef("");
    setTenderRef("");
    setTenderRefNote("");
    setTenders([]);
    setBankName("");
    setPayOpen(false);
  }

  return {
    payOpen,
    setPayOpen,
    tendered,
    setTendered,
    method,
    setMethod,
    transferRef,
    setTransferRef,
    tenderRef,
    setTenderRef,
    tenderRefNote,
    setTenderRefNote,
    splitOpen,
    setSplitOpen,
    splitWays,
    setSplitWays,
    tenders,
    setTenders,
    bankName,
    setBankName,
    paymentTypes,
    tenderOptions,
    activeTender,
    activeMethodName,
    needsTenderRef,
    openPayment,
    resetTender,
  };
}
