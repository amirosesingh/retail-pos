import { sameBranchId } from "@/lib/branch-id";
import { useStockTableCosts } from "@/lib/use-stock-table-costs";
import { transferTableTotals } from "@/lib/stock-table-totals";
/**
 * Stock movements log.
 *
 * This page is a register, not a workspace: every action opens the dedicated
 * full-page request, transfer or receiving screen so the counting always has
 * the whole window rather than a cramped dialog.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeftRight, ClipboardCheck, Eye, Printer, Send } from "lucide-react";
import { scopeBetween } from "@/lib/stock-transfers";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
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
import { money, usePos } from "@/lib/pos-store";
import { printTransferNote } from "@/lib/pos-print";
import type { Transfer, TransferKind } from "@/core/types/pos-types";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";
import { fulfilmentLabel, statusStyle } from "@/platforms/web/components/pos/TransferWorkspace";

type TransferSearch = { items?: string; kind?: TransferKind };

export const Route = createFileRoute("/transfers/")({
  head: () => ({
    meta: [
      { title: "Stock Transfers — Retail" },
      {
        name: "description",
        content:
          "Send stock between branches or request products from another store, then approve, receive and print transfer notes.",
      },
      { property: "og:title", content: "Stock Transfers — Retail" },
      {
        property: "og:description",
        content: "Branch-to-branch stock transfers and product requests.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): TransferSearch => ({
    items: typeof search.items === "string" ? search.items : undefined,
    kind:
      search.kind === "request" ? "request" : search.kind === "transfer" ? "transfer" : undefined,
  }),
  // A basket handed over from Inventory belongs on the composer, not here.
  beforeLoad: ({ search }) => {
    if (!search.items) return;
    throw redirect({
      to: search.kind === "request" ? "/requests/new" : "/transfers/new",
      search: { items: search.items, draft: undefined },
    });
  },
  component: Transfers,
});

function Transfers() {
  const { state, stores, currentStore } = usePos();
  const showCosts = useStockTableCosts();
  const productsById = useMemo(() => new Map(state.products.map(product => [product.id, product])), [state.products]);

  const storeOf = (id: string) => stores.find((s) => s.id === id);
  const productOf = (id: string) => state.products.find((p) => p.id === id) ?? null;

  const mine = useMemo(
    () =>
      state.transfers.filter(
        (t) => sameBranchId(t.fromStoreId, currentStore.id) || sameBranchId(t.toStoreId, currentStore.id),
      ),
    [state.transfers, currentStore.id],
  );
  const [scopeTab, setScopeTab] = useState<"all" | "INTRA_GROUP" | "INTER_GROUP">("all");
  const visible = useMemo(
    () =>
      mine.filter((t) =>
        scopeTab === "all"
          ? true
          : scopeBetween(
              stores.find((s) => sameBranchId(s.id, t.fromStoreId)),
              stores.find((s) => sameBranchId(s.id, t.toStoreId)),
            ) === scopeTab,
      ),
    [mine, scopeTab, stores],
  );

  const inbound = mine.filter((t) => sameBranchId(t.toStoreId, currentStore.id) && t.status === "dispatched");
  const toVerify = mine.filter((t) => sameBranchId(t.toStoreId, currentStore.id) && t.status === "received");
  const toApprove = mine.filter(
    (t) => sameBranchId(t.fromStoreId, currentStore.id) && t.status === "awaiting_approval",
  );
  const toDispatch = mine.filter(
    (t) => sameBranchId(t.fromStoreId, currentStore.id) && t.status === "approved",
  );

  function print(t: Transfer) {
    const from = storeOf(t.fromStoreId);
    const to = storeOf(t.toStoreId);
    if (from && to) printTransferNote(t, state.products, from, to);
  }

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Stock movements</h1>
            <p className="text-sm text-muted-foreground">
              Requests and transfers touching{" "}
              <span className="text-primary">{currentStore.name}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/requests/new" search={{ items: undefined, draft: undefined }}>
                <ArrowLeftRight className="size-4" /> Request stock
              </Link>
            </Button>
            <Button asChild>
              <Link to="/transfers/new" search={{ items: undefined, draft: undefined }}>
                <Send className="size-4" /> New transfer
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Awaiting my approval" value={String(toApprove.length)} />
          <Metric label="Approved · to send" value={String(toDispatch.length)} />
          <Metric label="Incoming in transit" value={String(inbound.length)} highlight />
          <Metric
            label="Arrived · to check"
            value={String(toVerify.length)}
            highlight={toVerify.length > 0}
          />
        </div>

        <section className="rounded-lg border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-5 py-3 sm:flex sm:items-center sm:justify-between">
            <h2 className="truncate text-sm font-semibold">Movement log</h2>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "All routes"],
                  ["INTRA_GROUP", "Within my group"],
                  ["INTER_GROUP", "Between groups"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setScopeTab(key)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    scopeTab === key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Separator />
          <Table managed summaryFormats={{ Amount: money, "Net impact": money, "Requested estimate": money, "Sent estimate": money }}>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                {showCosts && <TableHead className="text-right">Requested estimate</TableHead>}
                {showCosts && <TableHead className="text-right">Sent estimate</TableHead>}
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => {
                const totals = transferTableTotals(t.items, productsById, showCosts);
                const isRequest = t.kind === "request";
                const sourceRequest = t.sourceRequestId
                  ? state.transfers.find((row) => row.id === t.sourceRequestId)
                  : null;
                const needsCount =
                  sameBranchId(t.toStoreId, currentStore.id) &&
                  (t.status === "received" || t.status === "dispatched");
                return (
                  <TableRow key={t.id} summaryValues={totals}>
                    <TableCell className="numeric">
                      {t.ref}
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </div>
                      {sourceRequest ? (
                        <div className="text-[11px] text-primary">
                          Fulfils request {sourceRequest.ref}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {t.items.map((i) => (
                          <div key={i.productId} className="text-sm">
                            {productOf(i.productId)?.name ?? "—"}
                            <span className="numeric text-muted-foreground"> × {i.qty}</span>
                            {(i.approvedQty !== undefined ||
                              i.dispatchedQty !== undefined ||
                              i.receivedQty !== undefined ||
                              i.verifiedQty !== undefined) && (
                              <span className="numeric text-[11px] text-muted-foreground">
                                {i.approvedQty !== undefined && ` · appr ${i.approvedQty}`}
                                {i.dispatchedQty !== undefined && ` · sent ${i.dispatchedQty}`}
                                {i.verifiedQty !== undefined
                                  ? ` · counted ${i.verifiedQty}`
                                  : i.receivedQty !== undefined && ` · recv ${i.receivedQty}`}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="numeric text-center">
                      {t.items.reduce((a, i) => a + i.qty, 0)}
                      <div className="text-[11px] text-muted-foreground">
                        {t.items.length} line{t.items.length > 1 ? "s" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {storeOf(t.fromStoreId)?.code} → {storeOf(t.toStoreId)?.code}
                      {scopeBetween(storeOf(t.fromStoreId), storeOf(t.toStoreId)) ===
                        "INTER_GROUP" && (
                        <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          inter-group
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyle[t.status]}>
                        {TRANSFER_STATUS_LABELS[t.status]}
                      </Badge>
                      {t.fulfilment && t.fulfilment !== "full" && (
                        <div className="text-[10px] text-warning">
                          {fulfilmentLabel[t.fulfilment]}
                        </div>
                      )}
                      {(t.rejectedReason || t.cancelledReason || t.discrepancyReason) && (
                        <div className="max-w-40 truncate text-[10px] text-muted-foreground">
                          {t.rejectedReason ?? t.cancelledReason ?? t.discrepancyReason}
                        </div>
                      )}
                    </TableCell>
                    {showCosts && <TableCell className="numeric text-right">{totals["Unpriced lines"] ? "Cost unavailable" : money(totals["Requested estimate"])}</TableCell>}
                    {showCosts && <TableCell className="numeric text-right">{totals["Unpriced lines"] ? "Cost unavailable" : money(totals["Sent estimate"])}</TableCell>}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {needsCount && !isRequest && (
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/receiving/$id" params={{ id: t.id }}>
                              <ClipboardCheck className="size-4" /> Receive
                            </Link>
                          </Button>
                        )}
                        <Button asChild size="sm" variant="ghost">
                          {t.status === "draft" ? (
                            <Link
                              to={isRequest ? "/requests/new" : "/transfers/new"}
                              search={{ items: undefined, draft: t.id }}
                            >
                              <Eye className="size-4" /> Resume
                            </Link>
                          ) : isRequest ? (
                            <Link to="/requests/$id" params={{ id: t.id }}>
                              <Eye className="size-4" /> Open
                            </Link>
                          ) : (
                            <Link to="/transfers/$id" params={{ id: t.id }}>
                              <Eye className="size-4" /> Open
                            </Link>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Print note"
                          onClick={() => print(t)}
                        >
                          <Printer className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!visible.length && (
                <TableRow>
                  <TableCell colSpan={showCosts ? 8 : 6} className="py-10 text-center text-muted-foreground">
                    No stock movements for this store yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </div>
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
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`numeric text-lg font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
