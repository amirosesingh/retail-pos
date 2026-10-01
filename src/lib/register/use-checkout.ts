/**
 * Checkout orchestration.
 *
 * The two commit operations that finish a ticket: a normal sale (`completeSale`)
 * and a pay-later booking / racket stringing job (`bookAndPayLater`). Both are
 * lifted out of the register screen unchanged, so the till behaves exactly as
 * before.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { describeError, notifyError } from "@/lib/notify";
import { runWhatsAppSend } from "@/lib/register/wa-send";
import { openCashDrawer, printBookingSlip, printJobTag, printSaleReceipt } from "@/lib/pos-print";
import { buildBookingMessage, buildSaleMessage, sendBillOnWhatsApp } from "@/lib/whatsapp";
import { logger } from "@/lib/audit-log";
import { redeemVoucher } from "@/lib/coupons";
import { publishDisplay, type DisplaySnapshot } from "@/lib/customer-display";
import { rememberBanks } from "@/platforms/web/components/pos/TenderSplit";
import { isoDaysFromNow } from "@/lib/register/use-booking-intake";
import type { useBookingIntake } from "@/lib/register/use-booking-intake";
import { cartTotals, money, usePos } from "@/lib/pos-store";
import { db } from "@/core/api/pos-db";
import { defaultTradingHours } from "@/lib/pos-seed";

import { applyRounding, roundingOf } from "@/core/pricing/rounding";
import { applyCombo, intakeTotals, newJobTag } from "@/lib/booking-charges";
import { bookingRulesOf, paymentsLabel, r2, validateTenders } from "@/core/types/pos-types";
import type {
  Store,
  CartLine,
  Payment,
  PaymentMethod,
  Sale,
  Booking,
  Member,
} from "@/core/types/pos-types";
import type { CartCoupon } from "@/lib/register/use-cart";
import type { NewBooking } from "@/lib/pos-store";

export type CheckoutDeps = {
  /** Active shift (required before any commit). */
  getActiveShift: () => ReturnType<typeof usePos>["activeShift"];
  /** Branch this sale/booking is being raised at. */
  getCurrentStore: () => Store;
  /** Cashier name stamped on the receipt. */
  getActiveCashier: () => string;
  /** Manager-gated permission check. */
  requirePermission: (perm: string) => Promise<boolean>;
  /**
   * The approval a manager granted for this ticket, if any. Stamped on the
   * bill so a decision and the bill it allowed are always read together.
   */
  getAuthorization?: () => { requestId: string; approvedBy?: string | null } | null;

  // Cart / ticket
  getLines: () => CartLine[];
  getTotals: () => ReturnType<typeof cartTotals>;
  getMember: () => Member | null;
  getMemberId: () => string | null;
  getCoupon: () => CartCoupon | null;
  getVoucherToken: () => string | null;
  getExchangeRef: () => string | null;
  getPointsEarned: () => number;
  getBillNo: () => string | null;
  resetCart: () => void;
  setLines: (lines: CartLine[]) => void;
  setMemberId: (id: string | null) => void;
  setVoucherToken: (token: string | null) => void;

  // Tender
  getMethod: () => PaymentMethod;
  getTendered: () => string;
  getTransferRef: () => string;
  getTenderRef: () => string;
  getTenderRefNote: () => string;
  getBankName: () => string;
  getTenders: () => Payment[];
  getActiveMethodName: () => string;
  getNeedsTenderRef: () => boolean;
  resetTender: () => void;

  // Booking intake state
  bookingIntake: ReturnType<typeof useBookingIntake>;

  // UI / display
  getWaNumber: () => string;
  setWaNumber: (v: string) => void;
  setWaSending: (v: boolean) => void;
  cartSnapshot: () => DisplaySnapshot;
  getDisplayBase: () => DisplaySnapshotBase;
};

export type DisplaySnapshotBase = {
  companyName: string;
  storeName: string;
  cashier: string;
  payment: DisplaySnapshot["payment"];
};

export function useCheckout(deps: CheckoutDeps) {
  const { state, recordSale, createBooking } = usePos();
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  /**
   * One attempt id per ticket, kept across retries and cleared only once the
   * bill is stored. It is what lets the till recognise a payment that already
   * reached the database instead of billing the customer twice.
   */
  const attemptId = useRef<string | null>(null);
  /**
   * Set the instant a payment starts. React state updates a moment later, so a
   * fast second tap on Pay could otherwise start a second bill.
   */
  const inFlight = useRef(false);

  /**
   * Stamp the effective global rate on committed lines. Totals already use
   * this setting; keeping the same rate on the sale makes receipts, returns
   * and historical reports agree even when a product has an old legacy rate.
   */
  const linesWithEffectiveTax = (lines: CartLine[]) => {
    const taxRate = state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0;
    return lines.map((line) => (line.taxRate === taxRate ? line : { ...line, taxRate }));
  };

  /**
   * Sends the finished bill to the customer's WhatsApp.
   *
   * The shared helper clears the "sending" flag in every outcome and turns a
   * thrown send into a toast, so the automatic fire-and-forget call cannot
   * strand the register or raise an unhandled rejection.
   */
  async function sendSaleOnWhatsApp(sale: Sale, to: string) {
    await runWhatsAppSend(
      deps.setWaSending,
      () => {
        const wa = state.settings.whatsapp;
        const buyer = state.members.find((m) => m.id === sale.memberId) ?? null;
        return sendBillOnWhatsApp({
          cfg: wa,
          to,
          body: buildSaleMessage(sale, deps.getDisplayBase().companyName, wa),
          reference: sale.receiptNo,
          member: buyer,
        });
      },
      `Bill ${sale.receiptNo} sent on WhatsApp`,
    ).catch(() => {
      // The helper already reports every failure; this belt-and-braces catch
      // keeps the fire-and-forget caller free of unhandled rejections.
    });
  }

  async function bookAndPayLater() {
    const activeShift = deps.getActiveShift();
    const currentStore = deps.getCurrentStore();
    const activeCashier = deps.getActiveCashier();
    const lines = linesWithEffectiveTax(deps.getLines());
    const totals = deps.getTotals();
    const member = deps.getMember();
    const memberId = deps.getMemberId();
    const bi = deps.bookingIntake;
    const wa = state.settings.whatsapp;
    const displayBase = deps.getDisplayBase();
    const bookingRules = bookingRulesOf(state.settings.integrations.bookingRules);
    const racketMode = bi.bookMode === "racket";
    const combo = applyCombo(bi.intakeCharges, bookingRules);
    const intake = intakeTotals(
      combo.charges,
      state.settings.tax,
      0,
      state.settings.integrations.categoryMap,
    );
    const serviceCharge = racketMode ? intake.subtotal : 0;
    const bookingTotal = r2(totals.total + serviceCharge);
    const highTension =
      Number(bi.tensionMain || 0) > bookingRules.highTensionThreshold ||
      Number(bi.tensionCross || 0) > bookingRules.highTensionThreshold ||
      bi.stringCustomerOwned;

    if (!activeShift) {
      toast.error("Open a shift before taking a booking");
      return;
    }
    // Once closing has started the drawer is being counted — nothing more
    // may be added to this shift.
    if (activeShift.state && activeShift.state !== "ACTIVE") {
      toast.error("This shift is being closed — no further transactions can be taken.");
      return;
    }
    if (!racketMode && !lines.length) {
      toast.error("Please add at least one item to the cart before saving a pay-later booking.", {
        description: "Only racket / stringing jobs can be booked with an empty cart.",
      });
      return;
    }
    if (!(await deps.requirePermission("can_create_booking"))) return;
    const paidNow =
      bi.payTiming === "collection"
        ? 0
        : bi.payTiming === "now"
          ? bookingTotal
          : r2(Math.max(0, Number(bi.deposit || 0)));
    if (paidNow > bookingTotal) {
      toast.error("Deposit cannot exceed the booking total");
      return;
    }
    const minDeposit = Math.min(minDepositFor(bookingTotal, bookingRules), bookingTotal);
    if (minDeposit > 0 && paidNow + 0.001 < minDeposit) {
      toast.error(`This branch needs a deposit of at least ${money(minDeposit)}`);
      return;
    }
    if (!racketMode && bookingRules.serviceTerms.trim() && !bi.liabilityOk) {
      toast.error("The customer must accept the booking terms & conditions", {
        description: "Tick the agreement box at the bottom of the booking form.",
      });
      return;
    }
    if (racketMode) {
      if (bi.labourUnlocked && !bi.labourReason.trim()) {
        toast.error("Enter a reason for the labour override");
        return;
      }
      if (bookingRules.requireRacketModel && !bi.racketModel.trim()) {
        toast.error("Enter the racket brand / model");
        return;
      }
      if (bookingRules.requireStringType && !bi.stringType.trim()) {
        toast.error("Enter the string type / brand");
        return;
      }
      if (bookingRules.requirePromisedAt && !bi.promisedAt) {
        toast.error("Choose a ready-by date and time");
        return;
      }
      if (
        bookingRules.requireLiabilityAccept &&
        bookingRules.serviceTerms.trim() &&
        !bi.liabilityOk
      ) {
        toast.error("The customer must accept the service & liability terms", {
          description: highTension
            ? "This job is flagged high tension — acceptance is required."
            : "Tick the agreement box on the intake form.",
        });
        return;
      }
      if (bookingRules.warnOutsideTradingHours && bi.promisedAt) {
        const hhmm = bi.promisedAt.slice(11, 16);
        const { dayStart, dayEnd } = defaultTradingHours;
        if (dayStart && dayEnd && (hhmm < dayStart || hhmm > dayEnd))
          toast.warning(`Ready-by time is outside trading hours (${dayStart}–${dayEnd})`);
      }
    }
    if (!bi.dueDate) {
      toast.error("Choose a collect-by date");
      return;
    }
    let booking: Booking;
    try {
      setSaving(true);
      const serviceTypes = (state.settings.integrations.serviceTypes ?? []).filter(
        (s) => s.active && s.name.trim(),
      );
      const pickedService = serviceTypes.find((s) => s.id === bi.serviceId) ?? null;
      const newBooking: NewBooking = {
        storeId: currentStore.id,
        shiftId: activeShift.id,
        lines,
        subtotal: r2(totals.subtotal + serviceCharge),
        discount: totals.discount,
        tax: totals.tax,
        total: bookingTotal,
        serviceTypeId: racketMode ? pickedService?.id : undefined,
        serviceName: racketMode
          ? serviceLabel(pickedService, bi.customService) || undefined
          : undefined,
        serviceFee: serviceCharge || undefined,
        charges:
          racketMode && bi.intakeCharges.length
            ? bi.intakeCharges.map((c) =>
                c.kind === "labor" && bi.labourUnlocked && bi.labourReason.trim()
                  ? { ...c, overrideReason: bi.labourReason.trim() }
                  : c,
              )
            : undefined,
        paymentTiming: bi.payTiming,
        deposit: paidNow,
        depositMethod: bi.depositMethod,
        dueDate: bi.dueDate,
        memberId,
        customerName: bi.bookName.trim() || member?.name || "Walk-in",
        customerPhone: bi.bookPhone.trim() || member?.phone || "",
        note: bi.bookNote.trim(),
        cashier: activeCashier,
        tagId: racketMode
          ? bi.jobTag || (bookingRules.autoJobTag ? newJobTag() : undefined)
          : undefined,
        stringOrigin: racketMode ? (bi.stringCustomerOwned ? "customer" : "store") : undefined,
        liabilityAccepted: bi.liabilityOk,
        stringProductId:
          racketMode && !bi.stringCustomerOwned ? bi.stringProductId || undefined : undefined,
        intakeNote: racketMode ? bi.grommetNotes.trim() || undefined : undefined,
        job: racketMode
          ? {
              racketModel: bi.racketModel.trim() || undefined,
              stringType: bi.stringType.trim() || undefined,
              tensionMain: bi.tensionMain ? Number(bi.tensionMain) : undefined,
              tensionCross: bi.tensionCross ? Number(bi.tensionCross) : undefined,
              tensionUnit: bi.tensionUnit,
              grommetNotes: bi.grommetNotes.trim() || undefined,
              jobNotes: bi.jobNotes.trim() || undefined,
              stencil: bi.stencil,
              overgrip: bi.overgrip,
              droppedOffAt: new Date().toISOString(),
              promisedAt: bi.promisedAt ? new Date(bi.promisedAt).toISOString() : undefined,
              notifyWhatsApp: bi.notifyWhatsApp,
            }
          : undefined,
      };
      booking = await createBooking(newBooking);
    } catch (e) {
      toast.error("Booking was not saved", {
        description: describeError(e, "Saving the booking"),
      });
      return;
    } finally {
      setSaving(false);
    }
    if (paidNow > 0 && bi.depositMethod === "cash") openCashDrawer();
    printBookingSlip(booking, member, state.settings.payment);
    if (booking.job) printJobTag(booking);
    if (wa.enabled && wa.autoSendOnBooking) {
      void sendBillOnWhatsApp({
        cfg: wa,
        to: bi.bookPhone.trim() || member?.phone || "",
        body: buildBookingMessage(booking, displayBase.companyName, wa),
        reference: booking.ref,
        member,
      });
    }
    publishDisplay({
      ...deps.cartSnapshot(),
      mode: "booking",
      paid: booking.paid,
      balance: r2(booking.total - booking.paid),
      reference: booking.ref,
      dueDate: booking.dueDate,
      method: bi.depositMethod,
    });
    deps.resetCart();
    deps.setMemberId(null);
    deps.setLines([
      {
        productId: `booking:${booking.id}`,
        name: `${booking.job ? "Racket job" : "Booking"} ${booking.ref}`,
        price: 0,
        qty: 1,
        taxRate: 0,
        discount: 0,
        bookingId: booking.id,
        bookingRef: booking.ref,
        ...(booking.job ? { job: booking.job } : {}),
      },
    ]);
    bi.setBookOpen(false);
    bi.setDeposit("");
    bi.setBookName("");
    bi.setBookPhone("");
    bi.setBookNote("");
    bi.setServiceId("");
    bi.setCustomService("");
    bi.resetJobCard();
    bi.setBookMode("cart");
    bi.setPayTiming("deposit");
    bi.setDueDate(isoDaysFromNow(14));
    toast.success(
      `Booking ${booking.ref} reserved until ${new Date(booking.dueDate).toDateString()}`,
    );
  }

  async function completeSale() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await runCompleteSale();
    } finally {
      inFlight.current = false;
    }
  }

  async function runCompleteSale() {
    const activeShift = deps.getActiveShift();
    const currentStore = deps.getCurrentStore();
    const activeCashier = deps.getActiveCashier();
    const lines = linesWithEffectiveTax(deps.getLines());
    const totals = deps.getTotals();
    const member = deps.getMember();
    const memberId = deps.getMemberId();
    const coupon = deps.getCoupon();
    const voucherToken = deps.getVoucherToken();
    const exchangeRef = deps.getExchangeRef();
    const pointsEarned = deps.getPointsEarned();
    const billNo = deps.getBillNo();
    const method = deps.getMethod();
    const tendered = deps.getTendered();
    const transferRef = deps.getTransferRef();
    const tenderRef = deps.getTenderRef();
    const tenderRefNote = deps.getTenderRefNote();
    const bankName = deps.getBankName();
    const tenders = deps.getTenders();
    const activeMethodName = deps.getActiveMethodName();
    const needsTenderRef = deps.getNeedsTenderRef();
    const wa = state.settings.whatsapp;
    if (!activeShift) {
      toast.error("Open a shift before taking payment");
      return;
    }
    if (activeShift.state && activeShift.state !== "ACTIVE") {
      toast.error("This shift is being closed — no further transactions can be taken.");
      return;
    }
    const isRefund = totals.total < 0;
    if (!(await deps.requirePermission("can_process_sale"))) return;
    if (isRefund && !(await deps.requirePermission("can_process_refund"))) return;
    const splitting = tenders.length > 0;
    /**
     * Total rounding: runs once, on the number `cartTotals` produced, and the
     * rounded value is what the ticket is validated, charged and stored on.
     */
    const roundingCfg = state.settings.integrations.rounding;
    const settleMethod = splitting
      ? tenders.reduce((a, p) => (p.amount > a.amount ? p : a), tenders[0]!).method
      : method;
    const rounding = applyRounding(totals.total, roundingCfg, settleMethod);
    const chargeTotal = rounding.total;
    const split = validateTenders(chargeTotal, tenders);
    const splitPaid = split.paid;
    if (!isRefund && splitting && split.error) {
      toast.error(
        split.balance > 0
          ? `Split tenders cover ${money(splitPaid)} of ${money(chargeTotal)} — ${split.error}`
          : split.error,
      );
      return;
    }
    const paid = isRefund
      ? chargeTotal
      : splitting
        ? splitPaid
        : method === "cash"
          ? Number(tendered || 0)
          : chargeTotal;
    if (!isRefund && !splitting && method === "cash" && paid < chargeTotal) {
      toast.error("Tendered amount is less than the total");
      return;
    }
    if (!isRefund && !splitting && method === "card" && !bankName.trim()) {
      toast.error("Enter which bank card machine was used");
      return;
    }
    if (!isRefund && !splitting && method === "bank_transfer" && !transferRef.trim()) {
      toast.error("Enter the transfer reference shown on the customer's slip");
      return;
    }
    if (!isRefund && !splitting && needsTenderRef && !tenderRef.trim()) {
      toast.error(`Enter the serial / reference number for ${activeMethodName}`);
      return;
    }
    if (
      !isRefund &&
      !splitting &&
      method === "points" &&
      (member?.points ?? 0) < chargeTotal * 100
    ) {
      toast.error("Not enough points on this member");
      return;
    }
    const payments: Payment[] = splitting
      ? tenders
      : [
          {
            id: crypto.randomUUID(),
            method,
            amount: r2(Math.abs(chargeTotal)),
            ...(method === "card" && bankName.trim() ? { bankName: bankName.trim() } : {}),
            ...(method === "bank_transfer" && transferRef.trim()
              ? { ref: transferRef.trim() }
              : {}),
            ...(needsTenderRef
              ? {
                  requiresReference: true,
                  reference: tenderRef.trim(),
                  ...(tenderRefNote.trim() ? { referenceNote: tenderRefNote.trim() } : {}),
                }
              : {}),
          },
        ];
    const headline = payments.reduce((a, p) => (p.amount > a.amount ? p : a), payments[0]!).method;
    rememberBanks(payments.map((p) => p.bankName ?? ""));
    let sale: Sale;
    try {
      setSaving(true);
      if (!attemptId.current) attemptId.current = crypto.randomUUID();
      sale = await recordSale({
        storeId: currentStore.id,
        clientTxnId: attemptId.current,
        ...(billNo ? { receiptNo: billNo } : {}),
        shiftId: activeShift.id,
        lines,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: chargeTotal,
        paid,
        change: r2(Math.max(0, paid - chargeTotal)),
        method: splitting ? headline : method,
        payments,
        memberId,
        pointsEarned,
        cashier: activeCashier,
        // Always recorded for reconciliation, even when nothing is printed.
        roundingAdjustment: rounding.adjustment,
        ...(rounding.adjustment ? { roundingLabel: roundingOf(roundingCfg).receiptLabel } : {}),
        ...(method === "bank_transfer" ? { transferRef: transferRef.trim() } : {}),
        ...(exchangeRef ? { exchangeOfReceiptNo: exchangeRef, exchangeCredit: totals.credit } : {}),
        ...(() => {
          const grant = deps.getAuthorization?.();
          return grant
            ? {
                authorizationRequestId: grant.requestId,
                authorizedBy: grant.approvedBy ?? null,
                authorizedAt: new Date().toISOString(),
              }
            : {};
        })(),
        ...(coupon
          ? {
              couponCode: coupon.code,
              couponPromoId: coupon.promoId,
              couponScope: coupon.scope,
              couponDiscount: coupon.discount,
              couponName: coupon.name,
              couponRemaining: coupon.remaining,
            }
          : {}),
      });
    } catch (e) {
      // The sale header may already be committed even though a later step
      // failed. Never tell the cashier "nothing was stored" in that case —
      // it invites a second collection of the same payment.
      const stored = attemptId.current
        ? await db.saleAttemptExists(attemptId.current).catch(() => "unknown" as const)
        : ("no" as const);
      if (stored === "yes") {
        toast.warning("The sale is stored, but finishing it failed", {
          description:
            "Do not take payment again. The bill is saved and will reconcile; reprint the receipt from Sales if needed.",
        });
      } else if (stored === "unknown") {
        toast.error("Could not confirm whether the payment was saved", {
          description:
            "Check Sales for this bill before taking payment again. If it is not listed, verify the database connection and retry.",
        });
      } else {
        toast.error("Payment was not saved", {
          description: describeError(e, "Saving the payment"),
        });
      }
      return;
    } finally {
      setSaving(false);
    }
    attemptId.current = null;

    // From this point the SQL transaction is complete. Restore a usable till
    // before starting printer, drawer, messaging or audit side effects: none
    // of those integrations may strand the cashier on a completed ticket.
    setLastSale(sale);
    const customerNumber = member?.phone ?? "";
    deps.setWaNumber(customerNumber);
    let paidDisplay: DisplaySnapshot | null = null;
    try {
      paidDisplay = {
        ...deps.cartSnapshot(),
        mode: "paid",
        paid: sale.paid,
        change: sale.change,
        reference: sale.receiptNo,
        method: sale.method,
        transferRef: sale.transferRef ?? "",
      };
    } catch {
      // The customer display is optional; sale completion is not.
    }
    deps.resetCart();
    deps.setMemberId(null);
    deps.resetTender();
    toast.success(
      exchangeRef
        ? `Exchange ${sale.receiptNo} completed against ${exchangeRef}`
        : `Sale ${sale.receiptNo} completed`,
    );

    if (coupon) {
      try {
        logger.log("promotion", "Coupon redeemed on a bill", "register", {
          receiptNo: sale.receiptNo,
          coupon: coupon.code,
          promotionId: coupon.promoId,
          scope: coupon.scope,
          product: coupon.productName ?? null,
          discountValue: coupon.discount,
          billTotal: sale.total,
          storeId: sale.storeId,
        });
      } catch {
        /* audit recovery must not break a completed checkout */
      }
    }
    if (payments.some((p) => p.method === "cash")) {
      try {
        openCashDrawer();
      } catch (error) {
        notifyError(error, "Sale saved, but the drawer did not open");
      }
    }
    if (voucherToken) {
      void redeemVoucher({
        token: voucherToken,
        saleId: sale.receiptNo,
        storeId: sale.storeId,
        staff: activeCashier,
      }).catch((e: unknown) => notifyError(e, "Could not lock the voucher"));
      deps.setVoucherToken(null);
    }
    if (splitting || payments.some((p) => p.bankName)) {
      try {
        logger.log("sale", "Split payment recorded", "register", {
          receiptNo: sale.receiptNo,
          total: sale.total,
          tenders: paymentsLabel(payments),
          storeId: sale.storeId,
        });
      } catch {
        /* audit recovery must not break a completed checkout */
      }
    }
    if (method === "bank_transfer") {
      try {
        logger.log("sale", "Bank transfer payment recorded", "register", {
          receiptNo: sale.receiptNo,
          total: sale.total,
          transferRef: sale.transferRef,
          bank: state.settings.payment.bankName,
        });
      } catch {
        /* audit recovery must not break a completed checkout */
      }
    }
    try {
      printSaleReceipt(sale, member, "sale");
    } catch (error) {
      notifyError(error, "Sale saved, but printing failed");
    }
    if (wa.enabled && wa.autoSendOnSale && customerNumber) {
      void sendSaleOnWhatsApp(sale, customerNumber);
    }
    if (paidDisplay) publishDisplay(paidDisplay);
  }

  return {
    saving,
    lastSale,
    setLastSale,
    completeSale,
    bookAndPayLater,
    sendSaleOnWhatsApp,
  };
}

function minDepositFor(total: number, rules: ReturnType<typeof bookingRulesOf>) {
  if (!rules.requireDeposit) return 0;
  return rules.depositMode === "percent"
    ? r2((total * Math.max(0, rules.depositMin)) / 100)
    : r2(Math.max(0, rules.depositMin));
}

function serviceLabel(pickedService: { name: string } | null, customService: string) {
  return pickedService?.name || customService || "";
}
