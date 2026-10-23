import { reusableCodeTotals } from "@/lib/reusable-code-report";
import { ReusableCodeChangeLog } from "./ReusableCodeChangeLog";
import { nextCursor, type Cursor } from "@/lib/keyset";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { routedQuery } from "@/core/api/db-query";
import { formatDateTime } from "@/lib/time-zone";
import { isLive } from "@/lib/pos-promotions";

type Sale = Record<string, unknown>;
const PAGE_SIZE = 100;

/** Uses the normal permission-scoped cloud/local read path, only while opened. */
export function ReusableCodeActivity({ view }: { view: "issued" | "performance" | "audit" }) {
  const { state } = usePos();
  const codes = useMemo(
    () => state.promotions.filter((p) => p.type === "code"),
    [state.promotions],
  );
  const idsKey = JSON.stringify(codes.map((p) => p.id).sort());
  const [sales, setSales] = useState<Sale[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [revision, setRevision] = useState(0);
  const read = useCallback(
    async (position: Cursor) => {
      const ids = JSON.parse(idsKey) as string[];
      if (!ids.length) return [];
      // Bounded pages, never download the full transaction history on tab open.
      return routedQuery("sales", {
        columns:
          "id,bill_number,coupon_code,coupon_promo_id,coupon_scope,coupon_discount,total_amount,is_refunded,store_id,cashier_name,created_at",
        in: { column: "coupon_promo_id", values: ids },
        orderBy: { column: "created_at", ascending: false },
        limit: PAGE_SIZE,
        ...(position
          ? { cursor: { column: "created_at", value: position.ts, id: position.id } }
          : {}),
      });
    },
    [idsKey],
  );
  useEffect(() => {
    if (view === "issued") return;
    let live = true;
    setBusy(true);
    setError("");
    setSales([]);
    setCursor(null);
    setMore(false);
    void read(null)
      .then((rows) => {
        if (!live) return;
        setSales(rows);
        setCursor(nextCursor(rows, "created_at", PAGE_SIZE));
        setMore(rows.length === PAGE_SIZE);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load reusable-code sales");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [read, view, revision]);
  async function older() {
    if (busy) return;
    setBusy(true);
    try {
      const rows = await read(cursor);
      setSales((current) => [
        ...new Map([...current, ...rows].map((row) => [String(row.id), row])).values(),
      ]);
      setCursor(nextCursor(rows, "created_at", PAGE_SIZE));
      setMore(rows.length === PAGE_SIZE);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load older sales");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Reusable codes</h3>
        {view !== "issued" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((x) => x + 1)}
          >
            Refresh
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {view === "issued"
          ? "These codes can be shared repeatedly; they are not single-use vouchers. Edit them in Reusable codes."
          : `Showing ${sales.length} loaded sales, newest first. Load older sales to extend these results. Refunded bills are excluded from performance totals.`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {(view === "issued"
              ? ["Code", "Scope", "Coverage", "Status"]
              : view === "performance"
                ? ["Code", "Sales", "Bill revenue", "Coupon discount"]
                : ["When", "Code / bill", "Store / staff", "Discount / status"]
            ).map((title) => (
              <TableHead key={title}>{title}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {view === "audit"
            ? sales.map((sale) => (
                <TableRow key={String(sale.id)}>
                  <TableCell>{formatDateTime(new Date(String(sale.created_at)))}</TableCell>
                  <TableCell>
                    {String(sale.coupon_code ?? "")}
                    <div className="text-xs text-muted-foreground">{String(sale.bill_number)}</div>
                  </TableCell>
                  <TableCell>
                    {state.stores.find((s) => s.id === sale.store_id)?.name ??
                      String(sale.store_id ?? "—")}
                    <div className="text-xs text-muted-foreground">
                      {String(sale.cashier_name ?? "")}
                    </div>
                  </TableCell>
                  <TableCell>
                    {money(Number(sale.coupon_discount ?? 0))}
                    <Badge variant="outline" className="ml-2">
                      {sale.is_refunded ? "Refunded" : "Applied"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            : codes.map((code) => {
                const totals = reusableCodeTotals(sales, code.id);
                return (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono">{code.name}</TableCell>
                    {view === "issued" ? (
                      <>
                        <TableCell>
                          {code.codeScope === "item" ? "Per item" : "Whole bill"}
                        </TableCell>
                        <TableCell>{code.codeClusterId ? "Selected cluster" : "Global"}</TableCell>
                        <TableCell>
                          <Badge variant={isLive(code) ? "default" : "secondary"}>
                            {isLive(code) ? "Active" : "Inactive / outside dates"}
                          </Badge>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{totals.count}</TableCell>
                        <TableCell>
                          {money(totals.revenue)}
                        </TableCell>
                        <TableCell>
                          {money(totals.discount)}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
          {(view === "audit" ? !sales.length : !codes.length) && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                {busy ? "Loading…" : "No reusable-code records to display."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {view !== "issued" && more && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void older()}>
          {busy ? "Loading…" : "Load older sales"}
        </Button>
      )}
      {view === "audit" && <ReusableCodeChangeLog codeIds={codes.map((code) => code.id)} />}
    </section>
  );
}
