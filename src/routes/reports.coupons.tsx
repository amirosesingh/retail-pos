import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { useAuditLogs } from "@/lib/audit-log";
import { useReportSales } from "@/lib/use-report-sales";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadCsv,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/coupons")({
  head: () => ({
    meta: [
      { title: "Coupon Usage Report — Retail" },
      {
        name: "description",
        content:
          "Track every coupon applied at the till: the code, whether it hit the whole bill or one item, the value taken off and the exact timestamp.",
      },
      { property: "og:title", content: "Coupon Usage Report — Retail" },
      { property: "og:description", content: "Bill-level and item-level coupon audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CouponReport,
});

type Row = {
  at: string;
  code: string;
  scope: string;
  target: string;
  value: number;
  receipt: string;
  staff: string;
  status: string;
  partner: string;
  storeId: string;
};

const ALL = "__all__";
const UNATTRIBUTED = "Unattributed";

function CouponReport() {
  const { state, stores } = usePos();
  const logs = useAuditLogs();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [codeQuery, setCodeQuery] = useState("");
  const [partner, setPartner] = useState(ALL);
  const [scope, setScope] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [staff, setStaff] = useState(ALL);
  const [store, setStore] = useState(ALL);
  const reportStoreIds = store === ALL ? stores.map((row) => row.id) : [store];
  const history = useReportSales(state.sales, reportStoreIds, from, to);

  /** Resolve a coupon back to the promotion that issued it, then its partner. */
  const partnerOf = useMemo(() => {
    const byId = new Map(state.promotions.map((p) => [p.id, p.partner?.trim() || ""]));
    const byName = new Map(
      state.promotions.map((p) => [p.name.trim().toLowerCase(), p.partner?.trim() || ""]),
    );
    return (promoId: string | undefined, code: string) => {
      const hit =
        (promoId ? byId.get(promoId) : "") || byName.get((code || "").trim().toLowerCase()) || "";
      return hit || UNATTRIBUTED;
    };
  }, [state.promotions]);

  const allRows = useMemo<Row[]>(() => {
    // Applications, removals and item-level hits come from the audit trail.
    const events: Row[] = logs
      .filter((l) => l.category === "discount" && /coupon/i.test(l.action))
      .filter((l) => inRange(l.at, from, to))
      .map((l) => {
        const d = l.details as Record<string, unknown>;
        const code = String(d.coupon ?? "—");
        return {
          at: l.at,
          code,
          scope: String(d.scope ?? "bill"),
          target: String(d.product ?? "Whole bill"),
          value: Number(d.discountValue ?? 0),
          receipt: String(d.receiptNo ?? "—"),
          staff: l.staffName,
          partner: partnerOf(d.promotionId as string | undefined, code),
          storeId: l.storeId ?? "",
          status: /removed/i.test(l.action)
            ? "Removed"
            : /redeemed/i.test(l.action)
              ? "Redeemed"
              : "Applied",
        };
      });

    // Bills already stored with a coupon (covers history synced from cloud).
    const bills: Row[] = history.sales
      .filter((s) => s.couponCode && inRange(s.createdAt, from, to))
      .filter((s) => !events.some((e) => e.receipt === s.receiptNo && e.status === "Redeemed"))
      .map((s) => ({
        at: s.createdAt,
        code: s.couponCode!,
        scope: s.couponScope ?? "bill",
        target:
          s.couponScope === "item"
            ? (s.lines.find((l) => l.couponCode)?.name ?? "Item")
            : "Whole bill",
        value: s.couponDiscount ?? 0,
        receipt: s.receiptNo,
        staff: s.cashier,
        partner: partnerOf(s.couponPromoId, s.couponCode!),
        storeId: s.storeId,
        status: "Redeemed",
      }));

    return [...events, ...bills].sort((a, b) => b.at.localeCompare(a.at));
  }, [logs, history.sales, from, to, partnerOf]);

  const partners = useMemo(
    () => [...new Set(allRows.map((r) => r.partner))].sort(),
    [allRows],
  );
  const staffNames = useMemo(() => [...new Set(allRows.map((r) => r.staff))].sort(), [allRows]);

  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          (!codeQuery || r.code.toLowerCase().includes(codeQuery.trim().toLowerCase())) &&
          (partner === ALL || r.partner === partner) &&
          (scope === ALL || r.scope === scope) &&
          (status === ALL || r.status === status) &&
          (staff === ALL || r.staff === staff) &&
          (store === ALL || r.storeId === store),
      ),
    [allRows, codeQuery, partner, scope, status, staff, store],
  );

  const redeemed = rows.filter((r) => r.status === "Redeemed");
  const pager = usePagination(rows);

  /** Per-code totals so a collaboration payout is a single glance. */
  const byCode = useMemo(() => {
    const map = new Map<string, { code: string; partner: string; count: number; value: number }>();
    for (const r of redeemed) {
      const key = `${r.partner}|${r.code}`;
      const hit = map.get(key) ?? { code: r.code, partner: r.partner, count: 0, value: 0 };
      hit.count += 1;
      hit.value += r.value;
      map.set(key, hit);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [redeemed]);

  const resetFilters = () => {
    setCodeQuery("");
    setPartner(ALL);
    setScope(ALL);
    setStatus(ALL);
    setStaff(ALL);
    setStore(ALL);
  };

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Coupon & Discount Usage"
          subtitle="Which coupon was used, on which bill or item, by whom and when."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadCsv("coupon-usage", [
              [
                "Time",
                "Coupon",
                "Partner",
                "Scope",
                "Applied to",
                "Value",
                "Receipt",
                "Staff",
                "Status",
              ],
              ...rows.map((r) => [
                stamp(r.at),
                r.code,
                r.partner,
                r.scope,
                r.target,
                r.value,
                r.receipt,
                r.staff,
                r.status,
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-xs">Coupon code</Label>
            <Input
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
              placeholder="Search code…"
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Partner</Label>
            <ThemedSelect
              ariaLabel="Partner"
              className="h-9 w-48"
              value={partner}
              onChange={setPartner}
              options={[
                { value: ALL, label: "All partners" },
                ...partners.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Scope</Label>
            <ThemedSelect
              ariaLabel="Scope"
              className="h-9 w-36"
              value={scope}
              onChange={setScope}
              options={[
                { value: ALL, label: "All scopes" },
                { value: "bill", label: "Whole bill" },
                { value: "item", label: "Single item" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <ThemedSelect
              ariaLabel="Status"
              className="h-9 w-36"
              value={status}
              onChange={setStatus}
              options={[
                { value: ALL, label: "All statuses" },
                { value: "Applied", label: "Applied" },
                { value: "Redeemed", label: "Redeemed" },
                { value: "Removed", label: "Removed" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Staff</Label>
            <ThemedSelect
              ariaLabel="Staff"
              className="h-9 w-40"
              value={staff}
              onChange={setStaff}
              options={[
                { value: ALL, label: "All staff" },
                ...staffNames.map((s) => ({ value: s, label: s })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <ThemedSelect
              ariaLabel="Branch"
              className="h-9 w-40"
              value={store}
              onChange={setStore}
              options={[
                { value: ALL, label: "All branches" },
                ...state.stores.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <Button variant="ghost" className="h-9" onClick={resetFilters}>
            Clear filters
          </Button>
        </ReportHeader>

        {history.loading ? <p className="text-sm text-muted-foreground">Loading complete SQL history…</p> : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Coupon events" value={String(rows.length)} />
          <StatCard label="Coupons redeemed" value={String(redeemed.length)} />
          <StatCard
            label="Value given away"
            value={money(redeemed.reduce((a, r) => a + r.value, 0))}
            hint={partner === ALL ? "Across every partner" : `Partner: ${partner}`}
          />
        </div>

        {byCode.length > 0 && (
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-2 text-sm font-medium">
              Redemptions by coupon code
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead className="text-right">Times redeemed</TableHead>
                  <TableHead className="text-right">Value given away</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCode.map((c) => (
                  <TableRow key={`${c.partner}-${c.code}`}>
                    <TableCell className="font-medium">{c.code}</TableCell>
                    <TableCell>{c.partner}</TableCell>
                    <TableCell className="numeric text-right">{c.count}</TableCell>
                    <TableCell className="numeric text-right">{money(c.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Coupon</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Applied to</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((r, i) => (
                <TableRow key={`${r.at}-${i}`}>
                  <TableCell className="numeric text-xs">{stamp(r.at)}</TableCell>
                  <TableCell className="font-medium">{r.code}</TableCell>
                  <TableCell className="text-muted-foreground">{r.partner}</TableCell>
                  <TableCell>{r.target}</TableCell>
                  <TableCell className="capitalize">{r.scope}</TableCell>
                  <TableCell>{r.receipt}</TableCell>
                  <TableCell>{r.staff}</TableCell>
                  <TableCell className="numeric text-right">{money(r.value)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "Removed" ? "outline" : "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No coupons match these filters.
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
            label="coupon events"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}
