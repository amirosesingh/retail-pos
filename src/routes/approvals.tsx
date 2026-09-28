/**
 * Pending approvals.
 *
 * Anyone allowed to authorise an action sees the requests waiting on them and
 * decides from their own signed-in session — no PIN, because they are already
 * authenticated. Everything decided here is written to the authorisation log.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/lib/notify";
import { usePosOptional } from "@/lib/pos-store";
import { humanizeText } from "@/lib/human-readable";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  cancelAuthorizationRequest,
  decideAuthorizationRequest,
  listAuthorizationRequests,
} from "@/lib/authorization-client";
import { AUTH_ACTION_LABEL, type AuthorizationRequest } from "@/lib/authorization";
import { subscribeApprovals } from "@/lib/approval-centre";
import { syncNow } from "@/lib/sync-engine";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      const auth = await getPosCallerAuth();
      const res = await decideAuthorizationRequest({
        data: {
          ...auth,
          id: row.id,
          approve,
          note: note[row.id] ?? "",
          // Blank means "as requested"; a number here grants a different value.
          ...(approve && (amount[row.id] ?? "").trim() !== ""
            ? { approvedAmount: Number(amount[row.id]) }
            : {}),
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
              <Switch id="all-branches" checked={allBranches} onCheckedChange={setAllBranches} />
              <Label htmlFor="all-branches" className="text-xs">
                All branches
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="history" checked={history} onCheckedChange={setHistory} />
              <Label htmlFor="history" className="text-xs">
                Include decided
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
                Nothing is waiting for a decision right now.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {rows.map((row) => {
          const mine = !!me && row.requestedBy.toLowerCase() === me.id.toLowerCase();
          const payload = Object.entries(row.payload ?? {});
          return (
            <Card key={row.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <div>
                  <CardTitle className="text-base">
                    {AUTH_ACTION_LABEL[row.actionKey] ?? row.actionKey}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {row.requestedByName || "Staff member"} ·{" "}
                    {pos?.stores.find((store) => store.id === row.storeId)?.name ?? "All branches"}{" "}
                    · {ago(row.createdAt)}
                  </p>
                </div>
                <Badge className={STATUS_TONE[row.status] ?? ""} variant="secondary">
                  {row.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {row.reason ? <p className="text-sm">“{row.reason}”</p> : null}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-9 flex-1 min-w-[12rem]"
                        placeholder="Note (optional)"
                        value={note[row.id] ?? ""}
                        onChange={(e) =>
                          setNote((n) => ({ ...n, [row.id]: e.target.value.slice(0, 400) }))
                        }
                      />
                      <Input
                        className="h-9 w-36"
                        inputMode="decimal"
                        placeholder={
                          typeof row.requestedAmount === "number"
                            ? `Approve ${money(row.requestedAmount)}`
                            : "Amount (optional)"
                        }
                        value={amount[row.id] ?? ""}
                        onChange={(e) =>
                          setAmount((a) => ({
                            ...a,
                            [row.id]: e.target.value.replace(/[^0-9.]/g, "").slice(0, 12),
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        disabled={busy === row.id}
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
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {row.decidedByName || row.decidedBy
                      ? `${row.status} by ${row.decidedByName || row.decidedBy}`
                      : row.status}
                    {row.decisionNote ? ` — ${row.decisionNote}` : ""}
                    {typeof row.requestedAmount === "number"
                      ? ` · asked ${money(row.requestedAmount)}`
                      : ""}
                    {typeof row.approvedAmount === "number"
                      ? ` · granted ${money(row.approvedAmount)}`
                      : ""}
                    {row.consumedAt ? " · used" : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

/**
 * The whole ticket the cashier was ringing when the request was sent, so the
 * approver decides on what they can see rather than a bare number.
 */
function TicketReview({ row }: { row: AuthorizationRequest }) {
  const t = row.snapshot;
  if (!t) return null;
  const lines = Array.isArray(t.lines) ? t.lines : [];
  return (
    <div className="rounded-md border border-border/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <span className="font-medium">
          Ticket {t.billNo || t.ticketId || "—"} · {t.cashier || row.requestedByName}
        </span>
        {t.member ? (
          <span className="text-muted-foreground">
            Member {t.member.name}
            {t.member.tier ? ` · ${t.member.tier}` : ""}
            {t.member.points !== undefined ? ` · ${t.member.points} pts` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">Walk-in</span>
        )}
      </div>
      <table className="w-full text-xs">
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
          {lines.map((l, i) => (
            <tr key={`${l.sku}-${i}`} className="border-t border-border/40">
              <td className="px-3 py-1">
                {l.name || l.sku}
                {l.priceOverridden ? " · price changed" : ""}
              </td>
              <td className="px-3 py-1 text-right">{l.qty}</td>
              <td className="px-3 py-1 text-right">{money(l.unitPrice)}</td>
              <td className="px-3 py-1 text-right">{money(l.discount)}</td>
              <td className="px-3 py-1 text-right">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap justify-end gap-4 border-t border-border/60 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Subtotal {money(t.subtotal)}</span>
        <span className="text-muted-foreground">Discount {money(t.discount)}</span>
        <span className="text-muted-foreground">Tax {money(t.tax)}</span>
        <span className="font-medium">Total {money(t.total)}</span>
        {typeof t.expectedTotal === "number" ? (
          <span className="font-medium text-primary">If approved {money(t.expectedTotal)}</span>
        ) : null}
      </div>
      {typeof row.requestedAmount === "number" ? (
        <p className="border-t border-border/60 px-3 py-2 text-xs">
          Requested{t.requestedLabel ? ` ${t.requestedLabel}` : ""}:{" "}
          <span className="font-medium">{money(row.requestedAmount)}</span>
          {typeof row.approvedAmount === "number" && row.approvedAmount !== row.requestedAmount ? (
            <span className="text-primary"> · granted {money(row.approvedAmount)}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
