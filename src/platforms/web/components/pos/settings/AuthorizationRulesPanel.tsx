/**
 * Which sensitive actions need authorising, and who may give it.
 *
 * A rule saved here is what the till obeys: the browser only edits the row,
 * the server re-reads it for every action it gates.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import { notifyError } from "@/lib/notify";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  getAuthorizationRules,
  listAuthorizationPeople,
  saveAuthorizationRule,
} from "@/lib/authorization-client";
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
type AuthorizationPerson = { id: string; name: string; role: string; storeId?: string };
const WIRED_ACTIONS = new Set([
  "refund",
  "void_cart",
  "void_line",
  "reduce_qty",
  "discount_over_limit",
  "price_override",
  "shift_close",
  "stock_transfer",
]);

function PeopleMultiSelect({
  id,
  label,
  help,
  people,
  selected,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  people: AuthorizationPerson[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = people.filter((person) =>
    [person.name, person.id, person.role, person.storeId ?? ""].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
  const selectedKey = new Set(selected.map((value) => value.toLowerCase()));
  const toggle = (personId: string, checked: boolean) =>
    onChange(
      checked
        ? [...new Set([...selected, personId])]
        : selected.filter((value) => value.toLowerCase() !== personId.toLowerCase()),
    );

  return (
    <fieldset className="space-y-2 sm:col-span-2" disabled={disabled}>
      <div>
        <Label htmlFor={`${id}-search`} className="text-xs text-muted-foreground">
          {label} · {selected.length} selected
        </Label>
        <p className="text-[10px] text-muted-foreground">{help}</p>
      </div>
      <Input
        id={`${id}-search`}
        className="h-8"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name, staff ID, role or branch"
      />
      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
        {visible.map((person) => (
          <label
            key={`${id}-${person.id}`}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={selectedKey.has(person.id.toLowerCase())}
              onChange={(event) => toggle(person.id, event.target.checked)}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
            <span className="text-muted-foreground">{person.id}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {person.role}
            </span>
            {person.storeId ? (
              <span className="text-muted-foreground">{person.storeId}</span>
            ) : null}
          </label>
        ))}
        {!visible.length ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {people.length ? "No staff match this search." : "No active staff were found."}
          </p>
        ) : null}
      </div>
      {selected.filter(
        (idValue) => !people.some((person) => person.id.toLowerCase() === idValue.toLowerCase()),
      ).length ? (
        <p className="text-[10px] text-amber-600">
          Some previously selected staff are no longer active or visible in this branch. Remove them
          by saving a replacement selection.
        </p>
      ) : null}
    </fieldset>
  );
}

export function AuthorizationRulesPanel({
  storeId,
  storeName,
  mayEdit,
  canEditGlobal,
}: {
  storeId: string;
  storeName: string;
  mayEdit: boolean;
  canEditGlobal: boolean;
}) {
  const [branchScope, setBranchScope] = useState(!canEditGlobal);
  const [rules, setRules] = useState<RuleMap>({});
  const [draft, setDraft] = useState<RuleMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<AuthorizationPerson[]>([]);
  const queryClient = useQueryClient();

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

  useEffect(() => {
    if (!mayEdit) return;
    let cancelled = false;
    void (async () => {
      const auth = await getPosCallerAuth();
      const result = await listAuthorizationPeople({
        data: { ...auth, storeId: branchScope ? storeId : "" },
      });
      if (!cancelled && result.ok) setPeople(result.people);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchScope, mayEdit, storeId]);

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
        toast.error("Sign in with an account that has POS settings permission");
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
          approvalTimeoutMinutes: rule.approvalTimeoutMinutes,
          escalationAfterMinutes: rule.escalationAfterMinutes,
          escalationRoles: rule.escalationRoles,
          requireReason: rule.requireReason,
          threshold: rule.threshold,
        },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the rule");
        return;
      }
      setRules((r) => ({ ...r, [actionKey]: rule }));
      await queryClient.invalidateQueries({ queryKey: ["authorization-rules"] });
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
            Choose the method, who may request it, who may approve it, their limits, expiry and
            escalation. Every request and decision is recorded in the approval history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Switch
            id="authz-branch-scope"
            checked={branchScope}
            onCheckedChange={setBranchScope}
            disabled={!storeId || !canEditGlobal}
          />
          <Label htmlFor="authz-branch-scope" className="text-xs">
            {branchScope ? `Only ${storeName}` : "Global default"}
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
        items={AUTH_GROUPS.filter((group) =>
          AUTH_ACTIONS.some((action) => action.group === group.id && WIRED_ACTIONS.has(action.key)),
        ).map((group) => ({
          id: group.id,
          title: group.label,
          blurb: group.blurb,
          content: (
            <div className="space-y-4 pb-2">
              {AUTH_ACTIONS.filter(
                (action) => action.group === group.id && WIRED_ACTIONS.has(action.key),
              ).map((action) => {
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

                    <p className="text-[11px] text-muted-foreground">
                      {AUTH_MODES.find((mode) => mode.value === rule.mode)?.blurb}
                    </p>

                    {rule.mode !== "none" && (
                      <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Who may authorise — roles
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
                          <p className="text-[10px] text-muted-foreground">
                            A person may authorise when their role is selected OR they are selected
                            individually below. Clear every role to allow named people only.
                          </p>
                        </div>
                        {(rule.mode === "request" || rule.mode === "either") && (
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
                        )}
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Extra approval authority by role or person
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
                            placeholder="role:manager=20, user:lead1=5"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Added to the requester’s own limit. For discount rules, values are
                            percentage points; refund rules use currency; transfers use quantity.
                          </p>
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
                          <p className="text-[10px] text-muted-foreground">
                            Hard cap after extra authority is added. Leave blank for no separate
                            cap.
                          </p>
                          {Object.keys(rule.authorityLimits).length ? (
                            <p className="text-[10px] text-muted-foreground">
                              Existing absolute approval limits remain active until replaced by an
                              extra-authority value.
                            </p>
                          ) : null}
                        </div>
                        <PeopleMultiSelect
                          id={`approve-${action.key}`}
                          label="Who may authorise — specific users"
                          help="Select one or more active staff members. Only people matching a selected role or specifically named here receive this request."
                          people={people}
                          selected={rule.allowedUserIds}
                          disabled={!mayEdit}
                          onChange={(allowedUserIds) => patch(action.key, { allowedUserIds })}
                        />
                        {(rule.mode === "request" || rule.mode === "either") && (
                          <PeopleMultiSelect
                            id={`request-${action.key}`}
                            label="Who may request — specific users"
                            help="Optional named requesters are combined with the requester roles above."
                            people={people}
                            selected={rule.requesterUserIds}
                            disabled={!mayEdit}
                            onChange={(requesterUserIds) => patch(action.key, { requesterUserIds })}
                          />
                        )}
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
                        {(rule.mode === "request" || rule.mode === "either") && (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Approval expires after (minutes)
                              </Label>
                              <Input
                                className="numeric h-8 w-28"
                                inputMode="numeric"
                                disabled={!mayEdit}
                                value={rule.approvalTimeoutMinutes}
                                onChange={(event) =>
                                  patch(action.key, {
                                    approvalTimeoutMinutes: Math.min(
                                      1440,
                                      Math.max(1, Number(event.target.value) || 1),
                                    ),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Escalate after (minutes, optional)
                              </Label>
                              <Input
                                className="numeric h-8 w-28"
                                inputMode="numeric"
                                disabled={!mayEdit}
                                value={rule.escalationAfterMinutes ?? ""}
                                onChange={(event) =>
                                  patch(action.key, {
                                    escalationAfterMinutes:
                                      event.target.value === ""
                                        ? null
                                        : Math.min(
                                            1440,
                                            Math.max(1, Number(event.target.value) || 1),
                                          ),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs text-muted-foreground">
                                Backup approver roles (comma separated)
                              </Label>
                              <Input
                                className="h-8"
                                disabled={!mayEdit}
                                value={rule.escalationRoles.join(", ")}
                                onChange={(event) =>
                                  patch(action.key, {
                                    escalationRoles: event.target.value
                                      .split(",")
                                      .map((value) => value.trim().toLowerCase())
                                      .filter(Boolean),
                                  })
                                }
                                placeholder="e.g. admin, regional_manager"
                              />
                            </div>
                          </>
                        )}
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
