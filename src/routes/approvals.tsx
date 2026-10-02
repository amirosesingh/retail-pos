/**
 * Pending approvals.
 *
 * Anyone allowed to authorise an action sees the requests waiting on them and
 * decides from their own signed-in session — no PIN, because they are already
 * authenticated. Everything decided here is written to the authorisation log.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Eye, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notifyError } from "@/lib/notify";
import { usePosOptional } from "@/lib/pos-store";
import { humanizeText } from "@/lib/human-readable";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  cancelAuthorizationRequest,
  decideAuthorizationRequest,
  listAuthorizationRequests,
} from "@/lib/authorization-client";
import {
  approvalReference,
  AUTH_ACTION_LABEL,
  type AuthorizationRequest,
} from "@/lib/authorization";
import { subscribeApprovals } from "@/lib/approval-centre";
import { syncNow } from "@/lib/sync-engine";
import { lineDiscountTotal, r2 } from "@/core/types/pos-types";
import { previewBillAfterDiscount } from "@/lib/ticket-snapshot";

export const Route = createFileRoute("/approvals")({
  component: ApprovalsPage,
  head: () => ({
    meta: [
      { title: "Pending Approvals · Till" },
      {
        name: "description",
        content:
          "Review and decide authorisation requests raised at the tills — refunds, price overrides and edits to posted records.",
      },
      { property: "og:title", content: "Pending Approvals · Till" },
      {
        property: "og:description",
        content: "Approve or reject sensitive till actions waiting on authorisation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600",
  approved: "bg-emerald-500/15 text-emerald-600",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

/** Money that never throws on a missing or malformed value. */
const money = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "0.00");

const approvalValue = (value: number | null, unit: AuthorizationRequest["valueUnit"]) => {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "percent") return `${money(value)}%`;
  if (unit === "quantity") return `${value} item${value === 1 ? "" : "s"}`;
  if (unit === "currency") return `$${money(value)}`;
  return money(value);
};

function requestBillNumber(row: AuthorizationRequest): string {
  return (
    row.snapshot?.billNo ||
    String(row.approvedPayload["bill_no"] ?? row.payload["bill_no"] ?? "") ||
    "Draft bill"
  );
}

function approvalOutcome(row: AuthorizationRequest) {
  const grant =
    row.status === "approved"
      ? (row.approvedAmount ?? row.requestedAmount)
      : row.status === "pending"
        ? row.requestedAmount
        : null;
  const type =
    row.approvedPayload["discount_type"] === "percent" ||
    row.payload["discount_type"] === "percent" ||
    row.valueUnit === "percent"
      ? "percent"
      : "amount";
  const scope = String(
    row.approvedPayload["discount_scope"] ?? row.payload["discount_scope"] ?? "",
  );
  const snapshot = row.snapshot;
  if (!snapshot || grant === null) return { grant, after: null as number | null };
  if (scope === "bill") {
    return { grant, after: previewBillAfterDiscount(snapshot, grant, type) };
  }
  const index = Number(row.approvedPayload["target_index"] ?? row.payload["target_index"]);
  const line = Number.isInteger(index) ? snapshot.lines[index] : undefined;
  if (!line) return { grant, after: null as number | null };
  return {
    grant,
    after: r2(
      Math.abs(line.unitPrice * line.qty) -
        lineDiscountTotal({
          price: line.unitPrice,
          qty: line.qty,
          discount: grant,
          discountType: type,
        }),
    ),
  };
}

const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
};

function ApprovalsPage() {
  const pos = usePosOptional();
  const storeId = pos?.currentStore?.id ?? "";
  const [rows, setRows] = useState<AuthorizationRequest[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [allBranches, setAllBranches] = useState(false);
  const [history, setHistory] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  // What the approver is granting, when it differs from what was asked.
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [amountMode, setAmountMode] = useState<Record<string, "total" | "extra">>({});
  const [amountInvalid, setAmountInvalid] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const orderedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const statusOrder = Number(a.status !== "pending") - Number(b.status !== "pending");
        return statusOrder || b.createdAt.localeCompare(a.createdAt);
      }),
    [rows],
  );
  const firstDecided = orderedRows.findIndex((row) => row.status !== "pending");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await getPosCallerAuth();
      const res = await listAuthorizationRequests({
        data: {
          ...auth,
          storeId,
          allBranches,
          status: history ? "all" : "pending",
        },
      });
      setError(res.ok ? "" : (res.error ?? ""));
      // A refused reply may carry no list at all; never hand undefined on.
      setRows(Array.isArray(res.requests) ? (res.requests as AuthorizationRequest[]) : []);
      setMe(res.ok ? (res.me ?? null) : null);
    } catch (e) {
      setRows([]);
      setError((e as Error).message);
    }
    setLoading(false);
  }, [storeId, allBranches, history]);

  useEffect(() => {
    void load();
  }, [load]);

  // The queue is decided from another screen, so it refreshes on its own and
  // whenever this window is looked at again.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    const unsubscribe = subscribeApprovals(() => void load());
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [load]);

  const decide = async (row: AuthorizationRequest, approve: boolean) => {
    setBusy(row.id);
    try {
      if (approve && amountInvalid[row.id]) {
        toast.error("Enter a valid approval amount");
        setBusy(null);
        return;
      }
      const rawAmount = (amount[row.id] ?? "").trim();
      const enteredAmount = rawAmount === "" ? null : Number(rawAmount);
      const approvedAmount =
        enteredAmount === null
          ? null
          : amountMode[row.id] === "extra" && row.requesterDirectLimit !== null
            ? row.requesterDirectLimit + enteredAmount
            : enteredAmount;
      if (
        approve &&
        approvedAmount !== null &&
        (!Number.isFinite(approvedAmount) || approvedAmount < 0)
      ) {
        toast.error("Enter a valid approval amount");
        setBusy(null);
        return;
      }
      const auth = await getPosCallerAuth();
      const res = await decideAuthorizationRequest({
        data: {
          ...auth,
          id: row.id,
          approve,
          note: note[row.id] ?? "",
          // Blank means "as requested"; a number here grants a different value.
          ...(approve && approvedAmount !== null ? { approvedAmount } : {}),
        },
      });
      if (!res.ok) toast.error(res.error ?? "Could not record the decision");
      else {
        toast.success(approve ? "Approved" : "Rejected");
        // The cloud decision is complete. The local mirror catches up without
        // holding the approver on this screen.
        void syncNow(`approval-decision:${row.id}`);
      }
      await load();
    } catch (e) {
      notifyError(e, "Could not record the decision");
    }
    setBusy(null);
  };

  const withdraw = async (row: AuthorizationRequest) => {
    setBusy(row.id);
    try {
      const auth = await getPosCallerAuth();
      const res = await cancelAuthorizationRequest({ data: { ...auth, id: row.id } });
      if (!res.ok) toast.error(res.error ?? "Could not cancel");
      else void syncNow(`approval-cancelled:${row.id}`);
      await load();
    } catch (e) {
      notifyError(e, "Could not cancel");
    }
    setBusy(null);
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Pending approvals</h1>
            <p className="text-sm text-muted-foreground">
              Actions waiting on someone who is allowed to authorise them.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="all-branches"
                checked={allBranches}
                onCheckedChange={setAllBranches}
                disabled={me?.role !== "admin"}
              />
              <Label htmlFor="all-branches" className="text-xs">
                All branches
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </header>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Clock3 className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {history
                  ? "No approval requests have been recorded for this branch."
                  : "Nothing is waiting for a decision right now."}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {orderedRows.map((row, index) => {
          const mine = !!me && row.requestedBy.toLowerCase() === me.id.toLowerCase();
          const payload = Object.entries(row.payload ?? {});
          const outcome = approvalOutcome(row);
          return (
            <Fragment key={row.id}>
              {index === firstDecided ? (
                <div className="mt-6 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <div>
                    <p className="text-sm font-semibold">Decided approvals</p>
                    <p className="text-xs text-muted-foreground">
                      Completed decisions are kept below as bill-linked approval certificates.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setHistory(false)}>
                    Hide decided
                  </Button>
                </div>
              ) : null}
              <Dialog
                open={openRequestId === row.id}
                onOpenChange={(open) => setOpenRequestId(open ? row.id : null)}
              >
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <div>
                    <CardTitle className="text-base">
                      {AUTH_ACTION_LABEL[row.actionKey] ?? row.actionKey}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {approvalReference(row)} · {row.requestedByName || "Staff member"} ·{" "}
                      {pos?.stores.find((store) => store.id === row.storeId)?.name ??
                        "All branches"}{" "}
                      · {ago(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Open ${row.status} approval details`}
                      onClick={() => setOpenRequestId(row.id)}
                    >
                      <Badge className={STATUS_TONE[row.status] ?? ""} variant="secondary">
                        {row.status}
                      </Badge>
                    </button>
                    <Button variant="outline" size="sm" onClick={() => setOpenRequestId(row.id)}>
                      <Eye className="mr-1 size-4" /> View details
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-2 pt-0 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Bill number</p>
                    <p className="font-semibold">{requestBillNumber(row)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Purpose</p>
                    <p className="font-semibold">{row.reason || "No reason provided"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {row.status === "pending" ? "Requested" : "Decision"}
                    </p>
                    <p className="font-semibold text-primary">
                      {row.status === "approved"
                        ? `Approved ${approvalValue(outcome.grant, row.valueUnit)}`
                        : row.status === "pending"
                          ? approvalValue(row.requestedAmount, row.valueUnit)
                          : row.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">After discount</p>
                    <p className="font-semibold">
                      {outcome.after === null ? "—" : `$${money(outcome.after)}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>
                    {AUTH_ACTION_LABEL[row.actionKey] ?? row.actionKey} · {row.status}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {row.reason ? <p className="text-sm">“{row.reason}”</p> : null}
                  <dl className="grid gap-x-4 gap-y-1 rounded-md border border-border/60 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Approval number</dt>
                      <dd className="font-mono font-semibold">{approvalReference(row)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Request ID</dt>
                      <dd className="break-all font-mono">{row.id}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Created</dt>
                      <dd>{new Date(row.createdAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Expires</dt>
                      <dd>{new Date(row.expiresAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Terminal</dt>
                      <dd>{row.terminalId || "—"}</dd>
                    </div>
                    {row.decidedAt ? (
                      <div>
                        <dt className="text-muted-foreground">Decision time</dt>
                        <dd>{new Date(row.decidedAt).toLocaleString()}</dd>
                      </div>
                    ) : null}
                    {row.consumedAt ? (
                      <div>
                        <dt className="text-muted-foreground">Grant used</dt>
                        <dd>{new Date(row.consumedAt).toLocaleString()}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {row.approvalRoute ? <ApprovalRouteReview row={row} /> : null}
                  {payload.length ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/50 p-3 text-xs">
                      {payload.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                          <dd className="font-medium">
                            {humanizeText(String(v), {
                              stores: pos?.stores,
                              products: pos?.state.products,
                              members: pos?.state.members,
                              sales: pos?.state.sales,
                            })}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <ApprovalAmountReview
                    row={row}
                    draft={amount[row.id] ?? ""}
                    mode={amountMode[row.id] ?? "total"}
                  />
                  <TicketReview row={row} />
                  {row.status === "pending" ? (
                    mine ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          Waiting for someone else to decide this.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === row.id}
                          onClick={() => void withdraw(row)}
                        >
                          Withdraw
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-md border border-border/60 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`approval-note-${row.id}`} className="text-xs">
                              Decision note
                            </Label>
                            <Input
                              id={`approval-note-${row.id}`}
                              className="h-9"
                              placeholder="Optional note for the cashier"
                              value={note[row.id] ?? ""}
                              onChange={(e) =>
                                setNote((n) => ({ ...n, [row.id]: e.target.value.slice(0, 400) }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Label htmlFor={`approval-amount-${row.id}`} className="text-xs">
                                {(amountMode[row.id] ?? "total") === "extra"
                                  ? "Extra above cashier limit"
                                  : "Total approval to grant"}
                              </Label>
                              <div className="flex rounded-md border border-border p-0.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    (amountMode[row.id] ?? "total") === "total"
                                      ? "secondary"
                                      : "ghost"
                                  }
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() =>
                                    setAmountMode((current) => ({ ...current, [row.id]: "total" }))
                                  }
                                >
                                  Total
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={amountMode[row.id] === "extra" ? "secondary" : "ghost"}
                                  className="h-6 px-2 text-[11px]"
                                  disabled={row.requesterDirectLimit === null}
                                  onClick={() =>
                                    setAmountMode((current) => ({ ...current, [row.id]: "extra" }))
                                  }
                                >
                                  Extra
                                </Button>
                              </div>
                            </div>
                            <Input
                              id={`approval-amount-${row.id}`}
                              className="h-9"
                              type="number"
                              min="0"
                              step="any"
                              placeholder={
                                (amountMode[row.id] ?? "total") === "extra"
                                  ? approvalValue(
                                      row.requestedAmount !== null &&
                                        row.requesterDirectLimit !== null
                                        ? Math.max(
                                            0,
                                            row.requestedAmount - row.requesterDirectLimit,
                                          )
                                        : null,
                                      row.valueUnit,
                                    )
                                  : typeof row.requestedAmount === "number"
                                    ? approvalValue(row.requestedAmount, row.valueUnit)
                                    : "No amount requested"
                              }
                              value={amount[row.id] ?? ""}
                              aria-invalid={amountInvalid[row.id] || undefined}
                              onChange={(e) => {
                                const value = e.target.value;
                                const invalid = e.target.validity.badInput || value.length > 12;
                                setAmountInvalid((current) => ({ ...current, [row.id]: invalid }));
                                setAmount((current) => ({
                                  ...current,
                                  [row.id]: value,
                                }));
                              }}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Leave blank to grant the requested total. The extra above the
                              cashier's limit is shown above.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={busy === row.id || Boolean(amountInvalid[row.id])}
                            onClick={() => void decide(row, true)}
                          >
                            <Check className="mr-1 size-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === row.id}
                            onClick={() => void decide(row, false)}
                          >
                            <X className="mr-1 size-4" /> Reject
                          </Button>
                        </div>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {row.decidedByName || row.decidedBy
                        ? `${row.status} by ${row.decidedByName || row.decidedBy}`
                        : row.status}
                      {row.decisionNote ? ` — ${row.decisionNote}` : ""}
                      {typeof row.requestedAmount === "number"
                        ? ` · asked ${approvalValue(row.requestedAmount, row.valueUnit)}`
                        : ""}
                      {typeof row.approvedAmount === "number"
                        ? ` · granted ${approvalValue(row.approvedAmount, row.valueUnit)}`
                        : ""}
                      {row.consumedAt ? " · used" : ""}
                    </p>
                  )}
                </div>
              </DialogContent>
              </Dialog>
            </Fragment>
          );
        })}

        {firstDecided < 0 ? (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
            <div>
              <p className="text-sm font-semibold">Decided approvals</p>
              <p className="text-xs text-muted-foreground">
                {history
                  ? "No decided approvals were found for this branch."
                  : "Open the completed decision history and its bill-linked details."}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHistory((value) => !value)}>
              {history ? "Hide decided" : "Include decided"}
            </Button>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function ApprovalAmountReview({
  row,
  draft,
  mode,
}: {
  row: AuthorizationRequest;
  draft: string;
  mode: "total" | "extra";
}) {
  const typed = draft.trim() === "" ? null : Number(draft);
  const entered =
    typed === null
      ? row.requestedAmount
      : mode === "extra" && row.requesterDirectLimit !== null
        ? row.requesterDirectLimit + typed
        : typed;
  const grant = entered !== null && Number.isFinite(entered) ? entered : null;
  const extraRequested =
    row.requestedAmount !== null && row.requesterDirectLimit !== null
      ? Math.max(0, row.requestedAmount - row.requesterDirectLimit)
      : null;
  const extraGrant =
    grant !== null && row.requesterDirectLimit !== null
      ? Math.max(0, grant - row.requesterDirectLimit)
      : null;
  const snapshot = row.snapshot;
  const scope = String(row.payload["discount_scope"] ?? "");
  const type =
    row.payload["discount_type"] === "percent" || row.valueUnit === "percent"
      ? "percent"
      : "amount";
  const requestedIndex = Number(row.payload["target_index"]);
  const targetLine =
    snapshot && Number.isInteger(requestedIndex) ? snapshot.lines[requestedIndex] : undefined;
  const lineAfter =
    targetLine && grant !== null
      ? r2(
          Math.abs(targetLine.unitPrice * targetLine.qty) -
            lineDiscountTotal({
              price: targetLine.unitPrice,
              qty: targetLine.qty,
              discount: grant,
              discountType: type,
            }),
        )
      : null;
  const unitAfter =
    targetLine && lineAfter !== null && Math.abs(targetLine.qty) > 0
      ? r2(lineAfter / Math.abs(targetLine.qty))
      : null;
  const billAfter =
    snapshot && scope === "bill" && grant !== null
      ? previewBillAfterDiscount(snapshot, grant, type)
      : null;
  return (
    <div className="space-y-2">
      <dl className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Requested total</dt>
          <dd className="font-semibold">{approvalValue(row.requestedAmount, row.valueUnit)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cashier's current limit</dt>
          <dd className="font-semibold">
            {approvalValue(row.requesterDirectLimit, row.valueUnit)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {row.status === "pending" ? "Extra requested" : "Approved total"}
          </dt>
          <dd className="font-semibold text-primary">
            {approvalValue(
              row.status === "pending" ? extraRequested : row.approvedAmount,
              row.valueUnit,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {row.status === "pending" ? "Extra being granted" : "Extra approved"}
          </dt>
          <dd className="font-semibold text-primary">
            {approvalValue(
              row.status === "pending"
                ? extraGrant
                : row.approvedAmount !== null && row.requesterDirectLimit !== null
                  ? Math.max(0, row.approvedAmount - row.requesterDirectLimit)
                  : null,
              row.valueUnit,
            )}
          </dd>
        </div>
      </dl>
      {targetLine && unitAfter !== null && lineAfter !== null ? (
        <dl className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Approved item</dt>
            <dd className="font-semibold">{targetLine.name || targetLine.sku || "Item"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Quantity · original unit</dt>
            <dd className="font-semibold">
              {targetLine.qty} × {money(targetLine.unitPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Unit after approval</dt>
            <dd className="font-semibold text-primary">{money(unitAfter)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Line after approval</dt>
            <dd className="font-semibold text-primary">{money(lineAfter)}</dd>
          </div>
        </dl>
      ) : billAfter !== null ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          Bill total after this approval:{" "}
          <strong className="text-primary">{money(billAfter)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalRouteReview({ row }: { row: AuthorizationRequest }) {
  const route = row.approvalRoute;
  if (!route) return null;
  const primary = route.primaryApprovers.map((person) => `${person.name} (${person.role})`);
  const escalation = route.escalationApprovers.map((person) => `${person.name} (${person.role})`);
  const escalatesAt =
    route.escalationAfterMinutes && route.escalationAfterMinutes > 0
      ? new Date(Date.parse(row.createdAt) + route.escalationAfterMinutes * 60_000).toLocaleString()
      : null;
  return (
    <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 p-3 text-xs sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">Routed approvers</dt>
        <dd>{primary.join(", ") || "No eligible approver recorded"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Configured approver roles</dt>
        <dd>{route.primaryRoles.join(", ") || "Named users only"}</dd>
      </div>
      {escalatesAt ? (
        <>
          <div>
            <dt className="text-muted-foreground">Escalation eligible</dt>
            <dd>{escalatesAt}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Escalation route</dt>
            <dd>{escalation.join(", ") || route.escalationRoles.join(", ") || "Not configured"}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}

/**
 * The whole ticket the cashier was ringing when the request was sent, so the
 * approver decides on what they can see rather than a bare number.
 */
function TicketReview({ row }: { row: AuthorizationRequest }) {
  const t = row.snapshot;
  if (!t)
    return (
      <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
        This request was created without a bill snapshot. Its action, reason, amounts and audit
        details remain available above.
      </p>
    );
  const lines = Array.isArray(t.lines) ? t.lines : [];
  return (
    <div className="rounded-md border border-border/60">
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-sm font-semibold">Bill {t.billNo || t.ticketId || "—"}</p>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Bill number</dt>
            <dd>{t.billNo || "Draft bill"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ticket ID</dt>
            <dd className="break-all">{t.ticketId || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cashier</dt>
            <dd>{t.cashier || row.requestedByName || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Captured</dt>
            <dd>{new Date(t.capturedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Store ID</dt>
            <dd className="break-all">{t.storeId || row.storeId || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Terminal ID</dt>
            <dd className="break-all">{t.terminalId || row.terminalId || "—"}</dd>
          </div>
          {row.heldOrderId ? (
            <div>
              <dt className="text-muted-foreground">Held order</dt>
              <dd className="break-all">{row.heldOrderId}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="border-b border-border/60 px-3 py-2 text-xs">
        <p className="mb-2 font-medium">Member</p>
        {t.member ? (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Member ID</dt>
              <dd className="break-all">{t.member.id || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Member code</dt>
              <dd>{t.member.code || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd>{t.member.name || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tier</dt>
              <dd>{t.member.tier || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Phone (masked)</dt>
              <dd>{t.member.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email (masked)</dt>
              <dd className="break-all">{t.member.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Points</dt>
              <dd>{t.member.points ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total spend</dt>
              <dd>{t.member.totalSpend === undefined ? "—" : money(t.member.totalSpend)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">Walk-in customer — no member was attached.</p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-3 py-1 text-left font-normal">Item</th>
              <th className="px-3 py-1 text-right font-normal">Qty</th>
              <th className="px-3 py-1 text-right font-normal">Price</th>
              <th className="px-3 py-1 text-right font-normal">Disc</th>
              <th className="px-3 py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length ? (
              lines.map((l, i) => (
                <tr key={`${l.sku}-${i}`} className="border-t border-border/40">
                  <td className="px-3 py-1">
                    <span className="font-medium">{l.name || l.sku || "Unknown item"}</span>
                    {l.sku ? (
                      <span className="block text-[10px] text-muted-foreground">{l.sku}</span>
                    ) : null}
                    {l.priceOverridden ? " · price changed" : ""}
                  </td>
                  <td className="px-3 py-1 text-right">{l.qty}</td>
                  <td className="px-3 py-1 text-right">{money(l.unitPrice)}</td>
                  <td className="px-3 py-1 text-right">{money(l.discount)}</td>
                  <td className="px-3 py-1 text-right">{money(l.lineTotal)}</td>
                </tr>
              ))
            ) : (
              <tr className="border-t border-border/40">
                <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                  No cart lines were recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-4 border-t border-border/60 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Subtotal {money(t.subtotal)}</span>
        <span className="text-muted-foreground">Discount {money(t.discount)}</span>
        <span className="text-muted-foreground">Tax {money(t.tax)}</span>
        {t.serviceCharge ? (
          <span className="text-muted-foreground">Service {money(t.serviceCharge)}</span>
        ) : null}
        <span className="font-medium">Total {money(t.total)}</span>
        {typeof t.expectedTotal === "number" ? (
          <span className="font-medium text-primary">If approved {money(t.expectedTotal)}</span>
        ) : null}
      </div>
      {t.requestedLabel ? (
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          Approval subject: <span className="font-medium text-foreground">{t.requestedLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
