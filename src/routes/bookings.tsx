import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClock,
  Printer,
  Search,
  Ban,
  Check,
  Tag,
  Wrench,
  Banknote,
  Undo2,
  Trash2,
  ScanLine,
  History,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { StatusHistoryDialog } from "@/platforms/web/components/pos/StatusHistoryDialog";
import { ActionButton } from "@/platforms/web/components/pos/ActionButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BOOKING_TIMING_LABELS, bookingRulesOf } from "@/core/types/pos-types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, usePos } from "@/lib/pos-store";
import { useUserPermissions } from "@/lib/pos-permissions";
import { useAuth } from "@/lib/pos-auth";
import { readBookingBalance } from "@/lib/booking-collection";

import {
  bookingBalance,
  racketSummary,
  r2,
  JOB_STATUS_FLOW,
  JOB_STATUS_LABELS,
  type Booking,
  type JobStatus,
  type PaymentMethod,
} from "@/core/types/pos-types";
import {
  printBookingPayment,
  printBookingSlip,
  printJobTag,
  printSaleReceipt,
} from "@/lib/pos-print";

export const Route = createFileRoute("/bookings")({
  head: () => ({
    meta: [
      { title: "Bookings & Pay Later — Retail" },
      {
        name: "description",
        content:
          "Track reserved goods, take part payments, settle balances and hand over collected bookings.",
      },
      { property: "og:title", content: "Bookings & Pay Later — Retail" },
      {
        property: "og:description",
        content: "Layaway tickets with deposits, due dates and balance collection.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BookingsPage,
});

const statusTone: Record<Booking["status"], string> = {
  active: "border-primary/40 text-primary",
  collected: "border-success/40 text-success",
  cancelled: "border-muted text-muted-foreground",
};

const jobTone: Record<JobStatus, string> = {
  received: "border-muted text-muted-foreground",
  strung: "border-primary/40 text-primary",
  ready: "border-success/40 text-success",
  collected: "border-success/40 text-success",
  damaged: "border-destructive/50 text-destructive",
  cancelled: "border-muted text-muted-foreground",
};

function BookingsPage() {
  const {
    state,
    currentStore,
    addBookingPayment,
    collectBooking,
    cancelBooking,
    refundBooking,
    deleteBooking,
    setBookingJobStatus,
  } = usePos();
  const { requirePermission } = useUserPermissions();
  const { user, can } = useAuth();
  const rules = bookingRulesOf(state.settings.integrations.bookingRules);
  const isSupervisor = user?.role === "admin" || can("can_access_pos_settings");
  /** Cancelling can be reserved for supervisors by the branch rules. */
  const guardCancel = async () => {
    if (rules.managerOnlyCancel && !isSupervisor) {
      toast.error("Only a supervisor may cancel a booking");
      return false;
    }
    return requirePermission("can_cancel_booking");
  };
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Booking["status"] | "all">("active");
  /** Which kind of ticket the counter is looking at. */
  const [kind, setKind] = useState<"racket" | "standard" | "done">("racket");
  /** Extra lens over the racket workflow, on top of the booking status. */
  const [jobFilter, setJobFilter] = useState<JobStatus | "all" | "jobs">("all");
  const [payFor, setPayFor] = useState<Booking | null>(null);
  const [removing, setRemoving] = useState<Booking | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [settle, setSettle] = useState(false);
  /** Claim tag / reference scanned at the counter to pull a job up fast. */
  const [claim, setClaim] = useState("");
  /** Damaged or cancelled jobs must carry a written incident note. */
  const [incidentFor, setIncidentFor] = useState<{ booking: Booking; status: JobStatus } | null>(
    null,
  );
  const [incidentNote, setIncidentNote] = useState("");
  /** Cancelling always asks for a written reason, kept on the record for good. */
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  /** What happens to money already taken when a paid booking is cancelled. */
  const [cancelMoney, setCancelMoney] = useState<"refunded" | "retained">("refunded");
  /** Handing money back on a booking, capped by the server at what was taken. */
  const [refundFor, setRefundFor] = useState<Booking | null>(null);
  const [historyFor, setHistoryFor] = useState<Booking | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  /**
   * One id per open payment dialog: pressing the button twice, or retrying
   * after a dropped connection, can never take the money a second time.
   */
  const [payToken, setPayToken] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  /** What the central database says is still owed, refreshed on open. */
  const [serverDue, setServerDue] = useState<number | null>(null);

  const bookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.bookings
      .filter((b) => b.storeId === currentStore.id)
      .filter((b) =>
        kind === "done"
          ? b.status !== "active"
          : b.status === "active" && (kind === "racket" ? !!b.job : !b.job),
      )
      .filter((b) => (kind !== "done" || tab === "all" ? true : b.status === tab))
      .filter((b) =>
        jobFilter === "all"
          ? true
          : jobFilter === "jobs"
            ? !!b.job
            : (b.jobStatus ?? "received") === jobFilter && !!b.job,
      )
      .filter(
        (b) =>
          !q ||
          b.ref.toLowerCase().includes(q) ||
          b.customerName.toLowerCase().includes(q) ||
          b.customerPhone.replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
          (b.job?.racketModel ?? "").toLowerCase().includes(q) ||
          (b.job?.stringType ?? "").toLowerCase().includes(q),
      );
  }, [state.bookings, currentStore.id, kind, tab, query, jobFilter]);

  const pager = usePagination(bookings);

  /** Counts for the tab badges, before the search / status lenses apply. */
  const kindCounts = useMemo(() => {
    const mine = state.bookings.filter((b) => b.storeId === currentStore.id);
    return {
      racket: mine.filter((b) => b.status === "active" && !!b.job).length,
      standard: mine.filter((b) => b.status === "active" && !b.job).length,
      done: mine.filter((b) => b.status !== "active").length,
    };
  }, [state.bookings, currentStore.id]);

  const memberOf = (b: Booking) => state.members.find((m) => m.id === b.memberId) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  async function openPay(b: Booking, full: boolean) {
    setPayFor(b);
    setSettle(full);
    setAmount(bookingBalance(b).toFixed(2));
    setMethod("cash");
    setPayToken(crypto.randomUUID());
    setServerDue(null);
    const check = await readBookingBalance(b.id);
    if (check.ok) {
      setServerDue(check.state.outstanding);
      setAmount(check.state.outstanding.toFixed(2));
    }
  }

  /** Look a job up by its printed claim tag, or by the booking reference. */
  function findByClaim(raw: string) {
    const code = raw.trim().toLowerCase();
    if (!code) return;
    const hit = state.bookings.find(
      (b) =>
        (b.tagId ?? "").toLowerCase() === code ||
        b.ref.toLowerCase() === code ||
        (b.tagId ?? "").toLowerCase().endsWith(code),
    );
    if (!hit) {
      toast.error(`No job matches “${raw.trim()}”`);
      return;
    }
    setTab("all");
    setJobFilter("all");
    setQuery(hit.ref);
    setClaim("");
    toast.success(`${hit.ref} · ${hit.customerName}`);
  }

  /** Move a job card on, guarding incidents and unpaid handovers. */
  async function changeJobStatus(b: Booking, s: JobStatus, balance: number) {
    if (s === "damaged" || s === "cancelled") {
      setIncidentFor({ booking: b, status: s });
      setIncidentNote(b.incidentNote ?? "");
      return;
    }
    if (s === "collected") {
      // Never trust the figure on screen: ask the database what is owed now.
      const check = await readBookingBalance(b.id);
      const due = check.ok ? check.state.outstanding : balance;
      if (!check.ok)
        toast.warning("Balance could not be verified", { description: check.error });
      if (due > 0) {
        toast.error(`Balance of ${money(due)} must be settled before collection`, {
          description: "Collect the balance to hand the racket over.",
        });
        void openPay(b, true);
        return;
      }
    }
    const moved = await setBookingJobStatus(b.id, s, user?.name || b.cashier || "Counter");
    if (!moved) return;
    toast.success(`${b.ref} · ${JOB_STATUS_LABELS[s].toLowerCase()}`);
  }

  async function submitPayment() {
    if (!payFor) return;
    if (!(await requirePermission("can_collect_booking"))) return;
    const value = r2(Number(amount || 0));
    const balance = serverDue ?? bookingBalance(payFor);
    if (value <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    const token = payToken || crypto.randomUUID();
    setPayBusy(true);
    try {
      if (settle) {
        if (value < balance) {
          toast.error(`Collecting requires the full balance of ${money(balance)}`);
          return;
        }
        const done = await collectBooking(payFor.id, value, method, token);
        if (!done) return;
        printSaleReceipt(done.sale, memberOf(payFor), "sale");
        const change = r2(done.sale.change ?? 0);
        toast.success(`Booking ${done.booking.ref} collected · bill ${done.sale.receiptNo}`, {
          description: change > 0 ? `Change due ${money(change)}` : undefined,
        });
      } else {
        if (value > balance && method !== "cash") {
          toast.error("Part payment cannot exceed the outstanding balance");
          return;
        }
        if (value > balance) {
          toast.info(`Change due ${money(r2(value - balance))}`);
        }
        const updated = await addBookingPayment(
          payFor.id,
          Math.min(value, balance),
          method,
          payFor.cashier,
          token,
        );
        if (!updated) return;
        printBookingPayment(updated, updated.payments[updated.payments.length - 1]);
        toast.success(`${money(value)} received · balance ${money(bookingBalance(updated))}`);
      }
      setPayFor(null);
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        <header className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <CalendarClock className="size-5 shrink-0 text-primary" />
              <span className="truncate">Bookings, jobs &amp; pay later</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Reserved goods and racket stringing jobs at {currentStore.name}. Stock stays held
              until collection or cancellation.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="relative w-full sm:w-56">
              <ScanLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
              <Input
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") findByClaim(claim);
                }}
                placeholder="Scan claim tag…"
                className="pl-9"
                aria-label="Scan claim tag"
              />
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ref, customer, phone, racket…"
                className="pl-9"
              />
            </div>
          </div>
        </header>

        <div className="flex flex-wrap gap-1">
          {(
            [
              ["racket", "Racket jobs", kindCounts.racket],
              ["standard", "Standard bookings", kindCounts.standard],
              ["done", "Completed / collected", kindCounts.done],
            ] as const
          ).map(([k, label, count]) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                if (k === "done") setTab("all");
              }}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                kind === k
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {kind === "done" && (
        <div className="flex flex-wrap gap-1">
          {(["collected", "cancelled", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md border px-3 py-1.5 text-xs capitalize ${
                tab === t
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        )}

        {kind === "racket" && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Wrench className="size-3.5" /> Job cards
          </span>
          {(["all", "jobs", ...JOB_STATUS_FLOW] as const).map((f) => (
            <button
              key={f}
              onClick={() => setJobFilter(f)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                jobFilter === f
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "Everything" : f === "jobs" ? "String jobs" : JOB_STATUS_LABELS[f]}
            </button>
          ))}
        </div>
        )}

        {bookings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No bookings here yet. Start one from the register with “Book &amp; pay later”.
          </p>
        ) : (
          <ul className="space-y-3">
            {pager.pageItems.map((b) => {
              const balance = bookingBalance(b);
              const overdue = b.status === "active" && b.dueDate < today;
              const stale =
                b.status === "active" &&
                rules.staleAfterDays > 0 &&
                Date.now() - new Date(b.createdAt).getTime() >
                  rules.staleAfterDays * 86_400_000;
              const job = b.job;
              const jobStatus = (b.jobStatus ?? "received") as JobStatus;
              const hasJob =
                !!job &&
                !!(job.racketModel || job.stringType || job.tensionMain || job.promisedAt);
              return (
                 <li key={b.id} className="rounded-lg border border-border p-4">
                   <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {b.ref}
                        <Badge variant="outline" className={statusTone[b.status]}>
                          {b.status}
                        </Badge>
                        {overdue && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            overdue
                          </Badge>
                        )}
                        {stale && (
                          <Badge variant="outline" className="border-warning/40 text-warning">
                            uncollected {rules.staleAfterDays}d+
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {b.customerName}
                        {b.customerPhone ? ` · ${b.customerPhone}` : ""} · booked{" "}
                        {new Date(b.createdAt).toLocaleDateString()} · collect by{" "}
                        {new Date(b.dueDate).toDateString()}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {b.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
                      </p>
                      {b.serviceName && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {b.serviceName}
                          {b.serviceFee ? ` · service fee ${b.serviceFee.toFixed(2)}` : ""}
                          {b.paymentTiming ? ` · ${BOOKING_TIMING_LABELS[b.paymentTiming]}` : ""}
                        </p>
                      )}
                      {hasJob && (
                        <div className="mt-2 rounded-md border border-border/70 bg-muted/30 p-2 text-xs">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            <Wrench className="size-3.5 shrink-0 text-primary" />
                            <span className="min-w-0 truncate">
                              {racketSummary(job) || "String job"}
                            </span>
                            <Badge variant="outline" className={jobTone[jobStatus]}>
                              {JOB_STATUS_LABELS[jobStatus]}
                            </Badge>
                          </p>
                          {job?.promisedAt && (
                            <p className="mt-1 text-muted-foreground">
                              Ready by {new Date(job.promisedAt).toLocaleString()}
                              {job.droppedOffAt
                                ? ` · dropped off ${new Date(job.droppedOffAt).toLocaleDateString()}`
                                : ""}
                            </p>
                          )}
                          {(job?.grommetNotes || job?.jobNotes) && (
                            <p className="mt-1 text-muted-foreground">
                              {[job?.grommetNotes, job?.jobNotes].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {b.jobStatusBy && b.jobStatusAt && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {JOB_STATUS_LABELS[jobStatus]} by {b.jobStatusBy} ·{" "}
                              {new Date(b.jobStatusAt).toLocaleString()}
                            </p>
                          )}
                          {b.incidentNote && (
                            <p className="mt-1 text-[11px] text-destructive">
                              Incident: {b.incidentNote}
                            </p>
                          )}
                          {b.cancelReason && (
                            <p className="mt-1 text-[11px] text-destructive">
                              Cancelled: {b.cancelReason}
                              {b.cancelledBy ? ` · ${b.cancelledBy}` : ""}
                              {b.cancelledAt
                                ? ` · ${new Date(b.cancelledAt).toLocaleString()}`
                                : ""}
                              {b.cancelMoneyAction === "refunded"
                                ? " · money refunded"
                                : b.cancelMoneyAction === "retained"
                                  ? " · money kept"
                                  : ""}
                            </p>
                          )}

                          {job?.notifyWhatsApp && (
                            <p className="mt-1 text-[11px] text-primary">
                              Customer wants a WhatsApp when it is ready.
                            </p>
                          )}
                        </div>
                      )}
                      {b.note && <p className="mt-1 text-xs text-muted-foreground">{b.note}</p>}
                      {b.saleReceiptNo && (
                        <p className="mt-1 text-xs text-success">Billed as {b.saleReceiptNo}</p>
                      )}
                    </div>
                    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:min-w-56 sm:max-w-full sm:items-end">
                      <div className="text-right">
                        <p className="numeric text-lg font-bold">{money(b.total)}</p>
                        <p className="numeric text-xs text-muted-foreground">
                          paid {money(b.paid)}
                        </p>
                        <p className="numeric text-sm font-semibold text-primary">
                          balance {money(balance)}
                        </p>
                      </div>

                      {hasJob && b.status === "active" && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {JOB_STATUS_FLOW.map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                void changeJobStatus(b, s, balance);
                              }}
                              className={`rounded-md border px-2 py-1 text-[11px] ${
                                jobStatus === s
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {JOB_STATUS_LABELS[s]}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
                        <ActionButton
                          size="sm"
                          variant="outline"
                          layout="inline"
                          label="Print slip"
                          icon={<Printer className="size-4" />}
                          onClick={() => printBookingSlip(b, memberOf(b), state.settings.payment)}
                        />
                        {hasJob && (
                          <ActionButton
                            size="sm"
                            variant="outline"
                            layout="inline"
                            label="Job tag"
                            icon={<Tag className="size-4" />}
                            onClick={() => printJobTag(b)}
                          />
                        )}
                        {b.status === "active" && (
                          <>
                            <ActionButton
                              size="sm"
                              variant="outline"
                              layout="inline"
                              label="Part payment"
                              icon={<Banknote className="size-4" />}
                              onClick={() => void openPay(b, false)}
                            />
                            <ActionButton
                              size="sm"
                              layout="inline"
                              label={`Collect ${money(balance)}`}
                              icon={<Check className="size-4" />}
                              onClick={() => void openPay(b, true)}
                            />
                            <ActionButton
                              size="sm"
                              variant="ghost"
                              layout="inline"
                              label="Cancel"
                              icon={<Ban className="size-4" />}
                              className="text-destructive"
                              onClick={async () => {
                                if (!(await guardCancel())) return;
                                setCancelReason("");
                                setCancelling(b);
                              }}
                            />
                          </>
                        )}
                        {b.paid > 0 && b.status !== "cancelled" && (
                          <ActionButton
                            size="sm"
                            variant="outline"
                            layout="inline"
                            label="Refund"
                            icon={<Undo2 className="size-4" />}
                            onClick={async () => {
                              if (!(await requirePermission("can_process_refund"))) return;
                              setRefundFor(b);
                              setRefundAmount(b.paid.toFixed(2));
                              setRefundMethod("cash");
                              setRefundReason("");
                            }}
                          />
                        )}
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          layout="inline"
                          label="History"
                          icon={<History className="size-4" />}
                          onClick={() => setHistoryFor(b)}
                        />
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          layout="inline"
                          label="Delete job"
                          icon={<Trash2 className="size-4" />}
                          className="text-destructive"
                          onClick={async () => {
                            if (!(await guardCancel())) return;
                            setRemoving(b);
                            setRemoveReason(
                              b.status === "active" && jobStatus !== "collected"
                                ? ""
                                : "Job completed and collected",
                            );
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <TablePagination {...pager} onPage={pager.setPage} onPageSize={pager.setPageSize} label="bookings" />
      </div>

      {historyFor ? (
        <StatusHistoryDialog
          entity="booking"
          entityId={historyFor.id}
          title={historyFor.ref}
          open
          onOpenChange={(o) => !o && setHistoryFor(null)}
        />
      ) : null}

      <Dialog open={!!incidentFor} onOpenChange={(o) => !o && setIncidentFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {incidentFor?.status === "damaged" ? "Frame damaged / snapped" : "Cancel this job"} ·{" "}
              {incidentFor?.booking.ref}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>What happened?</Label>
            <Textarea
              rows={3}
              value={incidentNote}
              onChange={(e) => setIncidentNote(e.target.value)}
              placeholder="Frame cracked at 3 o'clock while tensioning the mains — customer informed."
            />
            <p className="text-[11px] text-muted-foreground">
              The note is stored on the job card and shown in the history line.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentFor(null)}>
              Back
            </Button>
            <Button
              onClick={async () => {
                if (!incidentFor) return;
                const note = incidentNote.trim();
                if (!note) {
                  toast.error("An incident note is required");
                  return;
                }
                if (!(await requirePermission("can_cancel_booking"))) return;
                const moved = await setBookingJobStatus(
                  incidentFor.booking.id,
                  incidentFor.status,
                  user?.name || incidentFor.booking.cashier || "Counter",
                  note,
                );
                if (!moved) return;
                toast.success(
                  `${incidentFor.booking.ref} · ${JOB_STATUS_LABELS[incidentFor.status].toLowerCase()}`,
                );
                setIncidentFor(null);
              }}
            >
              Record &amp; update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refundFor} onOpenChange={(o) => !o && setRefundFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund · {refundFor?.ref}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Amount to hand back</Label>
              <Input
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {money(refundFor?.paid ?? 0)} has been taken on this booking. The database refuses
                anything above that.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Refund method</Label>
              <div className="flex flex-wrap gap-2">
                {(["cash", "card", "qr", "transfer"] as PaymentMethod[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={refundMethod === m ? "default" : "outline"}
                    onClick={() => setRefundMethod(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Why is the money going back?</Label>
              <Textarea
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Customer cancelled the string upgrade after paying the deposit."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundFor(null)}>
              Back
            </Button>
            <Button
              disabled={refundBusy || refundReason.trim().length < 3}
              onClick={async () => {
                if (!refundFor) return;
                setRefundBusy(true);
                try {
                  const res = await refundBooking(
                    refundFor.id,
                    r2(Number(refundAmount || 0)),
                    refundMethod,
                    refundReason.trim(),
                  );
                  if (!res.ok) {
                    toast.error("Refund refused", { description: res.error });
                    return;
                  }
                  toast.success(
                    `${money(r2(Number(refundAmount || 0)))} refunded · paid now ${money(res.booking.paid)}`,
                  );
                  setRefundFor(null);
                } finally {
                  setRefundBusy(false);
                }
              }}
            >
              {refundBusy ? "Refunding…" : "Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel booking · {cancelling?.ref}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Why is this booking being cancelled?</Label>
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Customer changed their mind and asked for the deposit back."
            />
            <p className="text-[11px] text-muted-foreground">
              The reason, your name and the time are stored permanently against the booking and
              cannot be edited afterwards.
            </p>
            {cancelling && cancelling.paid > 0 && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label>{money(cancelling.paid)} has already been paid — what happens to it?</Label>
                <div className="flex gap-2">
                  {(["refunded", "retained"] as const).map((opt) => (
                    <Button
                      key={opt}
                      type="button"
                      size="sm"
                      variant={cancelMoney === opt ? "default" : "outline"}
                      onClick={() => setCancelMoney(opt)}
                    >
                      {opt === "refunded" ? "Refund the customer" : "Keep as a charge"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || cancelBusy}
              onClick={async () => {
                if (!cancelling) return;
                setCancelBusy(true);
                try {
                  const res = await cancelBooking(
                    cancelling.id,
                    cancelReason.trim(),
                    null,
                    cancelling.paid > 0 ? cancelMoney : null,
                  );
                  if (!res.ok) {
                    toast.error("Cancellation refused", { description: res.error });
                    return;
                  }
                  toast.success(`${cancelling.ref} cancelled · stock released`, {
                    description:
                      cancelling.paid > 0
                        ? cancelMoney === "refunded"
                          ? `${money(cancelling.paid)} refunded to the customer.`
                          : `${money(cancelling.paid)} kept as a cancellation charge.`
                        : undefined,
                  });
                  setCancelling(null);
                } finally {
                  setCancelBusy(false);
                }
              }}
            >
              {cancelBusy ? "Cancelling…" : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {settle ? "Collect & settle" : "Take part payment"} · {payFor?.ref}
            </DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-3">
              <div className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booking total</span>
                  <span className="numeric">{money(payFor.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid so far</span>
                  <span className="numeric">{money(payFor.paid)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Balance due</span>
                  <span className="numeric text-primary">
                    {money(serverDue ?? bookingBalance(payFor))}
                  </span>
                </div>
                <p className="pt-1 text-[11px] text-muted-foreground">
                  {serverDue === null
                    ? "Checking the balance with the central database…"
                    : "Balance confirmed by the central database."}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Amount received</Label>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="numeric"
                />
              </div>
              <div className="space-y-1">
                <Label>Method</Label>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {(["cash", "card", "wallet"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`flex-1 px-2 py-2 text-xs capitalize ${
                        method === m
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {settle && (
                <p className="text-xs text-muted-foreground">
                  Collecting raises the final bill, deducts the reserved stock and prints the sale
                  receipt.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button disabled={payBusy || serverDue === null} onClick={() => void submitPayment()}>
              {payBusy ? "Working…" : settle ? "Collect & print bill" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.ref}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This removes the booking and its job card for good. Tell us why so it stays on the
              activity trail.
            </p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Input
                autoFocus
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                placeholder="Job collected / booked by mistake / duplicate"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={removeReason.trim().length < 3}
              onClick={async () => {
                const target = removing;
                if (!target) return;
                try {
                  await deleteBooking(target.id, removeReason.trim());
                  setRemoving(null);
                  toast.success(`${target.ref} deleted`);
                  setRemoveReason("");
                } catch (error) {
                  toast.error("Booking was not deleted", {
                    description: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            >
              Delete job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
