import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Smartphone, MessageCircle, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { EVENT_CATALOG } from "@/lib/activity-events";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/lib/activity-events.functions";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { defaultAndroidPushRules, type AndroidPushRules } from "@/lib/android-push-policy";
import { usePos } from "@/lib/pos-store";

type Channel = "off" | "app" | "whatsapp";

type Settings = {
  enabled: boolean;
  recipients: string[];
  criticalOnly: boolean;
  quietFrom: string;
  quietTo: string;
  channels: Record<string, Channel>;
  androidPush?: AndroidPushRules;
};

const CHANNEL_OPTIONS = [
  { value: "app", label: "Notification only" },
  { value: "whatsapp", label: "Notification + WhatsApp" },
  { value: "off", label: "Do not record" },
];

function NotificationSettingsPage() {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"android" | "whatsapp" | null>(null);
  const [savedCfg, setSavedCfg] = useState<Settings | null>(null);
  const [newNumber, setNewNumber] = useState("");
  const [pushReady, setPushReady] = useState(false);
  const [staff, setStaff] = useState<{ user_id: string; full_name: string }[]>([]);
  const { stores } = usePos();

  useEffect(() => {
    void (async () => {
      try {
        const result = await loadNotificationSettings({
          data: await getPosCallerAuth(),
        });
        if (!result.ok) throw new Error(result.error);
        setCfg(result.settings as Settings);
        setSavedCfg(result.settings as Settings);
        setStaff(result.staff);
        setPushReady(result.pushConfigured);
      } catch (error) {
        toast.error((error as Error).message || "Could not load alert settings");
      }
    })();
  }, []);

  const patch = (next: Partial<Settings>) => setCfg((c) => (c ? { ...c, ...next } : c));
  const phone = cfg?.androidPush ?? defaultAndroidPushRules;
  const patchPhone = (next: Partial<AndroidPushRules>) =>
    patch({ androidPush: { ...phone, ...next } });
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const openDialog = (section: "android" | "whatsapp") => {
    if (savedCfg) setCfg(savedCfg);
    setNewNumber("");
    setDialog(section);
  };
  const save = async (section: "android" | "whatsapp") => {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      const res = await saveNotificationSettings({
        data: { ...(await getPosCallerAuth()), settings: cfg, section },
      });
      if (!res.ok) throw new Error(res.error ?? "Could not save alert settings");
      setSavedCfg(res.settings as Settings);
      setCfg(res.settings as Settings);
      toast.success(section === "android" ? "Android alert settings saved" : "WhatsApp alert settings saved");
      setDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save alert settings");
    } finally { setBusy(false); }
  };

  return (
    <SettingsFrame
      showSaveBar={false}
      title="Notifications & alerts"
      description="Choose which events reach the admin bell and which are also sent on WhatsApp."
    >
      {!cfg ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <Smartphone className="mb-3 size-6 text-primary" />
              <h2 className="font-semibold">Android phone alerts</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose recipients, branches and events for phone notifications.</p>
              <p className="my-3 text-xs text-muted-foreground">{savedCfg?.androidPush?.enabled ? "Enabled" : "Disabled"} · {pushReady ? "Service configured" : "Push service setup needed"}</p>
              <Button onClick={() => openDialog("android")}>Configure Android alerts</Button>
            </section>
            <section className="rounded-2xl border border-accent/20 bg-accent/5 p-5">
              <MessageCircle className="mb-3 size-6 text-accent" />
              <h2 className="font-semibold">WhatsApp delivery</h2>
              <p className="mt-1 text-sm text-muted-foreground">Configure recipients, quiet hours and event delivery.</p>
              <p className="my-3 text-xs text-muted-foreground">{savedCfg?.enabled ? "Enabled" : "Disabled"}</p>
              <Button variant="secondary" onClick={() => openDialog("whatsapp")}>Configure WhatsApp alerts</Button>
            </section>
          </div>
          <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
            <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle>{dialog === "android" ? "Android phone alerts" : "WhatsApp delivery"}</DialogTitle>
                <DialogDescription>{dialog === "android" ? "Choose phone notifications. Saving here changes only Android settings." : "Choose WhatsApp delivery. Saving here preserves Android settings."}</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
                {dialog === "android" ? (
          <section className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Android phone alerts</h2>
                <p className="text-sm text-muted-foreground">
                  System notifications on enrolled phones. Web and Electron alerts stay inside the
                  signed-in app.
                </p>
              </div>
              <Switch
                aria-label="Enable Android phone alerts"
                checked={phone.enabled}
                onCheckedChange={(enabled) => patchPhone({ enabled })}
              />
            </div>
            {!pushReady && (
              <p role="status" className="text-sm text-warning">
                The hosted POS backend is not connected to the central push service. Firebase Android configuration and server-only push credentials must be installed before phone delivery works.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Notifications contain a generic message. Details require the recipient's password and
              current permissions.
            </p>
            <div className="flex items-center gap-2">
              <Switch
                aria-label="Critical Android alerts only"
                checked={phone.criticalOnly}
                onCheckedChange={(criticalOnly) => patchPhone({ criticalOnly })}
              />
              <span className="text-sm">Critical alerts only</span>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Recipients</legend>
              <p className="text-xs text-muted-foreground">
                Select staff who should receive phone alerts. This does not grant access to
                restricted events.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {staff.map((person) => (
                  <label key={person.user_id} className="flex items-center gap-2 text-sm">
                    <Switch
                      aria-label={`Phone alerts for ${person.full_name}`}
                      checked={phone.recipients.includes(person.user_id)}
                      onCheckedChange={() =>
                        patchPhone({ recipients: toggle(phone.recipients, person.user_id) })
                      }
                    />
                    {person.full_name} · {person.user_id}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Branches</legend>
              <p className="text-xs text-muted-foreground">
                No selection means all branches permitted for the recipient.
              </p>
              <div className="flex flex-wrap gap-3">
                {stores.map((store) => (
                  <label key={store.id} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={phone.branches.includes(store.id)}
                      onCheckedChange={() =>
                        patchPhone({ branches: toggle(phone.branches, store.id) })
                      }
                    />
                    {store.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {EVENT_CATALOG.map((group) => (
              <fieldset key={group.group} className="space-y-2">
                <legend className="text-sm font-medium">{group.group}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.types.map((event) => (
                    <label key={event.type} className="flex items-center gap-2 text-sm">
                      <Switch
                        aria-label={`Phone alerts: ${event.label}`}
                        checked={phone.events.includes(event.type)}
                        onCheckedChange={() =>
                          patchPhone({ events: toggle(phone.events, event.type) })
                        }
                      />
                      {event.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </section>
                ) : (<div className="space-y-5">
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Switch
                id="wa-enabled"
                checked={cfg.enabled}
                onCheckedChange={(v) => patch({ enabled: v })}
              />
              <Label htmlFor="wa-enabled">Send WhatsApp alerts</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="wa-critical"
                checked={cfg.criticalOnly}
                onCheckedChange={(v) => patch({ criticalOnly: v })}
              />
              <Label htmlFor="wa-critical">Critical events only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="quiet-from" className="text-xs">
                Quiet hours
              </Label>
              <Input
                id="quiet-from"
                type="time"
                className="h-9 w-28"
                value={cfg.quietFrom}
                onChange={(e) => patch({ quietFrom: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="time"
                className="h-9 w-28"
                value={cfg.quietTo}
                onChange={(e) => patch({ quietTo: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Who gets the WhatsApp message</p>
              <p className="text-xs text-muted-foreground">
                Full international numbers, for example 60123456789. Critical events ignore quiet
                hours.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {cfg.recipients.map((n) => (
                <span
                  key={n}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs"
                >
                  {n}
                  <button
                    type="button"
                    aria-label={`Remove ${n}`}
                    onClick={() => patch({ recipients: cfg.recipients.filter((r) => r !== n) })}
                  >
                    <Trash2 className="size-3 text-muted-foreground" />
                  </button>
                </span>
              ))}
              {cfg.recipients.length === 0 && (
                <p className="text-xs text-muted-foreground">No recipients yet.</p>
              )}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const digits = newNumber.replace(/\D/g, "");
                if (!digits) return;
                if (!cfg.recipients.includes(digits))
                  patch({ recipients: [...cfg.recipients, digits] });
                setNewNumber("");
              }}
            >
              <Input
                className="h-9 max-w-xs"
                placeholder="60123456789"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
              />
              <Button type="submit" variant="secondary" size="sm">
                <Plus className="size-4" /> Add
              </Button>
            </form>
          </div>

          {EVENT_CATALOG.map((group) => (
            <div key={group.group} className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{group.group}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {group.types.map((t) => (
                  <div key={t.type} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs">{t.label}</span>
                    <ThemedSelect
                      className="h-9 w-52"
                      value={cfg.channels[t.type] ?? "app"}
                      onChange={(v) =>
                        patch({ channels: { ...cfg.channels, [t.type]: v as Channel } })
                      }
                      options={CHANNEL_OPTIONS}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}


                </div>)}
              </div>
              <DialogFooter className="border-t pt-4">
                <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
                <Button disabled={busy} onClick={() => dialog && void save(dialog)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {dialog === "android" ? "Save Android alert settings" : "Save WhatsApp alert settings"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </SettingsFrame>
  );
}

export const Route = createFileRoute("/settings/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications & Alerts — Retail" },
      {
        name: "description",
        content:
          "Pick which till events raise an admin notification and which are also delivered by WhatsApp, with quiet hours and per-event control.",
      },
      { property: "og:title", content: "Notifications & Alerts — Retail" },
      {
        property: "og:description",
        content: "Per-event admin alerts and WhatsApp delivery rules for the register.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationSettingsPage,
});
