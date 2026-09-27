/**
 * The one closing screen used everywhere — register header and Shifts page.
 *
 * The workflow lives in the database, so this component only walks the
 * cashier through the steps and shows whatever state the server hands back:
 *
 *   reason  →  blind count  →  server reconciles  →  closed / variance review
 *
 * A cashier never sees expected cash or the over/short: those come from a
 * separate, permission-gated table and are only fetched for staff allowed to
 * see them.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { parseAmount, parsePositiveAmount } from "@/core/pricing/amount";
import { openCashDrawer, printShiftReport } from "@/lib/pos-print";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { localTerminalId } from "@/lib/shift-hours";
import { logSystemAction } from "@/lib/system-audit";
import {
  approveVariance,
  loadReconciliations,
  startShiftClose,
  submitCashCount,
  submitRecount,
  type ShiftReconciliation,
} from "@/lib/shift-closing";
import type { ShiftState } from "@/core/types/pos-types";

type Step = "reason" | "count" | "review" | "done";

export function ShiftCloseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, activeShift, closeShift } = usePos();
  const { user, can } = useAuth();

  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState("");
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [digital, setDigital] = useState("");
  const [note, setNote] = useState("");
  const [recountReason, setRecountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverState, setServerState] = useState<ShiftState | null>(null);
  const [recon, setRecon] = useState<ShiftReconciliation | null>(null);

  const mayCount = can("can_shift_cash_count") || can("can_close_shift");
  const maySeeExpected = can("can_shift_expected_cash_view");
  const maySeeCounted = can("can_shift_counted_cash_view");
  const maySeeVariance = can("can_shift_variance_view");
  const maySeeFinancialSummary = can("can_shift_financial_summary_view");
  const maySeePaymentBreakdown = can("can_shift_payment_breakdown_view");
  const mayApprove = can("can_shift_variance_approve");
  const mayRecount = can("can_shift_cash_recount");
  const terminalId = readTerminalConfig()?.tokenId ?? localTerminalId();
  const actorId = user?.staffId ?? null;
  const differentOperator = activeShift
    ? activeShift.openedByStaffId && actorId
      ? activeShift.openedByStaffId !== actorId
      : activeShift.cashier.trim().toLowerCase() !== (user?.name ?? "").trim().toLowerCase()
    : false;
  const differentTerminal = !!activeShift?.terminalId && activeShift.terminalId !== terminalId;
  const forcedClosure = differentOperator || differentTerminal;
  const mayForceClose = can("can_manage_other_shifts");

  // Reopening the dialog always starts a fresh walk-through.
  useEffect(() => {
    if (!open) return;
    setStep(
      activeShift?.state === "VARIANCE_REVIEW_REQUIRED"
        ? "review"
        : activeShift?.state && activeShift.state !== "ACTIVE"
          ? "count"
          : "reason",
    );
    setServerState((activeShift?.state as ShiftState) ?? null);
    setReason(activeShift?.closeReason ?? "");
    setCash("");
    setCard("");
    setDigital("");
    setRecountReason("");
  }, [open, activeShift?.id, activeShift?.state, activeShift?.closeReason]);

  // Managers see the numbers; the database refuses everyone else.
  useEffect(() => {
    if (!open || !activeShift || !(maySeeExpected || maySeeCounted || maySeeVariance)) return;
    if (step !== "review" && step !== "done") return;
    void loadReconciliations(activeShift.id).then((rows) => setRecon(rows[0] ?? null));
  }, [open, step, activeShift, maySeeExpected, maySeeCounted, maySeeVariance]);

  if (!activeShift) return null;

  const cashValue = parsePositiveAmount(cash);
  const counted = {
    cash: cashValue ?? 0,
    card: parsePositiveAmount(card),
    digital: parsePositiveAmount(digital),
  };

  /** Mirror the finished closure into local state, then print and kick out. */
  async function finish() {
    const shift = activeShift;
    if (!shift) return;
    const closed = await closeShift(cashValue ?? shift.countedCash ?? 0, note.trim(), {
      countedCard: counted.card,
      countedDigital: counted.digital,
    });
    if (!closed) {
      toast.error("The shift close was not accepted.");
      return;
    }
    if (forcedClosure) {
      logSystemAction({
        actorId,
        actorName: user?.name ?? null,
        actorRole: user?.role ?? null,
        actionType: "SHIFT_FORCE_CLOSED",
        entityAffected: "shifts",
        entityId: shift.id,
        oldValue: {
          status: shift.status ?? "OPEN",
          openedBy: shift.cashier,
          terminalId: shift.terminalId ?? null,
        },
        newValue: {
          status: "CLOSED",
          countedCash: cashValue ?? shift.countedCash ?? 0,
          closedBy: user?.name ?? null,
        },
        terminalId,
        storeId: shift.storeId,
        note: reason.trim(),
      });
    }
    const printed = await printShiftReport(closed, state.sales, "zreport", {
      financialSummary: maySeeFinancialSummary,
      paymentBreakdown: maySeePaymentBreakdown,
      expected: maySeeExpected,
      counted: maySeeCounted,
      variance: maySeeVariance,
    });
    toast.success(printed.ok ? "Shift closed · Z report sent to printer" : "Shift closed", {
      description: printed.ok
        ? undefined
        : "The shift is safely closed. Reprint the Z report after checking the printer.",
    });
    setStep("done");
    onOpenChange(false);
  }

  async function handleState(next: ShiftState) {
    setServerState(next);
    if (next === "CLOSED") {
      await finish();
    } else if (next === "VARIANCE_REVIEW_REQUIRED") {
      setStep("review");
    } else {
      setStep("count");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        const locked = (activeShift.state ?? "ACTIVE") !== "ACTIVE" || step !== "reason";
        if (!busy && (next || !locked)) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{forcedClosure ? "Admin shift override" : "Close shift"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Opened by {activeShift.cashier}
            {activeShift.closingStartedAt
              ? ` · closing started ${new Date(activeShift.closingStartedAt).toLocaleTimeString()}`
              : ""}
          </p>

          {step === "reason" && (
            <>
              {forcedClosure && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  {mayForceClose
                    ? `You are closing a shift opened by ${activeShift.cashier}${activeShift.terminalName ? ` on ${activeShift.terminalName}` : ""}. Your identity, reason, and time will be written to the audit history.`
                    : "This shift belongs to another employee or terminal. The Manage other shifts permission is required to close it."}
                </div>
              )}
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Once closing starts this terminal stops taking sales on this shift. The count is
                blind: the till will not show you what the drawer should hold.
              </p>
              <div className="space-y-1">
                <Label>
                  {forcedClosure ? "Reason for forced closure" : "Reason for closing"}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  rows={2}
                  placeholder={
                    forcedClosure
                      ? "Why the original employee cannot close this shift"
                      : "End of day, handover, break…"
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </>
          )}

          {step === "count" && (
            <>
              <div className="space-y-1">
                <Label>Cashier</Label>
                <Input value={user?.name ?? activeShift.cashier} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label>
                  Total cash in drawer <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="numeric h-12 text-xl"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
                {parseAmount(cash) !== null && parseAmount(cash)! < 0 && (
                  <p className="text-[11px] text-destructive">The amount cannot be negative.</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Card terminal total</Label>
                  <Input
                    className="numeric"
                    inputMode="decimal"
                    placeholder="Optional"
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Digital / wallet total</Label>
                  <Input
                    className="numeric"
                    inputMode="decimal"
                    placeholder="Optional"
                    value={digital}
                    onChange={(e) => setDigital(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="size-3" /> The count is checked on the server. It can only be
                submitted once.
              </p>
            </>
          )}

          {step === "review" && (
            <>
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                <span>
                  This is a legacy in-progress closure. The count is already recorded; resolving it
                  will not overwrite the original count.
                </span>
              </div>

              {(maySeeExpected || maySeeCounted || maySeeVariance) && recon && (
                <div className="rounded-md border border-border px-3 py-2 text-xs">
                  {maySeeExpected && (
                    <Row label="Expected cash" value={money(recon.expectedCash)} />
                  )}
                  {maySeeCounted && (
                    <Row label="Counted cash" value={money(recon.countedCash ?? 0)} />
                  )}
                  {maySeeVariance && (
                    <Row
                      label="Over / short"
                      value={money(recon.varianceTotal ?? 0)}
                      tone={Math.abs(recon.varianceTotal ?? 0) > 0.005 ? "bad" : "good"}
                    />
                  )}
                </div>
              )}
              {!(maySeeExpected || maySeeCounted || maySeeVariance) && (
                <p className="text-xs text-muted-foreground">
                  The difference is only visible to a supervisor.
                </p>
              )}

              {mayRecount && (
                <div className="space-y-2 rounded-md border border-border px-3 py-2">
                  <Label className="text-xs">Authorised recount</Label>
                  <Input
                    className="numeric"
                    inputMode="decimal"
                    placeholder="Recounted cash"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                  />
                  <Input
                    placeholder="Reason for the recount"
                    value={recountReason}
                    onChange={(e) => setRecountReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || cashValue === null || !recountReason.trim()}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const res = await submitRecount(
                          activeShift.id,
                          counted,
                          recountReason.trim(),
                          terminalId,
                        );
                        setBusy(false);
                        if (!res.ok) {
                          toast.error(res.error);
                          return;
                        }
                        toast.success("Recount recorded — the original count is kept.");
                        await handleState(res.state);
                      })();
                    }}
                  >
                    Submit recount
                  </Button>
                </div>
              )}
            </>
          )}

          {serverState && serverState !== "ACTIVE" && step !== "review" && (
            <p className="text-[11px] text-muted-foreground">Shift state: {serverState}</p>
          )}
        </div>

        <DialogFooter>
          {step === "reason" && (
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step === "reason" && (
            <Button
              disabled={busy || reason.trim().length < 3 || (forcedClosure && !mayForceClose)}
              onClick={() => {
                void (async () => {
                  if (
                    forcedClosure &&
                    !window.confirm(
                      `Force-close ${activeShift.cashier}'s shift? This action will be audited.`,
                    )
                  )
                    return;
                  setBusy(true);
                  const drawer = await openCashDrawer(reason.trim(), activeShift.id);
                  if (!drawer.ok) {
                    setBusy(false);
                    toast.error("The drawer did not open", { description: drawer.error });
                    return;
                  }
                  const res = await startShiftClose(activeShift.id, reason.trim(), terminalId);
                  setBusy(false);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  await handleState(res.state);
                })();
              }}
            >
              {busy ? "Starting…" : "Start closing"}
            </Button>
          )}

          {step === "count" && (
            <Button
              disabled={busy || !mayCount || cashValue === null}
              onClick={() => {
                void (async () => {
                  if (!mayCount) {
                    toast.error("You do not have permission to submit the cash count.");
                    return;
                  }
                  setBusy(true);
                  const res = await submitCashCount(activeShift.id, counted, {
                    clientKey: `${activeShift.id}:original`,
                    terminalId,
                  });
                  setBusy(false);
                  if (!res.ok) {
                    // A parked count is not a failure: the drawer has been
                    // counted, the server just cannot be told yet.
                    if (res.queued) toast.success(res.error);
                    else toast.error(res.error);
                    return;
                  }

                  await handleState(res.state);
                })();
              }}
            >
              {busy ? "Submitting…" : "Submit count"}
            </Button>
          )}

          {step === "review" && mayApprove && (
            <Button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const res = await approveVariance(activeShift.id, note.trim() || undefined);
                  setBusy(false);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Variance approved");
                  await handleState(res.state);
                })();
              }}
            >
              <CheckCircle2 className="size-4" /> Approve &amp; close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`numeric ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
