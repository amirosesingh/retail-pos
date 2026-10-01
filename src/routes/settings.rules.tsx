import { PresetNumber } from "@/components/ui/preset-number";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";

import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { SaveIndicator } from "@/platforms/web/components/pos/settings/SaveIndicator";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import { AuthorizationRulesPanel } from "@/platforms/web/components/pos/settings/AuthorizationRulesPanel";
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
import { broadcastSettingsChange } from "@/lib/sync-engine";
import { reconcileRulesDraft } from "@/lib/pos-rules-draft";

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
    failureText,
    backendError,
    lastSyncedAt,
    refresh,
    confirmSaved,
    status,
    statusText,
    source,
    revision,
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
    setDraft((current) =>
      reconcileRulesDraft(
        current,
        previouslyConfirmed.current,
        rules,
        forceNextRules.current || changedBranch,
      ),
    );
    previouslyConfirmed.current = rules;
    draftScope.current = currentStore.id;
    forceNextRules.current = false;
  }, [currentStore.id, rules]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);
  const idleDirty = idleLoaded && savedIdle !== null && idle !== savedIdle;

  const statusView =
    status === "LIVE"
      ? {
          title: "Rules active",
          detail: "Verified with the central database.",
          icon: CheckCircle2,
          tone: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        }
      : status === "PENDING_UPLOAD"
        ? {
            title: "Rules active · Pending sync",
            detail:
              "This terminal is enforcing the saved change while it waits to reach head office.",
            icon: RefreshCw,
            tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          }
        : status === "DEGRADED"
          ? {
              title: "Rules active · Offline",
              detail:
                "The last verified rules remain in force. This page will catch up automatically.",
              icon: CloudOff,
              tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            }
          : status === "SYNCING"
            ? {
                title: "Checking rules",
                detail: "Checking the central database for this branch's enforced rules.",
                icon: RefreshCw,
                tone: "border-primary/30 bg-primary/5 text-foreground",
              }
            : {
                title:
                  status === "IDENTITY_UNAVAILABLE" ? "Branch required" : "Rules need attention",
                detail:
                  failureText ||
                  "This terminal has not received verified branch rules. Restrictive safety rules apply.",
                icon: TriangleAlert,
                tone: "border-destructive/40 bg-destructive/10 text-destructive",
              };
  const StatusIcon = statusView.icon;

  async function checkRulesNow() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

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

  return (
    <SettingsShell>
      <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
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
              Configure the branch policy enforced across every register at {currentStore.name}.
              Saved values stay in force while newer rules are checked quietly in the background.
            </p>
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

        <section className={`rounded-lg border p-4 text-sm ${statusView.tone}`}>
          <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
            <StatusIcon
              className={`mt-0.5 size-5 shrink-0 ${status === "SYNCING" ? "animate-spin" : ""}`}
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{statusView.title}</h2>
              <p className="mt-0.5 text-xs opacity-90">{statusView.detail}</p>
              <p className="mt-2 text-xs opacity-80">
                {lastSyncedAt
                  ? `Last verified ${new Date(lastSyncedAt).toLocaleString()}`
                  : "Not yet verified on this terminal"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={() => void checkRulesNow()}
            >
              {checking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Check now
            </Button>
          </div>
          <details className="mt-3 border-t border-current/15 pt-2 text-xs opacity-85">
            <summary className="cursor-pointer select-none font-medium">Technical details</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <div>
                <dt className="opacity-70">Branch</dt>
                <dd>{currentStore.name}</dd>
              </div>
              <div>
                <dt className="opacity-70">Branch ID</dt>
                <dd className="break-all">{branchId || currentStore.id || "—"}</dd>
              </div>
              <div>
                <dt className="opacity-70">Terminal</dt>
                <dd className="break-all">{terminal || "—"}</dd>
              </div>
              <div>
                <dt className="opacity-70">Source</dt>
                <dd>{source}</dd>
              </div>
              <div>
                <dt className="opacity-70">Revision</dt>
                <dd className="break-all">{revision || "—"}</dd>
              </div>
              <div>
                <dt className="opacity-70">Engine status</dt>
                <dd>{status}</dd>
              </div>
            </dl>
            <p className="mt-2">{statusText}</p>
            {backendError ? <p className="mt-1 break-words opacity-75">{backendError}</p> : null}
          </details>
        </section>

        <section className="rounded-lg border border-border bg-card px-5">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 py-4">
            <div>
              <h2 className="text-sm font-semibold">Operational rules</h2>
              <p className="text-xs text-muted-foreground">
                Shift, pricing, refund and manager-approval controls.
              </p>
            </div>
            <SaveIndicator
              dirty={dirty}
              saving={saving}
              savedText="Rules saved"
              dirtyText="Unsaved rule changes"
            />
          </div>
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

        <AuthorizationRulesPanel
          storeId={currentStore.id}
          storeName={currentStore.name}
          mayEdit={mayEdit}
          canEditGlobal={isAdmin}
        />

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
              savedText="Operational rules saved"
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
    </SettingsShell>
  );
}
