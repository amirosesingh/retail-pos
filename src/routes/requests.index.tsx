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
import { usePos } from "@/lib/pos-store";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";

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
  const [scope, setScope] = useState<Scope>("all");

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    const mine = state.transfers.filter(
      (t) =>
        t.kind === "request" &&
        (t.fromStoreId === currentStore.id || t.toStoreId === currentStore.id),
    );
    if (scope === "ours") return mine.filter((t) => t.toStoreId === currentStore.id);
    if (scope === "theirs") return mine.filter((t) => t.fromStoreId === currentStore.id);
    if (scope === "open")
      return mine.filter((t) => t.status === "awaiting_approval" || t.status === "approved");
    return mine;
  }, [state.transfers, currentStore.id, scope]);
  const pagination = usePagination(rows);

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
            <Link to="/requests/new" search={{ items: undefined }}>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No stock requests yet. Raise one with “New request”.
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageItems.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.ref}</TableCell>
                  <TableCell>{storeName(t.fromStoreId)}</TableCell>
                  <TableCell>{storeName(t.toStoreId)}</TableCell>
                  <TableCell className="numeric text-right">{t.items.length}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TRANSFER_STATUS_LABELS[t.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/requests/$id" params={{ id: t.id }}>
                        <Eye className="size-4" />
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            label="requests"
            onPage={pagination.setPage}
            onPageSize={pagination.setPageSize}
          />
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Send className="size-3.5" />
          Approved requests appear as transfers on the stock movements page.
        </p>
      </div>
    </AppShell>
  );
}
