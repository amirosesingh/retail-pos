/** Per-campaign performance: issued, redeemed and the money those bills brought in. */
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsv, loadCampaignStats, type CampaignStats } from "@/lib/coupons";
import { money } from "@/lib/pos-store";

export function CouponAnalytics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<CampaignStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadCampaignStats({
      from: from || undefined,
      to: to ? `${to}T23:59:59` : undefined,
    })
      .then((r) => live && (setRows(r), setError("")))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to]);

  const exportCsv = () =>
    downloadCsv(`coupon-performance-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Campaign", "Slug", "Issued", "Claimed", "Issued manually", "Redeemed", "Redemption %", "Revenue", "Discount given"],
      ...rows.map((r) => [
        r.campaign.name,
        r.campaign.slug,
        r.issued,
        r.claimedPublic,
        r.issuedManual,
        r.redeemed,
        r.redemptionRate.toFixed(1),
        r.revenue.toFixed(2),
        r.discount.toFixed(2),
      ]),
    ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="p-from">From</Label>
          <Input id="p-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-to">To</Label>
          <Input id="p-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table tableId="platforms/web/components/pos/CouponAnalytics#1">
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Manual</TableHead>
                <TableHead className="text-right">Redeemed</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Discount given</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.campaign.id}>
                  <TableCell>
                    <div className="font-medium">{r.campaign.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">/{r.campaign.slug}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.issuedManual}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.redeemed}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.redemptionRate.toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.discount)}</TableCell>
                </TableRow>
              ))}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No coupon activity in this period.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
