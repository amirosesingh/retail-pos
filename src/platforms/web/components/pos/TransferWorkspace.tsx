/**
 * Shared furniture for the full-page stock request, transfer and receiving
 * workspaces.
 *
 * These screens all describe the same underlying note from a different angle,
 * so the header, the fact grid, the line table and the record lookup live
 * here once. Nothing in this file writes: it reads the record out of the till
 * state, falls back to a direct database read for a deep link the till has
 * not cached, and lays it out.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePos, stockAt } from "@/lib/pos-store";
import { loadTransfer } from "@/lib/stock-transfers";
import { TRANSFER_STATUS_LABELS, type Transfer } from "@/core/types/pos-types";

export const statusStyle: Record<string, string> = {
  draft: "border-muted-foreground/40 text-muted-foreground",
  awaiting_approval: "border-warning/50 text-warning",
  approved: "border-sky-500/50 text-sky-600 dark:text-sky-400",
  dispatched: "border-primary/50 text-primary",
  received: "border-sky-500/50 text-sky-600 dark:text-sky-400",
  completed: "border-success/50 text-success",
  completed_with_discrepancy: "border-warning/50 text-warning",
  rejected: "border-destructive/50 text-destructive",
  cancelled: "border-destructive/50 text-destructive",
};

export const fulfilmentLabel: Record<string, string> = {
  full: "sent in full",
  partial: "part sent",
  none: "nothing sent",
};

export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * The note for this page: from till state when it is there — so actions and
 * live updates work — otherwise fetched once so a refresh or a shared link
 * still shows the real record.
 */
export function useTransferRecord(id: string) {
  const { state } = usePos();
  const inState = state.transfers.find((t) => t.id === id) ?? null;
  const [fetched, setFetched] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (inState) return;
    let live = true;
    setLoading(true);
    void loadTransfer(id).then((t) => {
      if (!live) return;
      setFetched(t);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id, inState]);

  return {
    transfer: inState ?? fetched,
    /** Actions only run against a note the till is holding. */
    live: Boolean(inState),
    loading: !inState && loading,
  };
}

export function WorkspaceHeader({
  back,
  backLabel,
  title,
  subtitle,
  status,
  fulfilment,
  actions,
}: {
  back: string;
  backLabel: string;
  title: string;
  subtitle?: React.ReactNode;
  status?: Transfer["status"];
  fulfilment?: Transfer["fulfilment"];
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <Link
          to={back as "/transfers"}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="numeric text-2xl font-semibold">{title}</h1>
          {status && (
            <Badge variant="outline" className={statusStyle[status]}>
              {TRANSFER_STATUS_LABELS[status]}
            </Badge>
          )}
          {fulfilment && fulfilment !== "full" && (
            <span className="text-xs text-warning">{fulfilmentLabel[fulfilment]}</span>
          )}
        </div>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card ${className ?? ""}`}>
      <div className="px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Separator />
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Every quantity a line has picked up, side by side. */
export function LineLedger({ transfer }: { transfer: Transfer }) {
  const { state } = usePos();
  const nameOf = (id: string) => state.products.find((p) => p.id === id)?.name ?? "Unknown item";
  const productOf = (id: string) => state.products.find((p) => p.id === id) ?? null;
  const totals = useMemo(
    () =>
      transfer.items.reduce(
        (a, i) => ({
          asked: a.asked + i.qty,
          approved: a.approved + (i.approvedQty ?? 0),
          sent: a.sent + (i.dispatchedQty ?? 0),
          counted: a.counted + (i.verifiedQty ?? 0),
        }),
        { asked: 0, approved: 0, sent: 0, counted: 0 },
      ),
    [transfer],
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Requested</TableHead>
          <TableHead className="text-right">Approved</TableHead>
          <TableHead className="text-right">Sent</TableHead>
          <TableHead className="text-right">Counted</TableHead>
          <TableHead className="text-right">Shortfall</TableHead>
          <TableHead className="text-right">On hand here</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transfer.items.map((i) => {
          const p = productOf(i.productId);
          const settled = i.verifiedQty ?? i.dispatchedQty;
          const shortfall = settled === undefined ? undefined : Math.max(0, i.qty - settled);
          return (
            <TableRow key={i.productId}>
              <TableCell>
                <div className="text-sm">{nameOf(i.productId)}</div>
                <div className="numeric text-[11px] text-muted-foreground">
                  {p?.barcode || p?.sku || "no code"}
                </div>
              </TableCell>
              <TableCell className="numeric text-right">{i.qty}</TableCell>
              <TableCell className="numeric text-right">{i.approvedQty ?? "—"}</TableCell>
              <TableCell className="numeric text-right">{i.dispatchedQty ?? "—"}</TableCell>
              <TableCell className="numeric text-right">{i.verifiedQty ?? "—"}</TableCell>
              <TableCell
                className={`numeric text-right ${shortfall ? "text-warning" : "text-muted-foreground"}`}
              >
                {shortfall === undefined ? "—" : shortfall}
              </TableCell>
              <TableCell className="numeric text-right text-muted-foreground">
                {p ? stockAt(p, transfer.toStoreId) : 0}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow>
          <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
            Total
          </TableCell>
          <TableCell className="numeric text-right font-semibold">{totals.asked}</TableCell>
          <TableCell className="numeric text-right font-semibold">
            {totals.approved || "—"}
          </TableCell>
          <TableCell className="numeric text-right font-semibold">{totals.sent || "—"}</TableCell>
          <TableCell className="numeric text-right font-semibold">
            {totals.counted || "—"}
          </TableCell>
          <TableCell />
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function NotFoundNote({ back, backLabel }: { back: string; backLabel: string }) {
  return (
    <div className="space-y-3 p-10 text-center">
      <p className="text-sm text-muted-foreground">
        That record could not be found. It may belong to another branch, or the till has not synced
        it yet.
      </p>
      <Link to={back as "/transfers"} className="text-sm text-primary underline">
        {backLabel}
      </Link>
    </div>
  );
}
