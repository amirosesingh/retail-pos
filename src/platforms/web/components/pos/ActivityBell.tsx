import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { visibleActivityRows } from "@/lib/notification-visibility";
import { activeBranchId } from "@/lib/active-branch";
/** Shared, durable notification acknowledgements; business records remain unchanged. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AnimatedList } from "@/components/ui/animated-list";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/pos-auth";
import {
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
import { usePosOptional } from "@/lib/pos-store";
import { createTextHumanizer } from "@/lib/human-readable";
import { hasStaffSession } from "@/core/api/sync-relay";
import { localDb } from "@/core/local-db/local-db";

const PIN_POLL_MS = 15_000;
const AUTHENTICATED_POLL_MS = 60_000;
const activityKey = (row: ActivityEvent) => row.id;
/** Notifications expire from the live delivery feed after one week. The
 * underlying immutable activity/audit event remains available in Reports. */
const NOTIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : posDisplayDateTime(d);
};

export function ActivityBell({ compact: _compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const humanizer = useMemo(() => createTextHumanizer(refs), [refs]);
  const textFormatter = useRef(humanizer);
  textFormatter.current = humanizer;
  const eventText = useCallback((value: string) => textFormatter.current(value), []);

  // Everyone polls the feed. Server and local audience filters return general
  // branch activity to supervisors and private approval notices to recipients.
  const showActivity = true;
  const allowed = true;

  const meKey = user?.staffId ?? user?.name ?? "";
  const [cleared, setCleared] = useState<string[]>(() => clearedIds(meKey));
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [rowsScope, setRowsScope] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(30);
  const [, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const preferenceScope = `${meKey}:${activeBranchId() ?? ""}`;
  const preferenceScopeRef = useRef(preferenceScope);
  preferenceScopeRef.current = preferenceScope;
  const [preferenceBusy, setPreferenceBusy] = useState<Set<string>>(() => new Set());
  const preferenceBusyRef = useRef(new Set<string>());
  const announcedIdsRef = useRef(new Set<string>());
  const activityInitializedRef = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const refreshGeneration = useRef(0);
  const mounted = useRef(false);
  const refreshLatest = useRef<() => Promise<void>>(async () => undefined);

  const updatePreference = useCallback(
    async (ids: string[], action: () => Promise<boolean>, failure: string) => {
      const keys = ids.map(id => `${preferenceScope}:${id}`);
      if (!ids.length || keys.some(key => preferenceBusyRef.current.has(key))) return false;
      // Only the current displayed batch is hidden. New arrivals remain visible.
      keys.forEach(key => preferenceBusyRef.current.add(key));
      setPreferenceBusy(new Set(preferenceBusyRef.current));
      ids.forEach(id => toast.dismiss(`activity-${id}`));
      try {
        const saved = await action();
        if (!mounted.current || preferenceScopeRef.current !== preferenceScope) return saved;
        if (!saved) {
          toast.error(failure);
        } else {
          setRows(current => current.map(row => ids.includes(row.id)
            ? { ...row, clearedBy: [...new Set([...row.clearedBy, meKey])] }
            : row));
        }
        return saved;
      } catch {
        if (mounted.current && preferenceScopeRef.current === preferenceScope) toast.error(failure);
        return false;
      } finally {
        keys.forEach(key => preferenceBusyRef.current.delete(key));
        // Removing the temporary overlay restores failures; successful records
        // stay cleared through the existing durable acknowledgement pipeline.
        if (mounted.current) setPreferenceBusy(new Set(preferenceBusyRef.current));
      }
    },
    [meKey, preferenceScope],
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
              : row.entityType === "sale" || row.type.startsWith("sale_")
                ? "/receipts"
                : row.type.startsWith("shift_")
                  ? "/shifts"
                  : "/alerts");
      if (!route) return;
      const saved = await updatePreference([row.id], () => clearActivityEntry(meKey, row.id),
        "Could not clear notification. Check the connection and try again.");
      if (!saved || !mounted.current || preferenceScopeRef.current !== preferenceScope) {
        return;
      }
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.dismiss(`activity-${row.id}`);
      setOpen(false);
      void navigate({ to: route });
    },
    [meKey, navigate, updatePreference, preferenceScope],
  );

  const refresh = useCallback(async () => {
    if (!showActivity || !meKey || !mounted.current) return;
    if (refreshInFlight.current) {
      refreshPending.current = true;
      return refreshInFlight.current;
    }
    const generation = refreshGeneration.current;
    const run = (async () => {
      void flushActivityQueue().catch(() => undefined);
      const list = await listActivityEvents({
        limit: 200,
        storeId: activeBranchId() ?? undefined,
        from: new Date(Date.now() - NOTIFICATION_RETENTION_MS).toISOString(),
        to: new Date().toISOString(),
      });
      if (generation !== refreshGeneration.current) return;
      if (isActivityLogMissing()) {
        setMissing(true);
        return;
      }
      setRows((current) => (JSON.stringify(current) === JSON.stringify(list) ? current : list));
      setRowsScope(preferenceScope);
      mergeRemoteActivityPreferences(meKey, list);
      const hidden = new Set(clearedIds(meKey));
      const fresh = unseenEvents(list, meKey).filter(
        (row) => !hidden.has(row.id) && !row.clearedBy.length,
      );
      setUnread(fresh.length);
      const newlyArrived = activityInitializedRef.current
        ? list.filter(
            (row) =>
              !announcedIdsRef.current.has(row.id) && !hidden.has(row.id) && !row.clearedBy.length,
          )
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
          closeButton: false,
          onDismiss: () => {
            if (!mounted.current || generation !== refreshGeneration.current || clearedIds(meKey).includes(row.id)) return;
            void updatePreference(
              [row.id],
              () => clearActivityEntry(meKey, row.id),
              "Could not clear notification. Your notification remains available in the bell.",
            );
          },
          duration: 4_000,
          position: "top-right",
          className: "activity-notification-toast",
          classNames: {
            title: "text-xs font-medium",
            description: "line-clamp-2 text-[11px] leading-4",
          },
        });
      }
    })();
    refreshInFlight.current = run;
    try {
      await run;
    } finally {
      refreshInFlight.current = null;
      if (refreshPending.current && mounted.current) {
        refreshPending.current = false;
        queueMicrotask(() => {
          void refreshLatest.current().catch(() => undefined);
        });
      }
    }
  }, [eventText, meKey, showActivity, updatePreference, preferenceScope]);
  refreshLatest.current = refresh;

  useEffect(() => {
    if (!showActivity) return;
    const generation = refreshGeneration.current;
    mounted.current = true;
    setRows([]);
    setRowsScope(null);
    announcedIdsRef.current.clear();
    activityInitializedRef.current = false;
    const onCleared = () =>
      setCleared((current) => {
        const next = clearedIds(meKey);
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
    onCleared();
    const tick = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(() => undefined);
    };
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (eventTimer) clearTimeout(eventTimer);
      eventTimer = setTimeout(() => { eventTimer = undefined; tick(); }, 150);
    };
    tick();
    const off = subscribeActivityEvents(schedule);
    const t = setInterval(() => {
      // Stop polling a database that has no activity log.
      if (isActivityLogMissing()) {
        clearInterval(t);
        return;
      }
      tick();
    }, localDb()?.onBusinessChanged || hasStaffSession() ? AUTHENTICATED_POLL_MS : PIN_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pos:activity-cleared-changed", onCleared);
    window.addEventListener("storage", onCleared);
    return () => {
      refreshGeneration.current = generation + 1;
      mounted.current = false;
      if (eventTimer) clearTimeout(eventTimer);
      off();
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pos:activity-cleared-changed", onCleared);
      window.removeEventListener("storage", onCleared);
    };
  }, [showActivity, refresh, meKey]);

  const visibleRows = useMemo(
    () => rowsScope === preferenceScope ? visibleActivityRows(rows, cleared, preferenceBusy, preferenceScope) : [],
    [rows, rowsScope, cleared, preferenceBusy, preferenceScope],
  );
  const displayedRows = useMemo(() => visibleRows.slice(0, displayLimit), [visibleRows, displayLimit]);
  const badge = unseenEvents(visibleRows, meKey).length;
  const saving = [...preferenceBusy].some(key => key.startsWith(`${preferenceScope}:`));

  if (!allowed) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setDisplayLimit(30);
          markActivitySeen(rows[0]?.createdAt ?? new Date().toISOString(), meKey);
          setUnread(0);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={badge ? `Notifications: ${badge} new` : "Notifications"}
          className={cn(
            "relative shrink-0 rounded-full border border-primary/15 bg-primary/5 text-primary shadow-none hover:bg-primary/10",
          )}
        >
          <Bell className="size-4" />
          {badge > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} overlayClassName="backdrop-blur-sm bg-black/20" aria-describedby={undefined} className="notification-panel max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:p-0">
        <div className="border-b border-border/60 px-4 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base"><Bell className="size-4 text-primary" /> Notifications</DialogTitle>
        </div>

        {saving && <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">Saving changes…</p>}
        <div className="min-h-32 max-h-[65dvh] overflow-y-auto overscroll-contain p-3">
          {showActivity && visibleRows.length > 0 && (
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">
                Active notifications
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 px-3 text-xs"
                onClick={() => void updatePreference(
                  visibleRows.map(row => row.id),
                  () => clearAllActivityEntries(meKey, visibleRows.map(row => row.id)),
                  "Some notifications could not be cleared. They have been restored; please try again.",
                )}
              >
                Clear all
              </Button>
            </div>
          )}
          {!showActivity ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              The branch activity feed is for supervisors.
            </p>
          ) : missing ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              The activity log needs a database update. Follow
              <span className="font-medium"> docs/database-upgrade.md</span> for an existing
              database.
            </p>
          ) : (
            <AnimatedList
              items={displayedRows}
              getKey={activityKey}
              empty={
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {saving ? "Notifications cleared from this view. Saving…" : "You’re all caught up."}
                </p>
              }
              renderItem={(r) => (
                <div
                  className={cn(
                    "activity-notification-row mb-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-3 last:mb-0",
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
                    <p className="min-w-0 text-xs font-medium">{eventText(r.title)}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-9 touch-manipulation gap-1 px-2 text-xs text-muted-foreground"
                      disabled={preferenceBusy.has(`${preferenceScope}:${r.id}`)}
                      aria-busy={preferenceBusy.has(`${preferenceScope}:${r.id}`)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void updatePreference(
                          [r.id],
                          () => clearActivityEntry(meKey, r.id),
                          "Could not clear notification. Check the connection and try again.",
                        );
                      }}
                    >
                      {preferenceBusy.has(`${preferenceScope}:${r.id}`) ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                      {preferenceBusy.has(`${preferenceScope}:${r.id}`) ? "Saving…" : "Clear"}
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
          {displayedRows.length < visibleRows.length && <Button type="button" variant="outline" className="mt-2 w-full"
            onClick={() => setDisplayLimit(value => value + 30)}>
            Show more ({displayedRows.length} of {visibleRows.length})
          </Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
