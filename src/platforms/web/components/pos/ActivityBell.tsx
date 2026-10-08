import { activeBranchId } from "@/lib/active-branch";
/**
 * The Approval & Activity Centre in the header.
 *
 * One bell for everybody: cashiers see the requests they sent and the
 * decisions that have come back, approvers see what is waiting for them, and
 * supervisors keep the branch activity feed they already had. Clearing an
 * entry only hides it for the person who cleared it — the request, the
 * decision and the audit trail are never touched. Dismissal is local to the
 * current window and is not synchronized to another terminal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AnimatedList } from "@/components/ui/animated-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/pos-auth";
import {
  EVENT_LABELS,
  SEVERITY_TONE,
  flushActivityQueue,
  isActivityLogMissing,
  listActivityEvents,
  markActivitySeen,
  mergeRemoteActivityPreferences,
  unseenEvents,
  clearAllActivityEntries,
  clearActivityEntry,
  clearedIds,
  subscribeActivityEvents,
  type ActivityEvent,
} from "@/lib/activity-events";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CENTRE_POLL_MS,
  loadApprovalCentre,
  subscribeApprovals,
  type CentreView,
} from "@/lib/approval-centre";
import { AUTH_ACTION_LABEL, type AuthorizationRequest } from "@/lib/authorization";
import { usePosOptional } from "@/lib/pos-store";
import { useSyncSummary } from "@/lib/sync-summary";
import { attentionCounts } from "@/lib/needs-attention";
import { humanizeText } from "@/lib/human-readable";

const POLL_MS = 15_000;
/** Notifications expire from the live delivery feed after one week. The
 * underlying immutable activity/audit event remains available in Reports. */
const NOTIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

export function ActivityBell({ compact: _compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { isSupervisor, user } = useAuth();
  const pos = usePosOptional();
  const refs = useMemo(
    () => ({
      stores: pos?.stores,
      products: pos?.state.products,
      members: pos?.state.members,
      sales: pos?.state.sales,
    }),
    [pos?.stores, pos?.state.products, pos?.state.members, pos?.state.sales],
  );
  const eventText = useCallback((value: string) => humanizeText(value, refs), [refs]);
  const sync = useSyncSummary();
  // Everyone polls the feed. Server and local audience filters return general
  // branch activity to supervisors and private approval notices to recipients.
  const showActivity = true;
  const allowed = true;
  const [centre, setCentre] = useState<CentreView | null>(null);
  const [, setClearedTick] = useState(0);
  const meKey = user?.staffId ?? user?.name ?? "";
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [clearAllBusy, setClearAllBusy] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState<Set<string>>(() => new Set());
  const preferenceBusyRef = useRef(new Set<string>());
  const announcedIdsRef = useRef(new Set<string>());
  const activityInitializedRef = useRef(false);

  const updatePreference = useCallback(
    async (id: string, action: () => Promise<boolean>, failure: string) => {
      if (preferenceBusyRef.current.has(id)) return;
      preferenceBusyRef.current.add(id);
      setPreferenceBusy(new Set(preferenceBusyRef.current));
      try {
        const saved = await action();
        if (!saved) {
          toast.error(failure);
        } else {
          toast.dismiss(`activity-${id}`);
          // Reflect the local dismissal immediately. The underlying business
          // event remains immutable and other terminals keep their own view.
          setRows((current) =>
            current.map((row) => {
              if (row.id !== id) return row;
              return { ...row, clearedBy: [...new Set([...row.clearedBy, meKey])] };
            }),
          );
        }
      } catch {
        toast.error(failure);
      } finally {
        preferenceBusyRef.current.delete(id);
        setPreferenceBusy(new Set(preferenceBusyRef.current));
      }
    },
    [meKey],
  );

  const openActivity = useCallback(
    async (row: ActivityEvent) => {
      const configured = typeof row.meta["route"] === "string" ? row.meta["route"] : "";
      const route =
        configured ||
        (row.entityType === "authorization_request"
          ? "/approvals"
          : row.entityType === "stock_request" && row.entityId
            ? `/requests/${row.entityId}`
            : row.entityType === "stock_transfer" && row.entityId
              ? `/transfers/${row.entityId}`
              : "");
      if (!route) return;
      const saved = await clearActivityEntry(meKey, row.id);
      if (!saved) {
        toast.error("Could not clear notification. Check the connection and try again.");
        return;
      }
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.dismiss(`activity-${row.id}`);
      setOpen(false);
      void navigate({ to: route });
    },
    [meKey, navigate],
  );

  const refreshCentre = useCallback(async () => {
    try {
      setCentre(await loadApprovalCentre());
    } catch {
      /* offline — the poll will pick it up again */
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!showActivity) return;
    void flushActivityQueue().catch(() => undefined);
    const list = await listActivityEvents({
      limit: 40,
      storeId: activeBranchId() ?? undefined,
      from: new Date(Date.now() - NOTIFICATION_RETENTION_MS).toISOString(),
    });
    if (isActivityLogMissing()) {
      setMissing(true);
      return;
    }
    setRows(list);
    mergeRemoteActivityPreferences(meKey, list);
    const hidden = new Set(clearedIds(meKey));
    const fresh = unseenEvents(list, meKey).filter((row) => !hidden.has(row.id));
    setUnread(fresh.length);
    const newlyArrived = activityInitializedRef.current
      ? list.filter((row) => !announcedIdsRef.current.has(row.id) && !hidden.has(row.id))
      : [];
    for (const row of list) announcedIdsRef.current.add(row.id);
    activityInitializedRef.current = true;
    // At most four compact cards are introduced at once. Sonner stacks them
    // at the right edge and animates both entry and dismissal.
    for (const row of newlyArrived.slice(0, 4).reverse()) {
      const show =
        row.severity === "critical"
          ? toast.error
          : row.severity === "warning"
            ? toast.warning
            : toast.info;
      show(eventText(row.title), {
        id: `activity-${row.id}`,
        description: row.message ? eventText(row.message) : undefined,
        closeButton: true,
        duration: 4_000,
        position: "top-right",
        className: "activity-notification-toast !w-[min(20rem,calc(100vw-1rem))] !gap-2 !p-3",
        classNames: {
          title: "text-xs font-medium",
          description: "line-clamp-2 text-[11px] leading-4",
        },
      });
    }
  }, [eventText, meKey, showActivity]);

  // Live decisions, with the existing poll kept as reconciliation.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") void refreshCentre().catch(() => undefined);
    };
    tick();
    const off = subscribeApprovals(tick);
    const t = setInterval(tick, CENTRE_POLL_MS);
    const onCleared = () => setClearedTick((n) => n + 1);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pos:activity-cleared-changed", onCleared);
    return () => {
      off();
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pos:activity-cleared-changed", onCleared);
    };
  }, [refreshCentre]);

  useEffect(() => {
    if (!showActivity) return;
    const tick = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(() => undefined);
    };
    tick();
    const off = subscribeActivityEvents(tick);
    const t = setInterval(() => {
      // Stop polling a database that has no activity log.
      if (isActivityLogMissing()) {
        clearInterval(t);
        return;
      }
      tick();
    }, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      off();
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [showActivity, refresh]);

  const hidden = new Set(clearedIds(meKey));
  const visibleRows = rows.filter((r) => !hidden.has(r.id));
  // Unresolved business records never consult notification clear/read preferences.
  const toDecide = centre?.toDecide ?? [];
  const waiting = centre?.waiting ?? [];
  const ready = centre?.ready ?? [];
  const attention = attentionCounts({
    approvals: [...toDecide, ...waiting],
    transfers: isSupervisor ? pos?.state.transfers : [],
    syncFailures: isSupervisor ? sync.failed : 0,
  });
  const badge = unread + attention.total + ready.length;

  if (!allowed) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          markActivitySeen(rows[0]?.createdAt ?? new Date().toISOString(), meKey);
          setUnread(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={badge ? `Approvals and activity: ${badge} new` : "Approvals and activity"}
          className={cn(
            "relative shrink-0 bg-transparent shadow-none hover:bg-transparent",
            badge ? "text-primary" : "",
          )}
        >
          <Bell className="size-4" />
          {badge > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-1rem))] p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Approvals &amp; activity</p>
          <p className="text-[11px] text-muted-foreground">
            Requests waiting on you, decisions on yours, and what is happening in the branch.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-1 border-b border-border px-3 py-2 text-center text-[10px]">
          <span>
            <strong>{attention.total}</strong>
            <br />
            Needs attention
          </span>
          <span>
            <strong>{attention.approvals}</strong>
            <br />
            Approvals
          </span>
          <span>
            <strong>{attention.transfers}</strong>
            <br />
            Transfers
          </span>
          <span>
            <strong>{attention.sync}</strong>
            <br />
            Sync issues
          </span>
        </div>
        <Tabs
          defaultValue={attention.approvals ? "attention" : ready.length ? "ready" : "activity"}
        >
          <TabsList className="grid w-full grid-cols-4 rounded-none">
            <TabsTrigger value="attention" className="text-[10px]">
              Attention{attention.approvals ? ` ${attention.approvals}` : ""}
            </TabsTrigger>
            <TabsTrigger value="warning" className="text-[10px]">
              Warning{waiting.length ? ` ${waiting.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="ready" className="text-[10px]">
              Ready{ready.length ? ` ${ready.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-[10px]">
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attention" className="m-0 max-h-80 overflow-y-auto">
            <RequestList
              rows={[...toDecide, ...waiting]}
              empty="No approvals need attention."
              actionLabel="Review"
              onAction={() => setOpen(false)}
            />
          </TabsContent>

          <TabsContent value="warning" className="m-0 max-h-80 overflow-y-auto">
            <RequestList rows={waiting} empty="You have nothing waiting for approval." />
          </TabsContent>

          <TabsContent value="ready" className="m-0 max-h-80 overflow-y-auto">
            <RequestList rows={ready} empty="No decisions to pick up." />
          </TabsContent>

          <TabsContent value="activity" className="m-0 max-h-80 overflow-y-auto">
            {showActivity && visibleRows.length > 0 && (
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">
                  Active notifications
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  disabled={clearAllBusy}
                  onClick={() => {
                    setClearAllBusy(true);
                    void clearAllActivityEntries(
                      meKey,
                      visibleRows.map((row) => row.id),
                    )
                      .then(async (saved) => {
                        if (!saved) {
                          toast.error(
                            "Could not clear notifications. Check the connection and try again.",
                          );
                          return;
                        }
                        setRows((current) =>
                          current.map((row) =>
                            visibleRows.some((visible) => visible.id === row.id)
                              ? { ...row, clearedBy: [...new Set([...row.clearedBy, meKey])] }
                              : row,
                          ),
                        );
                        for (const row of visibleRows) toast.dismiss(`activity-${row.id}`);
                      })
                      .finally(() => setClearAllBusy(false));
                  }}
                >
                  {clearAllBusy ? "Clearing…" : "Clear all"}
                </Button>
              </div>
            )}
            {!showActivity ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                The branch activity feed is for supervisors.
              </p>
            ) : missing ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                The activity log is not set up on this database yet. Run
                <span className="font-medium"> supabase/schema.sql</span> to switch it on.
              </p>
            ) : (
              <AnimatedList
                items={visibleRows.slice(0, 12)}
                getKey={(row) => row.id}
                empty={
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing has happened yet today.
                  </p>
                }
                renderItem={(r) => (
                  <div
                    className={cn(
                      "activity-notification-row border-b border-border/60 px-3 py-2 last:border-0",
                      (typeof r.meta["route"] === "string" ||
                        r.entityType === "authorization_request" ||
                        r.entityType === "stock_request" ||
                        r.entityType === "stock_transfer") &&
                        "cursor-pointer hover:bg-muted/60",
                    )}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openActivity(r)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openActivity(r);
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase",
                          SEVERITY_TONE[r.severity],
                        )}
                      >
                        {EVENT_LABELS[r.type] ? r.severity : r.type}
                      </span>
                      <p className="min-w-0 text-xs font-medium">{eventText(r.title)}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-6 touch-manipulation gap-1 px-2 text-[10px] text-muted-foreground"
                        disabled={preferenceBusy.has(r.id)}
                        aria-busy={preferenceBusy.has(r.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void updatePreference(
                            r.id,
                            () => clearActivityEntry(meKey, r.id),
                            "Could not clear notification. Check the connection and try again.",
                          );
                        }}
                      >
                        {preferenceBusy.has(r.id) ? (
                          <LoaderCircle className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        {preferenceBusy.has(r.id) ? "Saving…" : "Clear"}
                      </Button>
                    </div>
                    {r.message && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {eventText(r.message)}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {when(r.createdAt)}
                      {r.actorName ? ` · ${r.actorName}` : ""}
                      {r.storeId
                        ? ` · ${pos?.stores.find((store) => store.id === r.storeId)?.name ?? "Unknown branch"}`
                        : ""}
                      {r.whatsappStatus === "sent" ? " · WhatsApp sent" : ""}
                    </p>
                  </div>
                )}
              />
            )}
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-2 gap-2 border-t border-border p-2">
          <Button asChild size="sm" className="text-xs">
            <Link to="/approvals" onClick={() => setOpen(false)}>
              Approvals
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="text-xs">
            <Link to="/alerts" onClick={() => setOpen(false)}>
              Alerts
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One row per request, in the same shape as an activity entry. */
function RequestList({
  rows,
  empty,
  actionLabel,
  onAction,
}: {
  rows: AuthorizationRequest[];
  empty: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className="border-b border-border/60 px-3 py-2 last:border-0">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium">
              {AUTH_ACTION_LABEL[r.actionKey] ?? r.actionKey}
            </p>
            {actionLabel ? (
              <Link
                to="/approvals"
                onClick={onAction}
                className="text-[10px] text-primary underline"
              >
                {actionLabel}
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{r.reason || "No reason given"}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {when(r.createdAt)} · {r.requestedByName || r.requestedBy}
            {r.requestedAmount !== null ? ` · asked ${r.requestedAmount.toFixed(2)}` : ""}
            {r.approvedAmount !== null ? ` · approved ${r.approvedAmount.toFixed(2)}` : ""}
            {r.snapshot ? ` · ${r.snapshot.lines.length} item(s)` : ""}
          </p>
        </div>
      ))}
    </>
  );
}
