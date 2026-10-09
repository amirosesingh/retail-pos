import { sameBranchId } from "@/lib/branch-id";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
/**
 * Goods receiving register.
 *
 * Everything on its way to this branch, plus what has already been counted in.
 * Opening a line goes to the blind-count receiving workspace.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, PackageCheck } from "lucide-react";

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
import { usePos } from "@/lib/pos-store";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";

export const Route = createFileRoute("/receiving/")({
  head: () => ({
    meta: [
      { title: "Goods Receiving — Retail" },
      {
        name: "description",
        content:
          "Deliveries on their way to this branch and stock already counted in, with the blind-count receiving workspace one click away.",
      },
      { property: "og:title", content: "Goods Receiving — Retail" },
      {
        property: "og:description",
        content: "Count arriving stock in and post it to the shelf.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceivingIndex,
});

type Tab = "todo" | "done";

function ReceivingIndex() {
  const { state, stores, currentStore } = usePos();
  const [tab, setTab] = useState<Tab>("todo");

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    const inbound = state.transfers.filter((t) => sameBranchId(t.toStoreId, currentStore.id));
    return tab === "todo"
      ? inbound.filter((t) => t.status === "dispatched" || t.status === "received")
      : inbound.filter(
          (t) => t.status === "completed" || t.status === "completed_with_discrepancy",
        );
  }, [state.transfers, currentStore.id, tab]);

  const pager = usePagination(rows);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Goods receiving</h1>
            <p className="text-sm text-muted-foreground">
              Stock arriving at <span className="text-primary">{currentStore.name}</span>. Counts are
              blind: type what is physically in the box, not what the sender wrote.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={tab === "todo" ? "default" : "outline"} onClick={() => setTab("todo")}>
              To count
            </Button>
            <Button size="sm" variant={tab === "done" ? "default" : "outline"} onClick={() => setTab("done")}>
              Counted
            </Button>
          </div>
        </header>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>From</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    {tab === "todo"
                      ? "Nothing is waiting to be counted in."
                      : "No deliveries have been counted in yet."}
                  </TableCell>
                </TableRow>
              )}
              {pager.pageItems.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.ref}</TableCell>
                  <TableCell>{storeName(t.fromStoreId)}</TableCell>
                  <TableCell className="numeric text-right">{t.items.length}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TRANSFER_STATUS_LABELS[t.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant={tab === "todo" ? "default" : "ghost"}>
                      <Link to="/receiving/$id" params={{ id: t.id }}>
                        <ClipboardCheck className="size-4" />
                        {tab === "todo" ? "Count in" : "View"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...pager} onPage={pager.setPage} onPageSize={pager.setPageSize} label="receivings" />
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <PackageCheck className="size-3.5" />
          Posting a count is what puts the stock on this branch's shelf.
        </p>
      </div>
    </AppShell>
  );
}
