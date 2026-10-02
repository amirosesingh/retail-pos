import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { markHeldWaiting } from "@/lib/held-orders";
import { terminalId as posTerminalId } from "@/lib/activity-journal";
import {
  maskSnapshotEmail,
  maskSnapshotPhone,
  snapshotFingerprint,
  type TicketSnapshot,
} from "@/lib/ticket-snapshot";
import { useCart } from "@/lib/register/use-cart";
import { useTender } from "@/lib/register/use-tender";
import { isoDaysFromNow, useBookingIntake } from "@/lib/register/use-booking-intake";
import { useCheckout } from "@/lib/register/use-checkout";
import { applyRounding, roundingOf, showsRoundingLine } from "@/core/pricing/rounding";
import { usePromotions } from "@/lib/register/use-promotions";
import { useExchange } from "@/lib/register/use-exchange";
import { removeApprovedDiscount, useRegisterHeldOrders } from "@/lib/register/use-held-orders";
import { TICKET_ACTIONS, logTicketEvent } from "@/lib/ticket-audit";
import {
  BadgeCheck,
  Banknote,
  Minus,
  Plus,
  Printer,
  Search,
  Trash2,
  Gift,
  Vault,
  UserPlus,
  X,
  Repeat,
  Sparkles,
  History,
  CalendarClock,
  ChevronUp,
  MonitorPlay,
  MessageCircle,
  PauseCircle,
  Percent,
  TicketPercent,
  Split,
  Wrench,
  ChefHat,
  PackageSearch,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { commitLabel, searchCloudMembers } from "@/core/api/pos-db";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { ActionButton } from "@/platforms/web/components/pos/ActionButton";
import { CatalogPanel } from "@/platforms/web/components/pos/CatalogPanel";
import { ColumnResizer, usePanelWidth } from "@/platforms/web/components/pos/ColumnResizer";
import { ProductSearchDialog } from "@/platforms/web/components/pos/ProductSearchDialog";
import { ScanBar } from "@/platforms/web/components/pos/ScanBar";
import { BookingCartPanel } from "@/platforms/web/components/pos/booking/BookingCartPanel";
import { QuickMemberDialog } from "@/platforms/web/components/pos/QuickMemberDialog";
import { RegisterWorkspace } from "@/platforms/web/components/pos/layout/RegisterWorkspace";
import { RegisterActionsProvider, type ActionHandlers } from "@/lib/register-actions";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { ZoomCanvas } from "@/platforms/web/components/pos/ZoomCanvas";
import { setTicketDirty } from "@/platforms/windows/desktop-window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { availableAt, cartTotals, money, stockAt, usePos } from "@/lib/pos-store";
import { resolveByBarcode, variantForBarcode } from "@/lib/product-lookup";
import { reserveBillNumber } from "@/lib/bill-number";
import { useAuth } from "@/lib/pos-auth";
import { productVisibleAt } from "@/lib/branch-policy";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  BOOKING_TIMING_LABELS,
  bookingRulesOf,
  type BookingPaymentTiming,
} from "@/core/types/pos-types";
import { useUserPermissions } from "@/lib/pos-permissions";
import { useVisibility } from "@/lib/ui-visibility";
import { useUiScale } from "@/lib/use-ui-scale";
import { discountLabel, loadMemberVouchers, scopeLabel } from "@/lib/coupons";
import type { IntakeCharge, Member, Sale } from "@/core/types/pos-types";
import { applyCombo, intakeTotals, newJobTag } from "@/lib/booking-charges";
import { TenderSplit } from "@/platforms/web/components/pos/TenderSplit";
import { lineUnitDiscount, r2, validateTenders } from "@/core/types/pos-types";
import { tenderIcon } from "@/core/types/payment-types";
import { NO_SALE_REASON_MAX, NO_SALE_REASON_MIN, recordNoSale } from "@/lib/drawer-events";

import { logger } from "@/lib/audit-log";
import { DiscountPad } from "@/platforms/web/components/pos/DiscountPad";
import { useManagerGate, type GateRequest } from "@/lib/manager-gate";
import { authorizationBinding, type AuthPayload } from "@/lib/authorization";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { parsePositiveAmount } from "@/core/pricing/amount";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  cancelAuthorizationRequest,
  verifyBusinessAuthorization,
} from "@/lib/authorization-client";
import { evaluatePromotions, focLine } from "@/lib/pos-promotions";
import { loadCartDraft, saveCartDraft } from "@/lib/cart-draft";
import { openCashDrawer, printSaleReceipt, saleReceiptPreview } from "@/lib/pos-print";
import { ShiftCloseDialog } from "@/platforms/web/components/pos/ShiftCloseDialog";
import {
  openCustomerDisplay,
  publishDisplay,
  toDisplayLine,
  type DisplaySnapshot,
} from "@/lib/customer-display";
import { MemberHistoryDialog } from "@/platforms/web/components/pos/MemberHistoryDialog";
import { TerminalWorkspaceHome } from "@/platforms/web/components/pos/TerminalWorkspaceHome";
import { shouldOpenRegister } from "@/lib/terminal-workspace";
import { searchLocal } from "@/lib/product-search";
import { frequentRecentProducts } from "@/lib/standard-pos";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { resume?: string; booking?: "general" | "racket"; sell?: boolean } => ({
    ...(typeof search["resume"] === "string" ? { resume: search["resume"] as string } : {}),
    ...(search["booking"] === "general" || search["booking"] === "racket"
      ? { booking: search["booking"] as "general" | "racket" }
      : {}),
    ...(search["sell"] === true || search["sell"] === "1" ? { sell: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Register — Retail" },
      {
        name: "description",
        content:
          "Ring up sales, attach members, take cash or card payments, open the drawer and print thermal receipts.",
      },
      { property: "og:title", content: "Register — Retail" },
      { property: "og:description", content: "Fast touch checkout with receipts and members." },
    ],
  }),
  component: RegisterEntry,
});

function RegisterEntry() {
  const { state } = usePos();
  const { isAdmin, isSupervisor, isCashier } = useAuth();
  const search = Route.useSearch();
  return shouldOpenRegister({
    purpose: state.settings.integrations.terminalPurpose,
    isAdmin,
    isSupervisor,
    isCashier,
    forcedSelling: search.sell,
    resumeSale: !!search.resume,
    bookingFlow: !!search.booking,
  }) ? (
    <Register />
  ) : (
    <TerminalWorkspaceHome />
  );
}

type AppliedApproval = {
  requestId: string;
  actionKey: string;
  approvedPayload: AuthPayload;
  grantToken: string;
  approvedAmount: number | null;
  requestedAmount: number | null;
  requesterDirectLimit: number | null;
  valueUnit: "percent" | "currency" | "quantity" | "number";
  approvedBy: string | null;
  approvedByName: string | null;
  /** Fingerprint after the approved change was applied to the ticket. */
  appliedSnapshotHash: string | null;
};

function Register() {
  const {
    state,
    activeShift,
    updateBookingSpecs,
    openShift,
    currentStore,
    upsertProduct,
    updateSettings,
  } = usePos();
  useUiScale();
  const { user, can } = useAuth();
  const { requirePermission } = useUserPermissions();
  const { visible, visibleRoute } = useVisibility();
  /** Server-loaded operational rules. Never read from browser storage. */
  const { rules } = usePosRules();
  /**
   * Shared authorisation path: the branch rules decide whether a manager PIN
   * is needed at all, admins are approved without a prompt, and everyone else
   * gets the dialog. Resolves with the signed grant token, or null when the
   * action was refused.
   */
  const { authorize, rules: authorizationRules } = useManagerGate();
  /**
   * The open ticket, filled in below once the totals exist. Sending it with a
   * request lets a remote approver decide on what the cashier can see.
   */
  const ticketSnapshot = useRef<() => TicketSnapshot | null>(() => null);
  /** Parks the open ticket; filled in once the held-orders hook exists. */
  const parkTicket = useRef<((id?: string) => { id: string } | null) | null>(null);
  const appliedApprovalRef = useRef<AppliedApproval | null>(null);
  const revokeApprovalDiscountRef = useRef<(approval: AppliedApproval) => void>(() => undefined);
  const [appliedApproval, setAppliedApproval] = useState<AppliedApproval | null>(null);
  const clearAppliedApproval = useCallback(() => {
    appliedApprovalRef.current = null;
    setAppliedApproval(null);
  }, []);
  const invalidateAppliedApproval = useCallback(
    async (reason: string, revokeDiscount = true) => {
      const approval = appliedApprovalRef.current;
      if (!approval) return true;
      if (revokeDiscount) revokeApprovalDiscountRef.current(approval);
      clearAppliedApproval();
      const cancelled = await cancelAuthorizationRequest({
        data: {
          ...(await getPosCallerAuth()),
          id: approval.requestId,
          reason,
        },
      }).catch(() => null);
      if (!cancelled?.ok) {
        toast.error(
          (cancelled && "error" in cancelled ? cancelled.error : "") ||
            "The approval was removed from this till but could not be voided in the database",
        );
        return false;
      }
      return true;
    },
    [clearAppliedApproval],
  );
  const askManager = async (request: GateRequest) => {
    let baseSnapshot = ticketSnapshot.current();
    if (baseSnapshot && !baseSnapshot.billNo) {
      try {
        const reserved = await reserveBillNumber(
          currentStore.receiptPrefix?.trim() || currentStore.code || "R",
          state.sales.map((sale) => sale.receiptNo),
          {
            ...(state.settings.integrations.billNumbering ?? {}),
            timeZone: state.settings.integrations.timeZone || undefined,
          },
        );
        setBillNo(reserved);
        baseSnapshot = { ...baseSnapshot, ticketId: reserved, billNo: reserved };
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not reserve a bill number.");
        return null;
      }
    }
    const snapshot = baseSnapshot
      ? {
          ...baseSnapshot,
          ...(request.requestedAmount === undefined || request.requestedAmount === null
            ? {}
            : { requestedValue: request.requestedAmount }),
          requestedLabel: request.title,
        }
      : null;
    const requestedTargetIndex = Number(request.payload?.["target_index"]);
    const requestedTargetLine =
      snapshot && Number.isInteger(requestedTargetIndex)
        ? snapshot.lines[requestedTargetIndex]
        : undefined;
    const payload: AuthPayload = {
      ...(request.payload ?? {}),
      ...(snapshot?.billNo
        ? {
            bill_no: snapshot.billNo,
            transaction: snapshot.billNo,
          }
        : {}),
      ...(snapshot?.billNo && requestedTargetLine
        ? {
            target_line_key: [
              snapshot.billNo,
              requestedTargetIndex,
              requestedTargetLine.sku,
              requestedTargetLine.qty,
              requestedTargetLine.unitPrice,
            ].join("|"),
          }
        : {}),
    };
    const verifyGrant = async (grantToken: string | null) => {
      const resumedGrant = appliedApprovalRef.current;
      const requestedAmount =
        request.requestedAmount ??
        snapshot?.requestedValue ??
        resumedGrant?.requestedAmount ??
        resumedGrant?.approvedAmount ??
        null;
      const result = await verifyBusinessAuthorization({
        data: {
          ...(await getPosCallerAuth()),
          actionKey: request.action,
          storeId: request.storeId ?? currentStore.id,
          payload,
          snapshotHash: snapshot ? snapshotFingerprint(snapshot) : "",
          requestedAmount,
          grantToken,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      return grantToken ?? "";
    };
    const resumedGrant = appliedApprovalRef.current;
    if (resumedGrant?.grantToken && resumedGrant.actionKey === request.action) {
      const approvedPayloadForMatch = Object.fromEntries(
        Object.entries(resumedGrant.approvedPayload).filter(([key]) => key !== "approved_amount"),
      ) as AuthPayload;
      const requestedAmount =
        request.requestedAmount ?? snapshot?.requestedValue ?? resumedGrant.requestedAmount ?? null;
      const payloadMatches =
        authorizationBinding(payload) === authorizationBinding(approvedPayloadForMatch);
      const amountMatches =
        resumedGrant.approvedAmount === null ||
        (requestedAmount !== null && requestedAmount <= resumedGrant.approvedAmount);
      if (payloadMatches && amountMatches) {
        const verified = await verifyGrant(resumedGrant.grantToken);
        if (verified === null) revokeApprovalDiscountRef.current(resumedGrant);
        clearAppliedApproval();
        return verified;
      }
      revokeApprovalDiscountRef.current(resumedGrant);
      clearAppliedApproval();
    }
    const heldOrderId = snapshot
      ? `H${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : undefined;
    const res = await authorize({
      ...request,
      payload,
      ...(snapshot ? { snapshot } : {}),
      ...(heldOrderId ? { heldOrderId } : {}),
      ...(request.requestedAmount === undefined && snapshot?.requestedValue !== undefined
        ? { requestedAmount: snapshot.requestedValue }
        : {}),
    });
    // A queued action must not hold the till hostage: the ticket is parked
    // exactly as the approver sees it and the next customer can be served.
    if (res.pendingRequestId) {
      const parked = parkTicket.current?.(heldOrderId);
      if (parked) {
        markHeldWaiting(
          parked.id,
          res.pendingRequestId,
          snapshot ? snapshotFingerprint(snapshot) : undefined,
        );
        toast.info("Ticket parked while it waits for approval", {
          description: "Pick it up from Hold tickets once the decision arrives.",
        });
      }
    }
    // A gate that is switched off returns ok with no token — still a "go".
    return res.ok ? verifyGrant(res.grantToken) : null;
  };
  const requireCartPermission = async (flag: string) => {
    const governed = {
      can_void_cart: [
        "void_cart",
        "Authorise bill void",
        "Voiding this bill requires authorisation.",
      ],
      can_delete_line: [
        "void_line",
        "Authorise line void",
        "Removing this line requires authorisation.",
      ],
      can_reduce_qty: [
        "reduce_qty",
        "Authorise quantity reduction",
        "Reducing this quantity requires authorisation.",
      ],
    } as const;
    const match = governed[flag as keyof typeof governed];
    if (!match) return requirePermission(flag);
    const [action, title, reason] = match;
    if ((authorizationRules[action]?.mode ?? "none") === "none") {
      return requirePermission(flag);
    }
    return (
      (await askManager({
        action,
        title,
        reason,
        storeId: currentStore.id,
        requestedBy: user?.staffId ?? user?.name ?? null,
      })) !== null
    );
  };
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const canDiscount = can("can_give_discount");
  const [discountOverride, setDiscountOverride] = useState(false);
  const discountAllowed = canDiscount || discountOverride;
  async function unlockDiscounts() {
    if (discountAllowed) return true;
    const ok = await requirePermission("can_give_discount");
    if (ok) setDiscountOverride(true);
    return ok;
  }
  const canRefund = can("can_process_refund");
  const [query, setQuery] = useState("");
  /** Narrow-window product browser. */
  const [catalogOpen, setCatalogOpen] = useState(false);
  /** Code that failed to resolve, shown in the search dialog. */
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  /** The open ticket: lines, discount, member, coupon and bill number. */
  const {
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
  } = useCart({
    hasShift: !!activeShift,
    onNeedShift: () => setOpenShiftOpen(true),
    products: state.products,
    bookings: state.bookings,
    currentStore,
    requirePermission: requireCartPermission,
    getTotal: () => totals.total,
    getMemberName: () => member?.name ?? null,
    // A discount unlock lasts for this ticket only.
    onReset: (reason) => {
      setDiscountOverride(false);
      if (reason === "voided" || reason === "cleared") {
        void invalidateAppliedApproval(
          reason === "voided" ? "Bill voided before completion" : "Bill cleared before completion",
          false,
        );
      } else {
        clearAppliedApproval();
      }
    },
    // Tax is configured once for the business scope; product records are not a
    // second source of truth for the rate applied at the till.
    taxRate: state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0,
    // The register settings decide whether an out-of-stock item can be sold.
    preventNegativeStock: rules.prevent_negative_stock_sale,
  });
  revokeApprovalDiscountRef.current = (approval) => {
    // Functional updates cannot overwrite a cart mutation that landed after
    // the invalidation callback was created.
    setLines(
      (current) =>
        removeApprovedDiscount(
          { lines: current, cartDiscount: 0, cartDiscountType: "amount" },
          approval,
        ).lines,
    );
    if (approval.actionKey === "discount_over_limit") {
      setCartDiscount((current) =>
        approval.approvedPayload["discount_scope"] === "bill" ? 0 : current,
      );
    }
  };
  /** Cashier-adjustable column widths, remembered on this device. */

  const [lookupWidth, setLookupWidth] = usePanelWidth("pos.register.lookupWidth", 360);

  /** Calculator-style discount pad: index of the cart line, or "bill". */
  const [padTarget, setPadTarget] = useState<number | "bill" | null>(null);
  const [priceTarget, setPriceTarget] = useState<number | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [priceReason, setPriceReason] = useState("");

  /** True while a sale / booking is being stored — blocks a second click. */
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  // Start blank so the cashier must enter the amount actually counted.
  const [float, setFloat] = useState("");
  const [cashier] = useState(user?.name ?? "Cashier");
  useEffect(() => {
    if (openShiftOpen) setFloat("");
  }, [openShiftOpen]);
  /** Who is actually signed in right now — sales are stamped with this, not
   *  the name captured when the shift was opened (users may switch mid-shift). */
  const activeCashier = user?.name || activeShift?.cashier || cashier;
  /** No open shift = the whole till is frozen, for every role including
   *  supervisors: no coupons, exchanges, drawer opens, prints or payments. */
  const tillLocked = !activeShift;
  const lockedReason = "Open a shift first";
  const {
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
    tenderOptions,
    activeMethodName,
    needsTenderRef,
    openPayment,
    resetTender,
  } = useTender({
    hasLines: () => lines.length > 0,
    getTotal: () => totals.total,
  });

  const [waNumber, setWaNumber] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberMatches, setMemberMatches] = useState<Member[]>([]);
  const [bookMemberMatches, setBookMemberMatches] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [quickMemberOpen, setQuickMemberOpen] = useState(false);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const {
    bookOpen,
    setBookOpen,
    deposit,
    setDeposit,
    depositMethod,
    setDepositMethod,
    dueDate,
    setDueDate,
    bookName,
    setBookName,
    bookPhone,
    setBookPhone,
    bookNote,
    setBookNote,
    serviceId,
    setServiceId,
    customService,
    setCustomService,
    payTiming,
    setPayTiming,
    bookMode,
    setBookMode,
    racketModel,
    setRacketModel,
    stringType,
    setStringType,
    tensionMain,
    setTensionMain,
    tensionCross,
    setTensionCross,
    tensionUnit,
    setTensionUnit,
    grommetNotes,
    setGrommetNotes,
    jobNotes,
    setJobNotes,
    promisedAt,
    setPromisedAt,
    stencil,
    setStencil,
    overgrip,
    setOvergrip,
    jobTag,
    setJobTag,
    bookingHubOpen,
    setBookingHubOpen,
    editBookingId,
    setEditBookingId,
    notifyWhatsApp,
    setNotifyWhatsApp,
    intakeCharges,
    setIntakeCharges,
    liabilityOk,
    setLiabilityOk,
    bookMemberQuery,
    setBookMemberQuery,
    racketProductId,
    setRacketProductId,
    racketCustomerOwned,
    setRacketCustomerOwned,
    stringProductId,
    setStringProductId,
    stringCustomerOwned,
    setStringCustomerOwned,
    labourUnlocked,
    setLabourUnlocked,
    labourReason,
    setLabourReason,
    resetJobCard,
  } = useBookingIntake();

  /** Narrow windows: the action deck collapses so it can't cover the totals. */
  const [deckOpen, setDeckOpen] = useState(false);
  /* Operation deck state */
  const [receiptPreview, setReceiptPreview] = useState(false);
  /* No-sale drawer open */
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState("");
  const [noSaleNote, setNoSaleNote] = useState("");

  // One pass over the catalogue instead of one per render — the search dialog
  // gets the same array back until the catalogue or the branch actually change.
  const visibleProducts = useMemo(
    () => state.products.filter((p) => productVisibleAt(state.settings, p, state.currentStoreId)),
    [state.products, state.settings, state.currentStoreId],
  );
  const deferredProductQuery = useDeferredValue(query);
  const recommendedProducts = useMemo(
    () => frequentRecentProducts(visibleProducts, state.sales, currentStore.id, 8),
    [visibleProducts, state.sales, currentStore.id],
  );
  const standardLookupProducts = useMemo(() => {
    const needle = deferredProductQuery.trim();
    if (!needle) return recommendedProducts;
    return searchLocal(
      visibleProducts.filter((product) => !product.archived),
      needle,
      20,
    );
  }, [deferredProductQuery, recommendedProducts, visibleProducts]);

  const member = useMemo(
    () =>
      state.members.find((m) => m.id === memberId) ??
      (selectedMember?.id === memberId ? selectedMember : null),
    [state.members, memberId, selectedMember],
  );

  useEffect(() => {
    if (!memberId) setSelectedMember(null);
  }, [memberId]);

  useEffect(() => {
    const q = memberQuery.trim();
    if (!q) {
      setMemberMatches([]);
      return;
    }
    const lower = q.toLowerCase();
    setMemberMatches(
      state.members
        .filter(
          (m) =>
            m.name.toLowerCase().includes(lower) ||
            m.phone.replace(/\s/g, "").includes(lower.replace(/\s/g, "")) ||
            m.code.toLowerCase().includes(lower),
        )
        .slice(0, 5),
    );
    let alive = true;
    const timer = window.setTimeout(() => {
      void searchCloudMembers(q, 5).then((rows) => {
        if (alive && rows.length) setMemberMatches(rows);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [memberQuery, state.members]);

  useEffect(() => {
    const q = bookMemberQuery.trim();
    if (!q) {
      setBookMemberMatches([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void searchCloudMembers(q, 5).then((rows) => {
        if (alive) setBookMemberMatches(rows);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [bookMemberQuery]);

  /* ── Sticky ticket ──────────────────────────────────────────────────────
     The open ticket is stored per store so a refresh, a trip to another page
     or an app restart never silently drops what the cashier rang up. It is
     only cleared by Clear/Void, a completed payment, or holding/booking. */
  const draftStore = currentStore.id;
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (hydratedFor.current === draftStore) return;
    if (!state.products.length) return; // wait for the catalogue before validating
    hydratedFor.current = draftStore;
    const draft = loadCartDraft(draftStore);
    if (!draft) return;
    const known = new Set(state.products.map((p) => p.id));
    const kept = draft.lines.filter((l) => known.has(l.productId));
    setLines(kept);
    setCartDiscount(draft.cartDiscount);
    setCartDiscountType(draft.cartDiscountType);
    setExchangeRef(draft.exchangeRef);
    setMemberId(draft.memberId);
    setCoupon((draft.coupon as typeof coupon) ?? null);
    if (draft.billNo) setBillNo(draft.billNo);
    if (kept.length < draft.lines.length)
      toast.info("Some items on the saved ticket are no longer in the catalogue");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStore, state.products.length]);

  useEffect(() => {
    if (hydratedFor.current !== draftStore) return;
    saveCartDraft(draftStore, {
      lines,
      cartDiscount,
      cartDiscountType,
      exchangeRef,
      memberId,
      coupon,
      billNo,
    });
  }, [draftStore, lines, cartDiscount, cartDiscountType, exchangeRef, memberId, coupon, billNo]);

  /** A bill number is reserved the moment a ticket starts, so the header, the
   *  held record and the printed receipt all carry the same number. */
  useEffect(() => {
    if (!lines.length || billNo) return;
    let cancelled = false;
    void reserveBillNumber(
      currentStore.receiptPrefix?.trim() || currentStore.code || "R",
      state.sales.map((s) => s.receiptNo),
      {
        ...(state.settings.integrations.billNumbering ?? {}),
        timeZone: state.settings.integrations.timeZone || undefined,
      },
    )
      .then((no) => {
        if (!cancelled) setBillNo(no);
      })
      .catch((err) => {
        // Leave the header blank: checkout reserves the number again and will
        // stop the sale if the counter still cannot be stored.
        toast.error(err instanceof Error ? err.message : "Could not reserve a bill number.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, billNo, currentStore.id]);

  const taxSettings = state.settings.tax;
  // Promotions run against the subtotal after line-level discounts.
  const preTotals = cartTotals(lines, 0, "amount", taxSettings);
  const promoBase = r2(preTotals.subtotal - preTotals.lineDiscount);
  const promo = evaluatePromotions({
    promotions: state.promotions,
    products: state.products,
    base: promoBase,
    member,
  });
  // One conversion, one place: the calculator turns the cashier's entry into
  // money and folds automatic promotions and a whole-bill coupon in on the
  // same base, so none of them cancels another out.
  const billCouponDiscount = coupon && coupon.scope === "bill" ? r2(coupon.discount || 0) : 0;
  const totals = cartTotals(
    lines,
    cartDiscount,
    cartDiscountType,
    taxSettings,
    r2(promo.promoDiscount + billCouponDiscount),
  );
  const appliedApprovalText = appliedApproval
    ? (() => {
        const formatValue = (value: number) =>
          appliedApproval.valueUnit === "percent"
            ? `${value.toFixed(2)}%`
            : appliedApproval.valueUnit === "currency"
              ? money(value)
              : value.toFixed(2);
        const approved =
          appliedApproval.approvedAmount === null
            ? ""
            : ` · ${formatValue(appliedApproval.approvedAmount)} approved`;
        const extra =
          appliedApproval.approvedAmount !== null && appliedApproval.requesterDirectLimit !== null
            ? ` · ${formatValue(Math.max(0, appliedApproval.approvedAmount - appliedApproval.requesterDirectLimit))} extra`
            : "";
        const approver = appliedApproval.approvedByName || appliedApproval.approvedBy;
        return `#${appliedApproval.requestId.slice(-8).toUpperCase()}${approver ? ` · by ${approver}` : ""}${approved}${extra} · payable ${money(totals.total)}`;
      })()
    : "";
  const pointsEarned = member ? Math.max(0, Math.round(totals.total * promo.pointsRate)) : 0;

  // Keep the qualifying FOC freebie in sync with the open ticket.
  const focId = promo.foc ? `${promo.foc.promo.id}:${promo.foc.product.id}:${promo.foc.qty}` : "";
  const hasFoc = lines.some((l) => l.foc);
  // The desktop close button warns when a ticket is still open.
  useEffect(() => {
    setTicketDirty(lines.length > 0);
    return () => setTicketDirty(false);
  }, [lines.length]);
  useEffect(() => {
    if (focId && !hasFoc) {
      const [, productId, qty] = focId.split(":");
      const rule = state.promotions.find((p) => p.id === focId.split(":")[0]);
      const product = state.products.find((p) => p.id === productId);
      if (rule && product) setLines((ls) => [...ls, focLine(rule, product, Number(qty))]);
    }
    if (!focId && hasFoc) setLines((ls) => ls.filter((l) => !l.foc));
  }, [focId, hasFoc, state.promotions, state.products, setLines]);
  // Total rounding: display and tender validation use the same rounded figure
  // the checkout charges and stores.
  const rounding = applyRounding(totals.total, state.settings.integrations.rounding, method);
  const roundedTotal = rounding.total;
  const balanceDue = roundedTotal >= 0 ? roundedTotal : 0;
  const refundDue = roundedTotal < 0 ? r2(-roundedTotal) : 0;

  const {
    couponOpen,
    setCouponOpen,
    couponCode,
    setCouponCode,
    couponScope,
    setCouponScope,
    couponLine,
    setCouponLine,
    voucherToken,
    setVoucherToken,
    memberVouchers,
    voucherPickerOpen,
    setVoucherPickerOpen,
    applyCoupon,
    applyVoucher,
    voucherPreview,
    removeCoupon,
  } = usePromotions({
    products: state.products,
    promotions: state.promotions,
    members: state.members,
    storeId: currentStore.id,
    lines,
    promoBase,
    coupon,
    setCoupon,
    memberId,
    setMemberId,
    patchLine,
    unlockDiscounts,
  });

  const {
    exchangeOpen,
    setExchangeOpen,
    billQuery,
    setBillQuery,
    billHit,
    setBillHit,
    picks,
    setPicks,
    lookupBill,
    addExchangeCredits,
  } = useExchange({
    sales: state.sales,
    hasShift: () => !!activeShift,
    setLines,
    setExchangeRef,
  });

  const { held, holdOrder, resumeHeld } = useRegisterHeldOrders({
    lines,
    total: totals.total,
    cartDiscount,
    cartDiscountType,
    exchangeRef,
    memberId,
    memberName: member?.name ?? null,
    coupon,
    billNo,
    storeId: currentStore.id,
    cashier: activeCashier,
    setLines,
    setCartDiscount,
    setCartDiscountType,
    setExchangeRef,
    setMemberId,
    setCoupon,
    setBillNo,
    resetCart,
    snapshot: () => ticketSnapshot.current(),
    onApprovalCleared: clearAppliedApproval,
    activeApproval: appliedApproval,
    calculateTotal: (nextLines, nextCartDiscount, nextCartDiscountType) => {
      const nextPreTotals = cartTotals(nextLines, 0, "amount", taxSettings);
      const nextPromo = evaluatePromotions({
        promotions: state.promotions,
        products: state.products,
        base: r2(nextPreTotals.subtotal - nextPreTotals.lineDiscount),
        member,
      });
      return cartTotals(
        nextLines,
        nextCartDiscount,
        nextCartDiscountType,
        taxSettings,
        r2(nextPromo.promoDiscount + billCouponDiscount),
      ).total;
    },
    onApprovalClaimed: (grant) => {
      const applied: AppliedApproval = {
        requestId: grant.requestId,
        actionKey: grant.actionKey,
        approvedPayload: grant.approvedPayload,
        grantToken: grant.grantToken,
        approvedAmount: grant.approvedAmount,
        requestedAmount: grant.requestedAmount,
        requesterDirectLimit: grant.requesterDirectLimit,
        valueUnit: grant.valueUnit,
        approvedBy: grant.approvedBy,
        approvedByName: grant.approvedByName,
        appliedSnapshotHash: null,
      };
      appliedApprovalRef.current = applied;
      setAppliedApproval(applied);
      toast.success(
        grant.approvedAmount === null
          ? `Approval by ${grant.approvedByName || grant.approvedBy || "authorised staff"} applied to this ticket`
          : `Approved ${
              grant.valueUnit === "percent"
                ? `${grant.approvedAmount.toFixed(2)}%`
                : grant.valueUnit === "currency"
                  ? money(grant.approvedAmount)
                  : grant.approvedAmount.toFixed(2)
            } by ${grant.approvedByName || grant.approvedBy || "authorised staff"} — applied to this ticket`,
      );
    },
  });
  // Keep the picture of the open ticket current for anything that needs it.
  ticketSnapshot.current = () =>
    lines.length === 0
      ? null
      : {
          ticketId: billNo ?? `draft-${currentStore.id}`,
          capturedAt: new Date().toISOString(),
          storeId: currentStore.id,
          terminalId: posTerminalId(),
          cashier: activeCashier,
          ...(billNo ? { billNo } : {}),
          lines: lines.map((l) => ({
            sku: l.productId,
            name: l.name,
            qty: l.qty,
            unitPrice: l.price,
            discount: l.discount ?? 0,
            lineTotal: r2(l.price * l.qty - (l.discount ?? 0)),
            priceOverridden: !!l.priceOverridden,
          })),
          subtotal: totals.subtotal,
          discount: totals.discount ?? 0,
          tax: totals.tax ?? 0,
          serviceCharge: 0,
          total: totals.total,
          member: member
            ? {
                id: member.id,
                code: member.code,
                name: member.name,
                phone: maskSnapshotPhone(member.phone),
                email: maskSnapshotEmail(member.email),
                tier: member.tier,
                points: member.points,
                totalSpend: member.totalSpend,
              }
            : null,
        };
  parkTicket.current = (id) => holdOrder(true, id);
  // Capture the ticket immediately after the approved change is applied. Any
  // later line, quantity, member, coupon or total change voids the database
  // approval before its signed grant can be accepted again.
  useEffect(() => {
    const approval = appliedApprovalRef.current;
    if (!approval) return;
    const snapshot = ticketSnapshot.current();
    if (!snapshot) {
      void invalidateAppliedApproval("Approved bill was removed before completion");
      return;
    }
    const currentHash = snapshotFingerprint(snapshot);
    if (!approval.appliedSnapshotHash) {
      const bound = { ...approval, appliedSnapshotHash: currentHash };
      appliedApprovalRef.current = bound;
      setAppliedApproval(bound);
      return;
    }
    if (approval.appliedSnapshotHash !== currentHash) {
      void invalidateAppliedApproval("Approved bill or item changed before completion");
    }
  }, [
    billNo,
    cartDiscount,
    cartDiscountType,
    coupon,
    invalidateAppliedApproval,
    lines,
    memberId,
    totals.discount,
    totals.subtotal,
    totals.tax,
    totals.total,
  ]);
  const detail = state.products.find((p) => p.id === detailId) ?? null;

  /** Adds the product matching a scanned/typed code to the ticket. */
  function scanCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    // Customer vouchers arrive as a token or as the full redeem.* URL.
    if (/(^|\/)vch_[a-z0-9]+$/i.test(code)) {
      void applyVoucher(code);
      return;
    }
    if (!activeShift) {
      toast.error("Open a shift before ringing up a sale");
      setOpenShiftOpen(true);
      return;
    }
    const hit = resolveByBarcode(state.products, code);
    if (!hit) {
      toast.error(`No product matches “${code}”`);
      // A mis-read or unknown barcode drops the cashier straight into search.
      setQuery(code);
      setUnknownCode(code);
      setCatalogOpen(true);
      return;
    }
    addLine(hit.id, variantForBarcode(hit, code));
  }

  /** Attaches a member to the ticket and surfaces any vouchers they hold. */
  function attachMember(m: Member) {
    setSelectedMember(m);
    setMemberId(m.id);
    setMemberQuery("");
    toast.success(`${m.name} attached to receipt`);
    void loadMemberVouchers(m.id)
      .then((vs) => {
        if (!vs.length) return;
        toast.info(
          vs.length === 1
            ? `${m.name} has a voucher: ${vs[0]!.campaign.name}`
            : `${m.name} has ${vs.length} vouchers available`,
          {
            action: {
              label: "Apply",
              onClick: () => void applyVoucher(vs[0]!.voucher.tokenSlug),
            },
          },
        );
      })
      .catch(() => undefined);
  }

  const displayBase = {
    companyName: state.settings.receipt.companyName || currentStore.name,
    logo: state.settings.receipt.showLogo ? state.settings.receipt.logo || "" : "",
    storeName: `${currentStore.name} (${currentStore.code})`,
    cashier: activeCashier,
    payment: state.settings.payment,
  };

  const cartSnapshot = (): DisplaySnapshot => ({
    at: Date.now(),
    ...displayBase,
    mode: lines.length ? "cart" : "idle",
    memberName: member?.name ?? null,
    memberPoints: member?.points ?? null,
    lines: lines.map((l) => toDisplayLine(l, r2((l.price - lineUnitDiscount(l)) * l.qty))),
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    taxRate: taxSettings.rate,
    taxEnabled: taxSettings.enabled,
    total: totals.total,
    paid: 0,
    change: 0,
    balance: 0,
    reference: "",
    dueDate: "",
    promos: promo.applied.map((a) => `${a.name} · ${a.detail}`),
    method: null,
    transferRef: "",
  });

  const { saving, lastSale, completeSale, bookAndPayLater, sendSaleOnWhatsApp } = useCheckout({
    getActiveShift: () => activeShift,
    getCurrentStore: () => currentStore,
    getActiveCashier: () => activeCashier,
    requirePermission,
    getAuthorization: () =>
      appliedApprovalRef.current
        ? {
            requestId: appliedApprovalRef.current.requestId,
            approvedBy:
              appliedApprovalRef.current.approvedByName ?? appliedApprovalRef.current.approvedBy,
          }
        : null,
    getLines: () => lines,
    getTotals: () => totals,
    getMember: () => member,
    getMemberId: () => memberId,
    getCoupon: () => coupon,
    getVoucherToken: () => voucherToken,
    getExchangeRef: () => exchangeRef,
    getPointsEarned: () => pointsEarned,
    getBillNo: () => billNo,
    resetCart,
    setLines,
    setMemberId,
    setVoucherToken,
    getMethod: () => method,
    getTendered: () => tendered,
    getTransferRef: () => transferRef,
    getTenderRef: () => tenderRef,
    getTenderRefNote: () => tenderRefNote,
    getBankName: () => bankName,
    getTenders: () => tenders,
    getActiveMethodName: () => activeMethodName,
    getNeedsTenderRef: () => needsTenderRef,
    resetTender,
    bookingIntake: {
      bookOpen,
      setBookOpen,
      deposit,
      setDeposit,
      depositMethod,
      setDepositMethod,
      dueDate,
      setDueDate,
      bookName,
      setBookName,
      bookPhone,
      setBookPhone,
      bookNote,
      setBookNote,
      serviceId,
      setServiceId,
      customService,
      setCustomService,
      payTiming,
      setPayTiming,
      bookMode,
      setBookMode,
      racketModel,
      setRacketModel,
      stringType,
      setStringType,
      tensionMain,
      setTensionMain,
      tensionCross,
      setTensionCross,
      tensionUnit,
      setTensionUnit,
      grommetNotes,
      setGrommetNotes,
      jobNotes,
      setJobNotes,
      promisedAt,
      setPromisedAt,
      stencil,
      setStencil,
      overgrip,
      setOvergrip,
      jobTag,
      setJobTag,
      bookingHubOpen,
      setBookingHubOpen,
      editBookingId,
      setEditBookingId,
      notifyWhatsApp,
      setNotifyWhatsApp,
      intakeCharges,
      setIntakeCharges,
      liabilityOk,
      setLiabilityOk,
      bookMemberQuery,
      setBookMemberQuery,
      racketProductId,
      setRacketProductId,
      racketCustomerOwned,
      setRacketCustomerOwned,
      stringProductId,
      setStringProductId,
      stringCustomerOwned,
      setStringCustomerOwned,
      labourUnlocked,
      setLabourUnlocked,
      labourReason,
      setLabourReason,
      resetJobCard,
    },
    getWaNumber: () => waNumber,
    setWaNumber,
    setWaSending,
    cartSnapshot,
    getDisplayBase: () => displayBase,
  });

  const displayKey = JSON.stringify({
    l: lines.map((l) => [l.productId, l.qty, l.discount, l.discountType, l.foc, l.credit]),
    t: totals.total,
    d: totals.discount,
    x: totals.tax,
    xr: taxSettings.rate,
    xe: taxSettings.enabled,
    m: member?.id ?? null,
    s: currentStore.id,
  });
  useEffect(() => {
    publishDisplay(cartSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayKey, state.settings.payment]);

  /** Show bank-transfer instructions on the customer screen while the
   *  cashier has that tender selected. */
  useEffect(() => {
    if (!payOpen) return;
    publishDisplay({
      ...cartSnapshot(),
      mode: method === "bank_transfer" ? "transfer" : "cart",
      method,
      transferRef,
      balance: totals.total,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen, method, transferRef, displayKey]);

  const serviceTypes = (state.settings.integrations.serviceTypes ?? []).filter(
    (s2) => s2.active && s2.name.trim(),
  );
  const stringingService = serviceTypes.find((s2) => s2.isStringingJob) ?? null;
  const racketMode = bookMode === "racket";

  /** Master lists an admin curates in booking settings. */
  const racketModelList = state.settings.integrations.racketModels ?? [];
  const stringModelList = state.settings.integrations.stringModels ?? [];

  /** House rules for bookings, set in Settings → Booking rules. */
  const bookingRules = bookingRulesOf(state.settings.integrations.bookingRules);
  const isSupervisor = user?.role === "admin" || can("can_access_pos_settings");
  /** Payment timings the branch allows, in the order they are shown. */
  const allowedTimings = (["now", "deposit", "collection"] as BookingPaymentTiming[]).filter((t) =>
    t === "now"
      ? bookingRules.allowPayNow
      : t === "deposit"
        ? bookingRules.allowPayDeposit
        : bookingRules.allowPayOnCollection,
  );
  /** Ready-by value pre-filled from the branch's default turnaround. */
  const proposedPromisedAt = () => {
    const hours = bookingRules.defaultTurnaroundHours;
    if (!hours) return "";
    const at = new Date(Date.now() + hours * 3_600_000);
    at.setMinutes(at.getMinutes() - at.getTimezoneOffset());
    return at.toISOString().slice(0, 16);
  };
  /** Smallest deposit this branch will accept on a booking of `total`. */
  const minDepositFor = (total: number) =>
    !bookingRules.requireDeposit
      ? 0
      : bookingRules.depositMode === "percent"
        ? r2((total * Math.max(0, bookingRules.depositMin)) / 100)
        : r2(Math.max(0, bookingRules.depositMin));

  /** Jobs still on the bench today — drives the badge on the booking button. */
  const activeBookingCount = state.bookings.filter(
    (b) => b.storeId === currentStore.id && b.status === "active" && b.jobStatus !== "collected",
  ).length;

  /** Racket / stringing job started from the products card — cart independent. */
  function startRacketBooking() {
    if (!activeShift) {
      toast.error("Open a shift before taking a booking");
      return;
    }
    resetJobCard();
    setDeposit("");
    setBookName(member?.name ?? "");
    setBookPhone(member?.phone ?? "");
    if (stringingService) setServiceId(stringingService.id);
    setIntakeCharges([
      {
        kind: "labor",
        name: stringingService?.name || "Stringing labour",
        price: r2(
          Math.max(
            0,
            Number(stringingService?.fee ?? state.settings.integrations.baseLaborFee ?? 0),
          ),
        ),
      },
    ]);
    if (bookingRules.autoJobTag) setJobTag(newJobTag());
    setTensionUnit(bookingRules.defaultTensionUnit);
    if (bookingRules.defaultTensionMain) setTensionMain(String(bookingRules.defaultTensionMain));
    if (bookingRules.defaultTensionCross) setTensionCross(String(bookingRules.defaultTensionCross));
    setPromisedAt(proposedPromisedAt());
    if (!allowedTimings.includes(payTiming) && allowedTimings[0]) setPayTiming(allowedTimings[0]);
    /* Auto-fill from the customer's last racket job so regulars are one tap. */
    const past = memberId
      ? state.bookings.find((b) => b.memberId === memberId && b.job?.racketModel)
      : undefined;
    if (past?.job) {
      setRacketModel(past.job.racketModel ?? "");
      setStringType(past.job.stringType ?? "");
      setTensionMain(past.job.tensionMain ? String(past.job.tensionMain) : "");
      setTensionCross(past.job.tensionCross ? String(past.job.tensionCross) : "");
      setTensionUnit(past.job.tensionUnit ?? "lb");
      setStencil(!!past.job.stencil);
      setOvergrip(!!past.job.overgrip);
    }
    setBookMode("racket");
    setBookOpen(true);
  }

  /** Standard / general booking against the cart. */
  function startCartBooking() {
    if (!activeShift) {
      toast.error("Open a shift before taking a booking");
      return;
    }
    setDeposit("");
    setBookName(member?.name ?? "");
    setBookPhone(member?.phone ?? "");
    setBookMode("cart");
    resetJobCard();
    if (!allowedTimings.includes(payTiming) && allowedTimings[0]) setPayTiming(allowedTimings[0]);
    setBookOpen(true);
  }

  /** Re-open the racket dialog on a booking already on the ticket. */
  function editBookingSpecs(bookingId: string) {
    const b = state.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    if (bookingRules.managerOnlyEditPaidSpecs && b.paid > 0 && !isSupervisor) {
      toast.error("A supervisor must change the specs once a deposit is held");
      return;
    }
    setEditBookingId(b.id);
    setBookMode("racket");
    setRacketModel(b.job?.racketModel ?? "");
    setStringType(b.job?.stringType ?? "");
    setTensionMain(b.job?.tensionMain ? String(b.job.tensionMain) : "");
    setTensionCross(b.job?.tensionCross ? String(b.job.tensionCross) : "");
    setTensionUnit(b.job?.tensionUnit ?? "lb");
    setGrommetNotes(b.job?.grommetNotes ?? "");
    setJobNotes(b.job?.jobNotes ?? "");
    setStencil(!!b.job?.stencil);
    setOvergrip(!!b.job?.overgrip);
    setNotifyWhatsApp(!!b.job?.notifyWhatsApp);
    setPromisedAt(b.job?.promisedAt ? new Date(b.job.promisedAt).toISOString().slice(0, 16) : "");
    setJobTag(b.tagId ?? "");
    setBookOpen(true);
  }

  /** Save spec edits made from the cart row back onto the stored booking. */
  function saveSpecEdits() {
    if (!editBookingId) return;
    const job = {
      racketModel: racketModel.trim() || undefined,
      stringType: stringType.trim() || undefined,
      tensionMain: tensionMain ? Number(tensionMain) : undefined,
      tensionCross: tensionCross ? Number(tensionCross) : undefined,
      tensionUnit,
      grommetNotes: grommetNotes.trim() || undefined,
      jobNotes: jobNotes.trim() || undefined,
      stencil,
      overgrip,
      promisedAt: promisedAt ? new Date(promisedAt).toISOString() : undefined,
      notifyWhatsApp,
    };
    const updated = updateBookingSpecs(editBookingId, job);
    if (!updated) {
      toast.error("That booking is no longer on file");
      return;
    }
    setLines((ls) =>
      ls.map((l) => (l.bookingId === editBookingId ? { ...l, job: updated.job } : l)),
    );
    setBookOpen(false);
    resetJobCard();
    setBookMode("cart");
    toast.success(`Specs updated for ${updated.ref}`);
  }

  /* ---- racket intake: catalogue pickers, customer-provided gear, labour lock ---- */
  const catalogueOptions = (match: RegExp) =>
    state.products
      .filter((p) => !p.archived && match.test(`${p.category} ${p.subCategory ?? ""} ${p.name}`))
      .slice(0, 60)
      .map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}` }));
  const racketOptions = catalogueOptions(/racket|frame/i);
  const stringOptions = catalogueOptions(/string/i);
  const addOnOptions = catalogueOptions(/grip|grommet|stencil|accessor|add-on/i);

  /** Replace one charge line of a given kind (labour lines are never touched). */
  const setChargeOfKind = (kind: IntakeCharge["kind"], next: IntakeCharge) =>
    setIntakeCharges((rows) => [...rows.filter((r) => r.kind !== kind), next]);

  function pickRacketProduct(id: string) {
    const p = state.products.find((x) => x.id === id);
    setRacketProductId(id);
    if (!p) return;
    setRacketCustomerOwned(false);
    setRacketModel(p.name);
    setIntakeCharges((rows) => [
      ...rows.filter((r) => !(r.kind === "accessory" && /^racket/i.test(r.name))),
      { kind: "accessory", name: `Racket — ${p.name}`, price: r2(p.price), productId: p.id },
    ]);
  }

  function setCustomerRacket(on: boolean) {
    setRacketCustomerOwned(on);
    if (!on) return;
    setRacketProductId("");
    setIntakeCharges((rows) =>
      rows.filter((r) => !(r.kind === "accessory" && /^racket/i.test(r.name))),
    );
  }

  async function pickStringProduct(id: string) {
    const p = state.products.find((x) => x.id === id);
    if (p) {
      /* Inventory guard — never string from a reel the branch does not hold. */
      const onHand = availableAt(p, currentStore.id, state.bookings);
      if (onHand <= 0) {
        const ok = await requirePermission("can_adjust_stock");
        if (!ok) {
          toast.error(`${p.name} is out of stock at ${currentStore.name}`);
          return;
        }
        const reason = window
          .prompt(`${p.name} shows no stock here. Reason for using it anyway?`)
          ?.trim();
        if (!reason) {
          toast.error("A reason is required to use out-of-stock string");
          return;
        }
        toast.warning(`Out-of-stock string approved — ${reason}`);
      }
    }
    setStringProductId(id);
    if (!p) return;
    setStringCustomerOwned(false);
    setStringType(p.name);
    setChargeOfKind("string", {
      kind: "string",
      name: p.name,
      price: r2(p.price),
      productId: p.id,
    });
  }

  function setCustomerString(on: boolean) {
    setStringCustomerOwned(on);
    if (!on) return;
    setStringProductId("");
    setIntakeCharges((rows) =>
      rows.map((r) =>
        r.kind === "string" ? { ...r, price: 0, customerProvided: true, productId: undefined } : r,
      ),
    );
  }

  function addAddOnProduct(id: string) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    setIntakeCharges((rows) => [
      ...rows,
      {
        kind: /grip/i.test(p.category + p.name) ? "grip" : "accessory",
        name: p.name,
        price: r2(p.price),
        productId: p.id,
      },
    ]);
  }

  /** Unlock the read-only labour fee — supervisor gate or a written reason. */
  async function unlockLabour() {
    if (labourUnlocked) return;
    if (bookingRules.overrideNeedsSupervisor && !isSupervisor) {
      const ok = await requirePermission("can_access_pos_settings");
      if (!ok) return;
    }
    setLabourUnlocked(true);
    toast.info("Labour fee unlocked — record the reason.");
  }

  /** Racket + string bought together earns the configured combo on labour. */
  const combo = applyCombo(intakeCharges, bookingRules);
  /** Tension above the branch limit (or customer gear) flags the liability box. */
  const highTension =
    Number(tensionMain || 0) > bookingRules.highTensionThreshold ||
    Number(tensionCross || 0) > bookingRules.highTensionThreshold ||
    stringCustomerOwned;
  const intake = intakeTotals(
    combo.charges,
    state.settings.tax,
    0,
    state.settings.integrations.categoryMap,
  );
  const serviceCharge = racketMode ? intake.subtotal : 0;
  const bookingTotal = r2(totals.total + serviceCharge);
  /* Live deposit breakdown shown on the booking form: what the branch demands
     up front, what the cashier is taking now, and what is left to collect. */
  const bookingMinDeposit = Math.min(minDepositFor(bookingTotal), bookingTotal);
  const bookingPaidNow =
    payTiming === "collection"
      ? 0
      : payTiming === "now"
        ? bookingTotal
        : r2(Math.max(0, Number(deposit || 0)));
  const bookingBalance = r2(Math.max(0, bookingTotal - bookingPaidNow));
  const bookingDepositShort = bookingMinDeposit > 0 && bookingPaidNow + 0.001 < bookingMinDeposit;

  /* ── Operation deck helpers ─────────────────────────────────────── */

  /** Arriving from the Hold tickets screen with ?resume=<id>. */
  const { resume, booking: bookingFlow } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    if (!resume) return;
    if (can("can_reopen_held_order")) void resumeHeld(resume);
    else toast.error("Reopen held ticket permission is required");
    void navigate({ to: "/", search: { sell: true }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  /** Arriving from /pos/racket-service or /pos/general-booking. */
  useEffect(() => {
    if (!bookingFlow) return;
    if (bookingFlow === "racket") startRacketBooking();
    else startCartBooking();
    void navigate({ to: "/", search: { sell: true }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingFlow]);

  const splitShares = useMemo(() => {
    const cents = Math.round(balanceDue * 100);
    const base = Math.floor(cents / splitWays);
    return Array.from(
      { length: splitWays },
      (_, i) => (base + (i < cents - base * splitWays ? 1 : 0)) / 100,
    );
  }, [balanceDue, splitWays]);

  /** Provisional receipt rendered from the live ticket for the overlay. */
  const previewHtml = useMemo(() => {
    if (!receiptPreview) return "";
    const source: Sale | null = lines.length
      ? {
          id: "preview",
          receiptNo: "PREVIEW",
          storeId: currentStore.id,
          shiftId: activeShift?.id ?? "",
          lines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          paid: 0,
          change: 0,
          method,
          memberId,
          pointsEarned,
          cashier: activeCashier,
          createdAt: new Date().toISOString(),
          ...(exchangeRef
            ? { exchangeOfReceiptNo: exchangeRef, exchangeCredit: totals.credit }
            : {}),
        }
      : lastSale;
    return source ? saleReceiptPreview(source, member, "sale") : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptPreview, displayKey, method, lastSale, member]);

  const terminalKey = readTerminalConfig()?.tokenId ?? currentStore.id ?? "default";

  const closeShiftFromRegister = async () => {
    if (!(await requirePermission("can_close_shift"))) return;
    const grant = await authorize({
      action: "shift_close",
      title: "Authorise shift close",
      reason: "Closing the shift produces the final drawer count and Z report.",
      storeId: currentStore.id,
      terminalId: terminalKey,
      requestedBy: user?.staffId ?? user?.name ?? null,
    });
    if (!grant.ok) return;
    setCloseShiftOpen(true);
  };

  const slot_catalog = (
    <>
      <CatalogPanel
        storeName={currentStore.name}
        shiftOpen={!!activeShift}
        onOpenCatalog={() => setCatalogOpen(true)}
        onOpenCustomerDisplay={
          visible("register.customerDisplay") ? openCustomerDisplay : undefined
        }
        onOpenShift={() => setOpenShiftOpen(true)}
        onCloseShift={visible("register.closeShift") ? closeShiftFromRegister : undefined}
      />
    </>
  );

  const atom_billNumber = (
    <div className="flex h-full min-w-0 flex-col justify-center px-4 py-2">
      <p className="truncate text-sm font-semibold">Current Bill</p>
      <p className="numeric truncate text-[11px] text-muted-foreground">
        {billNo ? `#${billNo}` : "New bill — scan an item to start"}
      </p>
      {appliedApproval && (
        <p className="truncate text-[10px] font-medium text-success">
          Approval certificate · {appliedApprovalText}
        </p>
      )}
    </div>
  );

  const atom_shiftBadge = (
    <div className="flex h-full min-w-0 items-center px-2">
      <span
        className={`min-w-0 truncate rounded-full border px-2 py-1 text-[11px] font-medium ${
          activeShift
            ? "border-success/40 bg-success/10 text-success"
            : "border-destructive/40 bg-destructive/10 text-destructive"
        }`}
      >
        {activeShift ? "Shift open" : "No shift open"}
      </span>
    </div>
  );

  const atom_actExchange = visible("register.exchange") ? (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        layout="inline"
        variant="outline"
        className="h-full"
        label="Exchange"
        icon={<Repeat className="size-4" />}
        onClick={async () => {
          if (await requirePermission("can_process_exchange")) setExchangeOpen(true);
        }}
      />
    </div>
  ) : null;

  const atom_actClear = (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        layout="inline"
        variant="ghost"
        className="h-full"
        label="Clear"
        icon={<Trash2 className="size-4" />}
        disabled={!lines.length}
        onClick={() => void clearCart("clear")}
      />
    </div>
  );

  const slot_billHeader = (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Current Bill</p>
          <p className="numeric truncate text-[11px] text-muted-foreground">
            {billNo ? `#${billNo}` : "New bill — scan an item to start"}
          </p>
          {appliedApproval && (
            <p className="truncate text-[10px] font-medium text-success">
              Approval certificate · {appliedApprovalText}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium ${
            activeShift
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {activeShift ? "Shift open" : "No shift open"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {visible("register.exchange") && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (await requirePermission("can_process_exchange")) setExchangeOpen(true);
            }}
          >
            <Repeat className="size-4" /> Exchange
          </Button>
        )}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            disabled={tillLocked}
            onClick={() => setBookingHubOpen(true)}
          >
            <CalendarClock className="size-4" /> Manage Booking
          </Button>
          {activeBookingCount > 0 && (
            <Badge className="absolute -right-2 -top-2 h-5 min-w-5 justify-center px-1 text-[10px]">
              {activeBookingCount}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!lines.length}
          onClick={() => void clearCart("clear")}
        >
          <Trash2 className="size-4" /> Clear
        </Button>
      </div>
    </div>
  );

  const slot_scanBar = (
    <>
      <div className="min-w-0" data-scan-focus>
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Scan barcode
        </Label>
        <div className="mt-2">
          <ScanBar onScan={scanCode} />
        </div>
      </div>
    </>
  );

  const slot_standardProductLookup = (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Product lookup</p>
            <p className="truncate text-xs text-muted-foreground">{currentStore.name}</p>
          </div>
          {activeShift ? (
            visible("register.closeShift") && (
              <Button variant="outline" size="sm" onClick={() => void closeShiftFromRegister()}>
                Close shift
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => setOpenShiftOpen(true)}>
              Open shift
            </Button>
          )}
        </div>
        {slot_scanBar}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            disabled={!activeShift}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, SKU, barcode or category…"
            aria-label="Search products"
            className="h-11 pl-9"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {!deferredProductQuery.trim() && recommendedProducts.length > 0 && (
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Frequent &amp; recent
            </p>
          )}
          {standardLookupProducts.map((product) => (
            <Button
              key={product.id}
              type="button"
              variant="outline"
              disabled={!activeShift}
              onClick={() => addLine(product.id)}
              className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-card px-3 py-2.5 text-left font-normal hover:border-primary/60 hover:bg-primary/5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{product.name}</span>
                <span className="numeric block truncate text-[11px] text-muted-foreground">
                  {product.sku} · {stockAt(product, currentStore.id)} in stock
                </span>
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-primary">
                {money(product.price)}
              </span>
            </Button>
          ))}
          {!standardLookupProducts.length && (
            <div className="px-4 py-10 text-center">
              <PackageSearch className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">
                {deferredProductQuery.trim()
                  ? `No products match “${deferredProductQuery.trim()}”.`
                  : "Looking for more items? Search above."}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="grid shrink-0 gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <Button variant="outline" disabled={!activeShift} onClick={() => setCatalogOpen(true)}>
          <PackageSearch className="size-4" /> Advanced search
        </Button>
        {visible("register.customerDisplay") && (
          <Button variant="outline" onClick={openCustomerDisplay}>
            <MonitorPlay className="size-4" /> Customer screen
          </Button>
        )}
      </div>
    </section>
  );

  const slot_memberSearch = (
    <>
      <div className="min-w-0">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Search loyalty member
        </Label>
        {member ? (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2">
            <BadgeCheck className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{member.name}</p>
              <p className="numeric text-[11px] text-muted-foreground">
                {member.code} · {member.tier} · {member.points} pts · {member.phone}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label="Purchase history"
              onClick={() => setHistoryMemberId(memberId)}
            >
              <History className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label="Detach member"
              onClick={() => setMemberId(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : null}
        {member && memberVouchers.length ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-8 w-full text-xs"
            onClick={() => setVoucherPickerOpen(true)}
          >
            <TicketPercent className="size-3.5" /> Vouchers ({memberVouchers.length})
          </Button>
        ) : null}
        {member ? null : (
          <>
            <div className="mt-2 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={memberInputRef}
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Phone number or name…"
                  className="h-10 pl-8 text-sm"
                />
              </div>
              <Button
                variant="outline"
                className="h-10 shrink-0"
                onClick={() => setQuickMemberOpen(true)}
              >
                <UserPlus className="size-4" />
                <span className="hidden sm:inline">New member</span>
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {memberMatches.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{m.name}</p>
                    <p className="numeric text-[11px] text-muted-foreground">
                      {m.phone} · {m.points} pts · {m.tier}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => setHistoryMemberId(m.id)}
                  >
                    <History className="size-3" /> History
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => attachMember(m)}
                  >
                    <UserPlus className="size-3" /> Attach
                  </Button>
                </div>
              ))}
              {memberQuery.trim() && !memberMatches.length && (
                <div className="space-y-2 py-1">
                  <p className="text-[11px] text-muted-foreground">
                    No member matches “{memberQuery}”.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setMemberQuery("");
                        memberInputRef.current?.focus();
                      }}
                    >
                      <Search className="size-3" /> Search again
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setQuickMemberOpen(true)}
                    >
                      <UserPlus className="size-3" /> Enroll new member
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );

  const slot_cartLines = (
    <>
      <ScrollArea
        className="min-h-0 flex-1"
        data-register-cart
        tabIndex={-1}
        aria-label="Current cart"
      >
        <div className="divide-y divide-border">
          {lines.map((l, i) => (
            <div
              key={`${l.credit ? "C" : "S"}-${l.productId}-${i}`}
              className={`px-4 py-3 ${l.credit ? "bg-accent/5" : ""}`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {l.name}
                    {l.credit && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        credit
                      </Badge>
                    )}
                    {l.foc && (
                      <Badge className="ml-2 bg-success/15 text-[10px] text-success">
                        FREE PROMO
                      </Badge>
                    )}
                    {l.bookingRef && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {l.bookingRef}
                      </Badge>
                    )}
                  </div>
                  {l.bookingId && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {[
                        l.job?.racketModel,
                        l.job?.stringType,
                        l.job?.tensionMain || l.job?.tensionCross
                          ? `${l.job?.tensionMain ?? "—"}x${l.job?.tensionCross ?? l.job?.tensionMain ?? "—"} ${l.job?.tensionUnit ?? "lb"}`
                          : "",
                        l.job?.stencil ? "stencil" : "",
                        l.job?.overgrip ? "overgrip" : "",
                        l.job?.promisedAt
                          ? `ready ${new Date(l.job.promisedAt).toLocaleString()}`
                          : "",
                      ]
                        .filter(Boolean)
                        .map((chip) => (
                          <Badge
                            key={chip as string}
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            {chip}
                          </Badge>
                        ))}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-[11px]"
                        onClick={() => editBookingSpecs(l.bookingId!)}
                      >
                        Edit specs
                      </Button>
                    </div>
                  )}
                  <p className="numeric text-[11px] text-muted-foreground">
                    {money(l.price)}
                    {taxSettings.enabled ? ` · tax ${taxSettings.rate}%` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() => void setQty(i, -1)}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="numeric w-7 text-center text-sm">{l.qty}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() => void setQty(i, 1)}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
                <span
                  className={`numeric col-span-2 shrink-0 text-right text-sm font-semibold sm:col-span-1 sm:w-24 ${l.credit ? "text-accent" : ""}`}
                >
                  {money((l.price - lineUnitDiscount(l)) * l.qty)}
                </span>
              </div>
              {!l.credit && !l.foc && !discountAllowed && (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => void unlockDiscounts()}
                    className="h-auto p-0 text-[11px] text-muted-foreground"
                  >
                    Discount locked · supervisor override
                  </Button>
                </div>
              )}
              {!l.credit && !l.foc && discountAllowed && (
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">Disc</span>
                  <ActionButton
                    layout="inline"
                    variant="outline"
                    size="sm"
                    onClick={() => setPadTarget(i)}
                    className="numeric h-10 min-h-10 max-w-full shrink-0 justify-center gap-2 px-3 text-[11px]"
                    label={
                      l.discount
                        ? `${l.discount}${(l.discountType ?? "amount") === "percent" ? "%" : ""}`
                        : "Add discount"
                    }
                    icon={<Percent className="size-4" />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 shrink-0 px-2 text-[11px] text-muted-foreground"
                    onClick={() => {
                      setPriceTarget(i);
                      setPriceDraft(String(l.price));
                      setPriceReason("");
                    }}
                  >
                    <Pencil className="size-3" /> Override price
                  </Button>
                </div>
              )}
              {!l.credit && !l.foc && !discountAllowed && (
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-muted-foreground"
                    onClick={() => {
                      setPriceTarget(i);
                      setPriceDraft(String(l.price));
                      setPriceReason("");
                    }}
                  >
                    <Pencil className="size-3" /> Override price
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!lines.length && (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              Tap a product to start the ticket.
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  );

  const atom_totalsBlock = (
    <div className="w-full min-w-0 space-y-2 px-4 py-2 text-sm">
      {exchangeRef && (
        <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px]">
          <span className="min-w-0 truncate">Exchange against bill #{exchangeRef}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 shrink-0"
            aria-label="Remove exchange"
            title="Remove exchange"
            onClick={() => {
              setLines((ls) => ls.filter((l) => !l.credit));
              setExchangeRef(null);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <Row label="Subtotal" value={money(totals.subtotal)} />
      {totals.credit > 0 && (
        <Row label={`Store credit #${exchangeRef ?? ""}`} value={`-${money(totals.credit)}`} />
      )}
      {!discountAllowed && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => void unlockDiscounts()}
          className="flex h-auto w-full min-w-0 items-center justify-between gap-3 px-0 py-1 font-normal text-muted-foreground"
        >
          <span className="min-w-0 truncate">Bill discount</span>
          <span className="shrink-0 text-[11px] underline-offset-2 hover:underline">
            locked · supervisor override
          </span>
        </Button>
      )}
      {/* Label left, control flush right — sized by its own content so it can
          never push past the panel edge. */}
      <div
        className={`flex w-full min-w-0 items-center justify-between gap-3 ${discountAllowed ? "" : "hidden"}`}
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Bill discount</span>
        <ActionButton
          layout="inline"
          variant="outline"
          size="sm"
          onClick={() => setPadTarget("bill")}
          className="numeric h-10 min-h-10 max-w-full shrink-0 justify-center gap-2 px-3 text-xs"
          label={
            cartDiscount
              ? `${cartDiscount}${cartDiscountType === "percent" ? "%" : ""}`
              : "Add discount"
          }
          icon={<Percent className="size-4" />}
        />
      </div>
      {promo.promoDiscount > 0 && (
        <Row label="Promotion discount" value={`-${money(promo.promoDiscount)}`} />
      )}
      <Row label="Discount applied" value={`-${money(totals.discount)}`} />
      {taxSettings.enabled && !!totals.tax && (
        <Row
          label={
            taxSettings.mode === "inclusive"
              ? `Tax ${taxSettings.rate}% (included)`
              : `Tax ${taxSettings.rate}%`
          }
          value={money(totals.tax)}
        />
      )}
      {showsRoundingLine(rounding.adjustment, state.settings.integrations.rounding) && (
        <Row
          label={roundingOf(state.settings.integrations.rounding).receiptLabel}
          value={`-${money(Math.abs(rounding.adjustment))}`}
        />
      )}
      {promo.applied.length > 0 && (
        <div className="rounded-md border border-success/30 bg-success/5 px-2 py-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-success">
            <Sparkles className="size-3" /> Active promotions applied
          </p>
          <ul className="mt-1 space-y-0.5">
            {promo.applied.map((a) => (
              <li key={a.id} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{a.name}</span> · {a.detail}
              </li>
            ))}
          </ul>
          {member && (
            <p className="numeric mt-1 text-[11px] text-muted-foreground">
              {member.name} earns {pointsEarned} pts on this bill
            </p>
          )}
        </div>
      )}
      {coupon && (
        <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px]">
          <span className="min-w-0 truncate">
            Coupon <span className="font-semibold">{coupon.code}</span> ·{" "}
            {coupon.scope === "item" ? coupon.productName : "whole bill"} ·{" "}
            <span className="numeric">-{money(coupon.discount)}</span>
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 shrink-0"
            aria-label="Remove coupon"
            title="Remove coupon"
            onClick={removeCoupon}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );

  const atom_balanceDue = (
    <div className="flex h-full min-w-0 items-center justify-between gap-3 px-4">
      <span className="text-base font-semibold">
        {refundDue > 0 ? "Refund due" : "Balance due"}
      </span>
      <span
        className={`numeric text-2xl font-bold ${refundDue > 0 ? "text-accent" : "text-primary"}`}
      >
        {money(refundDue > 0 ? refundDue : balanceDue)}
      </span>
    </div>
  );

  const atom_actCharge = (
    <div className="flex h-full min-w-0 items-center">
      <ActionButton
        layout="inline"
        className="h-full w-full rounded-xl border-transparent bg-primary px-6 text-lg font-semibold text-primary-foreground shadow-md transition-[transform,box-shadow] hover:bg-primary/90 hover:shadow-lg active:scale-[0.995]"
        disabled={!lines.length || tillLocked || (refundDue > 0 && !canRefund)}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => openPayment()}
        icon={<Banknote className="size-5" />}
        label={
          !activeShift
            ? "Shift closed — selling locked"
            : refundDue > 0
              ? canRefund
                ? `Refund ${money(refundDue)}`
                : "Refunds locked for this user"
              : `Charge ${money(balanceDue)}`
        }
      />
    </div>
  );

  /** Always on the right panel, cart empty or not. */
  const atom_actBooking = (
    <div className="relative flex h-full min-w-0 items-center px-1">
      {activeBookingCount > 0 && (
        <Badge className="absolute right-2 top-0 z-10 h-5 min-w-5 justify-center px-1 text-[10px]">
          {activeBookingCount}
        </Badge>
      )}
      <ActionButton
        layout="inline"
        className="h-full w-full"
        label="Manage Booking"
        icon={<CalendarClock className="size-4" />}
        disabled={tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => setBookingHubOpen(true)}
      />
    </div>
  );

  const atom_reprintDeck = lastSale ? (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      {can("can_reprint_bill") && (
        <ActionButton
          layout="inline"
          variant="outline"
          size="sm"
          label="Reprint"
          icon={<Printer className="size-4" />}
          disabled={tillLocked}
          disabledReason={tillLocked ? lockedReason : undefined}
          onClick={() => {
            printSaleReceipt(
              lastSale,
              state.members.find((m) => m.id === lastSale.memberId) ?? null,
              "duplicate",
            );
            logTicketEvent(TICKET_ACTIONS.reprinted, {
              saleId: lastSale.id,
              receiptNo: lastSale.receiptNo,
              template: "duplicate",
              storeId: currentStore.id,
            });
          }}
        />
      )}
      <ActionButton
        layout="inline"
        variant="outline"
        size="sm"
        label="Gift"
        icon={<Gift className="size-4" />}
        disabled={tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => {
          printSaleReceipt(lastSale, null, "gift");
          logger.log("print", "Gift receipt printed", "register", {
            saleId: lastSale.id,
            receiptNo: lastSale.receiptNo,
          });
        }}
      />
      <ActionButton
        layout="inline"
        variant="outline"
        size="sm"
        label="Kitchen"
        icon={<ChefHat className="size-4" />}
        disabled={tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => {
          printSaleReceipt(lastSale, null, "kitchen");
          logger.log("print", "Kitchen receipt printed", "register", {
            saleId: lastSale.id,
            receiptNo: lastSale.receiptNo,
          });
        }}
      />
      {state.settings.whatsapp.enabled && can("can_send_whatsapp_bill") && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={waNumber}
            onChange={(e) => setWaNumber(e.target.value)}
            placeholder="WhatsApp number"
            className="numeric h-9 w-44"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={waSending || !waNumber.trim()}
            onClick={() => void sendSaleOnWhatsApp(lastSale, waNumber)}
          >
            <MessageCircle className="size-4" />
            {waSending ? "Sending…" : "Send bill"}
          </Button>
        </div>
      )}
    </div>
  ) : null;

  const slot_billFooter = (
    <div className="w-full min-w-0 shrink-0 space-y-2 border-t border-border pb-4 pt-2 text-sm">
      {atom_totalsBlock}
      <div className="px-4">
        <Separator />
      </div>
      <div className="h-12">{atom_balanceDue}</div>
      {visible("register.paymentExecution") && (
        <div className="h-14 px-4 pt-1">{atom_actCharge}</div>
      )}
      {lastSale && <div className="border-t border-border">{atom_reprintDeck}</div>}
    </div>
  );

  const atom_actHold =
    visible("register.holdOrder") && can("can_hold_cart") && lines.length > 0 ? (
      <div className="flex h-full min-w-0 items-center px-1">
        <ActionButton
          variant="outline"
          layout="inline"
          className="h-full w-full min-w-0"
          label="Hold order"
          icon={<PauseCircle className="size-4" />}
          disabled={!lines.length || tillLocked}
          disabledReason={tillLocked ? lockedReason : undefined}
          onClick={() => holdOrder()}
        />
      </div>
    ) : null;

  const atom_actVoid = (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        variant="outline"
        layout="inline"
        className="h-full w-full min-w-0 text-destructive hover:text-destructive"
        label="Void cart"
        icon={<Trash2 className="size-4" />}
        disabled={!lines.length || tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => void clearCart()}
      />
    </div>
  );

  const atom_actCoupon = visible("register.coupon") ? (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        variant="outline"
        layout="inline"
        className="h-full w-full min-w-0"
        label="Apply coupon"
        icon={<TicketPercent className="size-4" />}
        disabled={tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => setCouponOpen(true)}
      />
    </div>
  ) : null;

  const atom_actSplit = visible("register.splitBill") ? (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        variant="outline"
        layout="inline"
        className="h-full w-full min-w-0"
        label="Split bill"
        icon={<Split className="size-4" />}
        disabled={balanceDue <= 0 || tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={() => setSplitOpen(true)}
      />
    </div>
  ) : null;

  const atom_heldList =
    can("can_view_held_orders") && visibleRoute("/holds") && held.length ? (
      <div className="space-y-1 px-2 py-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Held orders</p>
          <Link
            to="/holds"
            className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
          >
            Held bills
            <span className="numeric inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {held.length}
            </span>
          </Link>
        </div>
        {held.map((h) => (
          <Button
            key={h.id}
            type="button"
            variant="outline"
            onClick={() => {
              if (can("can_reopen_held_order")) void resumeHeld(h.id);
              else toast.error("Reopen held ticket permission is required");
            }}
            className="flex h-auto w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-normal hover:border-primary/60"
          >
            <span className="truncate">
              {h.cancelledFrom ? "↩ " : ""}
              {h.label}
            </span>
            <span className="numeric font-semibold">{money(h.total)}</span>
          </Button>
        ))}
      </div>
    ) : null;

  const atom_actDrawer = (
    <div className="flex h-full min-w-0 items-center px-1">
      <ActionButton
        layout="inline"
        variant="outline"
        className="h-full w-full sm:gap-3"
        label="Open cash drawer"
        icon={<Vault className="size-4" />}
        disabled={tillLocked}
        disabledReason={tillLocked ? lockedReason : undefined}
        onClick={async () => {
          if (!(await requirePermission("can_open_drawer"))) return;
          setNoSaleNote("");
          setNoSaleReason("");
          setNoSaleOpen(true);
        }}
      />
    </div>
  );

  const atom_receiptToggle = (
    <div className="flex h-full min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <Label htmlFor="live-receipt" className="text-xs leading-tight">
        Live receipt preview
        <span className="block text-[11px] font-normal text-muted-foreground">
          Opens as an overlay
        </span>
      </Label>
      <Switch id="live-receipt" checked={receiptPreview} onCheckedChange={setReceiptPreview} />
    </div>
  );

  /**
   * Every till feature, registered once. Buttons only trigger these — removing
   * a button from the canvas never unregisters the handler or its hotkey.
   */
  const registerActionHandlers: ActionHandlers = {
    "cart.focus": () => {
      const cart = document.querySelector<HTMLElement>("[data-register-cart]");
      cart?.scrollIntoView({ block: "nearest", inline: "nearest" });
      cart?.focus({ preventScroll: true });
    },
    "cart.charge": () => openPayment(),
    "cart.fastCash": () => openPayment(),
    "cart.clear": () => void clearCart("clear"),
    "cart.coupon": () => setCouponOpen(true),
    "cart.split": () => setSplitOpen(true),
    "cart.receipt": () => setReceiptPreview((v) => !v),
    "cart.barcode": () =>
      document.querySelector<HTMLInputElement>("[data-scan-focus] input")?.focus(),
    "hold.new": () => {
      if (can("can_hold_cart")) holdOrder();
    },
    "void.cart": () => void clearCart(),
    "book.hub": () => setBookingHubOpen(true),
    "shift.open": () => setOpenShiftOpen(true),
    "shift.close": () => setCloseShiftOpen(true),
    "drawer.open": () => setNoSaleOpen(true),
    "member.add": () => setQuickMemberOpen(true),
    "product.search": () => setCatalogOpen(true),
    "exchange.open": () => setExchangeOpen(true),
    ...(lastSale
      ? {
          "receipt.reprint": () =>
            printSaleReceipt(
              lastSale,
              state.members.find((m) => m.id === lastSale.memberId) ?? null,
              "duplicate",
            ),
        }
      : {}),
  };

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center border-b border-border bg-background px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground"
            onClick={() => void navigate({ to: "/", search: {}, replace: true })}
          >
            <ArrowLeft className="size-4" /> Back to workspace
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <ZoomCanvas>
            <RegisterActionsProvider handlers={registerActionHandlers}>
              <RegisterWorkspace
                terminalKey={terminalKey}
                mode={state.settings.integrations.sellingLayout}
                onModeChange={(sellingLayout) =>
                  updateSettings({
                    integrations: { ...state.settings.integrations, sellingLayout },
                  })
                }
                slots={{
                  catalog: slot_catalog,
                  billNumber: atom_billNumber,
                  shiftBadge: atom_shiftBadge,
                  actExchange: atom_actExchange,
                  actClear: atom_actClear,
                  scanBar: slot_scanBar,
                  memberSearch: slot_memberSearch,
                  cartLines: slot_cartLines,
                  totalsBlock: atom_totalsBlock,
                  balanceDue: atom_balanceDue,
                  actCharge: atom_actCharge,
                  actBooking: atom_actBooking,
                  reprintDeck: atom_reprintDeck,
                  actHold: atom_actHold,
                  actVoid: atom_actVoid,
                  actCoupon: atom_actCoupon,
                  actSplit: atom_actSplit,
                  heldList: atom_heldList,
                  actDrawer: atom_actDrawer,
                  receiptToggle: atom_receiptToggle,
                }}
                classic={
                  <div className="pos-scaled flex h-full min-h-0 min-w-0 flex-col overflow-hidden lg:flex-row">
                    {/* Product lookup stays deliberately smaller than the sale. */}
                    <section
                      className="flex max-h-[42%] min-h-0 w-full shrink-0 flex-col border-b border-border lg:max-h-none lg:w-[var(--lookup-w)] lg:min-w-[240px] lg:border-b-0"
                      style={{ ["--lookup-w" as string]: `${lookupWidth}px` }}
                    >
                      {slot_standardProductLookup}
                    </section>

                    <ColumnResizer
                      width={lookupWidth}
                      onWidth={setLookupWidth}
                      min={240}
                      max={1200}
                      direction="right"
                      label="Resize product lookup"
                    />

                    {/* Current sale owns the remaining width. */}
                    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
                      {slot_billHeader}

                      <div className="border-b border-border px-4 py-3">{slot_memberSearch}</div>

                      <div className="border-b border-border bg-background/70 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {atom_actHold && (
                            <div className="h-10 min-w-32 flex-1">{atom_actHold}</div>
                          )}
                          {atom_actCoupon && (
                            <div className="h-10 min-w-32 flex-1">{atom_actCoupon}</div>
                          )}
                          <Button asChild variant="outline" className="h-10 min-w-32 flex-1">
                            <Link to="/holds">
                              <PauseCircle className="size-4" /> Held bills
                              {held.length > 0 && (
                                <Badge className="ml-1 h-5 min-w-5 justify-center px-1 text-[10px]">
                                  {held.length}
                                </Badge>
                              )}
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 min-w-28 flex-1"
                            onClick={() => setReceiptPreview((open) => !open)}
                          >
                            <Printer className="size-4" /> Receipt
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 min-w-28"
                            aria-expanded={deckOpen}
                            onClick={() => setDeckOpen((open) => !open)}
                          >
                            More actions
                            <ChevronUp
                              className={`size-4 transition-transform ${deckOpen ? "" : "rotate-180"}`}
                            />
                          </Button>
                        </div>
                        {deckOpen && (
                          <div className="mt-2 grid gap-2 rounded-lg border border-border bg-card p-2 sm:grid-cols-3">
                            {atom_actSplit && <div className="h-10">{atom_actSplit}</div>}
                            <div className="h-10">{atom_actDrawer}</div>
                            <div className="h-10">{atom_actVoid}</div>
                          </div>
                        )}
                      </div>

                      {slot_cartLines}

                      {slot_billFooter}
                    </section>
                  </div>
                }
              />
            </RegisterActionsProvider>
            {/* Unknown scans and manual lookups land in the search & add modal. */}
            <ProductSearchDialog
              open={catalogOpen}
              onOpenChange={(v) => {
                setCatalogOpen(v);
                if (!v) setUnknownCode(null);
              }}
              query={query}
              onQueryChange={setQuery}
              products={visibleProducts}
              storeId={currentStore.id}
              unknownCode={unknownCode}
              canCreateProduct={can("can_add_new_product")}
              canLinkBarcode={can("can_link_product_barcode")}
              onAdd={(id) => {
                addLine(id);
                setCatalogOpen(false);
                setUnknownCode(null);
                setQuery("");
              }}
              onLinkBarcode={async (id, code) => {
                if (!can("can_link_product_barcode")) {
                  toast.error("Link barcodes to products permission required");
                  return;
                }
                const product = state.products.find((p) => p.id === id);
                if (!product) return;
                await upsertProduct({
                  ...product,
                  barcodes: Array.from(new Set([...(product.barcodes ?? []), code])),
                  ...(product.barcode || !can("can_edit_product_details") ? {} : { barcode: code }),
                });
                toast.success(`${code} linked to ${product.name}`);
                addLine(id);
                setUnknownCode(null);
                setQuery("");
              }}
              onCreateProduct={async (draft) => {
                if (!can("can_add_new_product")) {
                  toast.error("Add new products permission required");
                  return;
                }
                const created = {
                  id: crypto.randomUUID(),
                  name: draft.name,
                  sku: draft.sku,
                  barcode: draft.barcode,
                  category: draft.category,
                  price: draft.price,
                  cost: 0,
                  stockByStore: { [currentStore.id]: 1 },
                  reorderLevel: 0,
                  taxRate: state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0,
                };
                await upsertProduct(created);
                toast.success(`${created.name} added to the catalogue`);
                addLine(created.id);
                setUnknownCode(null);
                setQuery("");
              }}
            />
          </ZoomCanvas>
        </div>
      </div>

      {/* Live receipt preview overlay */}
      <Sheet open={receiptPreview} onOpenChange={setReceiptPreview}>
        <SheetContent side="right" className="w-[min(420px,100vw)] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Live receipt preview</SheetTitle>
          </SheetHeader>
          <div className="mt-4 h-[calc(100vh-8rem)] overflow-hidden rounded-md border border-border bg-white">
            {previewHtml ? (
              <iframe title="Receipt preview" srcDoc={previewHtml} className="h-full w-full" />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Add items to the ticket to preview the printed receipt.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Apply coupon */}
      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply coupon</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Coupon code</Label>
            <Input
              autoFocus
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="e.g. WEEKEND10"
            />
            <Label>Apply to</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                variant={couponScope === "bill" ? "default" : "outline"}
                onClick={() => setCouponScope("bill")}
              >
                Whole bill
              </Button>
              <Button
                size="sm"
                className="flex-1"
                variant={couponScope === "item" ? "default" : "outline"}
                onClick={() => setCouponScope("item")}
              >
                Single item
              </Button>
            </div>
            {couponScope === "item" && (
              <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2">
                {lines.filter((l) => !l.credit && !l.foc).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No eligible items in the cart.
                  </p>
                )}
                {lines
                  .filter((l) => !l.credit && !l.foc)
                  .map((l) => (
                    <button
                      key={l.productId}
                      onClick={() => setCouponLine(l.productId)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ${
                        couponLine === l.productId
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{l.name}</span>
                      <span className="numeric">×{l.qty}</span>
                    </button>
                  ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Codes match an active promotion by name. Every application, its scope and the item it
              touched are written to the audit trail with a timestamp.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCouponOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void applyCoupon()}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split bill */}
      <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Split bill</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Bill total</span>
              <span className="numeric font-semibold">{money(balanceDue)}</span>
            </div>
            <div className="space-y-1">
              <Label>Split between</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setSplitWays((n) => Math.max(2, n - 1))}
                >
                  <Minus className="size-3" />
                </Button>
                <span className="numeric w-10 text-center text-lg font-semibold">{splitWays}</span>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setSplitWays((n) => Math.min(12, n + 1))}
                >
                  <Plus className="size-3" />
                </Button>
                <span className="text-sm text-muted-foreground">guests</span>
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              {splitShares.map((amount, i) => (
                <div key={i} className="flex items-center justify-between py-0.5 text-sm">
                  <span className="text-muted-foreground">Guest {i + 1}</span>
                  <span className="numeric font-semibold">{money(amount)}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Take each share as a separate tender, then complete the bill on the final payment.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setSplitOpen(false);
                logger.log("sale", "Bill split across guests", "register", {
                  ways: splitWays,
                  billTotal: balanceDue,
                  shares: splitShares,
                  storeId: currentStore.id,
                  memberId,
                });
                openPayment("cash");
              }}
            >
              Take payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cross-store stock */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <p className="numeric text-xs text-muted-foreground">
                {detail.sku} · {detail.barcode} · {money(detail.price)}
              </p>
              <Separator />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Stock across all locations
              </p>
              <div className="space-y-1">
                {state.stores.map((s) => {
                  const qty = stockAt(detail, s.id);
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        s.id === currentStore.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border"
                      }`}
                    >
                      <span>
                        {s.name}{" "}
                        <span className="text-[11px] text-muted-foreground">({s.code})</span>
                      </span>
                      <span
                        className={`numeric font-semibold ${
                          qty <= 0
                            ? "text-destructive"
                            : qty <= detail.reorderLevel
                              ? "text-warning"
                              : "text-foreground"
                        }`}
                      >
                        {qty}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Stock counts are shared company-wide. Financial metrics stay locked to{" "}
                {currentStore.name}.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {refundDue > 0
                ? `Refund customer · ${money(refundDue)}`
                : `Take payment · ${money(balanceDue)}`}
            </DialogTitle>
          </DialogHeader>
          {exchangeRef && (
            <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
              Store credit of {money(totals.credit)} from bill #{exchangeRef} applied to this
              ticket.
            </p>
          )}
          <div className="grid grid-cols-5 gap-2">
            {tenderOptions.map((opt) => {
              const Icon = tenderIcon(opt.icon, opt.code);
              return (
                <button
                  key={opt.code}
                  onClick={() => {
                    setMethod(opt.code);
                    setTenderRef("");
                    setTenderRefNote("");
                  }}
                  className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs transition-colors ${
                    method === opt.code
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                  {opt.name}
                </button>
              );
            })}
          </div>

          {needsTenderRef && refundDue === 0 && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <Label htmlFor="tender-reference">
                Enter voucher / coupon serial number & reference details
              </Label>
              <Input
                id="tender-reference"
                autoFocus
                value={tenderRef}
                onChange={(e) => setTenderRef(e.target.value)}
                placeholder="e.g. GV-2026-004512"
              />
              <Input
                value={tenderRefNote}
                onChange={(e) => setTenderRefNote(e.target.value)}
                placeholder="Issuer, batch or notes (optional)"
                className="text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {activeMethodName} cannot be completed without this reference. It is stored against
                the bill for reconciliation.
              </p>
            </div>
          )}

          {method === "cash" && refundDue > 0 && (
            <p className="numeric text-sm text-muted-foreground">
              Pay {money(refundDue)} back to the customer as cash or store credit.
            </p>
          )}
          {method === "cash" && refundDue === 0 && (
            <div className="space-y-2">
              <Label>Cash tendered</Label>
              <Input
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                className="numeric h-12 text-xl"
              />
              <div className="flex gap-2">
                {[balanceDue, 20, 50, 100].map((v, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => setTendered(v.toFixed(2))}
                  >
                    {money(v)}
                  </Button>
                ))}
              </div>
              <p className="numeric text-sm text-muted-foreground">
                Change due {money(Math.max(0, Number(tendered || 0) - balanceDue))}
              </p>
            </div>
          )}
          {method === "points" && (
            <p className="text-sm text-muted-foreground">
              {member
                ? `${member.name} has ${member.points} points (100 pts = $1).`
                : "Attach a member to pay with points."}
            </p>
          )}
          {method === "card" && refundDue === 0 && tenders.length === 0 && (
            <div className="space-y-2">
              <Label>Bank / card machine used</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HSBC terminal 2"
              />
            </div>
          )}

          {refundDue === 0 && (
            <TenderSplit
              total={balanceDue}
              tenders={tenders}
              onChange={setTenders}
              onBeforeAdd={() => requirePermission("can_edit_tenders")}
            />
          )}
          {method === "bank_transfer" && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                The customer screen is now showing your bank details and WhatsApp QR code so the
                shopper can transfer {money(balanceDue)}.
              </p>
              <div className="numeric space-y-0.5 text-sm">
                {state.settings.payment.bankName && <p>{state.settings.payment.bankName}</p>}
                {state.settings.payment.accountName && <p>{state.settings.payment.accountName}</p>}
                {state.settings.payment.accountNumber && (
                  <p className="font-bold">{state.settings.payment.accountNumber}</p>
                )}
              </div>
              <Label>Transfer reference / slip number</Label>
              <Input
                value={transferRef}
                onChange={(e) => setTransferRef(e.target.value)}
                placeholder="e.g. TRX-889210"
              />
            </div>
          )}

          <DialogFooter className="items-center gap-2">
            {refundDue === 0 &&
              tenders.length > 0 &&
              validateTenders(balanceDue, tenders).error && (
                <span className="mr-auto text-[11px] font-medium text-destructive">
                  {validateTenders(balanceDue, tenders).error}
                </span>
              )}
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={completeSale}
              disabled={
                saving ||
                (refundDue === 0 &&
                  tenders.length > 0 &&
                  !!validateTenders(balanceDue, tenders).error)
              }
            >
              {saving ? "Saving…" : "Complete & print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No-sale drawer open */}
      <Dialog open={noSaleOpen} onOpenChange={setNoSaleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open drawer without a sale</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            This open is logged against {user?.name ?? "this user"} with a timestamp.
          </p>
          <div className="space-y-2">
            <Label htmlFor="no-sale-reason">Reason (type it out)</Label>
            <Input
              id="no-sale-reason"
              autoFocus
              value={noSaleReason}
              maxLength={NO_SALE_REASON_MAX}
              placeholder="e.g. Adding change float for the till"
              onChange={(e) => setNoSaleReason(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {noSaleReason.trim().length < NO_SALE_REASON_MIN
                ? `Type at least ${NO_SALE_REASON_MIN} characters — no preset reasons.`
                : `${noSaleReason.trim().length}/${NO_SALE_REASON_MAX} characters`}
            </p>
            <Label>Note (optional)</Label>
            <Input value={noSaleNote} onChange={(e) => setNoSaleNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoSaleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={noSaleReason.trim().length < NO_SALE_REASON_MIN}
              onClick={async () => {
                const reason = noSaleReason.trim();
                if (reason.length < NO_SALE_REASON_MIN) return;
                const approved = await requirePermission("can_no_sale_open");
                if (!approved) return;
                try {
                  await recordNoSale({
                    storeId: currentStore.id,
                    terminalId: null,
                    shiftId: activeShift?.id ?? null,
                    staffId: user?.staffId ?? "unknown",
                    staffName: user?.name ?? "Unknown",
                    role: user?.role ?? "unknown",
                    reason,
                    note: noSaleNote.trim(),
                    approvedBy: can("can_no_sale_open") ? null : "supervisor override",
                  });
                } catch (error) {
                  notifyError(error, "Logging the drawer opening");
                  return;
                }
                openCashDrawer();
                setNoSaleOpen(false);
                setNoSaleReason("");
                setNoSaleNote("");
                toast.success("Drawer opened and logged");
              }}
            >
              Open &amp; log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exchange lookup */}
      <Dialog
        open={exchangeOpen}
        onOpenChange={(o) => {
          setExchangeOpen(o);
          if (!o) {
            setBillHit(null);
            setPicks({});
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Exchange item</DialogTitle>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              lookupBill();
            }}
          >
            <Input
              autoFocus
              value={billQuery}
              onChange={(e) => setBillQuery(e.target.value)}
              placeholder="Scan or type original bill number…"
              className="numeric h-11"
            />
            <Button type="submit" className="h-11">
              <Search className="size-4" /> Find
            </Button>
          </form>

          {billHit && (
            <div className="space-y-3">
              <p className="numeric text-xs text-muted-foreground">
                {billHit.receiptNo} · {new Date(billHit.createdAt).toLocaleString()} ·{" "}
                {money(billHit.total)} · {billHit.cashier}
                {billHit.exchangedToReceiptNo
                  ? ` · already exchanged to ${billHit.exchangedToReceiptNo}`
                  : ""}
              </p>
              <Separator />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {billHit.lines.map((l, idx) => {
                  const picked = picks[idx] ?? 0;
                  const unit = r2(l.price - lineUnitDiscount(l));
                  return (
                    <div
                      key={`${l.productId}-${idx}`}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <Checkbox
                        aria-label={`Exchange ${l.name}`}
                        checked={picked > 0}
                        onCheckedChange={(checked) =>
                          setPicks((p) => ({ ...p, [idx]: checked === true ? l.qty : 0 }))
                        }
                        className="size-4"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="numeric text-[11px] text-muted-foreground">
                          sold {l.qty} × {money(unit)}
                        </p>
                      </div>
                      <Input
                        value={picked || ""}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(l.qty, Number(e.target.value) || 0));
                          setPicks((p) => ({ ...p, [idx]: v }));
                        }}
                        placeholder="0"
                        className="numeric h-8 w-16 text-right"
                      />
                      <span className="numeric w-20 text-right text-sm font-semibold text-accent">
                        -{money(unit * picked)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Returned items are credited even when their stock at {currentStore.name} is 0 — the
                stock is added back on completion.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExchangeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!billHit} onClick={addExchangeCredits}>
              Add credit to cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Book & pay later (goods) / racket stringing booking */}
      <Dialog open={bookingHubOpen} onOpenChange={setBookingHubOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              className="h-auto w-full flex-col items-start gap-1 py-3 text-left"
              onClick={() => {
                setBookingHubOpen(false);
                void navigate({ to: "/pos/racket-service" });
              }}
            >
              <span className="font-semibold">🏸 Racket service / stringing</span>
              <span className="text-xs opacity-80">
                Racket + string specs, tension, stencil, job tag
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 py-3 text-left"
              onClick={() => {
                setBookingHubOpen(false);
                void navigate({ to: "/pos/general-booking" });
              }}
            >
              <span className="font-semibold">🛒 Standard / general booking</span>
              <span className="text-xs text-muted-foreground">
                Reserve cart items with a deposit and pickup date
              </span>
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setBookingHubOpen(false);
                void navigate({ to: "/bookings" });
              }}
            >
              Manage bookings ({activeBookingCount} active)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bookOpen}
        onOpenChange={(o) => {
          setBookOpen(o);
          if (!o && racketMode) resetJobCard();
        }}
      >
        <DialogContent
          className={
            racketMode
              ? "flex h-[92vh] max-h-[92vh] w-[94vw] max-w-[720px] flex-col"
              : "flex h-[90vh] max-h-[90vh] w-[94vw] max-w-[1040px] flex-col"
          }
        >
          <DialogHeader>
            <DialogTitle>
              {racketMode ? "Racket / stringing booking" : "Book & pay later"}
            </DialogTitle>
          </DialogHeader>
          <div
            className={`-mr-2 flex-1 overflow-y-auto pr-2 ${
              racketMode
                ? "space-y-3"
                : "space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0 [&>*]:mb-3"
            }`}
          >
            <div className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Booking total</span>
                <span className="numeric font-semibold">{money(bookingTotal)}</span>
              </div>
              {bookingMinDeposit > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Minimum deposit</span>
                  <span className="numeric font-medium">{money(bookingMinDeposit)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Paying now</span>
                <span className="numeric font-medium">{money(bookingPaidNow)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance on collection</span>
                <span className="numeric font-semibold text-primary">{money(bookingBalance)}</span>
              </div>
              {bookingDepositShort && (
                <p className="mt-1 rounded bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
                  This branch needs at least {money(bookingMinDeposit)} up front —{" "}
                  {money(bookingPaidNow)} entered.
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {racketMode
                  ? `Job taken at ${currentStore.name} — no cart items needed.`
                  : `${lines.reduce((a, l) => a + l.qty, 0)} unit(s) are reserved at ${currentStore.name} until the collect-by date.`}
              </p>
            </div>
            {!racketMode && (
              <BookingCartPanel
                lines={lines}
                money={money}
                onScan={scanCode}
                onSearch={() => setCatalogOpen(true)}
                onQty={(i, d) => void setQty(i, d)}
              />
            )}
            {racketMode && (
              <div className="space-y-2 rounded-md border border-border p-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Racket from catalogue</Label>
                    <ThemedSelect
                      ariaLabel="Racket from catalogue"
                      value={racketProductId}
                      placeholder="Pick a racket"
                      onChange={(v) => pickRacketProduct(v)}
                      options={racketOptions}
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={racketCustomerOwned}
                        onCheckedChange={(checked) => setCustomerRacket(checked === true)}
                      />
                      Customer provided racket (no charge)
                    </label>
                  </div>
                  <div className="space-y-1">
                    <Label>String from catalogue</Label>
                    <ThemedSelect
                      ariaLabel="String from catalogue"
                      value={stringProductId}
                      placeholder="Pick a string"
                      onChange={(v) => pickStringProduct(v)}
                      options={stringOptions}
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={stringCustomerOwned}
                        onCheckedChange={(checked) => setCustomerString(checked === true)}
                      />
                      Customer provided string (no charge)
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Add-ons from stock</Label>
                  <ThemedSelect
                    ariaLabel="Add an add-on from stock"
                    value=""
                    placeholder="Grips, grommets, stencil work…"
                    onChange={(v) => addAddOnProduct(v)}
                    options={addOnOptions}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Job charges</Label>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() =>
                      setIntakeCharges((c) => [...c, { kind: "accessory", name: "", price: 0 }])
                    }
                  >
                    + Add charge
                  </button>
                </div>
                {intakeCharges.map((c, i) => {
                  const lockedLabour = c.kind === "labor" && !labourUnlocked;
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[7rem_minmax(0,1fr)_6rem_1.5rem] items-center gap-1.5"
                    >
                      <ThemedSelect
                        ariaLabel="Charge type"
                        value={c.kind}
                        onChange={(v) =>
                          setIntakeCharges((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, kind: v as IntakeCharge["kind"] } : r,
                            ),
                          )
                        }
                        options={[
                          { value: "labor", label: "Labour" },
                          { value: "string", label: "String" },
                          { value: "grip", label: "Grip" },
                          { value: "accessory", label: "Add-on" },
                        ]}
                      />
                      <Input
                        placeholder="Description"
                        value={c.name}
                        onChange={(e) =>
                          setIntakeCharges((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                          )
                        }
                      />
                      <Input
                        className="numeric text-right"
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={lockedLabour || !!c.customerProvided}
                        value={c.price ? String(c.price) : ""}
                        onChange={(e) =>
                          setIntakeCharges((rows) =>
                            rows.map((r, j) =>
                              j === i
                                ? { ...r, price: Math.max(0, Number(e.target.value) || 0) }
                                : r,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remove charge"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setIntakeCharges((rows) => rows.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted-foreground">
                    Labour is locked to the fee set in Settings → Booking rules.
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void unlockLabour()}>
                    {labourUnlocked ? "Labour unlocked" : "Override / waive charge"}
                  </Button>
                </div>
                {labourUnlocked && (
                  <Input
                    placeholder="Reason for the override (required)"
                    value={labourReason}
                    onChange={(e) => setLabourReason(e.target.value)}
                  />
                )}
                {combo.label && (
                  <p className="text-[11px] font-medium text-primary">{combo.label}</p>
                )}
                <div className="flex items-center justify-between border-t border-border pt-1 text-xs">
                  <span className="text-muted-foreground">Charges total</span>
                  <span className="numeric font-semibold">{money(intake.subtotal)}</span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>When does the customer pay?</Label>
              <div className="flex overflow-hidden rounded-md border border-border">
                {allowedTimings.map((t) => (
                  <button
                    key={t}
                    onClick={() => setPayTiming(t)}
                    className={`flex-1 px-2 py-2 text-xs ${
                      payTiming === t
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {BOOKING_TIMING_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Deposit taken now</Label>
                <Input
                  value={
                    payTiming === "now"
                      ? bookingTotal.toFixed(2)
                      : payTiming === "collection"
                        ? "0.00"
                        : deposit
                  }
                  disabled={payTiming !== "deposit"}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="0.00"
                  className="numeric"
                />
              </div>
              <div className="space-y-1">
                <Label>Deposit method</Label>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {(["cash", "card", "wallet"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDepositMethod(m)}
                      className={`flex-1 px-2 py-2 text-xs capitalize ${
                        depositMethod === m
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Collect &amp; settle by</Label>
                <Input
                  type="date"
                  value={dueDate}
                  min={isoDaysFromNow(0)}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="numeric"
                />
              </div>
              <div className="space-y-1">
                <Label>Quick window</Label>
                <div className="flex gap-1">
                  {[7, 14, 30, 60].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDueDate(isoDaysFromNow(d))}
                      className="flex-1 rounded-md border border-border py-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <Label>Customer</Label>
                <button
                  type="button"
                  className="text-[11px] text-primary hover:underline"
                  onClick={() => {
                    setMemberQuery(bookMemberQuery);
                    setQuickMemberOpen(true);
                  }}
                >
                  + Quick add customer
                </button>
              </div>
              <Input
                value={bookMemberQuery}
                onChange={(e) => setBookMemberQuery(e.target.value)}
                placeholder="Search by name or phone…"
              />
              {bookMemberQuery.trim() && !member ? (
                <div className="space-y-1">
                  {bookMemberMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        attachMember(m);
                        setBookName(m.name);
                        setBookPhone(m.phone);
                        setBookMemberQuery("");
                      }}
                    >
                      <span className="truncate">
                        {m.name} · {m.phone}
                      </span>
                      <Badge variant="outline">
                        {m.code} · {m.tier}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : null}
              {member ? (
                <p className="text-[11px] text-muted-foreground">
                  Attached: {member.name} · {member.code} · {member.tier}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Customer name</Label>
                  <Input value={bookName} onChange={(e) => setBookName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input
                    value={bookPhone}
                    onChange={(e) => setBookPhone(e.target.value)}
                    className="numeric"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Note</Label>
              <Input
                value={bookNote}
                onChange={(e) => setBookNote(e.target.value)}
                placeholder="Colour, size, collection instructions…"
              />
            </div>

            {/* Racket stringing job card — racket bookings only */}
            {racketMode && (
              <div className="rounded-md border border-border">
                <div className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
                  <span className="flex min-w-0 items-center gap-2">
                    <Wrench className="size-4 shrink-0 text-primary" />
                    <span className="truncate">Racket / stringing job card</span>
                  </span>
                </div>
                <div className="space-y-3 border-t border-border p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Racket brand / model</Label>
                      <Input
                        value={racketModel}
                        list="racket-models"
                        onChange={(e) => setRacketModel(e.target.value)}
                        placeholder="Yonex Astrox 88D"
                      />
                      <datalist id="racket-models">
                        {racketModelList.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-1">
                      <Label>String type / brand</Label>
                      <Input
                        value={stringType}
                        list="string-models"
                        onChange={(e) => setStringType(e.target.value)}
                        placeholder="BG65 Ti"
                      />
                      <datalist id="string-models">
                        {stringModelList.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={stencil}
                        onCheckedChange={(checked) => setStencil(checked === true)}
                      />
                      Stencil the string
                    </label>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={overgrip}
                        onCheckedChange={(checked) => setOvergrip(checked === true)}
                      />
                      Replace overgrip
                    </label>
                    {jobTag && <Badge variant="outline">Job tag {jobTag}</Badge>}
                    {editBookingId && (
                      <Button size="sm" onClick={saveSpecEdits}>
                        Save spec changes
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label>Tension main</Label>
                      <Input
                        value={tensionMain}
                        inputMode="decimal"
                        onChange={(e) => setTensionMain(e.target.value)}
                        className="numeric"
                        placeholder="26"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Tension cross</Label>
                      <Input
                        value={tensionCross}
                        inputMode="decimal"
                        onChange={(e) => setTensionCross(e.target.value)}
                        className="numeric"
                        placeholder="28"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Unit</Label>
                      <div className="flex overflow-hidden rounded-md border border-border">
                        {(["lb", "kg"] as const).map((u) => (
                          <button
                            key={u}
                            onClick={() => setTensionUnit(u)}
                            className={`flex-1 px-2 py-2 text-xs uppercase ${
                              tensionUnit === u
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Promised ready date &amp; time</Label>
                    <Input
                      type="datetime-local"
                      value={promisedAt}
                      onChange={(e) => setPromisedAt(e.target.value)}
                      className="numeric"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Racket inspection / pre-existing condition</Label>
                    <Textarea
                      rows={2}
                      value={grommetNotes}
                      onChange={(e) => setGrommetNotes(e.target.value)}
                      placeholder="Two cracked grommets at 12 o'clock, replace grip"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Anything else the stringer needs</Label>
                    <Input
                      value={jobNotes}
                      onChange={(e) => setJobNotes(e.target.value)}
                      placeholder="Knot preference, stencil, urgent…"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={notifyWhatsApp}
                      onCheckedChange={(checked) => setNotifyWhatsApp(checked === true)}
                    />
                    Notify the customer on WhatsApp when the racket is ready
                  </label>
                  {bookingRules.serviceTerms.trim() ? (
                    <div
                      className={`space-y-2 rounded-md border p-3 ${
                        highTension
                          ? "border-warning/60 bg-warning/10"
                          : "border-border bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">
                          Service &amp; high-tension liability terms
                        </p>
                        {highTension ? (
                          <span className="rounded border border-warning/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning">
                            High tension
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {bookingRules.serviceTerms}
                      </p>
                      <label className="flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={liabilityOk}
                          onCheckedChange={(checked) => setLiabilityOk(checked === true)}
                        />
                        Customer has read, acknowledged, and accepted the Service &amp; High-Tension
                        Liability Terms.
                      </label>
                    </div>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    A job tag prints with the slip so it can be tied to the racket.
                  </p>
                </div>
              </div>
            )}
            {!racketMode && bookingRules.serviceTerms.trim() ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium">Booking terms &amp; conditions</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {bookingRules.serviceTerms}
                </p>
                <label className="flex items-start gap-2 text-xs">
                  <Checkbox
                    checked={liabilityOk}
                    onCheckedChange={(checked) => setLiabilityOk(checked === true)}
                  />
                  Customer has read and accepted the booking terms &amp; conditions.
                </label>
              </div>
            ) : null}
          </div>
          {racketMode && (
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">
                Charges total{" "}
                <span className="numeric font-semibold text-foreground">{money(bookingTotal)}</span>
              </span>
              <span className="text-muted-foreground">
                Paying now{" "}
                <span className="numeric font-semibold text-foreground">
                  {money(bookingPaidNow)}
                </span>{" "}
                · Balance{" "}
                <span className="numeric font-semibold text-primary">{money(bookingBalance)}</span>
              </span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookOpen(false)}>
              Cancel
            </Button>
            {allowedTimings.includes("now") && (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setPayTiming("now");
                  void bookAndPayLater();
                }}
              >
                Pay now
              </Button>
            )}
            <Button
              onClick={() => void bookAndPayLater()}
              disabled={
                saving ||
                (!racketMode && !lines.length) ||
                bookingDepositShort ||
                (!racketMode && !!bookingRules.serviceTerms.trim() && !liabilityOk)
              }
            >
              {saving
                ? "Saving…"
                : racketMode
                  ? "Save job & print ticket"
                  : "Save pay-later booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open shift */}
      <Dialog open={openShiftOpen} onOpenChange={setOpenShiftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>
                Cashier <span className="text-destructive">*</span>
              </Label>
              {/* Locked to the signed-in user: a shift is always attributed to
                  whoever is at the terminal, so it cannot be typed over. */}
              <Input value={user?.name ?? cashier} readOnly disabled />
            </div>
            <div className="space-y-1">
              <Label>
                Opening float{" "}
                {rules.require_opening_float_count && <span className="text-destructive">*</span>}
              </Label>
              <Input
                value={float}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setFloat(e.target.value)}
                className="numeric"
              />
              {rules.require_opening_float_count && parsePositiveAmount(float) === null && (
                <p className="text-[11px] text-destructive">
                  Count the drawer and enter the opening float.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                !cashier.trim() ||
                (rules.require_opening_float_count && parsePositiveAmount(float) === null)
              }
              onClick={async () => {
                if (!can("can_open_shift")) {
                  toast.error("You are not allowed to open a shift");
                  return;
                }
                try {
                  // Nothing is announced or unlocked until the shift is stored.
                  const target = await openShift(
                    (user?.name ?? cashier).trim() || "Cashier",
                    parsePositiveAmount(float) ?? 0,
                  );
                  openCashDrawer();
                  setFloat("");
                  setOpenShiftOpen(false);
                  toast.success(`Shift opened — ${commitLabel(target).toLowerCase()}`);
                } catch (e) {
                  notifyError(e, "Opening the shift");
                }
              }}
            >
              Open shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MemberHistoryDialog
        member={state.members.find((m) => m.id === historyMemberId) ?? null}
        onOpenChange={(o) => !o && setHistoryMemberId(null)}
      />

      <QuickMemberDialog
        open={quickMemberOpen}
        onOpenChange={setQuickMemberOpen}
        prefill={memberQuery}
        onCreated={(m) => attachMember(m)}
      />

      {/* Pick which of the member's vouchers goes on this bill */}
      <Dialog open={voucherPickerOpen} onOpenChange={setVoucherPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Member vouchers</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[...memberVouchers]
              .map((v) => ({ v, preview: voucherPreview(v.campaign) }))
              .sort((a, b) => b.preview.value - a.preview.value)
              .map(({ v, preview }) => {
                const active = voucherToken === v.voucher.tokenSlug;
                const usable = preview.value > 0;
                return (
                  <button
                    key={v.voucher.id}
                    type="button"
                    disabled={!usable}
                    onClick={() => {
                      void applyVoucher(v.voucher.tokenSlug);
                      setVoucherPickerOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                      active ? "border-accent bg-accent/10" : "border-border"
                    } ${usable ? "hover:bg-muted" : "opacity-50"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{v.campaign.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {discountLabel(v.campaign)} · {scopeLabel(v.campaign)}
                        {v.voucher.expiresAt || v.campaign.expiresAt
                          ? ` · until ${new Date(v.voucher.expiresAt ?? v.campaign.expiresAt!).toLocaleDateString()}`
                          : ""}
                      </p>
                      {usable ? null : (
                        <p className="text-[11px] text-destructive">{preview.reason}</p>
                      )}
                    </div>
                    <span className="numeric shrink-0 text-sm font-semibold">
                      −{money(preview.value)}
                    </span>
                  </button>
                );
              })}
            {!memberVouchers.length ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This member has no live vouchers.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            {voucherToken ? (
              <Button
                variant="outline"
                onClick={() => {
                  removeCoupon();
                  setVoucherPickerOpen(false);
                }}
              >
                Remove applied voucher
              </Button>
            ) : null}
            <Button onClick={() => setVoucherPickerOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close shift — the one server-driven closing workflow */}
      <ShiftCloseDialog open={closeShiftOpen} onOpenChange={setCloseShiftOpen} />
      <Dialog open={priceTarget !== null} onOpenChange={(open) => !open && setPriceTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Price override</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>New unit price</Label>
              <Input
                className="numeric"
                inputMode="decimal"
                value={priceDraft}
                onChange={(event) => setPriceDraft(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Reason {rules.require_reason_for_price_override ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                value={priceReason}
                onChange={(event) => setPriceReason(event.target.value.slice(0, 400))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const target = priceTarget;
                const line = target === null ? undefined : lines[target];
                const next = Number(priceDraft);
                void (async () => {
                  if (!line || !Number.isFinite(next) || next < 0) {
                    toast.error("Enter a valid unit price");
                    return;
                  }
                  if (rules.require_reason_for_price_override && priceReason.trim().length < 3) {
                    toast.error("Enter why the price is being changed");
                    return;
                  }
                  const granted = await askManager({
                    action: "price_override",
                    title: "Authorise price override",
                    reason: `${line.name}: ${money(line.price)} → ${money(next)}`,
                    storeId: currentStore.id,
                    requestedBy: activeCashier,
                    requestedAmount: next,
                    valueUnit: "currency",
                    payload: {
                      product_id: line.productId,
                      product_name: line.name,
                      original_price: line.price,
                      requested_price: next,
                      transaction: billNo ?? `draft-${currentStore.id}`,
                    },
                    detail: priceReason.trim(),
                  });
                  if (granted === null) return;
                  patchLine(target!, {
                    price: r2(next),
                    originalPrice: line.originalPrice ?? line.price,
                    priceOverridden: true,
                    priceOverrideReason: priceReason.trim(),
                  });
                  logger.log("discount", "Price overridden", "register", {
                    productId: line.productId,
                    product: line.name,
                    from: line.price,
                    to: r2(next),
                    reason: priceReason.trim(),
                    storeId: currentStore.id,
                  });
                  setPriceTarget(null);
                })();
              }}
            >
              Apply override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiscountPad
        open={padTarget !== null}
        onOpenChange={(o) => !o && setPadTarget(null)}
        title={padTarget === "bill" ? "Bill discount" : "Line discount"}
        value={
          padTarget === "bill"
            ? cartDiscount
            : typeof padTarget === "number"
              ? (lines[padTarget]?.discount ?? 0)
              : 0
        }
        type={
          padTarget === "bill"
            ? cartDiscountType
            : typeof padTarget === "number"
              ? (lines[padTarget]?.discountType ?? "percent")
              : "percent"
        }
        /** What the discount can be taken off — nothing may go below zero.
         *  A line amount is per unit, matching how it is entered. */
        max={
          padTarget === "bill"
            ? Math.max(0, r2(totals.subtotal - totals.lineDiscount))
            : typeof padTarget === "number" && lines[padTarget]
              ? Math.max(
                  0,
                  r2(
                    Math.abs(lines[padTarget]!.price) -
                      Math.min(
                        Math.abs(lines[padTarget]!.price),
                        Math.abs(lines[padTarget]!.couponDiscount || 0) /
                          Math.max(1, Math.abs(lines[padTarget]!.qty)),
                      ),
                  ),
                )
              : 0
        }
        onApply={(v, t) => {
          const target = padTarget;
          void (async () => {
            // Limits come from the database rule set; anything beyond them
            // needs a manager PIN verified on the server.
            const overLimit =
              t === "percent"
                ? v > rules.max_cashier_discount_percent
                : v > rules.max_cart_discount_amount;
            const stacking =
              !rules.allow_discount_stacking &&
              !!coupon &&
              v > 0 &&
              (target === "bill" || typeof target === "number");

            if (stacking) {
              toast.error(
                `Discount stacking is switched off for this branch, so coupon “${coupon?.code}” and a manual discount cannot both apply. Remove the coupon first, then enter the discount.`,
              );
              return;
            }
            if (overLimit) {
              const grant = await askManager({
                action: "discount_over_limit",
                title: "Discount above cashier limit",
                reason:
                  t === "percent"
                    ? `Your maximum allowed discount is ${rules.max_cashier_discount_percent}%. A ${v}% discount requires approval.`
                    : `Your maximum allowed discount is ${money(rules.max_cart_discount_amount)}. A ${money(v)} discount requires approval.`,
                storeId: currentStore.id,
                requestedBy: activeCashier,
                requestedAmount: v,
                requesterDirectLimit:
                  t === "percent"
                    ? rules.max_cashier_discount_percent
                    : rules.max_cart_discount_amount,
                valueUnit: t === "percent" ? "percent" : "currency",
                payload: {
                  discount_type: t,
                  discount_scope: target === "bill" ? "bill" : "item",
                  target_product_id:
                    typeof target === "number" ? (lines[target]?.productId ?? null) : null,
                  target_index: typeof target === "number" ? target : -1,
                  allowed_limit:
                    t === "percent"
                      ? rules.max_cashier_discount_percent
                      : rules.max_cart_discount_amount,
                  requested_value: v,
                  transaction: billNo ?? `draft-${currentStore.id}`,
                },
                detail: `${v}${t === "percent" ? "%" : ""} on ${target === "bill" ? "the bill" : "a line"}`,
              });
              // An ungated action is represented by an empty grant token and
              // is still allowed. Only null means the gate refused or queued it.
              if (grant === null) return;
            }
            if (target === "bill") {
              setCartDiscount(v);
              setCartDiscountType(t);
            } else if (typeof target === "number") {
              patchLine(target, { discount: v, discountType: t });
            }
          })();
        }}
      />
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="numeric shrink-0 text-right">{value}</span>
    </div>
  );
}
