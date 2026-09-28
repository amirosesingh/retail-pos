/**
 * Which sensitive actions need authorising, and who may give it.
 *
 * A rule saved here is what the till obeys: the browser only edits the row,
 * the server re-reads it for every action it gates.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import { notifyError } from "@/lib/notify";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { getAuthorizationRules, saveAuthorizationRule } from "@/lib/authorization-client";
import {
  AUTH_ACTIONS,
  AUTH_GROUPS,
  AUTH_MODES,
  defaultRule,
  normalizeRule,
  resolveRules,
  type AuthMode,
  type AuthorizationRule,
  type RuleMap,
} from "@/lib/authorization";

const ROLE_CHOICES = ["admin", "manager", "staff"];

export function AuthorizationRulesPanel({
  storeId,
  storeName,
  mayEdit,
}: {
  storeId: string;
  storeName: string;
  mayEdit: boolean;
}) {
  const [branchScope, setBranchScope] = useState(false);
  const [rules, setRules] = useState<RuleMap>({});
  const [draft, setDraft] = useState<RuleMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const auth = await getPosCallerAuth();
        const res = await getAuthorizationRules({
          data: { ...auth, storeId: branchScope ? storeId : "" },
        });
        if (cancelled) return;
        if (!res.ok) setError(res.error ?? "");
        else setError("");
        const rows = (res.rules ?? []).map((r) => normalizeRule({ ...r, action_key: r.actionKey }));
        const resolved = resolveRules(rows, branchScope ? storeId : "");
        setRules(resolved);
        setDraft(resolved);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchScope, storeId]);

  const patch = (key: string, change: Partial<AuthorizationRule>) =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? defaultRule(key as never)), ...change } }));

  const dirty = useMemo(
    () =>
      new Set(
        Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(rules[k])),
      ),
    [draft, rules],
  );

  async function save(actionKey: string) {
    const rule = draft[actionKey];
    if (!rule) return;
    setSaving(actionKey);
    try {
      const auth = await getPosCallerAuth();
      if (!auth.accessToken) {
        toast.error("Sign in with an administrator account to change this");
        return;
      }
      const res = await saveAuthorizationRule({
        data: {
          accessToken: auth.accessToken,
          actionKey,
          scopeType: branchScope ? "branch" : "global",
          scopeId: branchScope ? storeId : "",
          mode: rule.mode,
          allowedRoles: rule.allowedRoles,
          allowedUserIds: rule.allowedUserIds,
          requesterRoles: rule.requesterRoles,
          requesterUserIds: rule.requesterUserIds,
          authorityLimits: rule.authorityLimits,
          extraAuthority: rule.extraAuthority,
          absoluteCeilings: rule.absoluteCeilings,
          requireReason: rule.requireReason,
          threshold: rule.threshold,
        },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the rule");
        return;
      }
      setRules((r) => ({ ...r, [actionKey]: rule }));
      toast.success("Rule saved");
    } catch (e) {
      notifyError(e, "Could not save the rule");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Authorisation rules
          </h2>
          <p className="text-xs text-muted-foreground">
            For each sensitive action, choose how it must be authorised and who may authorise it.
            Administrators are never prompted — their approval is recorded automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Switch
            id="authz-branch-scope"
            checked={branchScope}
            onCheckedChange={setBranchScope}
            disabled={!storeId}
          />
          <Label htmlFor="authz-branch-scope" className="text-xs">
            {branchScope ? `Only ${storeName}` : "All branches"}
          </Label>
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <SettingsSections
        storageKey="authorization-rules"
        items={AUTH_GROUPS.map((group) => ({
          id: group.id,
          title: group.label,
          blurb: group.blurb,
          content: (
            <div className="space-y-4 pb-2">
              {AUTH_ACTIONS.filter((a) => a.group === group.id).map((action) => {
                const rule = draft[action.key] ?? defaultRule(action.key);
                return (
                  <div
                    key={action.key}
                    className="space-y-3 border-t border-border/60 pt-3 first:border-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Label className="text-sm">{action.label}</Label>
                        <p className="text-xs text-muted-foreground">{action.blurb}</p>
                      </div>
                      <div className={mayEdit ? "" : "pointer-events-none opacity-60"}>
                        <ThemedSelect
                          ariaLabel={`${action.label} authorisation`}
                          className="h-8 w-48"
                          value={rule.mode}
                          onChange={(v) => patch(action.key, { mode: v as AuthMode })}
                          options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label }))}
                        />
                      </div>
                    </div>

                    {rule.mode !== "none" && (
                      <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Roles that may authorise
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {ROLE_CHOICES.map((role) => (
                              <label key={role} className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  disabled={!mayEdit}
                                  checked={rule.allowedRoles.includes(role)}
                                  onChange={(e) =>
                                    patch(action.key, {
                                      allowedRoles: e.target.checked
                                        ? [...rule.allowedRoles, role]
                                        : rule.allowedRoles.filter((r) => r !== role),
                                    })
                                  }
                                />
                                {role}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Roles allowed to request escalation
                          </Label>
                          <div className="flex flex-wrap gap-3">
                            {["cashier", ...ROLE_CHOICES].map((role) => (
                              <label
                                key={`request-${role}`}
                                className="flex items-center gap-1 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  disabled={!mayEdit}
                                  checked={rule.requesterRoles.includes(role)}
                                  onChange={(e) =>
                                    patch(action.key, {
                                      requesterRoles: e.target.checked
                                        ? [...rule.requesterRoles, role]
                                        : rule.requesterRoles.filter((r) => r !== role),
                                    })
                                  }
                                />
                                {role}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Extra approval authority (for example role:manager=20, user:lead1=5)
                          </Label>
                          <Input
                            className="h-8"
                            disabled={!mayEdit}
                            value={Object.entries(rule.extraAuthority)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(", ")}
                            onChange={(e) =>
                              patch(action.key, {
                                extraAuthority: Object.fromEntries(
                                  e.target.value
                                    .split(",")
                                    .map((part) => part.trim().split("="))
                                    .filter(
                                      ([key, value]) =>
                                        key &&
                                        value !== undefined &&
                                        Number.isFinite(Number(value)) &&
                                        Number(value) >= 0,
                                    )
                                    .map(([key, value]) => [key.toLowerCase(), Number(value)]),
                                ),
                              })
                            }
                            placeholder="Added to the requester's direct limit; percentage values are points"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Optional absolute maximum
                          </Label>
                          <Input
                            className="h-8"
                            disabled={!mayEdit}
                            value={Object.entries(rule.absoluteCeilings)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(", ")}
                            onChange={(e) =>
                              patch(action.key, {
                                absoluteCeilings: Object.fromEntries(
                                  e.target.value
                                    .split(",")
                                    .map((part) => part.trim().split("="))
                                    .filter(
                                      ([key, value]) =>
                                        key &&
                                        value !== undefined &&
                                        Number.isFinite(Number(value)) &&
                                        Number(value) >= 0,
                                    )
                                    .map(([key, value]) => [key.toLowerCase(), Number(value)]),
                                ),
                              })
                            }
                            placeholder="Optional hard cap, e.g. role:manager=40"
                          />
                          {Object.keys(rule.authorityLimits).length ? (
                            <p className="text-[10px] text-muted-foreground">
                              Existing absolute approval limits remain active until replaced by an
                              extra-authority value.
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Named people (staff IDs, comma separated)
                          </Label>
                          <Input
                            className="h-8"
                            disabled={!mayEdit}
                            value={rule.allowedUserIds.join(", ")}
                            onChange={(e) =>
                              patch(action.key, {
                                allowedUserIds: e.target.value
                                  .split(",")
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="e.g. manager1, supervisor2"
                          />
                        </div>
                        {action.thresholdLabel ? (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              {action.thresholdLabel}
                            </Label>
                            <Input
                              className="numeric h-8 w-28"
                              inputMode="decimal"
                              disabled={!mayEdit}
                              value={rule.threshold === null ? "" : String(rule.threshold)}
                              onChange={(e) =>
                                patch(action.key, {
                                  threshold:
                                    e.target.value === "" ? null : Number(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`reason-${action.key}`}
                            disabled={!mayEdit}
                            checked={rule.requireReason}
                            onCheckedChange={(v) => patch(action.key, { requireReason: v })}
                          />
                          <Label htmlFor={`reason-${action.key}`} className="text-xs">
                            Require a reason
                          </Label>
                        </div>
                      </div>
                    )}

                    {mayEdit && dirty.has(action.key) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving === action.key}
                        onClick={() => void save(action.key)}
                      >
                        {saving === action.key ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                        Save “{action.label}”
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ),
        }))}
      />
    </section>
  );
}
