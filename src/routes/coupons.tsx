import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, Plus, Send, TicketPercent, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CouponAuditLog } from "@/platforms/web/components/pos/CouponAuditLog";
import { CampaignVouchers } from "@/platforms/web/components/pos/CampaignVouchers";
import { CouponAnalytics } from "@/platforms/web/components/pos/CouponAnalytics";
import { IssueVoucherDialog } from "@/platforms/web/components/pos/IssueVoucherDialog";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { claimUrl } from "@/lib/coupon-hosts";
import {
  blankCampaign,
  campaignStatus,
  deleteCampaign,
  discountLabel,
  loadCampaigns,
  loadCouponEvents,
  loadVouchers,
  saveCampaign,
  scopeLabel,
  slugify,
  type Campaign,
  type CouponEvent,
  type Voucher,
} from "@/lib/coupons";
import type { Cursor } from "@/lib/keyset";

export const Route = createFileRoute("/coupons")({
  head: () => ({
    meta: [
      { title: "Coupon Campaigns — Retail" },
      {
        name: "description",
        content:
          "Create digital coupon campaigns, share claim links on any channel and track every voucher issued and redeemed at the till.",
      },
      { property: "og:title", content: "Coupon Campaigns — Retail" },
      {
        property: "og:description",
        content: "Digital coupon campaigns, claim links and voucher redemption tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CouponsPage,
});

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Live: "default",
  Off: "secondary",
  Expired: "destructive",
  Scheduled: "outline",
  "Fully claimed": "secondary",
};

/** ISO timestamp <-> value for a datetime-local input. */
const toLocalInput = (iso?: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 16) : "";
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/**
 * A blank or half-typed limit ("", "-", "1e") must never reach the draft as
 * NaN: blank means unlimited, anything unreadable keeps the field empty.
 */
const toCountOrNull = (v: string): number | null => {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.floor(Math.abs(n)));
};

function CouponsPage() {
  const { can, user } = useAuth();
  const { state } = usePos();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [events, setEvents] = useState<CouponEvent[]>([]);
  const [eventCursor, setEventCursor] = useState<Cursor>(null);
  const [moreEvents, setMoreEvents] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [issueFor, setIssueFor] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, vs, es] = await Promise.all([
        loadCampaigns(),
        loadVouchers(),
        loadCouponEvents().catch(() => ({ rows: [] as CouponEvent[], cursor: null, hasMore: false })),
      ]);
      setCampaigns(cs);
      setVouchers(vs);
      setEvents(es.rows);
      setEventCursor(es.cursor);
      setMoreEvents(es.hasMore);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — follow docs/database-upgrade.md to install the missing POS tables.`
          : "Could not load campaigns.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Pull the next page of the event trail without re-reading the ones on screen. */
  const loadMoreEvents = useCallback(async () => {
    if (!eventCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadCouponEvents({ cursor: eventCursor });
      setEvents((prev) => [...prev, ...page.rows]);
      setEventCursor(page.cursor);
      setMoreEvents(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [eventCursor]);

  const counts = useMemo(() => {
    const map = new Map<string, { issued: number; redeemed: number }>();
    for (const v of vouchers) {
      const entry = map.get(v.campaignId) ?? { issued: 0, redeemed: 0 };
      entry.issued += 1;
      if (v.status === "REDEEMED") entry.redeemed += 1;
      map.set(v.campaignId, entry);
    }
    return map;
  }, [vouchers]);

  const categories = useMemo(
    () => Array.from(new Set(state.products.map((p) => p.category).filter(Boolean))).sort(),
    [state.products],
  );

  async function save() {
    if (!draft) return;
    const slug = slugify(draft.slug || draft.name);
    if (!draft.name.trim()) return toast.error("Give the campaign a name");
    if (!slug) return toast.error("Give the campaign a link slug");
    setSaving(true);
    try {
      const res = await saveCampaign({ ...draft, slug });
      if (!res.success) {
        toast.error(res.error ?? "Could not save the campaign");
        return;
      }
      toast.success("Campaign saved");
      setDraft(null);
      await refresh();
    } catch (e) {
      notifyError(e, "Could not save the campaign");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete “${c.name}” and every voucher issued from it?`)) return;
    try {
      const res = await deleteCampaign(c.id);
      if (!res.success) {
        toast.error(res.error ?? "Could not delete the campaign");
        return;
      }
      toast.success("Campaign deleted");
      await refresh();
    } catch (e) {
      notifyError(e, "Could not delete the campaign");
    }
  }

  const copyLink = async (c: Campaign) => {
    // Clipboard access is refused outright in some browsers and kiosks, so the
    // link is shown instead of the copy silently doing nothing.
    try {
      await navigator.clipboard.writeText(claimUrl(c.slug));
      toast.success("Claim link copied");
    } catch {
      toast.error("Could not copy — copy it by hand", { description: claimUrl(c.slug) });
    }
  };

  if (!can("can_manage_promotions")) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-semibold">Coupon campaigns</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have permission to manage campaigns. Customer vouchers still scan and apply
            automatically at your register.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Coupon campaigns</h1>
            <p className="text-sm text-muted-foreground">
              {campaigns.filter((c) => campaignStatus(c) === "Live").length} live ·{" "}
              {vouchers.length} vouchers issued · {vouchers.filter((v) => v.status === "REDEEMED").length}{" "}
              redeemed
            </p>
          </div>
          <Button onClick={() => setDraft(blankCampaign())}>
            <Plus className="mr-2 h-4 w-4" /> New campaign
          </Button>
        </header>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Tabs defaultValue="campaigns">
          <TabsList>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="mt-4">
        <div className="rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-12 text-center">
              <TicketPercent className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                No campaigns yet. Create one and share its claim link on WhatsApp, receipts or
                social posts.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Validity</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const stat = campaignStatus(c);
                  const tally = counts.get(c.id) ?? { issued: 0, redeemed: 0 };
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">/{c.slug}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {discountLabel(c)}
                        <div className="text-xs text-muted-foreground">{scopeLabel(c)}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "Now"} →{" "}
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "No end"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.claimsCount}
                        {c.maxClaims ? ` / ${c.maxClaims}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{tally.redeemed}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone[stat] ?? "secondary"}>{stat}</Badge>
                        {c.isWelcome ? (
                          <Badge variant="outline" className="ml-1">
                            Welcome
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Copy claim link"
                            onClick={() => void copyLink(c)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Issue a voucher to a member"
                            onClick={() => setIssueFor(c)}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Edit campaign"
                            onClick={() => setDraft(c)}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete campaign"
                            onClick={() => void remove(c)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <CouponAnalytics />
          </TabsContent>

          <TabsContent value="vouchers" className="mt-4">
            <CampaignVouchers
              campaigns={campaigns}
              vouchers={vouchers}
              members={state.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone }))}
              staffName={user?.name}
              staffRole={user?.role}
              storeId={state.currentStoreId}
              onChanged={refresh}
            />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <CouponAuditLog
              events={events}
              campaigns={campaigns}
              stores={state.stores.map((s) => ({ id: s.id, name: s.name }))}
            />
            {moreEvents ? (
              <div className="mt-3 flex justify-center">
                <Button variant="outline" onClick={() => void loadMoreEvents()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load older events"}
                </Button>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      <IssueVoucherDialog
        campaign={issueFor}
        members={state.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone }))}
        staffName={user?.name}
        staffRole={user?.role}
        storeId={state.currentStoreId}
        onClose={() => setIssueFor(null)}
        onIssued={() => void refresh()}
      />

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.name ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Campaign name</Label>
                <Input
                  id="c-name"
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      name: e.target.value,
                      slug: draft.slug || slugify(e.target.value),
                    })
                  }
                  placeholder="Merdeka weekend 15%"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-slug">Link slug</Label>
                <Input
                  id="c-slug"
                  value={draft.slug}
                  maxLength={48}
                  onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })}
                  placeholder="merdeka-15"
                />
                <p className="break-all text-xs text-muted-foreground">
                  {claimUrl(draft.slug || "your-slug")}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Discount type</Label>
                  <ThemedSelect
                    value={draft.discountType}
                    onChange={(v) =>
                      setDraft({ ...draft, discountType: v as Campaign["discountType"] })
                    }
                    options={[
                      { value: "PERCENTAGE", label: "Percentage" },
                      { value: "FIXED_AMOUNT", label: "Fixed amount" },
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-value">Value</Label>
                  <Input
                    id="c-value"
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.discountValue}
                    onChange={(e) =>
                      setDraft({ ...draft, discountValue: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Applies to</Label>
                  <ThemedSelect
                    value={draft.scope}
                    onChange={(v) =>
                      setDraft({ ...draft, scope: v as Campaign["scope"], scopeValue: null })
                    }
                    options={[
                      { value: "BILL", label: "Whole bill" },
                      { value: "CATEGORY", label: "One category" },
                      { value: "PRODUCT", label: "One product" },
                    ]}
                  />
                </div>
                {draft.scope === "CATEGORY" ? (
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <ThemedSelect
                      value={draft.scopeValue ?? ""}
                      onChange={(v) => setDraft({ ...draft, scopeValue: v })}
                      options={categories.map((c) => ({ value: c, label: c }))}
                    />
                  </div>
                ) : null}
                {draft.scope === "PRODUCT" ? (
                  <div className="space-y-1.5">
                    <Label>Product</Label>
                    <ThemedSelect
                      value={draft.scopeValue ?? ""}
                      onChange={(v) => setDraft({ ...draft, scopeValue: v })}
                      options={state.products.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-start">Starts</Label>
                  <Input
                    id="c-start"
                    type="datetime-local"
                    value={toLocalInput(draft.startsAt)}
                    onChange={(e) =>
                      setDraft({ ...draft, startsAt: fromLocalInput(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-end">Expires</Label>
                  <Input
                    id="c-end"
                    type="datetime-local"
                    value={toLocalInput(draft.expiresAt)}
                    onChange={(e) =>
                      setDraft({ ...draft, expiresAt: fromLocalInput(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-max">Maximum coupons (blank = unlimited)</Label>
                <Input
                  id="c-max"
                  type="number"
                  min={1}
                  value={draft.maxClaims ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxClaims: toCountOrNull(e.target.value),
                    })
                  }
                  placeholder="Unlimited"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-per-member">Maximum per member (blank = unlimited)</Label>
                <Input
                  id="c-per-member"
                  type="number"
                  min={1}
                  value={draft.maxPerMember ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxPerMember: toCountOrNull(e.target.value),
                    })
                  }
                  placeholder="1"
                />
                <p className="text-xs text-muted-foreground">
                  Claiming the same campaign again is blocked once a member hits this number.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">
                    Turn off to pause claims without deleting the campaign.
                  </p>
                </div>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Welcome coupon</p>
                  <p className="text-xs text-muted-foreground">
                    Issued automatically to everyone who registers on the member signup page.
                  </p>
                </div>
                <Switch
                  checked={draft.isWelcome}
                  onCheckedChange={(v) => setDraft({ ...draft, isWelcome: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
