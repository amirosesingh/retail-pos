import { sameBranchId } from "@/lib/branch-id";
import { useStockTableCosts } from "@/lib/use-stock-table-costs";
import { transferTableTotals } from "@/lib/stock-table-totals";
/**
 * Stock requests register.
 *
 * The list every branch needs before it can use the request workspace: what we
 * asked other branches for, what they asked us for, and where each ask stands.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, ListPlus, Send } from "lucide-react";

import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";

export const Route = createFileRoute("/requests/")({
  head: () => ({
    meta: [
      { title: "Stock Requests — Retail" },
      {
        name: "description",
        content:
          "Every stock request raised by or sent to this branch, with its approval, dispatch and receiving status.",
      },
      { property: "og:title", content: "Stock Requests — Retail" },
      {
        property: "og:description",
        content: "Track branch-to-branch stock requests from one register.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequestsIndex,
});

type Scope = "all" | "ours" | "theirs" | "open";

function RequestsIndex() {
  const { state, stores, currentStore } = usePos();
  const showCosts = useStockTableCosts();
  const productsById = useMemo(() => new Map(state.products.map(product => [product.id, product])), [state.products]);
  const [scope, setScope] = useState<Scope>("all");

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    const mine = state.transfers.filter(
      (t) =>
        t.kind === "request" &&
        (sameBranchId(t.fromStoreId, currentStore.id) || sameBranchId(t.toStoreId, currentStore.id)),
    );
    if (scope === "ours") return mine.filter((t) => sameBranchId(t.toStoreId, currentStore.id));
    if (scope === "theirs") return mine.filter((t) => sameBranchId(t.fromStoreId, currentStore.id));
    if (scope === "open")
      return mine.filter((t) => t.status === "awaiting_approval" || t.status === "approved");
    return mine;
  }, [state.transfers, currentStore.id, scope]);

  const tabs: Array<{ id: Scope; label: string }> = [
    { id: "all", label: "All" },
    { id: "ours", label: "We asked for" },
    { id: "theirs", label: "Asked of us" },
    { id: "open", label: "Awaiting action" },
  ];

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Stock requests</h1>
            <p className="text-sm text-muted-foreground">
              Requests touching <span className="text-primary">{currentStore.name}</span>. A request
              moves no stock until the supplying branch approves and dispatches it.
            </p>
          </div>
          <Button asChild>
            <Link to="/requests/new" search={{ items: undefined, draft: undefined }}>
              <ListPlus className="size-4" />
              New request
            </Link>
          </Button>
        </header>

        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={scope === t.id ? "default" : "outline"}
              onClick={() => setScope(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border border-border">
          <Table managed summaryFormats={{ Amount: money, "Net impact": money, "Requested estimate": money, "Sent estimate": money }}>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Requested units</TableHead>
                <TableHead className="text-right">Sent units</TableHead>
                {showCosts && <TableHead className="text-right">Requested estimate</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={showCosts ? 9 : 8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No stock requests yet. Raise one with “New request”.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => {
                const totals = transferTableTotals(t.items, productsById, showCosts);
                return (
                <TableRow key={t.id} summaryValues={totals}>
                  <TableCell className="font-mono text-xs">{t.ref}</TableCell>
                  <TableCell>{storeName(t.fromStoreId)}</TableCell>
                  <TableCell>{storeName(t.toStoreId)}</TableCell>
                  <TableCell className="numeric text-right">{t.items.length}</TableCell>
                  <TableCell className="numeric text-right">{totals.Requested}</TableCell>
                  <TableCell className="numeric text-right">{totals.Sent}</TableCell>
                  {showCosts && <TableCell className="numeric text-right">{totals["Unpriced lines"] ? "Cost unavailable" : money(totals["Requested estimate"])}</TableCell>}
                  <TableCell>
                    <Badge variant="outline">{TRANSFER_STATUS_LABELS[t.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      {t.status === "draft" ? (
                        <Link to="/requests/new" search={{ items: undefined, draft: t.id }}>
                          <Eye className="size-4" />
                          Resume
                        </Link>
                      ) : (
                        <Link to="/requests/$id" params={{ id: t.id }}>
                          <Eye className="size-4" />
                          Open
                        </Link>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Send className="size-3.5" />
          Approved requests appear as transfers on the stock movements page.
        </p>
      </div>
    </AppShell>
  );
}
