import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
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

type Channel = "off" | "app" | "whatsapp";

type Settings = {
  enabled: boolean;
  recipients: string[];
  criticalOnly: boolean;
  quietFrom: string;
  quietTo: string;
  channels: Record<string, Channel>;
};

const CHANNEL_OPTIONS = [
  { value: "app", label: "Notification only" },
  { value: "whatsapp", label: "Notification + WhatsApp" },
  { value: "off", label: "Do not record" },
];

function NotificationSettingsPage() {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newNumber, setNewNumber] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const result = await loadNotificationSettings({
          data: await getPosCallerAuth(),
        });
        if (!result.ok) throw new Error(result.error);
        setCfg(result.settings as Settings);
      } catch (error) {
        toast.error((error as Error).message || "Could not load alert settings");
      }
    })();
  }, []);

  const patch = (next: Partial<Settings>) => setCfg((c) => (c ? { ...c, ...next } : c));

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    const res = await saveNotificationSettings({
      data: { ...(await getPosCallerAuth()), settings: cfg },
    });
    setBusy(false);
    if (res.ok) toast.success("Alert settings saved");
    else toast.error(res.error ?? "Could not save");
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

          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save alert settings
          </Button>
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
