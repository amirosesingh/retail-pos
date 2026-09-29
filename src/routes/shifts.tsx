import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Printer, RotateCcw, Users, Vault } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
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
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { openCashDrawer, printSaleReceipt, printShiftReport } from "@/lib/pos-print";
import { signInsForDay, type SignInEntry } from "@/lib/shift-attendance";
import { localShiftSessions, mergeSessions } from "@/lib/shift-sessions";
import { commitLabel, loadShiftSessions } from "@/core/api/pos-db";
import { notifyError } from "@/lib/notify";
import type { ShiftSession } from "@/core/types/pos-types";
import { parseAmount, parsePositiveAmount } from "@/core/pricing/amount";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { assertShiftClosable } from "@/lib/pos-rules.functions";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { useManagerGate } from "@/lib/manager-gate";
import { ShiftCloseDialog } from "@/platforms/web/components/pos/ShiftCloseDialog";
import { logSystemAction } from "@/lib/system-audit";

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
  const { state, activeShift, openShift, closeShift, refundSale, currentStore, stores } = usePos();
  const { user, isAdmin, isSupervisor, can } = useAuth();
  const { requirePermission } = useUserPermissions();
  const { rules } = usePosRules();
  const { authorize, rules: authorizationRules } = useManagerGate();
  const [cashier, setCashier] = useState(user?.name ?? "Cashier");
  // Never carry a suggested or previous drawer count into a new shift.
  const [float, setFloat] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [signIns, setSignIns] = useState<SignInEntry[]>([]);
  const [sessions, setSessions] = useState<ShiftSession[]>([]);

  // Local per-terminal log — read after mount so SSR and hydration match.
  useEffect(() => {
    const refresh = () => setSignIns(signInsForDay());
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [user?.staffId]);

  // Central record of every sign-in against a shift, with the local cache as
  // the offline fallback.
  useEffect(() => {
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
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [currentStore.id, activeShift?.id]);

  const storeSales = state.sales.filter((s) => s.storeId === currentStore.id);
  const storeShifts = state.shifts.filter((s) => s.storeId === currentStore.id);
  const shiftSales = activeShift
    ? storeSales.filter((s) => s.shiftId === activeShift.id && !s.refunded)
    : [];
  const cashTaken = shiftSales.filter((s) => s.method === "cash").reduce((a, s) => a + s.total, 0);
  const expected = (activeShift?.openingFloat ?? 0) + cashTaken;

  // Terminal-bound close: the PC that opened it, or any manager / admin.
  const hereId = readTerminalConfig()?.tokenId ?? localTerminalId();
  const canCloseHere =
    !activeShift ||
    !activeShift.terminalId ||
    activeShift.terminalId === hereId ||
    can("can_manage_other_shifts");
  const overdueNow = activeShift ? isShiftOverdue(activeShift, state.settings.hours) : false;

  /* Mid-shift snapshot: supervisors always, cashiers only when switched on. */
  const mayPrintXReport =
    can("can_shift_financial_summary_view") &&
    (isAdmin || isSupervisor || rules.enable_cashier_x_report);
  const storeIndex = stores.findIndex((s) => s.id === currentStore.id);
  const storeLabel = `Store ${storeIndex + 1}`;

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Shifts &amp; receipts · {currentStore.name}</h1>
            <p className="text-sm text-muted-foreground">
              Drawer control, X / Z reports and full sales history
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
                const sales = state.sales.filter((s) => s.storeId === st.id && !s.refunded);
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
              <Metric label="Opened" value={new Date(activeShift.openedAt).toLocaleTimeString()} />
              <Metric label="Transactions" value={String(shiftSales.length)} />
              <Metric label="Terminal" value={activeShift.terminalName ?? "This PC"} />
              <Metric label="Running for" value={shiftDuration(activeShift)} />
              {can("can_shift_expected_cash_view") && (
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
                        financialSummary: can("can_shift_financial_summary_view"),
                        paymentBreakdown: can("can_shift_payment_breakdown_view"),
                        expected: can("can_shift_expected_cash_view"),
                        counted: can("can_shift_counted_cash_view"),
                        variance: can("can_shift_variance_view"),
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
                    const drawer = await openCashDrawer("Opening float for a new shift");
                    if (!drawer.ok) toast.warning(drawer.error ?? "The cash drawer did not open.");
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

        <section className="rounded-lg border border-border bg-card">
          <h2 className="flex items-center gap-2 px-5 py-3 text-sm font-semibold">
            <Users className="size-4" /> Signed in today on this terminal
          </h2>
          <Separator />
          {signIns.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No sign-ins recorded yet today.
            </p>
          ) : (
            <Table>
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
                {signIns.map((e) => (
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
          {sessions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No shift sessions recorded for this branch yet.
            </p>
          ) : (
            <Table>
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
                {sessions.slice(0, 50).map((s) => (
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
                    <TableCell className="text-muted-foreground">{s.terminalName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(s.signedInAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.signedOutAt ? new Date(s.signedOutAt).toLocaleString() : "Still signed in"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <h2 className="px-5 py-3 text-sm font-semibold">Receipts</h2>
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Reprint</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storeSales.map((s) => {
                const member = state.members.find((m) => m.id === s.memberId) ?? null;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="numeric">
                      {s.receiptNo}
                      {s.refunded && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-destructive/50 text-destructive"
                        >
                          refunded
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{s.cashier}</TableCell>
                    <TableCell className="uppercase text-muted-foreground">{s.method}</TableCell>
                    <TableCell className="numeric text-right">{money(s.total)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => printSaleReceipt(s, member, "duplicate")}
                        >
                          Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => printSaleReceipt(s, member, "gift")}
                        >
                          Gift
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={s.refunded}
                          onClick={async () => {
                            if (
                              (authorizationRules.refund?.mode ?? "none") === "none" &&
                              !(await requirePermission("can_process_refund"))
                            )
                              return;
                            const grant = await authorize({
                              action: "refund",
                              title: "Authorise refund",
                              reason: `Refund bill ${s.receiptNo}`,
                              storeId: currentStore.id,
                              requestedBy: user?.staffId ?? user?.name ?? null,
                              requestedAmount: Math.abs(s.total),
                              valueUnit: "currency",
                              payload: {
                                sale_id: s.id,
                                receipt_no: s.receiptNo,
                                total: Math.abs(s.total),
                              },
                            });
                            if (!grant.ok) return;
                            try {
                              await refundSale(s.id, grant.grantToken);
                              printSaleReceipt(s, member, "refund");
                              const drawer = await openCashDrawer(
                                `Refund ${s.receiptNo}`,
                                activeShift?.id,
                              );
                              if (!drawer.ok)
                                toast.warning(drawer.error ?? "The cash drawer did not open.");
                              toast.success(`${s.receiptNo} refunded`);
                            } catch (error) {
                              notifyError(error, "Refunding the sale");
                            }
                          }}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!storeSales.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No sales recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        {can("can_shift_closing_history_view") && (
          <section className="rounded-lg border border-border bg-card">
            <h2 className="px-5 py-3 text-sm font-semibold">Shift history</h2>
            <Separator />
            <Table>
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
                  {can("can_shift_counted_cash_view") && (
                    <TableHead className="text-right">Closing float</TableHead>
                  )}
                  {can("can_shift_variance_view") && (
                    <TableHead className="text-right">Over / short</TableHead>
                  )}
                  {can("can_shift_report_reprint") && (
                    <TableHead className="text-right">Z report</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeShifts.map((sh) => (
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
                      {new Date(sh.openedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "open"}
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
                    {can("can_shift_counted_cash_view") && (
                      <TableCell className="numeric text-right">
                        {(sh.closingFloat ?? sh.countedCash) == null
                          ? "—"
                          : money((sh.closingFloat ?? sh.countedCash) as number)}
                      </TableCell>
                    )}
                    {can("can_shift_variance_view") && (
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
                              financialSummary: can("can_shift_financial_summary_view"),
                              paymentBreakdown: can("can_shift_payment_breakdown_view"),
                              expected: can("can_shift_expected_cash_view"),
                              counted: can("can_shift_counted_cash_view"),
                              variance: can("can_shift_variance_view"),
                            })
                          }
                        >
                          <Printer className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!storeShifts.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No shifts yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        )}
      </div>

      <ShiftCloseDialog open={closeOpen} onOpenChange={setCloseOpen} />
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
