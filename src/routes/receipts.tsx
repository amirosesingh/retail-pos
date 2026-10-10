import { uniqueSales, sameRecordId } from "@/lib/sale-identity";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Gift, Printer, ReceiptText, Search, ScrollText, Wallet, Wrench } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cartTotals, money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { logger } from "@/lib/audit-log";
import {
  clearPendingCorrectionHold,
  holdCancelledBill,
  loadPendingCorrectionHold,
  rememberPendingCorrectionHold,
  saleCorrectionContext,
  type PendingCorrectionHold,
} from "@/lib/held-orders";
import {
  printSaleReceipt,
  printShiftReport,
  saleReceiptPreview,
  shiftReportPreview,
} from "@/lib/pos-print";
import type { PaymentMethod, Sale } from "@/core/types/pos-types";
import { r2, type CartLine, type DiscountType } from "@/core/types/pos-types";
import { findReceiptExact, loadSalesPage } from "@/core/api/pos-db";
import type { Cursor } from "@/lib/keyset";
import {
  clearPendingRecordEditHistory,
  loadPendingRecordEditHistory,
  type RecordEditHistoryInput,
  rememberPendingRecordEditHistory,
  saveRecordEditHistory,
} from "@/lib/record-edit-flow";
import { useManagerGate } from "@/lib/manager-gate";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Receipt History Log — Retail" },
      {
        name: "description",
        content:
          "Browse every processed receipt and reprint it as a standard customer receipt, a gift receipt or an internal Z-report.",
      },
      { property: "og:title", content: "Receipt History Log — Retail" },
      {
        property: "og:description",
        content: "Three receipt templates, one history log, native printing.",
      },
    ],
  }),
  component: ReceiptVault,
});

type Template = "standard" | "gift" | "zreport";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "wallet", label: "Wallet" },
  { value: "points", label: "Points" },
  { value: "bank_transfer", label: "Bank transfer" },
];

const TEMPLATES: { key: Template; label: string; icon: typeof Printer }[] = [
  { key: "standard", label: "Standard Customer Receipt", icon: ReceiptText },
  { key: "gift", label: "Gift Receipt", icon: Gift },
  { key: "zreport", label: "Z-Report Receipt", icon: ScrollText },
];

function ReceiptVault() {
  const navigate = useNavigate();
  const { state, currentStore, activeShift, refundSale, changeSalePayment } = usePos();
  const { user, can, isAdmin } = useAuth();
  const { requirePermission } = useUserPermissions();
  const { authorize, rules: authorizationRules } = useManagerGate();
  const [query, setQuery] = useState("");
  /** Cashiers land on their own shift; anything older needs a date range. */
  const [scope, setScope] = useState<"shift" | "range" | "all">("shift");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [template, setTemplate] = useState<Template>("standard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelMode, setCancelMode] = useState<"cancel" | "correct">("cancel");
  const [correctionLines, setCorrectionLines] = useState<CartLine[]>([]);
  const [correctionDiscount, setCorrectionDiscount] = useState(0);
  const [correctionDiscountType, setCorrectionDiscountType] = useState<DiscountType>("amount");
  const [correctionSearch, setCorrectionSearch] = useState("");
  const cancelling = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pendingCorrectionAudit, setPendingCorrectionAudit] = useState<{
    input: RecordEditHistoryInput;
    persisted: boolean;
  } | null>(null);
  const [pendingCorrectionHold, setPendingCorrectionHold] = useState<PendingCorrectionHold | null>(
    null,
  );
  const correctionHoldRetries = useRef(new Set<string>());
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payReason, setPayReason] = useState("");
  // Older bills pulled a page at a time, below the ones already in memory.
  const [older, setOlder] = useState<Sale[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [findingExact, setFindingExact] = useState(false);
  const [cloudHistory, setCloudHistory] = useState<Set<string>>(() => new Set());

  // Employees only ever see the log of the store they are on duty at.
  const sales = useMemo(() => {
    const live = state.sales.filter((s) => s.storeId === currentStore.id);

    return uniqueSales([...older, ...live]);
  }, [state.sales, currentStore.id, older]);

  const loadOlder = async () => {
    setLoadingOlder(true);
    try {
      const from =
        cursor ??
        (() => {
          const last = sales[sales.length - 1];
          return last ? { ts: last.createdAt, id: last.id } : null;
        })();
      const page = await loadSalesPage(currentStore.id, from);
      setOlder((prev) => [...prev, ...page.rows]);
      setCursor(page.cursor);
      if (!page.hasMore) setExhausted(true);
    } catch (e) {
      notifyError(e, "Could not load older receipts.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const searchExact = async () => {
    if (!query.trim()) return;
    setFindingExact(true);
    try {
      const found = await findReceiptExact(query, currentStore.id);
      if (!found) {
        toast.error("No exact receipt was found for this branch");
        return;
      }
      setOlder((previous) => [found.sale, ...previous.filter((sale) => sale.id !== found.sale.id)]);
      setSelectedId(found.sale.id);
      setScope("all");
      if (found.source === "cloud") {
        setCloudHistory((previous) => new Set(previous).add(found.sale.id));
        toast.success("Receipt retrieved from cloud history and verified locally");
      }
    } catch (error) {
      notifyError(error, "Finding receipt");
    } finally {
      setFindingExact(false);
    }
  };

  const scoped = sales.filter((s) => {
    if (scope === "shift") return activeShift ? sameRecordId(s.shiftId, activeShift.id) : false;
    if (scope === "range") {
      const day = new Date(s.createdAt).toLocaleDateString("en-CA");
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    }
    return true;
  });

  const rows = scoped.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.receiptNo.toLowerCase().includes(q) ||
      s.cashier.toLowerCase().includes(q) ||
      s.lines.some((l) => l.name.toLowerCase().includes(q))
    );
  });

  const selected: Sale | null = rows.find((s) => s.id === selectedId) ?? rows[0] ?? null;
  const retryingCorrectionAudit = pendingCorrectionAudit?.input.recordId === selected?.id;
  const retryingCorrectionHold = pendingCorrectionHold?.saleId === selected?.id;

  useEffect(() => {
    if (!selected?.id) return;
    let active = true;
    void loadPendingRecordEditHistory(selected.id)
      .then((pending) => {
        if (!active) return;
        setPendingCorrectionAudit((current) => {
          if (pending) return { input: pending, persisted: true };
          if (current?.input.recordId === selected.id && current.persisted) return null;
          return current;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id) return;
    let active = true;
    void loadPendingCorrectionHold(selected.id)
      .then((pending) => {
        if (active) setPendingCorrectionHold(pending);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selected?.id]);
  const member = selected ? (state.members.find((m) => m.id === selected.memberId) ?? null) : null;
  const shift = selected ? (state.shifts.find((s) => s.id === selected.shiftId) ?? null) : null;

  const previewHtml = useMemo(() => {
    if (!selected) return "";
    if (template === "zreport") return shift ? shiftReportPreview(shift, state.sales) : "";
    return saleReceiptPreview(
      selected,
      template === "gift" ? null : member,
      template === "gift" ? "gift" : "sale",
    );
  }, [selected, template, member, shift, state.sales]);

  function print() {
    if (!selected) return;
    if (template === "zreport") {
      if (!shift) {
        toast.error("No shift record linked to this receipt");
        return;
      }
      printShiftReport(shift, state.sales, "zreport");
    } else if (template === "gift") {
      printSaleReceipt(selected, null, "gift");
    } else {
      printSaleReceipt(selected, member, "sale");
    }
    logger.log("print", "Receipt printed", "receipts", {
      saleId: selected.id,
      receiptNo: selected.receiptNo,
      template,
    });
    toast.success("Sent to printer");
  }

  async function openCancel() {
    if (!selected) return;
    if (
      (authorizationRules.refund?.mode ?? "none") === "none" &&
      !(await requirePermission("can_process_refund"))
    )
      return;
    setCancelMode("cancel");
    setCancelReason("");
    setCancelOpen(true);
  }

  function openSaleCorrection() {
    if (!selected) return;
    if (!isAdmin) {
      toast.error("Only an administrator can correct a finalized sale.");
      return;
    }
    setCancelMode("correct");
    setCorrectionLines(selected.lines.map(line => ({...line})));
    setCorrectionDiscount(saleCorrectionContext(selected).cartDiscount);
    setCorrectionDiscountType("amount");
    setCorrectionSearch("");
    setCancelReason("");
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (cancelling.current) return;
    cancelling.current = true;
    setCancelBusy(true);
    try { await performCancel(); }
    finally { cancelling.current = false; setCancelBusy(false); }
  }

  async function performCancel() {
    if (pendingCorrectionHold && retryingCorrectionHold) {
      if (correctionHoldRetries.current.has(pendingCorrectionHold.saleId)) return;
      correctionHoldRetries.current.add(pendingCorrectionHold.saleId);
      try {
        await holdCancelledBill(pendingCorrectionHold);
        await clearPendingCorrectionHold(pendingCorrectionHold.saleId);
        setPendingCorrectionHold(null);
        if (!retryingCorrectionAudit) setCancelOpen(false);
        toast.success(
          retryingCorrectionAudit
            ? "The correction draft is now in Holds. Retry its audit entry next."
            : "The correction draft is now available in Holds.",
        );
        if (!retryingCorrectionAudit) await navigate({to:"/",search:{resume:pendingCorrectionHold.id ?? `C-${pendingCorrectionHold.saleId}`,sell:true}});
      } catch (error) {
        notifyError(error, "The bill is reversed, but preparing its correction draft still failed");
      } finally {
        correctionHoldRetries.current.delete(pendingCorrectionHold.saleId);
      }
      return;
    }
    if (pendingCorrectionAudit && retryingCorrectionAudit) {
      const saved = await saveRecordEditHistory(pendingCorrectionAudit.input);
      if (!saved) {
        toast.error("The sale is already reversed, but its completed audit entry still needs saving.");
        return;
      }
      await clearPendingRecordEditHistory(pendingCorrectionAudit.input.recordId);
      setPendingCorrectionAudit(null);
      setCancelOpen(false);
      toast.success("The completed correction audit entry is now saved.");
      await navigate({to:"/",search:{resume:`C-${pendingCorrectionAudit.input.recordId}`,sell:true}});
      return;
    }
    if (!selected) return;
    if (cancelMode === "correct" && (!Number.isFinite(correctionDiscount) || correctionDiscount < 0 || (correctionDiscountType === "percent" && correctionDiscount > 100))) {
      toast.error("Enter a valid whole-bill discount");
      return;
    }
    if (cancelMode === "correct" && (!correctionLines.length || correctionLines.some(line => !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.discount) || line.discount < 0 || line.discount > (line.discountType === "percent" ? 100 : line.price)))) {
      toast.error("Check each item's quantity and discount before preparing the correction");
      return;
    }
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      toast.error("Type why this bill is being cancelled");
      return;
    }
    const grant = await authorize({
      action: "refund",
      title: "Authorise bill void / refund",
      reason,
      storeId: currentStore.id,
      requestedBy: user?.staffId ?? user?.name ?? null,
      requestedAmount: Math.abs(selected.total),
      valueUnit: "currency",
      payload: {
        sale_id: selected.id,
        receipt_no: selected.receiptNo,
        total: Math.abs(selected.total),
      },
      detail: reason,
    });
    if (!grant.ok) {
      if (grant.pendingRequestId) setCancelOpen(false);
      return;
    }
    try {
      const saleSnapshot = {
        receiptNo: selected.receiptNo,
        subtotal: selected.subtotal,
        discount: selected.discount,
        tax: selected.tax,
        total: selected.total,
        paymentMethod: selected.method,
        refunded: selected.refunded,
        lines: selected.lines,
      };
      const stockDeltas = selected.lines.reduce<Record<string, number>>((changes, line) => {
        changes[line.productId] = (changes[line.productId] ?? 0) + line.qty;
        return changes;
      }, {});
      if (cancelMode === "correct") {
        const auditReady = await saveRecordEditHistory({
          kind: "sale",
          recordId: selected.id,
          reference: selected.receiptNo,
          storeId: selected.storeId,
          actionKey: "SALE_CORRECTION_STARTED",
          before: saleSnapshot,
          after: saleSnapshot,
          stockDeltas: {},
          note: reason,
        });
        if (!auditReady) {
          toast.error("Correction stopped because its audit record could not be saved.");
          return;
        }
      }
      const reversed = await refundSale(selected.id, grant.grantToken, selected);
      if (!reversed) {
        toast.error("The bill could not be reversed. No correction draft was created.");
        return;
      }
      setOlder((rows) =>
        rows.map((row) => (row.id === selected.id ? { ...row, refunded: true } : row)),
      );
      const correctionHold = {
        ...saleCorrectionContext(selected),
        id: `C-${selected.id}`,
        saleId: selected.id,
        receiptNo: selected.receiptNo,
        total: cancelMode === "correct" ? cartTotals(correctionLines, correctionDiscount, correctionDiscountType, state.settings.tax, selected.couponScope === "bill" ? selected.couponDiscount ?? 0 : 0).total : selected.total,
        lines: cancelMode === "correct" ? correctionLines : selected.lines,
        storeId: selected.storeId,
        cartDiscount: cancelMode === "correct" ? correctionDiscount : saleCorrectionContext(selected).cartDiscount,
        cartDiscountType: cancelMode === "correct" ? correctionDiscountType : "amount" as const,
      };
      let holdPrepared = true;
      try {
        await holdCancelledBill(correctionHold);
      } catch {
        holdPrepared = false;
        setPendingCorrectionHold(correctionHold);
        await rememberPendingCorrectionHold(correctionHold).catch(() => undefined);
      }
      if (cancelMode === "correct") {
        const completedAudit = {
          historyId: crypto.randomUUID(),
          kind: "sale",
          recordId: selected.id,
          reference: selected.receiptNo,
          storeId: selected.storeId,
          actionKey: "SALE_REVERSED_FOR_CORRECTION",
          before: saleSnapshot,
          after: {
            ...saleSnapshot,
            refunded: true,
            correctionDraft: {lines:correctionHold.lines,cartDiscount:correctionHold.cartDiscount,cartDiscountType:correctionHold.cartDiscountType,total:correctionHold.total},
          },
          stockDeltas,
          note: reason,
        } satisfies Parameters<typeof saveRecordEditHistory>[0];
        const auditSaved = await saveRecordEditHistory(completedAudit);
        if (!auditSaved) {
          const retryRemembered = await rememberPendingRecordEditHistory(completedAudit);
          setPendingCorrectionAudit({ input: completedAudit, persisted: retryRemembered });
          logActivity(selected, reason);
          toast.error(
            retryRemembered
              ? holdPrepared
                ? "The bill was reversed and placed in Holds, but its completed audit entry still needs saving. The retry is secured on this device."
                : "The bill was reversed, but its correction draft and completed audit entry still need retrying. Keep this dialog open."
              : "The bill was reversed, but this device could not preserve the audit retry. Keep this dialog open and retry before leaving.",
          );
          return;
        }
      }
      logActivity(selected, reason);
      if (!holdPrepared) {
        toast.error("The bill was reversed, but its correction draft was not prepared", {
          description:
            "The reversal is safely recorded. Keep this dialog open and use Retry preparing correction.",
        });
        return;
      }
      setCancelOpen(false);
      toast.success(
        cancelMode === "correct"
          ? `Bill ${selected.receiptNo} reversed — open it from Holds, correct it, and complete a replacement receipt`
          : `Bill ${selected.receiptNo} cancelled — the items are waiting on the register's hold list`,
      );
      if (cancelMode === "correct") await navigate({to:"/",search:{resume:correctionHold.id,sell:true}});
    } catch (error) {
      notifyError(error, "Cancelling the bill");
    }
  }

  function logActivity(sale: Sale, reason: string) {
    logger.log("sale_event", "Bill cancelled", "receipts", {
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      total: sale.total,
      reason,
      staff: user?.name ?? null,
    });
  }

  async function openPaymentFix() {
    if (!selected) return;
    // Payment corrections are sensitive posted-record edits. The relay
    // independently checks this same permission before changing the sale.
    if (!isAdmin || !can("can_edit_tenders")) {
      toast.error("Administrator permission is required to correct a completed payment.");
      return;
    }
    setPayMethod(selected.method);
    setPayReason("");
    setPayOpen(true);
  }

  async function confirmPaymentFix() {
    if (!selected) return;
    if (payMethod === selected.method) {
      setPayOpen(false);
      return;
    }
    const reason = payReason.trim();
    if (reason.length < 3) {
      toast.error("Type why this payment record is being corrected.");
      return;
    }
    try {
      const before = { paymentMethod: selected.method };
      const after = { paymentMethod: payMethod };
      const changed = await changeSalePayment(selected.id, payMethod, reason, selected);
      if (!changed) return;
      setOlder((rows) =>
        rows.map((row) => (row.id === selected.id ? { ...row, method: payMethod } : row)),
      );
      await saveRecordEditHistory({
        kind: "sale",
        recordId: selected.id,
        reference: selected.receiptNo,
        storeId: selected.storeId,
        actionKey: "PAYMENT_CORRECTED",
        before,
        after,
        note: reason,
      });
      setPayOpen(false);
      toast.success(`Bill ${selected.receiptNo} now recorded as ${payMethod.replace("_", " ")}`);
    } catch (error) {
      notifyError(error, "Correcting the payment method");
    }
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Receipt history log</h1>
            <p className="text-sm text-muted-foreground">
              Viewing data for {currentStore.name} only · signed in as {user?.name}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchExact();
                }}
                placeholder="Receipt no, sale ID or transaction ID"
                className="w-full pl-9 sm:w-72"
              />
            </div>
            <Button
              variant="outline"
              disabled={findingExact || !query.trim()}
              onClick={() => void searchExact()}
            >
              {findingExact ? "Finding…" : "Find exact"}
            </Button>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex gap-2">
            {(
              [
                { id: "shift", label: "Current shift" },
                { id: "range", label: "Date range" },
                { id: "all", label: "Everything" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scope === s.id
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {scope === "range" && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="from-date" className="text-[11px] uppercase text-muted-foreground">
                  From
                </Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 h-9 w-40"
                />
              </div>
              <div>
                <Label htmlFor="to-date" className="text-[11px] uppercase text-muted-foreground">
                  To
                </Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 h-9 w-40"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
              >
                Clear dates
              </Button>
            </div>
          )}

          <p className="ml-auto text-xs text-muted-foreground">
            {scope === "shift" && !activeShift
              ? "No shift open — showing every receipt at this store."
              : `${rows.length} receipt${rows.length === 1 ? "" : "s"} shown`}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-border bg-card">
            <ScrollArea className="h-[calc(100vh-220px)]">
              <ul className="divide-y divide-border">
                {rows.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                        selected?.id === s.id ? "bg-surface-2" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="numeric text-sm font-semibold">{s.receiptNo}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(s.createdAt).toLocaleString()} · {s.cashier} · {s.lines.length}{" "}
                          item{s.lines.length > 1 ? "s" : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {s.method}
                      </Badge>
                      {cloudHistory.has(s.id) && <Badge variant="secondary">Cloud history</Badge>}
                      <span className="numeric w-20 text-right text-sm font-semibold">
                        {money(s.total)}
                      </span>
                      {s.refunded && (
                        <Badge variant="outline" className="border-destructive/50 text-destructive">
                          refunded
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
                {!rows.length && (
                  <li className="py-16 text-center text-sm text-muted-foreground">
                    {scope === "shift"
                      ? "No receipts on the current shift yet."
                      : "No receipts match this filter."}
                  </li>
                )}
                {!exhausted && sales.length > 0 && (
                  <li className="py-3 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                    >
                      {loadingOlder ? "Loading…" : "Load older receipts"}
                    </Button>
                  </li>
                )}
              </ul>
            </ScrollArea>
          </section>

          <aside className="space-y-3">
            <div className="grid gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplate(t.key)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    template === t.key
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </button>
              ))}
            </div>

            <Button className="w-full" disabled={!selected} onClick={print}>
              <Printer className="size-4" /> Print this template
            </Button>

            <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Bill corrections
              </p>
              {isAdmin && (
                <>
                  {retryingCorrectionHold && (
                    <Button
                      variant="outline"
                      className="w-full justify-start border-amber-500/60 text-amber-600"
                      onClick={() => {
                        setCancelMode("correct");
                        setCancelOpen(true);
                      }}
                    >
                      <Wrench className="size-4" /> Retry preparing correction
                    </Button>
                  )}
                  {retryingCorrectionAudit && (
                    <Button
                      variant="outline"
                      className="w-full justify-start border-amber-500/60 text-amber-600"
                      onClick={() => {
                        setCancelMode("correct");
                        setCancelOpen(true);
                      }}
                    >
                      <ScrollText className="size-4" /> Retry saving correction audit
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!selected || selected.refunded}
                    onClick={openSaleCorrection}
                  >
                    <Wrench className="size-4" /> Correct items or amounts
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!selected}
                    onClick={() => void openPaymentFix()}
                  >
                    <Wallet className="size-4" /> Change payment method
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:text-destructive"
                disabled={!selected || selected.refunded}
                onClick={() => void openCancel()}
              >
                <Ban className="size-4" />
                {selected?.refunded ? "Bill already cancelled" : "Cancel this bill"}
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-white">
              {selected && previewHtml ? (
                <iframe
                  key={`${selected.id}-${template}`}
                  title="Receipt preview"
                  srcDoc={previewHtml}
                  className="h-[520px] w-full"
                />
              ) : (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  {selected
                    ? "No shift record linked to this receipt."
                    : "Select a receipt to preview it."}
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={open => { if (!cancelBusy) setCancelOpen(open); }}>
        <DialogContent className={cancelMode === "correct" ? "max-h-[90dvh] overflow-y-auto sm:max-w-3xl" : undefined}>
          <DialogHeader>
            <DialogTitle>
              {cancelMode === "correct" ? "Correct finalized bill" : "Cancel bill"}{" "}
              {selected?.receiptNo}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {cancelMode === "correct"
              ? `Add the missing item or adjust quantities and discounts here. The original receipt stays traceable. After reversal, the corrected bill opens automatically for approval and payment. An open shift is required to complete the replacement receipt.`
              : `The items go back into stock at ${currentStore.name} and the receipt is flagged as cancelled. This is recorded against ${user?.name}.`}
          </p>
          {cancelMode === "correct" && !retryingCorrectionHold && !retryingCorrectionAudit && (
            <fieldset disabled={cancelBusy} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="correction-product">Add missing item</Label>
                <Input id="correction-product" value={correctionSearch} onChange={event => setCorrectionSearch(event.target.value)} placeholder="Search item name, SKU or barcode" />
                {correctionSearch.trim() && <div className="max-h-36 overflow-y-auto space-y-1">
                  {state.products.filter(product => `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(correctionSearch.trim().toLowerCase())).slice(0,15).map(product => (
                    <Button key={product.id} variant="outline" className="w-full justify-between" onClick={() => {
                      setCorrectionLines(lines => [...lines,{productId:product.id,name:product.name,price:product.price,cost:product.cost,qty:1,taxRate:state.settings.tax.rate,discount:0,discountType:"percent"}]);
                      setCorrectionSearch("");
                    }}><span>{product.name}</span><span>{money(product.price)}</span></Button>
                  ))}
                </div>}
              </div>
              {correctionLines.map((line,index) => <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_80px_100px_110px_auto]">
                <div><p className="text-sm font-medium">{line.name}</p><p className="text-xs text-muted-foreground">{money(line.price)} each</p></div>
                <div><Label htmlFor={`correction-qty-${index}`}>Qty</Label><Input id={`correction-qty-${index}`} type="number" min="0.001" step="any" value={line.qty} onChange={event => {
                  const qty = Number(event.target.value);
                  setCorrectionLines(lines => lines.map((item,i) => i === index ? {...item,qty,couponDiscount:item.couponDiscount && item.qty > 0 ? r2(item.couponDiscount / item.qty * qty) : item.couponDiscount} : item));
                }} /></div>
                <div><Label htmlFor={`correction-discount-${index}`}>Discount</Label><Input id={`correction-discount-${index}`} type="number" min="0" step="0.01" value={line.discount} onChange={event => setCorrectionLines(lines => lines.map((item,i) => i === index ? {...item,discount:Number(event.target.value)} : item))} /></div>
                <div><Label htmlFor={`correction-type-${index}`}>Type</Label><select id={`correction-type-${index}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={line.discountType ?? "amount"} onChange={event => setCorrectionLines(lines => lines.map((item,i) => i === index ? {...item,discount:0,discountType:event.target.value as DiscountType} : item))}><option value="percent">Percentage</option><option value="amount">Amount/unit</option></select></div>
                <Button variant="outline" onClick={() => setCorrectionLines(lines => lines.filter((_,i) => i !== index))}>Remove</Button>
              </div>)}
              <div className="flex flex-wrap items-end gap-2">
                <div><Label htmlFor="correction-bill-discount">Whole-bill discount</Label><Input id="correction-bill-discount" type="number" min="0" step="0.01" value={correctionDiscount} onChange={event => setCorrectionDiscount(Number(event.target.value))} /></div>
                <select aria-label="Whole-bill discount type" className="h-9 rounded-md border bg-background px-2 text-sm" value={correctionDiscountType} onChange={event => {setCorrectionDiscountType(event.target.value as DiscountType);setCorrectionDiscount(0);}}><option value="amount">Amount</option><option value="percent">Percentage</option></select>
                <p className="text-sm font-semibold">Corrected total: {money(cartTotals(correctionLines,correctionDiscount,correctionDiscountType,state.settings.tax,selected?.couponScope === "bill" ? selected.couponDiscount ?? 0 : 0).total)}</p>
              </div>
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (required)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              maxLength={200}
              placeholder={
                cancelMode === "correct"
                  ? "e.g. cashier entered the wrong quantity on the original receipt"
                  : "e.g. customer changed their mind before leaving"
              }
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={cancelBusy} onClick={() => setCancelOpen(false)}>
              Keep bill
            </Button>
            <Button variant="destructive" disabled={cancelBusy} onClick={() => void confirmCancel()}>
              {cancelBusy ? "Preparing…" : retryingCorrectionHold
                ? "Retry preparing correction"
                : retryingCorrectionAudit
                ? "Retry saving completed audit"
                : cancelMode === "correct"
                  ? "Reverse and prepare correction"
                  : "Cancel bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct payment on {selected?.receiptNo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Currently recorded as{" "}
            <span className="font-semibold capitalize">{selected?.method.replace("_", " ")}</span>.
            Pick what the customer actually paid with.
          </p>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Original → Corrected
            </p>
            <p className="mt-1 capitalize">
              {selected?.method.replace("_", " ")} → {payMethod.replace("_", " ")}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setPayMethod(m.value)}
                className={`rounded-md border px-2 py-3 text-xs transition-colors ${
                  payMethod === m.value
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-reason">Reason for correction (required)</Label>
            <Textarea
              id="pay-reason"
              value={payReason}
              maxLength={400}
              placeholder="e.g. cashier pressed card by mistake"
              onChange={(e) => setPayReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Close
            </Button>
            <Button
              disabled={payMethod === selected?.method || payReason.trim().length < 3}
              onClick={confirmPaymentFix}
            >
              Confirm &amp; save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
