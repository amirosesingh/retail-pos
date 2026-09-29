import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Ban, Gift, Printer, ReceiptText, Search, ScrollText, Wallet } from "lucide-react";
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
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { logger } from "@/lib/audit-log";
import { holdCancelledBill } from "@/lib/held-orders";
import {
  printSaleReceipt,
  printShiftReport,
  saleReceiptPreview,
  shiftReportPreview,
} from "@/lib/pos-print";
import type { PaymentMethod, Sale } from "@/core/types/pos-types";
import { findReceiptExact, loadSalesPage } from "@/core/api/pos-db";
import type { Cursor } from "@/lib/keyset";
import { saveRecordEditHistory } from "@/lib/record-edit-flow";
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
  const { state, currentStore, activeShift, refundSale, changeSalePayment } = usePos();
  const { user, can } = useAuth();
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
    const seen = new Set(live.map((s) => s.id));
    return [...live, ...older.filter((s) => !seen.has(s.id))];
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
    if (scope === "shift") return activeShift ? s.shiftId === activeShift.id : true;
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
    setCancelReason("");
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (!selected) return;
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
      await refundSale(selected.id, grant.grantToken);
      holdCancelledBill({
        receiptNo: selected.receiptNo,
        total: selected.total,
        lines: selected.lines,
      });
      logActivity(selected, reason);
      setCancelOpen(false);
      toast.success(
        `Bill ${selected.receiptNo} cancelled — the items are waiting on the register's hold list`,
      );
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
    if (!can("can_edit_tenders")) {
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
      const changed = await changeSalePayment(selected.id, payMethod, reason);
      if (!changed) return;
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
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={!selected}
                onClick={() => void openPaymentFix()}
              >
                <Wallet className="size-4" /> Change payment method
              </Button>
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

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel bill {selected?.receiptNo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The items go back into stock at {currentStore.name} and the receipt is flagged as
            cancelled. This is recorded against {user?.name}.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (required)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              maxLength={200}
              placeholder="e.g. customer changed their mind before leaving"
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep bill
            </Button>
            <Button variant="destructive" onClick={confirmCancel}>
              Cancel bill
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
