import { PresetNumber } from "@/components/ui/preset-number";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";

import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { SaveIndicator } from "@/platforms/web/components/pos/settings/SaveIndicator";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import { AuthorizationRulesPanel } from "@/platforms/web/components/pos/settings/AuthorizationRulesPanel";
import { ScopePanel } from "@/platforms/web/components/pos/settings/ScopeControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { RULE_GROUPS, type PosRules, type PosRuleKey } from "@/lib/pos-rules";
import { savePosRules } from "@/lib/pos-rules.functions";
import { queueRulesSave } from "@/lib/pos-rules-offline";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { posFetch, serverOrigin } from "@/lib/server-origin";
import { requestIdleTimeout } from "@/lib/idle-timeout-client";
import { isWindowsShell } from "@/platform-config/features";

export const Route = createFileRoute("/settings/rules")({
  head: () => ({
    meta: [
      { title: "POS Rules & Enforcement · Register Settings" },
      {
        name: "description",
        content:
          "Configure shift, discount, refund and terminal security rules enforced across every register.",
      },
      { property: "og:title", content: "POS Rules & Enforcement" },
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

function RulesSettings() {
  const {
    rules,
    loading,
    usingDefaults,
    degraded,
    failureText,
    backendError,
    lastSyncedAt,
    refresh,
    status,
    statusText,
    source,
    revision,
    branchId,
    terminalId: terminal,
    rowVersion,
  } = usePosRules();

  const { currentStore, state, updateSettings, saveConfiguredSettings } = usePos();
  const { isAdmin, can } = useAuth();
  const mayEdit = isAdmin || can("can_access_pos_settings");

  const [draft, setDraft] = useState<PosRules>(rules);
  const [saving, setSaving] = useState(false);
  const [idle, setIdle] = useState(30);
  const [idleScope, setIdleScope] = useState<"branch" | "global">("branch");
  const [savingIdle, setSavingIdle] = useState(false);
  const [idleLoaded, setIdleLoaded] = useState(false);
  const [savingScoped, setSavingScoped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIdleLoaded(false);
    void requestIdleTimeout(currentStore.id, undefined, idleScope)
      .then((result) => {
        if (!cancelled && typeof result.minutes === "number") {
          setIdle(result.minutes);
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

  async function saveScopedSettings() {
    setSavingScoped(true);
    try {
      await saveConfiguredSettings();
      toast.success("Trading hours and review thresholds saved");
    } catch (error) {
      notifyError(error, "Could not save the scoped settings");
    } finally {
      setSavingScoped(false);
    }
  }

  // Rules live in the database; the draft only mirrors the last server read.
  useEffect(() => setDraft(rules), [rules]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);

  const set = (key: PosRuleKey, value: boolean | number) =>
    setDraft((d) => ({ ...d, [key]: value }) as PosRules);

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
            ...((await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }),
            ok: response.ok,
          }))
        : await savePosRules({ data: payload });
      if (!res.ok) {
        if (/STALE_RULES/i.test(res.error ?? "")) {
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
      await refresh();
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

  return (
    <SettingsShell>
      <div className="mx-auto w-full max-w-4xl space-y-5 p-6">
        <div className="sticky top-0 z-20 -mx-6 -mt-6 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
            <Link to="/settings">
              <ArrowLeft className="size-4" /> All settings
            </Link>
          </Button>
        </div>

        <SettingsTabs current="/settings/rules" />

        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="size-5 shrink-0 text-primary" /> POS rules &amp; enforcement
            </h1>
            <p className="text-sm text-muted-foreground">
              Operational limits for {currentStore.name}. Stored in the database and re-checked on
              the server for every till action — never cached in the browser.
            </p>
          </div>
          {loading && (
            <Loader2 className="mt-2 size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </header>

        <ScopePanel sections={["review", "hours", "terminalSecurity"]} />

        {!mayEdit && (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            These rules are managed by an administrator. You can see what is enforced, but not
            change it.
          </p>
        )}

        {usingDefaults && !loading && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {failureText || "The saved rules could not be read."} The strictest built-in settings
            are being enforced right now, and anything you save here may not take effect until the
            connection is back.
            {backendError ? (
              <span className="mt-1 block text-xs opacity-80">{backendError}</span>
            ) : null}
          </p>
        )}

        {degraded && !loading && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            {failureText || "The saved rules could not be refreshed."} The last confirmed settings
            {lastSyncedAt ? ` (read ${new Date(lastSyncedAt).toLocaleTimeString()})` : ""} are still
            in force, and this page will catch up on its own once the connection returns.
            {backendError ? (
              <span className="mt-1 block text-xs opacity-80">{backendError}</span>
            ) : null}
          </p>
        )}

        <section className="rounded-lg border border-border bg-card p-4 text-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-medium">Rules status</h2>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              Check now
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide">Branch</dt>
              <dd className="text-foreground">{currentStore.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Branch ID</dt>
              <dd className="text-foreground">{branchId || currentStore.id || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Terminal</dt>
              <dd className="text-foreground">{terminal || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Source</dt>
              <dd className="text-foreground">{source}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Revision</dt>
              <dd className="text-foreground">{revision || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Status</dt>
              <dd className="text-foreground">{status}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide">Last successful sync</dt>
              <dd className="text-foreground">
                {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "never on this terminal"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{statusText}</p>
        </section>

        <section className="rounded-lg border border-border bg-card px-5">
          <SettingsSections
            storageKey="rules"
            items={RULE_GROUPS.map((group) => ({
              id: group.id,
              title: group.label,
              blurb: group.blurb,
              content: (
                <div className="space-y-3 pb-2">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/60 pt-3 first:border-0 first:pt-0"
                    >
                      <div className="min-w-0">
                        <Label className="text-sm">{field.label}</Label>
                        <p className="text-xs text-muted-foreground">{field.blurb}</p>
                      </div>
                      {field.kind === "switch" ? (
                        <Switch
                          aria-label={field.label}
                          disabled={!mayEdit}
                          checked={Boolean(draft[field.key])}
                          onCheckedChange={(v) => set(field.key, v)}
                        />
                      ) : field.key === "auto_lock_timeout_seconds" ? (
                        <PresetNumber
                          label={field.label}
                          disabled={!mayEdit}
                          value={
                            state.settings.integrations.autoLockTimeoutSeconds ??
                            Number(draft[field.key])
                          }
                          onChange={(v) =>
                            updateSettings({
                              integrations: {
                                ...state.settings.integrations,
                                autoLockTimeoutSeconds: v,
                              },
                            })
                          }
                          min={0}
                          max={86400}
                          options={[0, 30, 60, 90, 180, 300, 600, 900, 1800, 3600].map((value) => ({
                            value,
                            label:
                              value === 0
                                ? "Disabled"
                                : value < 60
                                  ? `${value} seconds`
                                  : `${value / 60} minutes`,
                          }))}
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

        <section className="space-y-5 rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Trading hours &amp; review thresholds</h2>
            <p className="text-xs text-muted-foreground">
              These values use the scope selected above and are consumed by checkout, shift alerts
              and the manager review dashboard.
            </p>
          </div>
          <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Trading day starts</span>
              <Input
                type="time"
                disabled={!mayEdit}
                value={state.settings.hours.dayStart}
                onChange={(event) =>
                  updateSettings({
                    hours: { ...state.settings.hours, dayStart: event.target.value },
                  })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Trading day ends</span>
              <Input
                type="time"
                disabled={!mayEdit}
                value={state.settings.hours.dayEnd}
                onChange={(event) =>
                  updateSettings({ hours: { ...state.settings.hours, dayEnd: event.target.value } })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Maximum shift hours</span>
              <Input
                type="number"
                min={1}
                max={48}
                disabled={!mayEdit}
                value={state.settings.hours.maxShiftHours}
                onChange={(event) =>
                  updateSettings({
                    hours: {
                      ...state.settings.hours,
                      maxShiftHours: Math.min(48, Math.max(1, Number(event.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Shift reminder (minutes)</span>
              <Input
                type="number"
                min={0}
                max={240}
                disabled={!mayEdit}
                value={state.settings.hours.reminderMinutes}
                onChange={(event) =>
                  updateSettings({
                    hours: {
                      ...state.settings.hours,
                      reminderMinutes: Math.min(240, Math.max(0, Number(event.target.value) || 0)),
                    },
                  })
                }
              />
            </label>
          </div>
          <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["maxVoids", "Voids before review"],
                ["maxRefunds", "Refunds before review"],
                ["maxRefundValue", "Refund value before review"],
                ["maxNoSaleOpens", "No-sale opens before review"],
                ["maxDiscountPct", "Discount % before review"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1 text-sm">
                <span>{label}</span>
                <Input
                  type="number"
                  min={0}
                  disabled={!mayEdit}
                  value={state.settings.review[key]}
                  onChange={(event) =>
                    updateSettings({
                      review: {
                        ...state.settings.review,
                        [key]: Math.max(0, Number(event.target.value) || 0),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {mayEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={savingScoped}
              onClick={() => void saveScopedSettings()}
            >
              {savingScoped ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save trading &amp; review settings
            </Button>
          )}
        </section>

        <AuthorizationRulesPanel
          storeId={currentStore.id}
          storeName={currentStore.name}
          mayEdit={mayEdit}
        />

        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Idle session timeout</h2>
            <p className="text-xs text-muted-foreground">
              Server session idle limit for new sign-ins at this branch (1–1440 minutes). Existing
              sessions keep the limit assigned at sign-in. Use Auto-lock under Terminal security &
              access above to set when the screen returns to sign-in.
            </p>
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
                disabled={savingIdle || !idleLoaded}
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
            <SaveIndicator dirty={dirty} saving={saving} />
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
    </SettingsShell>
  );
}
