import { formatDateTime as posDisplayDateTime, posDayKey } from "@/lib/time-zone";
import { subscribePageDataRefresh } from "@/lib/page-data-refresh";
import { canOpenDrawer } from "@/lib/receipt-printer";
import { tenderSales } from "@/lib/shift-close";
import { sameRecordId } from "@/lib/sale-identity";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pencil, Printer, Users, Vault } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isShiftOverdue, localTerminalId, shiftDuration } from "@/lib/shift-hours";
import { defaultTradingHours } from "@/lib/pos-seed";
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { openCashDrawer, printShiftReport } from "@/lib/pos-print";
import { signInsForDay, type SignInEntry } from "@/lib/shift-attendance";
import { localShiftSessions, mergeSessions } from "@/lib/shift-sessions";
import { commitLabel, loadShiftSessions } from "@/core/api/pos-db";
import { notifyError } from "@/lib/notify";
import type { ShiftSession } from "@/core/types/pos-types";
import { parsePositiveAmount } from "@/core/pricing/amount";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { useManagerGate } from "@/lib/manager-gate";
import { ShiftCloseDialog } from "@/platforms/web/components/pos/ShiftCloseDialog";
import { logSystemAction } from "@/lib/system-audit";
import { correctClosedShift } from "@/lib/shift-corrections-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import type { Shift } from "@/core/types/pos-types";

export const Route = createFileRoute("/shifts")({
  head: () => ({
    meta: [
      { title: "Shifts & Sales — Retail" },
      {
        name: "description",
        content:
          "Open and close cashier shifts, count the drawer, print X and Z reports and reprint or refund any receipt.",
      },
      { property: "og:title", content: "Shifts & Sales — Retail" },
      { property: "og:description", content: "Shift control, drawer counts and X/Z reports." },
    ],
  }),
  component: Shifts,
});

function Shifts() {
  const { state, activeShift, openShift, currentStore, stores } = usePos();
  const { user, isAdmin, can } = useAuth();
  const { requirePermission } = useUserPermissions();
  const { rules } = usePosRules();
  const { authorize, rules: authorizationRules } = useManagerGate();
  const [cashier] = useState(user?.name ?? "Cashier");
  // Never carry a suggested or previous drawer count into a new shift.
  const [float, setFloat] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [signIns, setSignIns] = useState<SignInEntry[]>([]);
  const [sessions, setSessions] = useState<ShiftSession[]>([]);
  const mayViewSignIns = isAdmin || can("can_shift_signin_history_view");
  const mayViewShiftHistory = isAdmin || can("can_shift_closing_history_view");
  const [signHistoryOpen, setSignHistoryOpen] = useState(false);
  const [shiftHistoryOpen, setShiftHistoryOpen] = useState(false);
  const [signSearch, setSignSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [signPage, setSignPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const matches = (values: unknown[], query: string) =>
    values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const visibleSignIns = signIns.filter((entry) =>
    matches([entry.name, entry.staffId, entry.role, entry.firstSeen], signSearch),
  );
  const visibleSessions = sessions.filter((entry) =>
    matches(
      [
        entry.staffName,
        entry.role,
        entry.terminalName,
        entry.signedInAt,
        posDisplayDateTime(new Date(entry.signedInAt)),
      ],
      signSearch,
    ),
  );
  const [correcting, setCorrecting] = useState<Shift | null>(null);
  const [correctCash, setCorrectCash] = useState("");
  const [correctCard, setCorrectCard] = useState("");
  const [correctDigital, setCorrectDigital] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);
  const correctionClientKey = useRef<string | null>(null);

  // Local per-terminal log — read after mount so SSR and hydration match.
  useEffect(() => {
    if (!mayViewSignIns || !signHistoryOpen) {
      setSignIns([]);
      return;
    }
    const refresh = () => setSignIns(signInsForDay());
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [user?.staffId, mayViewSignIns, signHistoryOpen]);

  // Central record of every sign-in against a shift, with the local cache as
  // the offline fallback.
  useEffect(() => {
    if (!mayViewSignIns || !signHistoryOpen) {
      setSessions([]);
      return;
    }
    let alive = true;
    const refresh = async () => {
      const local = localShiftSessions();
      try {
        const remote = await loadShiftSessions(currentStore.id);
        if (alive) setSessions(mergeSessions(remote, local));
      } catch {
        if (alive) setSessions(local);
      }
    };
    const offData = subscribePageDataRefresh(refresh, ["shift_sessions"], { allowOffline: true, initial: true });
    return () => {
      alive = false;
      offData();
    };
  }, [currentStore.id, activeShift?.id, mayViewSignIns, signHistoryOpen]);

  const storeSales = state.sales.filter((s) => sameRecordId(s.storeId, currentStore.id));
  const storeShifts = state.shifts.filter((s) => sameRecordId(s.storeId, currentStore.id));
  const validHistoryRange = !historyFrom || !historyTo || historyFrom <= historyTo;
  const visibleShifts = storeShifts.filter((shift) =>
    validHistoryRange &&
    (!historyFrom || posDayKey(shift.openedAt) >= historyFrom) &&
    (!historyTo || posDayKey(shift.openedAt) <= historyTo) && matches(
      [
        shift.cashier,
        shift.terminalName,
        shift.status,
        shift.openedAt,
        posDisplayDateTime(new Date(shift.openedAt)),
      ],
      historySearch,
    ),
  );
  const shiftSales = activeShift
    ? storeSales.filter((s) => sameRecordId(s.shiftId, activeShift.id) && !s.refunded)
    : [];
  const cashTaken = tenderSales(activeShift, shiftSales, "cash");
  const expected = (activeShift?.openingFloat ?? 0) + cashTaken;

  // Terminal-bound close: the PC that opened it, or any manager / admin.
  const hereId = readTerminalConfig()?.tokenId ?? localTerminalId();
  const canCloseHere =
    !activeShift ||
    !activeShift.terminalId ||
    activeShift.terminalId === hereId ||
    isAdmin ||
    can("can_manage_other_shifts") ||
    (state.settings.integrations.allowAnyStaffCloseShift === true && can("can_close_shift"));
  const overdueNow = activeShift ? isShiftOverdue(activeShift, defaultTradingHours) : false;

  /* Viewing financial data and printing reports are independently assigned. */
  const mayPrintXReport =
    (isAdmin || can("can_shift_financial_summary_view")) &&
    (isAdmin || can("can_shift_report_reprint"));
  const storeIndex = stores.findIndex((s) => s.id === currentStore.id);
  const storeLabel = `Store ${storeIndex + 1}`;

  const openShiftCorrection = (shift: Shift) => {
    correctionClientKey.current = crypto.randomUUID();
    setCorrecting(shift);
    setCorrectCash(String(shift.countedCash ?? shift.closingFloat ?? ""));
    setCorrectCard(shift.countedCard == null ? "" : String(shift.countedCard));
    setCorrectDigital(shift.countedDigital == null ? "" : String(shift.countedDigital));
    setCorrectReason("");
  };

  const submitShiftCorrection = async () => {
    if (!correcting || !isAdmin) return;
    const cash = parsePositiveAmount(correctCash);
    const card = correctCard.trim() ? parsePositiveAmount(correctCard) : null;
    const digital = correctDigital.trim() ? parsePositiveAmount(correctDigital) : null;
    if (
      cash === null ||
      (correctCard.trim() && card === null) ||
      (correctDigital.trim() && digital === null)
    ) {
      toast.error("Enter valid non-negative tender counts.");
      return;
    }
    if (correctReason.trim().length < 3) {
      toast.error("Type why this closed shift is being corrected.");
      return;
    }
    setCorrectBusy(true);
    try {
      const auth = await getPosCallerAuth();
      const result = await correctClosedShift({
        data: {
          ...auth,
          shiftId: correcting.id,
          storeId: correcting.storeId,
          cash,
          card,
          digital,
          reason: correctReason.trim(),
          terminalId: correcting.terminalId ?? null,
          clientKey:
            correctionClientKey.current ?? (correctionClientKey.current = crypto.randomUUID()),
        },
      });
      if (!result.ok) throw new Error(result.error);
      correctionClientKey.current = null;
      setCorrecting(null);
      toast.success("Shift correction saved with its original and corrected values.");
    } catch (error) {
      notifyError(error, "Correcting the closed shift");
    } finally {
      setCorrectBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Shifts · {currentStore.name}</h1>
            <p className="text-sm text-muted-foreground page-description">
              Current shift, drawer control and X / Z reports
            </p>
          </div>
          {can("can_open_drawer") && (
            <Button
              variant="outline"
              onClick={async () => {
                if (!(await requirePermission("can_open_drawer"))) return;
                const reason = window.prompt("Reason for opening the cash drawer")?.trim();
                if (!reason) return;
                const result = await openCashDrawer(reason, activeShift?.id);
                if (!result.ok) toast.error(result.error ?? "The cash drawer did not open.");
              }}
            >
              <Vault className="size-4" /> Open drawer
            </Button>
          )}
        </header>
        {!isAdmin && (
          <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary">
            Viewing data for {storeLabel} Only
          </div>
        )}
        {isAdmin && (
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Aggregated multi-store statistics</h2>
            <div className="grid gap-4 md:grid-cols-4">
              {stores.map((st, i) => {
                const sales = state.sales.filter(
                  (s) => sameRecordId(s.storeId, st.id) && !s.refunded,
                );
                return (
                  <Metric
                    key={st.id}
                    label={`Store ${i + 1} · ${st.name} (${sales.length} sales)`}
                    value={money(sales.reduce((a, s) => a + s.total, 0))}
                  />
                );
              })}
              <Metric
                label="Company-wide revenue"
                value={money(
                  state.sales.filter((s) => !s.refunded).reduce((a, s) => a + s.total, 0),
                )}
                highlight
              />
            </div>
          </section>
        )}
        <section className="rounded-lg border border-border bg-card p-5">
          {activeShift ? (
            <div className="grid gap-4 md:grid-cols-4">
              <Metric label="Opened by" value={activeShift.cashier} />
              <Metric label="Serving now" value={user?.name || activeShift.cashier} />
              <Metric label="Opened" value={posDisplayDateTime(activeShift.openedAt)} />
              <Metric label="Transactions" value={String(shiftSales.length)} />
              <Metric label="Terminal" value={activeShift.terminalName ?? "This PC"} />
              <Metric label="Running for" value={shiftDuration(activeShift)} />
              {(isAdmin || can("can_shift_expected_cash_view")) && (
                <Metric label="Expected drawer" value={money(expected)} highlight />
              )}
              {overdueNow && (
                <p className="md:col-span-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  This shift is past the trading-day window and is flagged as overdue.
                </p>
              )}
              {!canCloseHere && (
                <p className="md:col-span-4 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                  This shift was opened on {activeShift.terminalName ?? "another terminal"}. Close
                  it from that PC, or ask a manager or admin to close it.
                </p>
              )}
              <p className="md:col-span-4 text-xs text-muted-foreground">
                Another user can lock the till and sign in without closing this shift — each sale is
                recorded under whoever is signed in at the time.
              </p>
              <div className="md:col-span-4 flex flex-wrap gap-2">
                {mayPrintXReport && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Read-only audit snapshot: derived from recorded sales,
                      // never editable, and every print is logged.
                      void printShiftReport(activeShift, storeSales, "xreport", {
                        financialSummary: isAdmin || can("can_shift_financial_summary_view"),
                        paymentBreakdown: isAdmin || can("can_shift_payment_breakdown_view"),
                        expected: isAdmin || can("can_shift_expected_cash_view"),
                        counted: isAdmin || can("can_shift_counted_cash_view"),
                        variance: isAdmin || can("can_shift_variance_view"),
                      });
                      logSystemAction({
                        actorName: user?.name ?? activeShift.cashier,
                        actorRole: user?.role ?? null,
                        actionType: "X_REPORT_PRINTED",
                        entityAffected: "shifts",
                        entityId: activeShift.id,
                        storeId: currentStore.id,
                        terminalId: hereId,
                      });
                    }}
                  >
                    <Printer className="size-4" /> Print X report
                  </Button>
                )}
                <Button
                  disabled={!canCloseHere}
                  onClick={async () => {
                    if (!(await requirePermission("can_close_shift"))) return;
                    const grant = await authorize({
                      action: "shift_close",
                      title: "Authorise shift close",
                      reason: "Closing the shift produces the final drawer count and Z report.",
                      storeId: currentStore.id,
                      terminalId: hereId,
                      requestedBy: user?.staffId ?? user?.name ?? null,
                    });
                    if (!grant.ok) return;
                    setCloseOpen(true);
                  }}
                >
                  Close shift
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Cashier</Label>
                {/* Locked to the signed-in user — a shift is always theirs. */}
                <Input value={user?.name ?? cashier} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Opening float <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="numeric w-32"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={float}
                  onChange={(e) => setFloat(e.target.value)}
                />
              </div>
              <Button
                disabled={!cashier.trim() || parsePositiveAmount(float) === null}
                onClick={async () => {
                  if (!(await requirePermission("can_open_drawer"))) return;
                  try {
                    const target = await openShift(
                      (user?.name ?? cashier).trim() || "Cashier",
                      parsePositiveAmount(float) ?? 0,
                    );
                    if (canOpenDrawer()) {
                      const drawer = await openCashDrawer("Opening float for a new shift");
                      if (!drawer.ok)
                        toast.warning(drawer.error ?? "The cash drawer did not open.");
                    }
                    setFloat("");
                    toast.success(`Shift opened — ${commitLabel(target).toLowerCase()}`);
                  } catch (e) {
                    notifyError(e, "Opening the shift");
                  }
                }}
              >
                Open shift
              </Button>
            </div>
          )}
        </section>
        <div className="flex flex-wrap gap-2">
          {mayViewSignIns && (
            <Button variant="outline" onClick={() => setSignHistoryOpen(true)}>
              <Users className="size-4" /> Sign-in history
            </Button>
          )}
          {mayViewShiftHistory && (
            <Button variant="outline" onClick={() => setShiftHistoryOpen(true)}>
              Shift history
            </Button>
          )}
        </div>{" "}
      </div>

      <Dialog open={mayViewSignIns && signHistoryOpen} onOpenChange={setSignHistoryOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Sign-in history</DialogTitle>
            <DialogDescription>Staff sign-ins for this branch and terminal.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search sign-in history"
            placeholder="Search staff, role or terminal…"
            value={signSearch}
            onChange={(event) => {
              setSignSearch(event.target.value);
              setSignPage(0);
            }}
          />{" "}
          <section className="rounded-lg border border-border bg-card">
            <h2 className="flex items-center gap-2 px-5 py-3 text-sm font-semibold">
              <Users className="size-4" /> Signed in today on this terminal
            </h2>
            <Separator />
            {visibleSignIns.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No sign-ins recorded yet today.
              </p>
            ) : (
              <Table tableId="routes/shifts#1">
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>First sign-in</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSignIns.map((e) => (
                    <TableRow key={e.staffId}>
                      <TableCell className="font-medium">
                        {e.name}
                        {user && (user.staffId === e.staffId || user.name === e.name) && (
                          <Badge variant="outline" className="ml-2">
                            signed in
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="numeric text-muted-foreground">{e.staffId}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{e.role}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(e.firstSeen).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(e.lastSeen).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
          <section className="rounded-lg border border-border bg-card">
            <h2 className="flex items-center gap-2 px-5 py-3 text-sm font-semibold">
              <Users className="size-4" /> Shift sign-in history (all terminals)
            </h2>
            <Separator />
            {visibleSessions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No shift sessions recorded for this branch yet.
              </p>
            ) : (
              <Table tableId="routes/shifts#2">
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Signed in</TableHead>
                    <TableHead>Signed out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSessions.slice(signPage * 25, (signPage + 1) * 25).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.staffName}
                        {s.shiftId === activeShift?.id && !s.signedOutAt && (
                          <Badge variant="outline" className="ml-2">
                            on shift
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {s.role ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.terminalName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {posDisplayDateTime(new Date(s.signedInAt))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.signedOutAt
                          ? posDisplayDateTime(new Date(s.signedOutAt))
                          : "Still signed in"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {visibleSessions.length} sign-ins · Page {signPage + 1}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={signPage === 0}
                onClick={() => setSignPage((page) => page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={(signPage + 1) * 25 >= visibleSessions.length}
                onClick={() => setSignPage((page) => page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={mayViewShiftHistory && shiftHistoryOpen} onOpenChange={setShiftHistoryOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Shift history</DialogTitle>
            <DialogDescription>
              Search {currentStore.name}'s shifts by opening date and open permitted reports. Dates use the configured store time zone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="shift-history-from">Opened from</Label><Input id="shift-history-from" type="date" value={historyFrom} onChange={event => { setHistoryFrom(event.target.value); setHistoryPage(0); }} /></div>
            <div className="space-y-1"><Label htmlFor="shift-history-to">Opened through</Label><Input id="shift-history-to" type="date" value={historyTo} min={historyFrom || undefined} onChange={event => { setHistoryTo(event.target.value); setHistoryPage(0); }} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { const today = posDayKey(); setHistoryFrom(today); setHistoryTo(today); setHistoryPage(0); }}>Today</Button>
            <Button size="sm" variant="outline" onClick={() => { setHistoryFrom(""); setHistoryTo(""); setHistoryPage(0); }}>All loaded shifts</Button>
            {can("can_view_sales_reports") && <Button size="sm" variant="outline" onClick={() => window.location.assign("/reports/sales")}>Sales by date · Reports</Button>}
          </div>
          {!validHistoryRange && <p role="alert" className="text-sm text-destructive">Choose an end date on or after the start date.</p>}
          <Input
            aria-label="Search shift history"
            placeholder="Search cashier, terminal, status or date…"
            value={historySearch}
            onChange={(event) => {
              setHistorySearch(event.target.value);
              setHistoryPage(0);
            }}
          />
          <section className="rounded-lg border border-border bg-card">
            <h2 className="px-5 py-3 text-sm font-semibold">Shift history</h2>
            <Separator />
            <Table tableId="routes/shifts#3">
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Closed by</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Float</TableHead>
                  {(isAdmin || can("can_shift_counted_cash_view")) && (
                    <TableHead className="text-right">Closing float</TableHead>
                  )}
                  {(isAdmin || can("can_shift_variance_view")) && (
                    <TableHead className="text-right">Over / short</TableHead>
                  )}
                  {can("can_shift_report_reprint") && (
                    <TableHead className="text-right">Z report</TableHead>
                  )}
                  {isAdmin && <TableHead className="text-right">Correction</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleShifts.slice(historyPage * 25, (historyPage + 1) * 25).map((sh) => (
                  <TableRow key={sh.id}>
                    <TableCell>{sh.cashier}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          sh.closedAt
                            ? "text-[10px]"
                            : "border-success/40 bg-success/10 text-[10px] text-success"
                        }
                      >
                        {sh.closedAt ? "CLOSED" : "OPEN"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {posDisplayDateTime(new Date(sh.openedAt))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sh.closedAt ? posDisplayDateTime(new Date(sh.closedAt)) : "open"}
                      {sh.overdue && (
                        <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                          OVERDUE
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{sh.closedBy ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {sh.terminalName ?? "—"}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {shiftDuration(sh)}
                    </TableCell>
                    <TableCell className="numeric text-right">{money(sh.openingFloat)}</TableCell>
                    {(isAdmin || can("can_shift_counted_cash_view")) && (
                      <TableCell className="numeric text-right">
                        {(sh.closingFloat ?? sh.countedCash) == null
                          ? "—"
                          : money((sh.closingFloat ?? sh.countedCash) as number)}
                      </TableCell>
                    )}
                    {(isAdmin || can("can_shift_variance_view")) && (
                      <TableCell className="numeric text-right">
                        {sh.varianceTotal == null ? (
                          "—"
                        ) : (
                          <span
                            className={
                              Math.abs(sh.varianceTotal) <= 0.005
                                ? "text-muted-foreground"
                                : sh.varianceTotal > 0
                                  ? "text-success"
                                  : "text-destructive"
                            }
                          >
                            {money(sh.varianceTotal)}
                          </span>
                        )}
                      </TableCell>
                    )}
                    {can("can_shift_report_reprint") && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void printShiftReport(sh, storeSales, "zreport", {
                              financialSummary: isAdmin || can("can_shift_financial_summary_view"),
                              paymentBreakdown: isAdmin || can("can_shift_payment_breakdown_view"),
                              expected: isAdmin || can("can_shift_expected_cash_view"),
                              counted: isAdmin || can("can_shift_counted_cash_view"),
                              variance: isAdmin || can("can_shift_variance_view"),
                            })
                          }
                        >
                          <Printer className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!sh.closedAt}
                          onClick={() => openShiftCorrection(sh)}
                        >
                          <Pencil className="size-4" /> Correct
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!visibleShifts.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No shifts yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>{" "}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {visibleShifts.length} shifts · Page {historyPage + 1}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={historyPage === 0}
                onClick={() => setHistoryPage((page) => page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={(historyPage + 1) * 25 >= visibleShifts.length}
                onClick={() => setHistoryPage((page) => page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ShiftCloseDialog open={closeOpen} onOpenChange={setCloseOpen} />
      <Dialog open={!!correcting} onOpenChange={(open) => !open && setCorrecting(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Correct closed shift count</DialogTitle>
            <DialogDescription>
              Administrator only. The original declaration is retained and this recount is added to
              the audit history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Counted cash</Label>
              <Input
                inputMode="decimal"
                value={correctCash}
                onChange={(e) => setCorrectCash(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Counted card</Label>
              <Input
                inputMode="decimal"
                value={correctCard}
                onChange={(e) => setCorrectCard(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Counted digital</Label>
              <Input
                inputMode="decimal"
                value={correctDigital}
                onChange={(e) => setCorrectDigital(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Correction reason</Label>
            <Textarea
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
              placeholder="Explain the original mistake and why these counts are correct"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                correctionClientKey.current = null;
                setCorrecting(null);
              }}
            >
              Cancel
            </Button>
            <Button disabled={correctBusy} onClick={() => void submitShiftCorrection()}>
              {correctBusy ? "Saving…" : "Save audited correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md bg-surface-2 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`numeric text-lg font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
