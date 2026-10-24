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
import { queueRulesSave } from "@/lib/pos-rules-offline";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { posFetch, serverOrigin } from "@/lib/server-origin";
import { requestIdleTimeout } from "@/lib/idle-timeout-client";
import { isWindowsShell } from "@/platform-config/features";
import { broadcastSettingsChange } from "@/lib/sync-engine";
import { reconcileRulesDraft } from "@/lib/pos-rules-draft";

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
    rules,
    loading,
    failureText,
    refresh,
    confirmSaved,
    status,
    branchId,
    terminalId: terminal,
    rowVersion,
  } = usePosRules();

  const { currentStore } = usePos();
  const { isAdmin, can } = useAuth();
  const mayEdit = isAdmin || can("can_access_pos_settings");

  const [draft, setDraft] = useState<PosRules>(rules);
  const [saving, setSaving] = useState(false);
  const [idle, setIdle] = useState(30);
  const [idleScope, setIdleScope] = useState<"branch" | "global">("branch");
  const [savingIdle, setSavingIdle] = useState(false);
  const [idleLoaded, setIdleLoaded] = useState(false);
  const [savedIdle, setSavedIdle] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const previouslyConfirmed = useRef(rules);
  const draftScope = useRef(currentStore.id);
  const forceNextRules = useRef(false);

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
    const changedBranch = draftScope.current !== currentStore.id;
    // React may run the updater after the refs below have advanced.
    const previous = previouslyConfirmed.current;
    const force = forceNextRules.current || changedBranch;
    setDraft((current) =>
      reconcileRulesDraft(
        current,
        previous,
        rules,
        force,
      ),
    );
    previouslyConfirmed.current = rules;
    draftScope.current = currentStore.id;
    forceNextRules.current = false;
  }, [currentStore.id, rules]);

  const dirty = !rulesEqual(draft, rules);
  const idleDirty = idleLoaded && savedIdle !== null && idle !== savedIdle;

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

  const set = (key: PosRuleKey, value: boolean | number) =>
    setDraft((d) => key === "require_counted_cash_on_close"
      ? withClosingCashCount(d, Boolean(value))
      : ({ ...d, [key]: value }) as PosRules);

  /**
   * Keep the change on this terminal and let the sync worker deliver it.
   * Used when the central system cannot be reached right now.
   */
  async function keepLocally(reason: string) {
    if (!isWindowsShell())
      throw new Error("Rules can only be saved while connected on this device.");
    await queueRulesSave({
      terminalId: terminal,
      branchId: branchId || currentStore.id,
      rules: draft,
      patch: draft as unknown as Record<string, boolean | number>,
      expectedVersion: rowVersion,
    });
    await refresh();
    toast.success("Saved on this terminal", {
      description: `${reason} These rules are in force here and will reach head office on the next connection.`,
    });
  }

  async function save() {
    setSaving(true);
    try {
      const auth = await getPosCallerAuth();
      if (!auth.accessToken) {
        // Signed in at the till but with no central session — the change is
        // still kept, and the server re-checks the account when it arrives.
        await keepLocally("Head office could not be reached.");
        return;
      }
      const payload = {
        ...auth,
        accessToken: auth.accessToken,
        storeId: currentStore.id,
        patch: draft as unknown as Record<string, boolean | number>,
        expectedVersion: rowVersion,
      };
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
      if (!res.ok) {
        if (/STALE_RULES/i.test(res.error ?? "")) {
          forceNextRules.current = true;
          await refresh();
          toast.error(
            "These settings were changed on another terminal. The latest version has been loaded.",
          );
          return;
        }
        // A refusal is a refusal; only an unreachable system is queued.
        toast.error(res.error ?? "Could not save rules");
        return;
      }
      if ("snapshot" in res && res.snapshot) await confirmSaved(res.snapshot);
      else await refresh();
      await broadcastSettingsChange("pos_store_settings");
      toast.success("Rules saved");
    } catch (e) {
      if (!isWindowsShell()) {
        notifyError(e, "Could not save rules");
        return;
      }
      try {
        await keepLocally("Head office could not be reached.");
      } catch {
        notifyError(e, "Could not save rules");
      }
    } finally {
      setSaving(false);
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
                        <HelpTip text={field.blurb} label={`About ${field.label}`} />
                      </div>
                      {field.kind === "switch" ? (
                        <Switch
                          aria-label={field.label}
                          disabled={!mayEdit}
                          checked={field.key === "require_counted_cash_on_close" ? requiresClosingCashCount(draft) : Boolean(draft[field.key])}
                          onCheckedChange={(v) => set(field.key, v)}
                        />
                      ) : (
                        <Input
                          aria-label={field.label}
                          className="numeric h-8 w-28 shrink-0"
                          inputMode="decimal"
                          disabled={!mayEdit}
                          value={String(draft[field.key])}
                          onChange={(e) => set(field.key, Number(e.target.value) || 0)}
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
              disabled={!dirty || saving}
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
