import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, usePos } from "@/lib/pos-store";
import { useReportSales } from "@/lib/use-report-sales";
import { PAYMENT_LABELS, paymentsLabel, type Payment, type Sale } from "@/core/types/pos-types";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadCsv,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/payments")({
  head: () => ({
    meta: [
      { title: "Cashier Payments Report — Retail" },
      {
        name: "description",
        content:
          "Every payment transaction taken by each cashier with the full tender breakdown: cash, card machine, wallet, transfer and points.",
      },
      { property: "og:title", content: "Cashier Payments Report — Retail" },
      {
        property: "og:description",
        content: "Payments per cashier with tender and card-machine breakdown.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PaymentsReport,
});

/** Tenders on a bill; single-tender bills are normalised into one line. */
const tendersOf = (s: Sale): Payment[] =>
  s.payments?.length
    ? s.payments
    : [{ id: s.id, method: s.method, amount: s.total }];

const tenderKey = (p: Payment) =>
  p.method === "card" && p.bankName?.trim()
    ? `card:${p.bankName.trim()}`
    : (p.method as string);

const tenderLabel = (key: string) =>
  key.startsWith("card:")
    ? `Card · ${key.slice(5)}`
    : (PAYMENT_LABELS[key as keyof typeof PAYMENT_LABELS] ?? key);

function PaymentsReport() {
  const { state, stores } = usePos();
  const init = defaultRange(7);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [storeId, setStoreId] = useState("all");
  const reportStoreIds = storeId === "all" ? stores.map((store) => store.id) : [storeId];
  const history = useReportSales(state.sales, reportStoreIds, from, to);
  const [cashier, setCashier] = useState("all");
  const [tender, setTender] = useState("all");
  const [q, setQ] = useState("");

  const cashiers = useMemo(
    () => [...new Set(history.sales.map((s) => s.cashier).filter(Boolean))].sort(),
    [history.sales],
  );

  const tenderOptions = useMemo(() => {
    const keys = new Set<string>();
    history.sales.forEach((s) => tendersOf(s).forEach((p) => keys.add(tenderKey(p))));
    return [...keys].sort();
  }, [history.sales]);

  const rows = useMemo(
    () =>
      history.sales
        .filter((s) => inRange(s.createdAt, from, to))
        .filter((s) => storeId === "all" || s.storeId === storeId)
        .filter((s) => cashier === "all" || s.cashier === cashier)
        .filter((s) => tender === "all" || tendersOf(s).some((p) => tenderKey(p) === tender))
        .filter((s) => {
          const needle = q.trim().toLowerCase();
          if (!needle) return true;
          return (
            s.receiptNo.toLowerCase().includes(needle) ||
            s.cashier.toLowerCase().includes(needle) ||
            paymentsLabel(tendersOf(s)).toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history.sales, from, to, storeId, cashier, tender, q],
  );

  /** Takings per cashier, split by tender. */
  const perCashier = useMemo(() => {
    const map = new Map<
      string,
      { bills: number; total: number; cash: number; card: number; other: number }
    >();
    for (const s of rows) {
      const cur =
        map.get(s.cashier) ?? { bills: 0, total: 0, cash: 0, card: 0, other: 0 };
      cur.bills += 1;
      cur.total += s.total;
      for (const p of tendersOf(s)) {
        if (p.method === "cash") cur.cash += p.amount;
        else if (p.method === "card") cur.card += p.amount;
        else cur.other += p.amount;
      }
      map.set(s.cashier, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [rows]);

  const takings = rows.reduce((a, s) => a + s.total, 0);
  const cash = perCashier.reduce((a, [, v]) => a + v.cash, 0);
  const card = perCashier.reduce((a, [, v]) => a + v.card, 0);
  const pager = usePagination(rows);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.code ?? id;

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Payments by Cashier"
          subtitle="Every payment transaction taken at the till, with the tender and card machine used."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadCsv("cashier-payments", [
              ["Time", "Bill", "Store", "Cashier", "Member", "Total", "Tenders"],
              ...rows.map((s) => [
                stamp(s.createdAt),
                s.receiptNo,
                storeName(s.storeId),
                s.cashier,
                s.memberId ?? "",
                s.total.toFixed(2),
                paymentsLabel(tendersOf(s)),
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-xs">Store</Label>
            <ThemedSelect
              value={storeId}
              onChange={setStoreId}
              ariaLabel="Filter by store"
              className="w-44"
              options={[
                { value: "all", label: "All stores" },
                ...stores.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cashier</Label>
            <ThemedSelect
              value={cashier}
              onChange={setCashier}
              ariaLabel="Filter by cashier"
              className="w-44"
              options={[
                { value: "all", label: "All cashiers" },
                ...cashiers.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tender</Label>
            <ThemedSelect
              value={tender}
              onChange={setTender}
              ariaLabel="Filter by payment method"
              className="w-48"
              options={[
                { value: "all", label: "All payment types" },
                ...tenderOptions.map((k) => ({ value: k, label: tenderLabel(k) })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="bill no, cashier, bank…"
              className="h-9 w-56"
            />
          </div>
        </ReportHeader>

        {history.loading ? <p className="text-sm text-muted-foreground">Loading complete SQL history…</p> : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Transactions" value={String(rows.length)} />
          <StatCard label="Total taken" value={money(takings)} />
          <StatCard
            label="Cash"
            value={money(cash)}
            hint={takings ? `${Math.round((cash / takings) * 100)}% of takings` : undefined}
          />
          <StatCard
            label="Card"
            value={money(card)}
            hint={takings ? `${Math.round((card / takings) * 100)}% of takings` : undefined}
          />
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-sm font-medium">Per cashier</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Taken</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">Card</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Avg basket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perCashier.map(([name, v]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name || "—"}</TableCell>
                  <TableCell className="numeric text-right">{v.bills}</TableCell>
                  <TableCell className="numeric text-right">{money(v.total)}</TableCell>
                  <TableCell className="numeric text-right">{money(v.cash)}</TableCell>
                  <TableCell className="numeric text-right">{money(v.card)}</TableCell>
                  <TableCell className="numeric text-right">{money(v.other)}</TableCell>
                  <TableCell className="numeric text-right">
                    {money(v.bills ? v.total / v.bills : 0)}
                  </TableCell>
                </TableRow>
              ))}
              {!perCashier.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No payments in this window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Tenders</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="numeric whitespace-nowrap text-xs">
                    {stamp(s.createdAt)}
                  </TableCell>
                  <TableCell className="numeric font-medium">{s.receiptNo}</TableCell>
                  <TableCell className="text-muted-foreground">{storeName(s.storeId)}</TableCell>
                  <TableCell>{s.cashier}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {tendersOf(s).map((p, i) => (
                        <Badge key={`${s.id}-${i}`} variant="outline" className="text-[10px]">
                          {tenderLabel(tenderKey(p))} {money(p.amount)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="numeric text-right">{money(s.total)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No payment transactions match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            label="transactions"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}
