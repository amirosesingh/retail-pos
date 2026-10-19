import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * Voucher register for a coupon campaign.
 *
 * Every token ever created for a campaign is listed here with its live state,
 * who holds it and — once used — the bill it was spent on. Managers can switch
 * a voucher off; the till then refuses it with a clear message and the change
 * is written to the coupon event trail.
 */
import { useMemo, useState } from "react";
import { Ban, Download, Loader2, RotateCcw, TicketPercent } from "lucide-react";
import { toast } from "sonner";
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
import {
  discountLabel,
  downloadCsv,
  setVoucherStatus,
  voucherDeadline,
  voucherState,
  type Campaign,
  type Voucher,
} from "@/lib/coupons";

type MemberLite = { id: string; name: string; phone: string };

type Props = {
  campaigns: Campaign[];
  vouchers: Voucher[];
  members: MemberLite[];
  staffName?: string | undefined;
  staffRole?: string | undefined;
  storeId?: string | undefined;
  onChanged: () => void | Promise<void>;
};

const STATES = ["All", "Available", "Used", "Expired", "Disabled"] as const;

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Available: "default",
  Used: "secondary",
  Expired: "destructive",
  Disabled: "destructive",
};

const when = (iso?: string | null) => (iso ? posDisplayDateTime(new Date(iso)) : "—");

export function CampaignVouchers({
  campaigns,
  vouchers,
  members,
  staffName,
  staffRole,
  storeId,
  onChanged,
}: Props) {
  const [campaignId, setCampaignId] = useState("all");
  const [status, setStatus] = useState<(typeof STATES)[number]>("All");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const byId = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rows = useMemo(() => {
    const now = new Date();
    const needle = q.trim().toLowerCase();
    return vouchers
      .map((v) => {
        const campaign = byId.get(v.campaignId);
        const member = v.memberId ? memberById.get(v.memberId) : undefined;
        return {
          v,
          campaign,
          member,
          state: campaign ? voucherState(v, campaign, now) : "Available",
        };
      })
      .filter((r) => (campaignId === "all" ? true : r.v.campaignId === campaignId))
      .filter((r) => (status === "All" ? true : r.state === status))
      .filter((r) =>
        !needle
          ? true
          : [r.v.tokenSlug, r.member?.name, r.member?.phone, r.campaign?.name]
              .filter(Boolean)
              .some((s) => String(s).toLowerCase().includes(needle)),
      );
  }, [vouchers, byId, memberById, campaignId, status, q]);

  const totals = useMemo(() => {
    const t = { created: rows.length, available: 0, used: 0, expired: 0, disabled: 0 };
    rows.forEach((r) => {
      if (r.state === "Available") t.available += 1;
      else if (r.state === "Used") t.used += 1;
      else if (r.state === "Expired") t.expired += 1;
      else t.disabled += 1;
    });
    return t;
  }, [rows]);

  const rate = totals.created ? Math.round((totals.used / totals.created) * 100) : 0;

  const flip = async (token: string, next: "ISSUED" | "DISABLED") => {
    const reason =
      next === "DISABLED"
        ? window.prompt("Why is this voucher being switched off?", "Withdrawn by manager")
        : "Re-enabled by manager";
    if (next === "DISABLED" && reason === null) return;
    setBusy(token);
    try {
      await setVoucherStatus({
        token,
        status: next,
        reason,
        ...(staffName ? { staff: staffName } : {}),
        ...(staffRole ? { role: staffRole } : {}),
        ...(storeId ? { storeId } : {}),
      });
      toast.success(next === "DISABLED" ? "Voucher switched off" : "Voucher re-enabled");
      await onChanged();
    } catch (e) {
      toast.error("Could not update the voucher", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy("");
    }
  };

  const exportCsv = () =>
    downloadCsv("voucher-register.csv", [
      [
        "Token",
        "Campaign",
        "Discount",
        "Member",
        "Phone",
        "Issued",
        "Source",
        "Expires",
        "Status",
        "Used at",
        "Bill",
        "Shop",
        "Cashier",
        "Reason",
      ],
      ...rows.map((r) => [
        r.v.tokenSlug,
        r.campaign?.name ?? "",
        r.campaign ? discountLabel(r.campaign) : "",
        r.member?.name ?? "",
        r.member?.phone ?? "",
        when(r.v.issuedAt),
        r.v.issuedSource === "MANUAL" ? "Issued manually" : "Claimed",
        r.campaign ? when(voucherDeadline(r.v, r.campaign)) : "—",
        r.state,
        when(r.v.redeemedAt),
        r.v.redeemedSaleId ?? "",
        r.v.storeId ?? "",
        r.v.redeemedBy ?? "",
        r.v.disableReason ?? "",
      ]),
    ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Created", totals.created],
          ["Available", totals.available],
          ["Used", totals.used],
          ["Expired", totals.expired],
          ["Disabled", totals.disabled],
          ["Redemption", `${rate}%`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Campaign</Label>
          <ThemedSelect
            ariaLabel="Campaign"
            className="h-9 w-56"
            value={campaignId}
            onChange={setCampaignId}
            options={[
              { value: "all", label: "All campaigns" },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Status</Label>
          <ThemedSelect
            ariaLabel="Voucher status"
            className="h-9 w-40"
            value={status}
            onChange={(v: string) => setStatus(v as (typeof STATES)[number])}
            options={STATES.map((s) => ({ value: s, label: s }))}
          />
        </div>
        <div className="min-w-52 flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">Search</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Token, member or phone"
            className="h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="p-12 text-center">
            <TicketPercent className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm text-muted-foreground">
              No vouchers match these filters yet.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.v.id}>
                  <TableCell className="font-mono text-xs">{r.v.tokenSlug}</TableCell>
                  <TableCell className="text-sm">
                    {r.campaign?.name ?? "—"}
                    <div className="text-xs text-muted-foreground">
                      {r.campaign ? discountLabel(r.campaign) : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.member?.name ?? "—"}
                    <div className="text-xs text-muted-foreground">{r.member?.phone ?? ""}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {when(r.v.issuedAt)}
                    <div>{r.v.issuedSource === "MANUAL" ? "Issued manually" : "Claimed"}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.campaign ? when(voucherDeadline(r.v, r.campaign)) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tone[r.state] ?? "secondary"}>{r.state}</Badge>
                    {r.state === "Used" ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {when(r.v.redeemedAt)} · {r.v.redeemedBy ?? "—"}
                      </div>
                    ) : null}
                    {r.state === "Disabled" && r.v.disableReason ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {r.v.disableReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.state === "Used" ? (
                      <span className="text-xs text-muted-foreground">Locked</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === r.v.tokenSlug}
                        onClick={() =>
                          void flip(
                            r.v.tokenSlug,
                            r.v.status === "DISABLED" ? "ISSUED" : "DISABLED",
                          )
                        }
                      >
                        {busy === r.v.tokenSlug ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : r.v.status === "DISABLED" ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <Ban className="mr-2 h-4 w-4 text-destructive" />
                        )}
                        {r.v.status === "DISABLED" ? "Re-enable" : "Disable"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}