/**
 * Which sensitive actions need authorising, and who may give it.
 *
 * The category list is deliberately an overview. Detailed rule configuration
 * lives in one reusable dialog so every action follows the same workflow.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { SettingsSections } from "@/platforms/web/components/pos/settings/SettingsSection";
import {
  authorizationRuleSummary,
  validateAuthorizationRuleConfiguration,
} from "@/platforms/web/components/pos/settings/authorization-rule-configuration";
import { notifyError } from "@/lib/notify";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { subscribeSettingsChange } from "@/lib/sync-engine";
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
  isAuthorizationRuleConflict,
  normalizeRule,
  resolveEditableRules,
  type AuthActionDef,
  type AuthMode,
  type AuthorizationRule,
  type RuleMap,
} from "@/lib/authorization";

const ROLE_CHOICES = ["admin", "manager", "staff"];
const REQUESTER_ROLE_CHOICES = ["cashier", ...ROLE_CHOICES];
const SELECTABLE_AUTH_MODES = AUTH_MODES.filter((mode) => mode.value !== "either");
type SelectableAuthMode = Exclude<AuthMode, "either">;
type AuthorizationPerson = { id: string; name: string; role: string; storeId?: string };
type EditingRule = {
  action: AuthActionDef;
  previousMode: AuthMode;
  rule: AuthorizationRule;
};

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

const AUTHORITY_UNIT: Partial<Record<string, string>> = {
  refund: "amount",
  reduce_qty: "quantity",
  discount_over_limit: "percentage or amount",
  price_override: "amount",
  stock_transfer: "quantity",
};

const methodLabel = (mode: AuthMode) =>
  AUTH_MODES.find((candidate) => candidate.value === mode)?.label ?? "No authorisation";

const displayedMode = (mode: AuthMode): SelectableAuthMode =>
  mode === "either" ? "request" : mode;

function RoleChoices({
  id,
  roles,
  choices,
  disabled,
  onChange,
}: {
  id: string;
  roles: string[];
  choices: string[];
  disabled: boolean;
  onChange: (roles: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {choices.map((role) => (
        <label key={`${id}-${role}`} className="flex items-center gap-2 text-sm capitalize">
          <input
            type="checkbox"
            disabled={disabled}
            checked={roles.includes(role)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...new Set([...roles, role])]
                  : roles.filter((candidate) => candidate !== role),
              )
            }
          />
          {role}
        </label>
      ))}
    </div>
  );
}

function PeopleMultiSelect({
  id,
  label,
  help,
  people,
  selected,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  people: AuthorizationPerson[];
  selected: string[];
  disabled: boolean;
  invalid?: boolean;
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
    <fieldset className="space-y-2" disabled={disabled}>
      <div>
        <Label htmlFor={`${id}-search`} className="text-sm">
          {label}{" "}
          <span className="font-normal text-muted-foreground">· {selected.length} selected</span>
        </Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Input
        id={`${id}-search`}
        className={cn("h-9", invalid && "border-destructive")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name, staff ID, role or branch"
      />
      <div
        className={cn(
          "max-h-40 space-y-1 overflow-y-auto rounded-md border bg-background p-2",
          invalid && "border-destructive",
        )}
      >
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
            <span className="rounded bg-muted px-1.5 py-0.5 capitalize text-muted-foreground">
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
        <p className="text-xs text-amber-600">
          Some selected staff are no longer active or visible here. They remain selected until you
          remove them.
        </p>
      ) : null}
    </fieldset>
  );
}

function AuthorityFields({
  id,
  title,
  help,
  unit,
  rule,
  people,
  values,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  help: string;
  unit: string;
  rule: AuthorizationRule;
  people: AuthorizationPerson[];
  values: Record<string, number>;
  disabled: boolean;
  onChange: (values: Record<string, number>) => void;
}) {
  const selectedSubjects = [
    ...rule.allowedRoles.map((role) => ({
      key: `role:${role.toLowerCase()}`,
      label: `${role} role`,
    })),
    ...rule.allowedUserIds.map((userId) => ({
      key: `user:${userId.toLowerCase()}`,
      label:
        people.find((person) => person.id.toLowerCase() === userId.toLowerCase())?.name ?? userId,
    })),
  ];
  const subjects = Array.from(
    new Map(
      [
        ...selectedSubjects,
        ...Object.keys(values).map((key) => ({ key, label: key.replace(":", ": ") })),
      ].map((subject) => [subject.key, subject]),
    ).values(),
  );

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm">{title}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      {subjects.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {subjects.map((subject) => (
            <label key={`${id}-${subject.key}`} className="space-y-1 text-xs">
              <span className="block truncate capitalize">{subject.label}</span>
              <div className="flex items-center gap-2">
                <Input
                  className="numeric h-9"
                  inputMode="decimal"
                  disabled={disabled}
                  min={0}
                  value={values[subject.key] ?? ""}
                  onChange={(event) => {
                    const next = { ...values };
                    if (event.target.value === "") delete next[subject.key];
                    else {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 0) next[subject.key] = value;
                    }
                    onChange(next);
                  }}
                  placeholder="No limit"
                />
                <span className="whitespace-nowrap text-muted-foreground">{unit}</span>
              </div>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Select an authorising role or person first.
        </p>
      )}
    </div>
  );
}

function RuleConfigurationDialog({
  editing,
  people,
  mayEdit,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editing: EditingRule | null;
  people: AuthorizationPerson[];
  mayEdit: boolean;
  saving: boolean;
  onChange: (change: Partial<AuthorizationRule>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const rule = editing?.rule;
  const action = editing?.action;
  const issues = rule && action ? validateAuthorizationRuleConfiguration(rule, action) : [];
  const hasIssue = (field: string) => issues.some((issue) => issue.field === field);
  const requestMode = rule?.mode === "request" || rule?.mode === "either";
  const authorityUnit = action ? AUTHORITY_UNIT[action.key] : undefined;
  const extraAuthorityEnabled = Boolean(
    rule && (Object.keys(rule.extraAuthority).length || Object.keys(rule.absoluteCeilings).length),
  );
  const approvalRequestBecomingInactive = Boolean(
    rule &&
    (editing?.previousMode === "request" || editing?.previousMode === "either") &&
    rule.mode !== "request" &&
    rule.mode !== "either",
  );

  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {rule && action ? (
          <>
            <DialogHeader className="border-b px-6 py-5 pr-12">
              <DialogTitle>{action.label} configuration</DialogTitle>
              <DialogDescription>{action.blurb}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5 overflow-y-auto px-6 py-5">
              <section className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Authorization method
                </p>
                <p className="mt-1 text-base font-semibold">{methodLabel(rule.mode)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {AUTH_MODES.find((mode) => mode.value === rule.mode)?.blurb}
                </p>
              </section>

              {editing.previousMode === "either" ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  This older rule currently allows either a PIN or an approval request. Saving will
                  use {methodLabel(rule.mode)} only; all detailed settings will remain available.
                </p>
              ) : null}

              {approvalRequestBecomingInactive ? (
                <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Approval Request settings will become inactive, not deleted. Select Approval
                  Request again later to restore and edit them.
                </p>
              ) : null}

              {rule.mode === "none" ? (
                <section className="space-y-2 rounded-lg border p-4">
                  <h3 className="font-medium">No additional setup is required</h3>
                  <p className="text-sm text-muted-foreground">
                    The action will run without this authorization rule, while the person’s normal
                    permissions still apply.
                  </p>
                </section>
              ) : (
                <>
                  {issues.length ? (
                    <div
                      className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                      role="alert"
                    >
                      <p className="font-medium">
                        Complete the highlighted settings before saving:
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {issues.map((issue) => (
                          <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <section className="space-y-4 rounded-lg border p-4">
                    <div>
                      <h3 className="font-medium">Who may authorize</h3>
                      <p className="text-xs text-muted-foreground">
                        Choose one or more roles, named staff members, or both.
                      </p>
                    </div>
                    <div
                      className={cn(
                        "space-y-2 rounded-md border p-3",
                        hasIssue("authorizers") && "border-destructive",
                      )}
                    >
                      <Label className="text-sm">Authorized roles</Label>
                      <RoleChoices
                        id={`authorizer-role-${action.key}`}
                        roles={rule.allowedRoles}
                        choices={ROLE_CHOICES}
                        disabled={!mayEdit}
                        onChange={(allowedRoles) => onChange({ allowedRoles })}
                      />
                    </div>
                    <PeopleMultiSelect
                      id={`approve-${action.key}`}
                      label="Authorized people"
                      help="Search and select active staff. A selected role or a named person may authorize."
                      people={people}
                      selected={rule.allowedUserIds}
                      disabled={!mayEdit}
                      invalid={hasIssue("authorizers")}
                      onChange={(allowedUserIds) => onChange({ allowedUserIds })}
                    />
                  </section>

                  {action.thresholdLabel || authorityUnit ? (
                    <section className="space-y-4 rounded-lg border p-4">
                      <div>
                        <h3 className="font-medium">Approval authority / limit</h3>
                        <p className="text-xs text-muted-foreground">
                          Only limits supported by this rule are shown.
                        </p>
                      </div>
                      {action.thresholdLabel ? (
                        <label className="block max-w-sm space-y-1 text-sm">
                          <span>{action.thresholdLabel}</span>
                          <Input
                            className={cn(
                              "numeric h-9",
                              hasIssue("threshold") && "border-destructive",
                            )}
                            inputMode="decimal"
                            min={0}
                            disabled={!mayEdit}
                            value={rule.threshold ?? ""}
                            onChange={(event) =>
                              onChange({
                                threshold:
                                  event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                          {hasIssue("threshold") ? (
                            <span className="text-xs text-destructive">
                              {issues.find((issue) => issue.field === "threshold")?.message}
                            </span>
                          ) : null}
                        </label>
                      ) : null}
                      {authorityUnit ? (
                        <AuthorityFields
                          id={`limit-${action.key}`}
                          title="Maximum approval authority"
                          help="Leave a person or role blank when no separate maximum is needed."
                          unit={authorityUnit}
                          rule={rule}
                          people={people}
                          values={rule.authorityLimits}
                          disabled={!mayEdit}
                          onChange={(authorityLimits) => onChange({ authorityLimits })}
                        />
                      ) : null}
                    </section>
                  ) : null}

                  {requestMode ? (
                    <section className="space-y-4 rounded-lg border p-4">
                      <div>
                        <h3 className="font-medium">Who may request approval</h3>
                        <p className="text-xs text-muted-foreground">
                          These people may send the action to the approval queue. They cannot
                          approve it unless they are also selected above.
                        </p>
                      </div>
                      <div
                        className={cn(
                          "space-y-2 rounded-md border p-3",
                          hasIssue("requesters") && "border-destructive",
                        )}
                      >
                        <Label className="text-sm">Requester roles</Label>
                        <RoleChoices
                          id={`requester-role-${action.key}`}
                          roles={rule.requesterRoles}
                          choices={REQUESTER_ROLE_CHOICES}
                          disabled={!mayEdit}
                          onChange={(requesterRoles) => onChange({ requesterRoles })}
                        />
                      </div>
                      <PeopleMultiSelect
                        id={`request-${action.key}`}
                        label="Named requesters"
                        help="Optional named staff are combined with the selected requester roles."
                        people={people}
                        selected={rule.requesterUserIds}
                        disabled={!mayEdit}
                        invalid={hasIssue("requesters")}
                        onChange={(requesterUserIds) => onChange({ requesterUserIds })}
                      />
                      <label className="block max-w-sm space-y-1 text-sm">
                        <span>Approval expires after</span>
                        <div className="flex items-center gap-2">
                          <Input
                            className={cn(
                              "numeric h-9",
                              hasIssue("timeout") && "border-destructive",
                            )}
                            type="number"
                            min={1}
                            max={1440}
                            disabled={!mayEdit}
                            value={rule.approvalTimeoutMinutes}
                            onChange={(event) =>
                              onChange({ approvalTimeoutMinutes: Number(event.target.value) })
                            }
                          />
                          <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                      </label>
                    </section>
                  ) : null}

                  {requestMode ? (
                    <section className="space-y-4 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-medium">Escalation</h3>
                          <p className="text-xs text-muted-foreground">
                            Send an unanswered request to backup roles after a delay.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`escalation-${action.key}`} className="text-sm">
                            {rule.escalationAfterMinutes === null ? "Off" : "On"}
                          </Label>
                          <Switch
                            id={`escalation-${action.key}`}
                            disabled={!mayEdit}
                            checked={rule.escalationAfterMinutes !== null}
                            onCheckedChange={(enabled) =>
                              onChange({ escalationAfterMinutes: enabled ? 5 : null })
                            }
                          />
                        </div>
                      </div>
                      {rule.escalationAfterMinutes !== null ? (
                        <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <span>Escalate after</span>
                            <div className="flex items-center gap-2">
                              <Input
                                className={cn(
                                  "numeric h-9",
                                  hasIssue("escalation-delay") && "border-destructive",
                                )}
                                type="number"
                                min={1}
                                max={1440}
                                disabled={!mayEdit}
                                value={rule.escalationAfterMinutes}
                                onChange={(event) =>
                                  onChange({ escalationAfterMinutes: Number(event.target.value) })
                                }
                              />
                              <span className="text-sm text-muted-foreground">minutes</span>
                            </div>
                          </label>
                          <div
                            className={cn(
                              "space-y-2 rounded-md border p-3",
                              hasIssue("escalation-roles") && "border-destructive",
                            )}
                          >
                            <Label className="text-sm">Backup approver roles</Label>
                            <RoleChoices
                              id={`escalation-role-${action.key}`}
                              roles={rule.escalationRoles}
                              choices={ROLE_CHOICES}
                              disabled={!mayEdit}
                              onChange={(escalationRoles) => onChange({ escalationRoles })}
                            />
                            <label className="block space-y-1 pt-2 text-xs">
                              <span>Other configured roles</span>
                              <Input
                                className="h-9"
                                disabled={!mayEdit}
                                value={rule.escalationRoles
                                  .filter((role) => !ROLE_CHOICES.includes(role))
                                  .join(", ")}
                                onChange={(event) => {
                                  const standardRoles = rule.escalationRoles.filter((role) =>
                                    ROLE_CHOICES.includes(role),
                                  );
                                  const otherRoles = event.target.value
                                    .split(",")
                                    .map((role) => role.trim().toLowerCase())
                                    .filter(Boolean);
                                  onChange({
                                    escalationRoles: [
                                      ...new Set([...standardRoles, ...otherRoles]),
                                    ],
                                  });
                                }}
                                placeholder="For example: regional manager"
                              />
                              <span className="text-muted-foreground">
                                Keep any additional organization roles separated by commas.
                              </span>
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {authorityUnit ? (
                    <section className="space-y-4 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-medium">Extra approval authority</h3>
                          <p className="text-xs text-muted-foreground">
                            Optionally add authority above the requester’s own limit.
                          </p>
                        </div>
                        <Switch
                          aria-label="Extra approval authority"
                          disabled={!mayEdit}
                          checked={extraAuthorityEnabled}
                          onCheckedChange={(enabled) => {
                            if (!enabled) onChange({ extraAuthority: {}, absoluteCeilings: {} });
                            else {
                              const firstRole = rule.allowedRoles[0];
                              const firstUser = rule.allowedUserIds[0];
                              const firstKey = firstRole
                                ? `role:${firstRole.toLowerCase()}`
                                : firstUser
                                  ? `user:${firstUser.toLowerCase()}`
                                  : "";
                              onChange({ extraAuthority: firstKey ? { [firstKey]: 0 } : {} });
                            }
                          }}
                        />
                      </div>
                      {extraAuthorityEnabled ? (
                        <div className="space-y-5 border-t pt-4">
                          <AuthorityFields
                            id={`extra-${action.key}`}
                            title="Additional authority"
                            help="This is added to the requester’s own limit."
                            unit={authorityUnit}
                            rule={rule}
                            people={people}
                            values={rule.extraAuthority}
                            disabled={!mayEdit}
                            onChange={(extraAuthority) => onChange({ extraAuthority })}
                          />
                          <AuthorityFields
                            id={`ceiling-${action.key}`}
                            title="Optional hard maximum"
                            help="The final approval cannot exceed this value. Leave blank for no hard maximum."
                            unit={authorityUnit}
                            rule={rule}
                            people={people}
                            values={rule.absoluteCeilings}
                            disabled={!mayEdit}
                            onChange={(absoluteCeilings) => onChange({ absoluteCeilings })}
                          />
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className="flex items-center justify-between gap-4 rounded-lg border p-4">
                    <div>
                      <h3 className="font-medium">Reason required</h3>
                      <p className="text-xs text-muted-foreground">
                        Require the workflow to record why this action is needed.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`reason-${action.key}`} className="text-sm">
                        Require reason: {rule.requireReason ? "Yes" : "No"}
                      </Label>
                      <Switch
                        id={`reason-${action.key}`}
                        disabled={!mayEdit}
                        checked={rule.requireReason}
                        onCheckedChange={(requireReason) => onChange({ requireReason })}
                      />
                    </div>
                  </section>
                </>
              )}
            </div>

            <DialogFooter className="border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!mayEdit || saving || issues.length > 0}
                onClick={onSave}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<AuthorizationPerson[]>([]);
  const [editing, setEditing] = useState<EditingRule | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    setEditing(null);
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
        const rows = (res.rules ?? []).map((row) =>
          normalizeRule({ ...row, action_key: row.actionKey }),
        );
        setRules(
          resolveEditableRules(rows, branchScope ? "branch" : "global", branchScope ? storeId : ""),
        );
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchScope, reloadVersion, storeId]);

  useEffect(
    () =>
      subscribeSettingsChange((change) => {
        if (change.table !== "authorization_actions" || editing) return;
        setReloadVersion((version) => version + 1);
      }),
    [editing],
  );

  useEffect(() => {
    const refreshVisibleRules = () => {
      if (!editing) setReloadVersion((version) => version + 1);
    };
    window.addEventListener("focus", refreshVisibleRules);
    return () => window.removeEventListener("focus", refreshVisibleRules);
  }, [editing]);

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

  const visibleGroups = useMemo(
    () =>
      AUTH_GROUPS.filter((group) =>
        AUTH_ACTIONS.some((action) => action.group === group.id && WIRED_ACTIONS.has(action.key)),
      ),
    [],
  );

  const openConfiguration = (action: AuthActionDef, mode?: SelectableAuthMode) => {
    if (!mayEdit) return;
    const existing = rules[action.key] ?? defaultRule(action.key);
    setEditing({
      action,
      previousMode: existing.mode,
      rule: { ...existing, mode: mode ?? displayedMode(existing.mode) },
    });
  };

  async function save() {
    if (!editing) return;
    const { action, rule } = editing;
    const issues = validateAuthorizationRuleConfiguration(rule, action);
    if (issues.length) return;
    setSaving(action.key);
    try {
      const auth = await getPosCallerAuth();
      const res = await saveAuthorizationRule({
        data: {
          ...auth,
          actionKey: action.key,
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
          expectedVersion: rule.rowVersion,
        },
      });
      if (!res.ok) {
        if (isAuthorizationRuleConflict(res.error ?? "")) {
          setEditing(null);
          setReloadVersion((version) => version + 1);
          toast.error(
            "This rule changed elsewhere. The latest version is being loaded for review.",
          );
          return;
        }
        toast.error(res.error ?? "Could not save the rule");
        return;
      }
      setRules((current) => ({ ...current, [action.key]: res.rule ?? rule }));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["authorization-rules"] });
      toast.success(`${action.label} rule saved`);
    } catch (caught) {
      notifyError(caught, "Could not save the rule");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Authorization rules
          </h2>
          <p className="text-xs text-muted-foreground">
            Choose how each action is authorized. Detailed settings open separately and every
            request and decision remains recorded in approval history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
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

      <div className="hidden grid-cols-[minmax(0,1.25fr)_12rem_minmax(0,1fr)] gap-4 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
        <span>Rule name</span>
        <span>Authorization method</span>
        <span>Status / configuration summary</span>
      </div>

      <SettingsSections
        storageKey="authorization-rules"
        items={visibleGroups.map((group) => ({
          id: group.id,
          title: group.label,
          blurb: group.blurb,
          content: (
            <div className="pb-2">
              {AUTH_ACTIONS.filter(
                (action) => action.group === group.id && WIRED_ACTIONS.has(action.key),
              ).map((action) => {
                const rule = rules[action.key] ?? defaultRule(action.key);
                const legacyEither = rule.mode === "either";
                return (
                  <div
                    key={action.key}
                    className="grid gap-3 border-t border-border/60 py-3 first:border-0 first:pt-0 lg:grid-cols-[minmax(0,1.25fr)_12rem_minmax(0,1fr)] lg:items-center lg:gap-4"
                  >
                    <div className="min-w-0">
                      <Label className="text-sm">{action.label}</Label>
                      <p className="text-xs text-muted-foreground">{action.blurb}</p>
                    </div>

                    <div className={mayEdit ? "" : "pointer-events-none opacity-60"}>
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
                        Authorization method
                      </span>
                      <ThemedSelect
                        ariaLabel={`${action.label} authorization`}
                        className="h-9 w-full"
                        value={displayedMode(rule.mode)}
                        onChange={(value) => openConfiguration(action, value as SelectableAuthMode)}
                        options={SELECTABLE_AUTH_MODES.map((mode) => ({
                          value: mode.value,
                          label: mode.label,
                        }))}
                      />
                    </div>

                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
                          Status / configuration
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {authorizationRuleSummary(rule)}
                        </p>
                        {legacyEither ? (
                          <p className="mt-1 text-xs text-amber-600">
                            Existing rule also permits PIN; review to choose one method.
                          </p>
                        ) : null}
                      </div>
                      {rule.mode !== "none" || legacyEither ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          disabled={!mayEdit}
                          onClick={() => openConfiguration(action)}
                        >
                          <Settings2 className="size-4" /> Configure
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        }))}
      />

      <RuleConfigurationDialog
        editing={editing}
        people={people}
        mayEdit={mayEdit}
        saving={Boolean(saving)}
        onChange={(change) =>
          setEditing((current) =>
            current ? { ...current, rule: { ...current.rule, ...change } } : current,
          )
        }
        onCancel={() => setEditing(null)}
        onSave={() => void save()}
      />
    </section>
  );
}
