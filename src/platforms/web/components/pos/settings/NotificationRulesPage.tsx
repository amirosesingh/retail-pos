import { useCallback, useEffect, useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { SettingsFrame } from "./SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ThemedSelect } from "../ThemedSelect";
import { usePos } from "@/lib/pos-store";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  loadNotificationRuleTable,
  saveNotificationRuleTable,
} from "@/lib/notification-rules-client";
import {
  newNotificationRule,
  notificationRuleSchema,
  PRIVATE_NOTIFICATION_EVENTS,
  type NotificationRule,
} from "@/lib/notification-rules";

type Loaded = Extract<Awaited<ReturnType<typeof loadNotificationRuleTable>>, { ok: true }>;
type Choice = { value: string; label: string };
function Selection({
  label,
  choices,
  values,
  onChange,
}: {
  label: string;
  choices: Choice[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectionId = useId();
  const known = new Set(choices.map((choice) => choice.value));
  const all = [
    ...choices,
    ...values
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: `${value} (saved selection)` })),
  ];
  const filtered = all.filter((choice) =>
    `${choice.label} ${choice.value}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">
        {label} · {values.length} selected
      </summary>
      <Input
        className="my-2"
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-52 overflow-auto">
        {filtered.slice(0, 100).map((choice) => (
          <label
            key={choice.value}
            htmlFor={`${selectionId}-${choice.value}`}
            className="flex min-h-11 items-center gap-2"
          >
            <Checkbox
              id={`${selectionId}-${choice.value}`}
              checked={values.includes(choice.value)}
              onCheckedChange={() =>
                onChange(
                  values.includes(choice.value)
                    ? values.filter((value) => value !== choice.value)
                    : [...values, choice.value],
                )
              }
            />
            {choice.label}
          </label>
        ))}
        {filtered.length > 100 && (
          <p className="text-sm text-muted-foreground">
            Search to narrow the remaining {filtered.length - 100} choices.
          </p>
        )}
      </div>
    </details>
  );
}

export function NotificationRulesPage() {
  const { stores } = usePos();
  const [data, setData] = useState<Loaded | null>(null);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<NotificationRule | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(async (historyOffset = 0) => {
    setLoading(true);
    setError("");
    try {
      const result = await loadNotificationRuleTable({
        data: { ...(await getPosCallerAuth()), offset: historyOffset },
      });
      if (!result.ok) throw new Error(result.error);
      setData(result);
      setRules(result.rules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load notification rules");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const dirty = data && JSON.stringify(rules) !== JSON.stringify(data.rules);
  useEffect(() => {
    if (!dirty && !draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft]);
  const save = async () => {
    if (!data || busy || loading || data.needsUpgrade) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveNotificationRuleTable({
        data: { ...(await getPosCallerAuth()), rules, expected: data.expected },
      });
      if (!result.ok) throw new Error(result.error);
      setRules(result.rules);
      setData({ ...data, rules: result.rules, expected: result.rules, imported: false });
      toast.success("Notification rules saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save notification rules");
    } finally {
      setBusy(false);
    }
  };
  const applyDraft = () => {
    const result = notificationRuleSchema.safeParse(
      draft ? { ...draft, phones: draft.phones.filter(Boolean) } : null,
    );
    if (!result.success) {
      toast.error(result.error.issues[0]?.message ?? "Check the rule");
      return;
    }
    setRules((current) =>
      current.some((rule) => rule.id === result.data.id)
        ? current.map((rule) => (rule.id === result.data.id ? result.data : rule))
        : [...current, result.data],
    );
    setDraft(null);
  };
  const patch = (next: Partial<NotificationRule>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));
  const staff =
    data?.staff.map((person) => ({
      value: person.user_id,
      label: `${person.full_name}${person.is_active ? "" : " (disabled)"}`,
    })) ?? [];
  const roles = data?.roles.map((role) => ({ value: role.slug, label: role.name })) ?? [];
  const branches = stores.map((store) => ({ value: store.id, label: store.name }));
  const names = (rule: NotificationRule) =>
    rule.audience === "original"
      ? rule.event === "soft_token_approval" ? "Token owner and administrators" : "Original private recipients"
      : rule.audience === "branch"
        ? "Staff in matched branches"
        : rule.audience === "audit"
          ? "Accounts with audit access"
          : [
              ...rule.users.map((id) => staff.find((person) => person.value === id)?.label ?? id),
              ...rule.roles.map(
                (id) => `${roles.find((role) => role.value === id)?.label ?? id} role`,
              ),
            ].join(", ") || "No users selected";
  return (
    <SettingsFrame
      showSaveBar={false}
      title="Notification rules"
      description="Choose what happened, who receives it, and how it is delivered. Audit records are retained even when a rule is disabled."
    >
      <div className="space-y-5">
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            {error}
          </p>
        )}
        {loading && !data ? (
          <p>Loading notification rules…</p>
        ) : !data ? (
          <Button onClick={() => void load()}>Retry</Button>
        ) : (
          <>
            {data.needsUpgrade && (
              <p role="status" className="rounded-lg border p-3">
                The notification database upgrade is required before these rules can be saved.
                Existing delivery remains active.
              </p>
            )}
            {data.imported && (
              <p className="rounded-lg border p-3">
                These rules are a draft imported from your existing delivery settings. Review them,
                then Save rules to use this table. Nothing changes until you save.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Android background delivery:{" "}
              {data.pushConfigured ? "service configured" : "service setup needed"}. WhatsApp
              requires your saved WhatsApp service credentials. Existing bill-sharing settings stay
              separate from event alerts.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-sm"
                aria-label="Search notification rules"
                placeholder="Search rules or events"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button disabled={busy || loading} onClick={() => setDraft(newNotificationRule())}>
                Add rule
              </Button>
              <Button
                disabled={busy || loading || data.needsUpgrade || (!dirty && !data.imported)}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save rules"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || loading || !!dirty || !!draft}
                onClick={() => void load(offset)}
              >
                {loading ? "Refreshing…" : "Refresh saved rules"}
              </Button>
              {(dirty || data.imported) && <span className="text-sm">Unsaved changes</span>}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      "Rule",
                      "Event and conditions",
                      "Recipients",
                      "Delivery",
                      "Status",
                      "Actions",
                    ].map((label) => (
                      <th key={label} className="p-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules
                    .filter((rule) =>
                      `${rule.name} ${rule.event}`.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((rule) => (
                      <tr key={rule.id} className="border-t">
                        <td className="p-3 font-medium">{rule.name}</td>
                        <td className="p-3">
                          {data.events.find((event) => event.type === rule.event)?.label ??
                            rule.event}
                          <div className="text-xs text-muted-foreground">
                            {rule.branches.length
                              ? `${rule.branches.length} branches`
                              : "All permitted branches"}
                            {rule.minAmount !== null ? ` · amount ≥ ${rule.minAmount}` : ""}
                            {rule.maxAmount !== null ? ` · amount ≤ ${rule.maxAmount}` : ""}
                            {rule.actorUsers.length || rule.actorRoles.length
                              ? " · actor filter"
                              : ""}
                            {rule.severities.length ? ` · ${rule.severities.join(", ")}` : ""}
                          </div>
                        </td>
                        <td className="max-w-xs p-3">
                          {names(rule)}
                          {rule.phones.length > 0 && (
                            <div>{rule.phones.length} WhatsApp numbers</div>
                          )}
                        </td>
                        <td className="p-3">
                          {rule.channels
                            .map((channel) =>
                              channel === "push"
                                ? "Android"
                                : channel === "app"
                                  ? "In-app"
                                  : "WhatsApp",
                            )
                            .join(", ") || "None"}
                          {rule.quietFrom && (
                            <div className="text-xs">
                              Quiet {rule.quietFrom}–{rule.quietTo} · {rule.timeZone}
                            </div>
                          )}
                        </td>
                        <td className="p-3">{rule.enabled ? "Enabled" : "Disabled"}</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || loading}
                              onClick={() => setDraft({ ...rule })}
                              aria-label={`Edit ${rule.name}`}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy || loading}
                              onClick={() =>
                                setRules((current) => current.filter((item) => item.id !== rule.id))
                              }
                              aria-label={`Remove ${rule.name}`}
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {!rules.length && (
                    <tr>
                      <td colSpan={6} className="p-5">
                        No rules. Audit events remain recorded; add a rule to deliver notifications.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Delivery history</h2>
              <p className="text-sm text-muted-foreground">
                In-app “available” means visible to the recipient. Android “sent” means accepted by
                the phone service; WhatsApp “sent” means accepted by WhatsApp. Unknown results are
                not automatically resent.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["Time", "Rule", "Channel", "Recipient", "Status / reason"].map((label) => (
                        <th key={label} className="p-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-3">{new Date(row.created_at).toLocaleString()}</td>
                        <td className="p-3">{row.rule_name}</td>
                        <td className="p-3">{row.channel}</td>
                        <td className="p-3">
                          {(staff.find((person) => person.value === row.recipient)?.label ??
                            row.recipient) ||
                            "—"}
                        </td>
                        <td className="p-3">
                          {row.status}
                          {row.reason && ` · ${row.reason}`}
                          {row.status === "queued" &&
                            new Date(row.next_attempt) > new Date() &&
                            ` · due ${new Date(row.next_attempt).toLocaleString()}`}
                        </td>
                      </tr>
                    ))}
                    {!data.history.length && (
                      <tr>
                        <td colSpan={5} className="p-4">
                          No delivery records in this page.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={!offset || loading || !!dirty || !!draft}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 100));
                    void load(Math.max(0, offset - 100));
                  }}
                >
                  Previous history
                </Button>
                <Button
                  variant="outline"
                  disabled={data.history.length < 100 || loading || !!dirty || !!draft}
                  onClick={() => {
                    setOffset(offset + 100);
                    void load(offset + 100);
                  }}
                >
                  Next history
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {draft && rules.some((rule) => rule.id === draft.id)
                ? "Edit notification rule"
                : "Add notification rule"}
            </DialogTitle>
            <DialogDescription>
              Apply changes to the table, then Save rules. Recipients must be active and eligible
              for the event’s branch. Private approval recipients cannot be expanded.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="notification-rule-name">Rule name</Label>
                  <Input
                    id="notification-rule-name"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </div>
                <label className="flex min-h-11 items-center justify-between gap-3">
                  Enabled
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(enabled) => patch({ enabled })}
                    aria-label="Rule enabled"
                  />
                </label>
              </div>
              <div>
                <Label htmlFor="notification-rule-event">Event trigger</Label>
                <Input
                  id="notification-rule-event"
                  list="notification-event-options"
                  value={draft.event}
                  onChange={(e) =>
                    patch({
                      event: e.target.value,
                      ...(PRIVATE_NOTIFICATION_EVENTS.includes(e.target.value)
                        ? {
                            audience: "original",
                            channels: draft.channels.filter((channel) => channel !== "whatsapp"),
                          }
                        : {}),
                    })
                  }
                />
                <datalist id="notification-event-options">
                  {data?.events.map((event) => (
                    <option key={event.type} value={event.type}>
                      {event.label}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Choose an existing event. A custom event key works only when the application emits
                  that event.
                </p>
              </div>
              <Selection
                label="Branches"
                choices={branches}
                values={draft.branches}
                onChange={(branches) => patch({ branches })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Selection
                  label="Acting users"
                  choices={staff}
                  values={draft.actorUsers}
                  onChange={(actorUsers) => patch({ actorUsers })}
                />
                <Selection
                  label="Acting user roles"
                  choices={roles}
                  values={draft.actorRoles}
                  onChange={(actorRoles) => patch({ actorRoles })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="notification-min">Minimum event amount</Label>
                  <Input
                    type="number"
                    id="notification-min"
                    min="0"
                    step="0.01"
                    value={draft.minAmount ?? ""}
                    onChange={(e) =>
                      patch({ minAmount: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="notification-max">Maximum event amount</Label>
                  <Input
                    type="number"
                    id="notification-max"
                    min="0"
                    step="0.01"
                    value={draft.maxAmount ?? ""}
                    onChange={(e) =>
                      patch({ maxAmount: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <Selection
                label="Severities"
                choices={["info", "warning", "critical"].map((value) => ({ value, label: value }))}
                values={draft.severities}
                onChange={(severities) =>
                  patch({ severities: severities as NotificationRule["severities"] })
                }
              />
              <div>
                <Label>Recipient selection</Label>
                <ThemedSelect
                  ariaLabel="Recipient selection"
                  value={draft.audience}
                  onChange={(value) =>
                    patch({
                      audience: value as NotificationRule["audience"],
                      ...(value === "original"
                        ? { channels: draft.channels.filter((channel) => channel !== "whatsapp") }
                        : {}),
                    })
                  }
                  options={
                    draft.event === "soft_token_approval"
                      ? [{ value: "original", label: "Token owner and administrators" },
                          { value: "selected", label: "Selected token owners or administrators" }]
                      : PRIVATE_NOTIFICATION_EVENTS.includes(draft.event)
                      ? [{ value: "original", label: "Original private recipients" }]
                      : [
                          { value: "selected", label: "Selected users and roles" },
                          { value: "branch", label: "Staff in matched branches" },
                          { value: "audit", label: "Accounts with audit access" },
                          { value: "original", label: "Original private recipients" },
                        ]
                  }
                />
              </div>
              {draft.audience === "selected" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Selection
                    label="Recipient users"
                    choices={staff}
                    values={draft.users}
                    onChange={(users) => patch({ users })}
                  />
                  <Selection
                    label="Recipient roles"
                    choices={roles}
                    values={draft.roles}
                    onChange={(roles) => patch({ roles })}
                  />
                </div>
              )}
              <Selection
                label="Delivery channels"
                choices={[
                  { value: "app", label: "In-app bell" },
                  { value: "push", label: "Android phone" },
                  ...(draft.audience === "original"
                    ? []
                    : [{ value: "whatsapp", label: "WhatsApp" }]),
                ]}
                values={draft.channels}
                onChange={(channels) =>
                  patch({ channels: channels as NotificationRule["channels"] })
                }
              />
              {draft.channels.includes("whatsapp") && (
                <div>
                  <Label htmlFor="notification-phones">WhatsApp numbers</Label>
                  <Input
                    id="notification-phones"
                    placeholder="International digits, separated by commas"
                    value={draft.phones.join(", ")}
                    onChange={(e) =>
                      patch({ phones: e.target.value.split(",").map((value) => value.trim()) })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Assign each number to its staff account below. WhatsApp uses the same
                    active-account, role and branch checks as other channels.
                  </p>
                </div>
              )}
              {draft.channels.includes("whatsapp") &&
                draft.phones.filter(Boolean).map((phone) => (
                  <div key={phone}>
                    <Label>Staff recipient for {phone}</Label>
                    <ThemedSelect
                      ariaLabel={`Staff recipient for ${phone}`}
                      value={draft.phoneUsers[phone] ?? ""}
                      placeholder="Choose the account that owns this number"
                      onChange={(user) =>
                        patch({ phoneUsers: { ...draft.phoneUsers, [phone]: user } })
                      }
                      options={(data?.staff ?? [])
                        .filter(
                          (person) =>
                            person.is_active &&
                            (draft.audience !== "selected" ||
                              draft.users.includes(person.user_id) ||
                              draft.roles.includes(person.role_slug || person.role)),
                        )
                        .map((person) => ({ value: person.user_id, label: person.full_name }))}
                    />
                  </div>
                ))}
              <div>
                <Label htmlFor="notification-template">Message</Label>
                <textarea
                  id="notification-template"
                  className="min-h-24 w-full rounded-md border bg-background p-3"
                  value={draft.template}
                  onChange={(e) => patch({ template: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Fields:{" "}
                  {
                    "{{title}}, {{message}}, {{cashier}}, {{role}}, {{branch}}, {{amount}}, {{time}}"
                  }
                  . This wording is used for in-app and WhatsApp delivery. Android lock-screen
                  notices stay private and ask the recipient to sign in.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="notification-quiet-from">Quiet hours from</Label>
                  <Input
                    id="notification-quiet-from"
                    type="time"
                    value={draft.quietFrom}
                    onChange={(e) => patch({ quietFrom: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="notification-quiet-to">Quiet hours to</Label>
                  <Input
                    id="notification-quiet-to"
                    type="time"
                    value={draft.quietTo}
                    onChange={(e) => patch({ quietTo: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="notification-timezone">Time zone</Label>
                  <Input
                    id="notification-timezone"
                    value={draft.timeZone}
                    onChange={(e) => patch({ timeZone: e.target.value })}
                    placeholder="Asia/Brunei"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Quiet hours defer Android and WhatsApp delivery. In-app notices remain available.
                Leave both times empty for immediate delivery.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={applyDraft}>Apply to table</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsFrame>
  );
}
