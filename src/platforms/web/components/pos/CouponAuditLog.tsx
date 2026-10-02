/**
 * Append-only trail of every coupon claim, manual issue, redemption and
 * blocked attempt, with the shop and cashier that caused it.
 */
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { downloadCsv, type Campaign, type CouponEvent } from "@/lib/coupons";
import { branchDisplayName } from "@/lib/human-readable";

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CLAIMED: "default",
  ISSUED_MANUAL: "outline",
  REDEEMED: "secondary",
  BLOCKED: "destructive",
};

const label: Record<string, string> = {
  CLAIMED: "Claimed",
  ISSUED_MANUAL: "Issued manually",
  REDEEMED: "Redeemed",
  BLOCKED: "Blocked",
};

export function CouponAuditLog({
  events,
  campaigns,
  stores,
}: {
  events: CouponEvent[];
  campaigns: Campaign[];
  stores: { id: string; name: string }[];
}) {
  const [campaignId, setCampaignId] = useState("all");
  const [type, setType] = useState("all");
  const [storeId, setStoreId] = useState("all");
  const [cashier, setCashier] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const cashiers = useMemo(
    () => Array.from(new Set(events.map((e) => e.staffName).filter(Boolean) as string[])).sort(),
    [events],
  );

  const rows = useMemo(
    () =>
      events.filter((e) => {
        if (campaignId !== "all" && e.campaignId !== campaignId) return false;
        if (type !== "all" && e.type !== type) return false;
        if (storeId !== "all" && (e.storeId ?? "") !== storeId) return false;
        if (cashier !== "all" && (e.staffName ?? "") !== cashier) return false;
        const at = new Date(e.createdAt);
        if (from && at < new Date(from)) return false;
        if (to && at > new Date(`${to}T23:59:59`)) return false;
        return true;
      }),
    [events, campaignId, type, storeId, cashier, from, to],
  );

  const storeName = (id: string | null) => branchDisplayName(stores, id, "—");

  const exportCsv = () =>
    downloadCsv(`coupon-audit-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        "When",
        "Event",
        "Campaign",
        "Voucher",
        "Member ID",
        "Phone",
        "Shop",
        "Cashier",
        "Role",
        "Bill",
        "Note",
      ],
      ...rows.map((e) => [
        new Date(e.createdAt).toLocaleString(),
        label[e.type] ?? e.type,
        e.campaignName,
        e.token,
        e.memberId,
        e.memberPhone,
        storeName(e.storeId),
        e.staffName,
        e.staffRole,
        e.saleId,
        e.note,
      ]),
    ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5">
          <Label>Campaign</Label>
          <ThemedSelect
            value={campaignId}
            onChange={setCampaignId}
            options={[
              { value: "all", label: "All campaigns" },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Event</Label>
          <ThemedSelect
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All events" },
              { value: "CLAIMED", label: "Claimed" },
              { value: "ISSUED_MANUAL", label: "Issued manually" },
              { value: "REDEEMED", label: "Redeemed" },
              { value: "BLOCKED", label: "Blocked" },
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Shop</Label>
          <ThemedSelect
            value={storeId}
            onChange={setStoreId}
            options={[
              { value: "all", label: "All shops" },
              ...stores.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cashier</Label>
          <ThemedSelect
            value={cashier}
            onChange={setCashier}
            options={[
              { value: "all", label: "All cashiers" },
              ...cashiers.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-from">From</Label>
          <Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-to">To</Label>
          <Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} events</p>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead>Bill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 500).map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {new Date(e.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={tone[e.type] ?? "secondary"}>{label[e.type] ?? e.type}</Badge>
                  {e.note ? (
                    <div className="text-[11px] text-muted-foreground">{e.note}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{e.campaignName || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{e.token ?? "—"}</TableCell>
                <TableCell className="text-xs">{e.memberPhone ?? e.memberId ?? "—"}</TableCell>
                <TableCell className="text-xs">{storeName(e.storeId)}</TableCell>
                <TableCell className="text-xs">{e.staffName ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{e.saleId ?? "—"}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No coupon activity for these filters yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
