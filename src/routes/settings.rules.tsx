import { OperationalRulesPanel } from "@/platforms/web/components/pos/settings/panels/OperationalRulesPanel";
import { SponsorshipSalesPolicy } from "@/platforms/web/components/admin/SponsorshipSalesPolicy";
import { ShiftClosingPolicy } from "@/platforms/web/components/admin/ShiftClosingPolicy";
import { OperationalTablePolicies } from "@/platforms/web/components/admin/OperationalTablePolicies";
import { SettingsBackLink } from "@/platforms/web/components/pos/settings/SettingsBackLink";
import { HelpTip } from "@/components/ui/help-tip";
import { PresetNumber } from "@/components/ui/preset-number";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";

import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { SaveIndicator } from "@/platforms/web/components/pos/settings/SaveIndicator";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { rulesEqual } from "@/lib/pos-rules-pending";
import { RULE_GROUPS, requiresClosingCashCount, withClosingCashCount, type PosRules, type PosRuleKey } from "@/lib/pos-rules";
import { savePosRules } from "@/lib/pos-rules-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { posFetch, serverOrigin } from "@/lib/server-origin";
import { requestIdleTimeout } from "@/lib/idle-timeout-client";
import { broadcastSettingsChange } from "@/lib/sync-engine";
import { changedDrawerLimit, hasVerifiedRulesBaseline, offlineRulesPatch, reconcileRulesDraft } from "@/lib/pos-rules-draft";
import { isTransientRulesSaveFailure } from "@/lib/pos-rules-failure";
import { canonicalBranchId, sameBranchId } from "@/lib/branch-id";
import type { LocalSyncStatus, StoreSettingsEditReview, StoreSettingsEditUpload } from "@/core/local-db/local-db";

const uploadLabels: Partial<Record<StoreSettingsEditUpload["status"], string>> = {
  PENDING: "Edit saved on this till and waiting to upload. Current rules stay in effect.",
  APPLIED: "Edit accepted centrally. Waiting for the confirmed rules to download.",
  AWAITING_DOWNLOAD: "Edit accepted centrally. Waiting for the confirmed rules to download.",
  RETRY: "The queued edit is waiting to retry.",
  AWAITING_OPERATOR: "Store settings upload requires the original authorized staff account.",
  REVIEW_REQUIRED: "The saved edit needs review. Current rules stay in effect.",
  PAUSED: "Store settings synchronization is paused.",
  UNAVAILABLE: "The offline store settings pilot is unavailable on this till.",
};
const reviewLabels = { block_shift_close_on_hold: "Block shift closing while bills are held", max_drawer_cash_limit: "Drawer cash limit" };
const reviewValue = (value: boolean | string | null | undefined) =>
  value === true ? "On" : value === false ? "Off" : value ?? "Unset";

export const Route = createFileRoute("/settings/rules")({
  head: () => ({
    meta: [
      { title: "Operational policies · Register Settings" },
      {
        name: "description",
        content:
          "Configure shift, discount, refund and terminal security rules enforced across every register.",
      },
      { property: "og:title", content: "Operational policies" },
      {
        property: "og:description",
        content: "Shift, discount, refund and terminal security rules for every till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RulesSettings,
});

export function RulesSettings({ embedded = false }: { embedded?: boolean }) {
  const {
    shiftSharingAvailable,
    rules,
    loading,
    failure,
    failureText,
    refresh,
    confirmSaved,
    status,
    branchId,
    terminalId: terminal,
    rowVersion,
    source,
    usingDefaults,
    notVerified,
    cacheScope,
  } = usePosRules();

  const { currentStore } = usePos();
  const { isAdmin, can, user, authUserId, terminalUser } = useAuth();
  const mayEdit = isAdmin || can("can_access_pos_settings");
  const mayEditRules = mayEdit && Boolean(branchId) && sameBranchId(branchId, currentStore.id) &&
    hasVerifiedRulesBaseline({ source, loading, usingDefaults, notVerified });
  const editorScope = JSON.stringify([authUserId, user?.staffId ?? null,
    terminalUser?.cashierId ?? terminalUser?.userCode ?? null, currentStore.id, branchId, terminal, cacheScope]);
  const contextKey = JSON.stringify([mayEditRules, editorScope, source]);
  const editContext = useRef(contextKey);
  const contextEpoch = useRef(0);
  if (editContext.current !== contextKey) {
    editContext.current = contextKey;
    contextEpoch.current++;
  }

  const [draft, setDraft] = useState<PosRules>(rules);
  const [saving, setSaving] = useState(false);
  const [idle, setIdle] = useState(30);
  const [idleScope, setIdleScope] = useState<"branch" | "global">("branch");
  const [savingIdle, setSavingIdle] = useState(false);
  const [idleLoaded, setIdleLoaded] = useState(false);
  const [savedIdle, setSavedIdle] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [drawerLimit, setDrawerLimit] = useState<string | null>(null);
  const [upload, setUpload] = useState<StoreSettingsEditUpload | null>(null);
  const [review, setReview] = useState<{ context: string; comparison: StoreSettingsEditReview } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const draftBase = useRef<{ rules: PosRules; version: number } | null>(null);
  const queuedAttempt = useRef<{ key: string; operationId: string } | null>(null);
  const uncertainOnlineSave = useRef<string | null>(null);
  const previouslyConfirmed = useRef(rules);
  const draftScope = useRef(editorScope);
  const forceNextRules = useRef(false);

  useEffect(() => {
    const sync = window.pos?.sync;
    let active = true;
    const update = (state: LocalSyncStatus) => {
      if (!active) return;
      if (state.storeSettingsEditUpload) setUpload(state.storeSettingsEditUpload);
      else if (state.groupedSettingsPilot?.reason === "ESETTINGS_EDIT_PENDING" && state.groupedSettingsPilot.branchId)
        setUpload({ status: "REVIEW_REQUIRED", branchId: state.groupedSettingsPilot.branchId });
      else if (state.groupedSettingsPilot?.status === "HANDED_BACK") setUpload(null);
    };
    const stop = sync?.subscribe?.(update);
    void sync?.getStatus?.().then(update).catch(() => undefined);
    return () => { active = false; stop?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIdleLoaded(false);
    void requestIdleTimeout(currentStore.id, undefined, idleScope)
      .then((result) => {
        if (!cancelled && typeof result.minutes === "number") {
          setIdle(result.minutes);
          setSavedIdle(result.minutes);
          setIdleLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) notifyError(error, "Could not load the idle limit");
      });
    return () => {
      cancelled = true;
    };
  }, [currentStore.id, idleScope]);

  async function saveIdle() {
    setSavingIdle(true);
    try {
      await requestIdleTimeout(currentStore.id, idle, idleScope);
      setSavedIdle(idle);
      toast.success(
        idleScope === "global"
          ? "Global idle limit saved for new sign-ins"
          : "Branch idle limit saved for new sign-ins",
      );
    } catch (e) {
      notifyError(e, "Could not save the idle limit");
    } finally {
      setSavingIdle(false);
    }
  }

  // Accept background refreshes while the editor is clean. A focus/timer
  // refresh must never erase an unfinished administrator draft.
  useEffect(() => {
    const changedScope = draftScope.current !== editorScope;
    // React may run the updater after the refs below have advanced.
    const previous = previouslyConfirmed.current;
    const force = forceNextRules.current || changedScope;
    if (force) {
      draftBase.current = null;
      queuedAttempt.current = null;
      setDrawerLimit(null);
    }
    setDraft((current) => !force && changedDrawerLimit(drawerLimit, previous.max_drawer_cash_limit)
      ? current : reconcileRulesDraft(current, previous, rules, force));
    previouslyConfirmed.current = rules;
    draftScope.current = editorScope;
    forceNextRules.current = false;
  }, [editorScope, rules, rowVersion, drawerLimit]);

  const dirty = !rulesEqual(draft, rules) || changedDrawerLimit(drawerLimit, rules.max_drawer_cash_limit);
  const idleDirty = idleLoaded && savedIdle !== null && idle !== savedIdle;
  const hasReviewHold = upload?.status === "REVIEW_REQUIRED" && sameBranchId(upload.branchId, currentStore.id);
  const canReview = mayEdit && hasReviewHold && sameBranchId(branchId, currentStore.id) &&
    typeof window !== "undefined" && Boolean(window.pos?.reviewStoreSettingsEdit);
  const comparison = canReview && review?.context === contextKey ? review.comparison : null;

  const saveStatus = dirty ? "Unsaved changes" : status === "LIVE" ? "Saved"
    : status === "PENDING_UPLOAD" ? "Saved on this terminal — upload pending"
    : status === "DEGRADED" ? "Offline — showing last saved settings"
    : loading ? "Loading settings" : "Saved settings unavailable";

  async function checkRulesNow() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  const set = (key: PosRuleKey, value: boolean | number) => {
    if (!mayEditRules || saving) return;
    if (!dirty || !draftBase.current) draftBase.current = { rules, version: rowVersion };
    setDraft((d) => key === "require_counted_cash_on_close"
      ? withClosingCashCount(d, Boolean(value))
      : ({ ...d, [key]: value }) as PosRules);
  };

  async function save() {
    if (!mayEditRules || saving || hasReviewHold || draftScope.current !== editorScope) return;
    if (source === "LOCAL_PENDING") {
      toast.error("Wait for the pending rules to be confirmed before saving another edit. Your draft is still open.");
      return;
    }
    const startedEpoch = contextEpoch.current;
    const assertContext = () => {
      if (contextEpoch.current !== startedEpoch || editContext.current !== contextKey)
        throw Object.assign(new Error("The active branch, connection or permission changed. Review the current saved rules before saving."), { code: "RULES_CONTEXT_CHANGED" });
    };
    setSaving(true);
    let submittedOnline = false;
    try {
      assertContext();
      const queue = typeof window !== "undefined" ? window.pos?.queueStoreSettingsEdit : undefined;
      const offline = (source === "LAST_KNOWN_GOOD" && failure === "network") ||
        (source === "DATABASE" && typeof navigator !== "undefined" && navigator.onLine === false);
      if (queue && offline) {
        if (uncertainOnlineSave.current === editorScope) {
          toast.error("The earlier online save could not be confirmed. Reconnect before saving again.");
          return;
        }
        const base = draftBase.current ?? { rules, version: rowVersion };
        const patch = offlineRulesPatch(draft, base.rules, drawerLimit);
        if (!patch) {
          toast.error("These edits need a connection to head office, or a valid drawer cash limit. Your draft is still open.");
          return;
        }
        const key = JSON.stringify([editorScope, base.version, patch]);
        if (queuedAttempt.current?.key !== key) queuedAttempt.current = { key, operationId: crypto.randomUUID() };
        const operationId = queuedAttempt.current.operationId;
        const result = await queue({ branchId: canonicalBranchId(currentStore.id), expectedVersion: base.version, operationId, patch });
        assertContext();
        if (!result.ok || result.operationId !== operationId) {
          toast.error(result.error ?? "The offline save could not be confirmed. Your draft is still open.");
          return;
        }
        queuedAttempt.current = null;
        draftBase.current = null;
        setDraft(rules);
        setDrawerLimit(null);
        setUpload({ status: "PENDING", branchId: currentStore.id });
        toast.success("Rules edit queued for synchronization");
        return;
      }
      const auth = await getPosCallerAuth();
      assertContext();
      if (!auth.accessToken) {
        toast.error("Connect to head office to save these rules. Your draft is still open.");
        return;
      }
      const payload = {
        ...auth,
        accessToken: auth.accessToken,
        storeId: currentStore.id,
        patch: draft as unknown as Record<string, boolean | number>,
        expectedVersion: draftBase.current?.version ?? rowVersion,
      };
      submittedOnline = true;
      // Native bundles have no local app server; the hosted endpoint derives
      // branch and supervisor authority from these credentials.
      const res = serverOrigin()
        ? await posFetch("/api/public/pos-rules/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async (response) => ({
            ...((await response.json().catch(() => ({}))) as {
              ok?: boolean;
              error?: string;
              snapshot?: unknown;
            }),
            ok: response.ok,
          }))
        : await savePosRules({ data: payload });
      uncertainOnlineSave.current = null;
      assertContext();
      if (!res.ok) {
        if (/STALE_RULES/i.test(res.error ?? "")) {
          forceNextRules.current = true;
          await refresh();
          toast.error(
            "These settings were changed on another terminal. The latest version has been loaded.",
          );
          return;
        }
        toast.error(res.error ?? "Could not save rules");
        return;
      }
      if ("snapshot" in res && res.snapshot) await confirmSaved(res.snapshot);
      else await refresh();
      draftBase.current = null;
      queuedAttempt.current = null;
      setDrawerLimit(null);
      await broadcastSettingsChange("pos_store_settings");
      toast.success("Rules saved");
    } catch (e) {
      if (isTransientRulesSaveFailure(e)) {
        if (submittedOnline) uncertainOnlineSave.current = editorScope;
        toast.error("The save could not be confirmed. Reconnect and refresh the store rules before retrying.");
      } else notifyError(e, "Could not save rules");
    } finally {
      setSaving(false);
    }
  }

  async function reviewSavedEdit(keepCentral: boolean) {
    if (!canReview || reviewing || saving || editContext.current !== contextKey || (keepCentral && !comparison)) return;
    const reviewEdit = window.pos?.reviewStoreSettingsEdit;
    if (!reviewEdit) return;
    const epoch = contextEpoch.current;
    const branchId = canonicalBranchId(currentStore.id);
    setReviewing(true);
    try {
      const result = await reviewEdit(keepCentral && comparison
        ? { action: "keep-central", branchId, operationId: comparison.operationId, decisionSha256: comparison.decisionSha256 }
        : { action: "preview", branchId });
      if (contextEpoch.current !== epoch) return;
      if (!result.ok) {
        if (result.code === "ESETTINGS_REVIEW_CHANGED") setReview(null);
        toast.error(result.error ?? "The saved edit could not be reviewed.");
        return;
      }
      if (keepCentral) {
        if (result.operationId !== comparison?.operationId) throw new Error("The saved review could not be confirmed.");
        setReview(null);
        setUpload(null);
        toast.success("Central rules kept. The original edit and review were saved.");
      } else if (result.review) {
        setReview({ context: contextKey, comparison: result.review });
      } else {
        setReview(null);
        toast.error("There is no stale settings edit to review on this till.");
      }
    } catch (error) {
      if (contextEpoch.current === epoch) notifyError(error, "Could not review the saved settings edit");
    } finally {
      setReviewing(false);
    }
  }

  const Shell = embedded ? Fragment : SettingsShell;
  return (
    <Shell>
      <div className={embedded ? "space-y-4" : "pos-page-container"}>
        {!embedded && <SettingsTabs current="/settings/rules" />}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {!embedded && <SettingsBackLink />}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">Operational policies</h1>
              <p className="text-sm text-muted-foreground page-description">
                Set trading and shift policies for {currentStore.name}. Individual access is managed in Edit permissions.
              </p>
            </div>
          </div>
          {loading && (
            <Loader2 className="mt-2 size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </header>

        {!mayEdit && (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            You can see what is enforced, but changing rules requires the POS settings permission.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">Refresh reads the latest saved branch rules. It does not save your edits.</p>
          <Button variant="outline" size="sm" disabled={checking || saving} onClick={() => void checkRulesNow()}><RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />{checking ? "Refreshing…" : "Refresh"}</Button>
        </div>
        {failureText && status !== "LIVE" && <p role="alert" className="text-sm text-destructive">Could not load current saved settings. Check the connection and reload.</p>}
        {source === "LEGACY_CACHE" && <p role="status" className="text-sm text-muted-foreground">Previous saved rules are preserved for offline operation. Connect to verify this database before editing. Existing pending changes remain pending.</p>}
        {upload && sameBranchId(upload.branchId, currentStore.id) && uploadLabels[upload.status] && <p role="status" className="text-sm text-muted-foreground">{uploadLabels[upload.status]}</p>}
        {canReview && (
          <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Saved offline settings edit">
            {!comparison ? (
              <Button type="button" size="sm" variant="outline" disabled={reviewing || saving} onClick={() => void reviewSavedEdit(false)}>
                Review saved settings edit
              </Button>
            ) : (
              <>
                <h2 className="text-sm font-semibold">Compare the saved edit with central rules</h2>
                <p className="text-sm text-muted-foreground">
                  The edit used revision {comparison.expectedVersion}. Central rules are at revision {comparison.currentVersion}.
                </p>
                <ul className="space-y-2 text-sm">
                  {(Object.keys(comparison.proposedValues) as (keyof typeof reviewLabels)[]).map(field => (
                    <li key={field}>
                      <span className="font-medium">{reviewLabels[field]}</span>
                      <span className="block">Saved edit {reviewValue(comparison.proposedValues[field])}</span>
                      <span className="block">Central value {reviewValue(comparison.currentValues[field])}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">Keeping central rules records the decision. Make and save any new edits separately.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={reviewing || saving} onClick={() => void reviewSavedEdit(true)}>
                    Keep central rules
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={reviewing} onClick={() => setReview(null)}>Cancel</Button>
                </div>
              </>
            )}
          </section>
        )}

        <section className="rounded-lg border border-border bg-card px-5">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 py-4">
            <div>
              <h2 className="text-sm font-semibold">Operational rules</h2>
              <p className="text-xs text-muted-foreground">
                Branch limits for trading, stock and shift reconciliation. User permissions and Approver rules are managed separately.
              </p>
            </div>
            <SaveIndicator
              dirty={dirty}
              saving={saving}
              savedText={saveStatus}
              dirtyText="Unsaved rule changes"
            />
          </div>
          <div className="space-y-3 pt-4">
            <ShiftClosingPolicy />
            <SponsorshipSalesPolicy />
            <OperationalRulesPanel canEdit={mayEdit} />
            <OperationalTablePolicies />
          </div>
          <SettingsSections
            storageKey="rules"
            items={RULE_GROUPS.filter(group => group.id !== "pin-gates").map((group) => ({
              id: group.id,
              title: group.label,
              blurb: group.blurb,
              content: (
                <div className="space-y-3 pb-2">
                  {group.fields.filter(field => !["enable_cashier_x_report", "show_opening_float_at_close", "show_expected_totals_at_close", "show_live_variance_at_close", "show_itemized_tender_breakdown"].includes(field.key)).map((field) => (
                    <div
                      key={field.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/60 pt-3 first:border-0 first:pt-0"
                    >
                      <div className="min-w-0 flex items-center gap-1">
                        <Label className="text-sm">{field.label}</Label>
                        <HelpTip text={field.blurb + (field.key === 'allow_branch_shift_sharing' && !shiftSharingAvailable ? ' This control needs the reviewed cloud and terminal upgrades before it can be changed.' : '')} label={`About ${field.label}`} />
                      </div>
                      {field.kind === "switch" ? (
                        <Switch
                          aria-label={field.label}
                          disabled={!mayEditRules || saving || (field.key === 'allow_branch_shift_sharing' && !shiftSharingAvailable && draft.allow_branch_shift_sharing !== false)}
                          checked={field.key === "require_counted_cash_on_close" ? requiresClosingCashCount(draft) : Boolean(draft[field.key])}
                          onCheckedChange={(v) => set(field.key, v)}
                        />
                      ) : (
                        <Input
                          aria-label={field.label}
                          className="numeric h-8 w-28 shrink-0"
                          inputMode="decimal"
                          disabled={!mayEditRules || saving}
                          value={field.key === "max_drawer_cash_limit" && drawerLimit !== null ? drawerLimit : String(draft[field.key])}
                          onChange={(e) => {
                            set(field.key, Number(e.target.value) || 0);
                            if (field.key === "max_drawer_cash_limit") setDrawerLimit(e.target.value);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ),
            }))}
          />
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Session security</h2>
              <p className="text-xs text-muted-foreground">
                Default sign-out time for new sessions at this branch. A personal limit may be
                shorter, but never longer. Saving here changes only this session setting.
              </p>
            </div>
            {idleLoaded ? (
              <SaveIndicator
                dirty={idleDirty}
                saving={savingIdle}
                savedText="Session limit saved"
                dirtyText="Unsaved session limit"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
            {isAdmin && (
              <select
                aria-label="Idle timeout scope"
                value={idleScope}
                disabled={savingIdle}
                className="h-9 rounded border border-input bg-background px-2 text-sm"
                onChange={(event) => setIdleScope(event.target.value as "branch" | "global")}
              >
                <option value="branch">This branch</option>
                <option value="global">Global default</option>
              </select>
            )}
            <Label className="text-sm">Minutes of inactivity</Label>
            <PresetNumber
              label="Idle session timeout in minutes"
              disabled={!mayEdit || savingIdle || !idleLoaded}
              value={idle}
              onChange={setIdle}
              min={1}
              max={1440}
              options={[1, 5, 10, 15, 30, 60, 120, 240, 480, 1440].map((value) => ({
                value,
                label: `${value} minutes`,
              }))}
            />
            {mayEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={savingIdle || !idleLoaded || !idleDirty}
                onClick={() => void saveIdle()}
              >
                {savingIdle ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save limit
              </Button>
            )}
          </div>
        </section>

        {mayEdit && (
          <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
            <SaveIndicator
              dirty={dirty}
              saving={saving}
              savedText={saveStatus}
              dirtyText="Unsaved operational-rule changes"
            />
            <Button
              size="sm"
              className="ml-auto"
              disabled={!mayEditRules || !dirty || saving || hasReviewHold}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Saving…" : "Save rules"}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}
