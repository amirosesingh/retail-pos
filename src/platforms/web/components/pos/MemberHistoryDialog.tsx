import { Table } from "@/components/ui/table";
import { formatDateTime as posDisplayDateTime, formatDate as posDisplayDate } from "@/lib/time-zone";
import { useCallback, useMemo, useState } from "react";
import { Printer, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { money, usePos } from "@/lib/pos-store";
import type { Member, Sale } from "@/core/types/pos-types";
import { lineUnitDiscount, r2 } from "@/core/types/pos-types";
import { printSaleReceipt, saleReceiptPreview } from "@/lib/pos-print";

export function MemberHistoryDialog({
  member,
  onOpenChange,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { state } = usePos();
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<Sale | null>(null);

  const inRange = useCallback((iso: string) => {
    const d = iso.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }, [from, to]);

  const sales = useMemo(
    () =>
      member
        ? state.sales
            .filter((s) => s.memberId === member.id && inRange(s.createdAt))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [],
    [member, state.sales, inRange],
  );

  const q = query.trim().toLowerCase();
  const bills = q
    ? sales.filter(
        (s) =>
          s.receiptNo.toLowerCase().includes(q) ||
          s.lines.some((l) => l.name.toLowerCase().includes(q)),
      )
    : sales;

  const items = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; spent: number; last: string; points: number }
    >();
    for (const s of sales) {
      const gross = s.lines.reduce(
        (a, l) => a + Math.max(0, (l.price - lineUnitDiscount(l)) * l.qty),
        0,
      );
      for (const l of s.lines) {
        if (l.qty <= 0) continue;
        const value = r2((l.price - lineUnitDiscount(l)) * l.qty);
        const prev = map.get(l.productId) ?? {
          name: l.name,
          qty: 0,
          spent: 0,
          last: s.createdAt,
          points: 0,
        };
        prev.qty += l.qty;
        prev.spent = r2(prev.spent + value);
        prev.points += gross > 0 ? Math.round((s.pointsEarned * value) / gross) : 0;
        if (s.createdAt > prev.last) prev.last = s.createdAt;
        map.set(l.productId, prev);
      }
    }
    const rows = [...map.values()].sort((a, b) => b.spent - a.spent);
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [sales, q]);

  const totalSpent = sales.reduce((a, s) => a + s.total, 0);

  return (
    <>
      <Dialog open={!!member} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Purchased items &amp; bills — {member?.name}
              {member && (
                <Badge variant="outline" className="ml-2 align-middle text-[11px]">
                  {member.code} · {member.tier} · {member.points} pts
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1">
              <Label className="text-[11px] uppercase text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Product name or bill number…"
                  className="h-9 pl-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase text-muted-foreground">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] uppercase text-muted-foreground">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <Tabs defaultValue="bills">
            <TabsList>
              <TabsTrigger value="bills">Past invoices ({bills.length})</TabsTrigger>
              <TabsTrigger value="items">All purchased items ({items.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="bills">
              <ScrollArea className="h-[46vh] rounded-md border border-border">
                <Table tableId="platforms/web/components/pos/MemberHistoryDialog.native#1" clientDataControls={false} className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Bill no</th>
                      <th className="px-3 py-2 text-left">Date &amp; time</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Points</th>
                      <th className="px-3 py-2 text-left">Payment</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bills.map((s) => (
                      <tr key={s.id}>
                        <td className="numeric px-3 py-2">{s.receiptNo}</td>
                        <td className="numeric px-3 py-2 text-xs text-muted-foreground">
                          {posDisplayDateTime(new Date(s.createdAt))}
                        </td>
                        <td className="numeric px-3 py-2 text-right">{money(s.total)}</td>
                        <td className="numeric px-3 py-2 text-right">
                          {s.method === "points" ? `−${s.pointsEarned}` : `+${s.pointsEarned}`}
                        </td>
                        <td className="px-3 py-2 capitalize">{s.method}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPreview(s)}>
                            View receipt
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!bills.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                          No bills match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </ScrollArea>
              <p className="mt-2 text-xs text-muted-foreground">
                {bills.length} bills · {money(totalSpent)} lifetime in range
              </p>
            </TabsContent>

            <TabsContent value="items">
              <ScrollArea className="h-[46vh] rounded-md border border-border">
                <Table tableId="platforms/web/components/pos/MemberHistoryDialog.native#2" clientDataControls={false} className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-right">Qty purchased</th>
                      <th className="px-3 py-2 text-left">Last purchased</th>
                      <th className="px-3 py-2 text-right">Total spent</th>
                      <th className="px-3 py-2 text-right">Points earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((r) => (
                      <tr key={r.name}>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="numeric px-3 py-2 text-right">{r.qty}</td>
                        <td className="numeric px-3 py-2 text-xs text-muted-foreground">
                          {posDisplayDate(new Date(r.last))}
                        </td>
                        <td className="numeric px-3 py-2 text-right">{money(r.spent)}</td>
                        <td className="numeric px-3 py-2 text-right">{r.points}</td>
                      </tr>
                    ))}
                    {!items.length && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                          No purchased items match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Receipt {preview?.receiptNo}</DialogTitle>
          </DialogHeader>
          {preview && (
            <iframe
              title="Receipt preview"
              className="h-[55vh] w-full rounded-md border border-border bg-white"
              srcDoc={saleReceiptPreview(preview, member, "sale")}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>
              <X className="size-4" /> Close
            </Button>
            <Button onClick={() => preview && printSaleReceipt(preview, member, "sale")}>
              <Printer className="size-4" /> Print receipt
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
