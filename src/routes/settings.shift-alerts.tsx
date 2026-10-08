import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/pos-auth";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_ALERT_SETTINGS,
  listShiftSummaries,
  readAlertSettings,
  writeAlertSettings,
  type ShiftAlertSettings,
  type ShiftSummary,
} from "@/lib/shift-alerts";

export const Route = createFileRoute("/settings/shift-alerts")({
  head: () => ({
    meta: [
      { title: "Shift alerts — Retail" },
      {
        name: "description",
        content:
          "Choose how the day-end shift summary reaches this phone: in-app alert, WhatsApp to managers, or a phone notification.",
      },
      { property: "og:title", content: "Shift alerts — Retail" },
      {
        property: "og:description",
        content: "Day-end shift summary delivery settings for this device.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShiftAlertsPage,
});

function ShiftAlertsPage() {
  const { isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ShiftAlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [numbers, setNumbers] = useState("");
  const [recent, setRecent] = useState<ShiftSummary[]>([]);

  useEffect(() => {
    void readAlertSettings().then((saved) => {
      setSettings(saved); setNumbers(saved.recipients.join(", "));
    }).catch(() => toast.error("Global shift notification settings could not be loaded."));
    void listShiftSummaries()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const set = (patch: Partial<ShiftAlertSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const save = async () => {
    if (!isAdmin || saving) return;
    setSaving(true);
    try {
    const recipients = numbers
      .split(/[,\s]+/)
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n.length >= 6);
    const next = { ...settings, recipients };
    await writeAlertSettings(next);
    setSettings(next);
    toast.success("Global shift alert settings saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Settings could not be saved."); }
    finally { setSaving(false); }
  };

  const Row = ({
    title,
    hint,
    checked,
    onChange,
    disabled,
  }: {
    title: string;
    hint: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-2 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );

  if (!isAdmin) return <SettingsFrame title="Shift alerts" description="Global notification delivery is managed by administrators." showSaveBar={false}><p>Administrator access is required.</p></SettingsFrame>;
  return (
    <SettingsFrame
      showSaveBar={false}
      title="Shift alerts"
      description="When a shift is closed the till builds a day summary — total sales, bills, payment split, discounts, refunds and the cash count. Administrators configure delivery for all platforms."
    >
      <div className="grid gap-3">
        <Row
          title="In-app alert"
          hint="Shows the summary in the app with an unread badge."
          checked={settings.inApp}
          onChange={(v) => set({ inApp: v })}
        />
        <Row
          title="WhatsApp to managers"
          hint="Sends the same summary to the numbers below."
          checked={settings.whatsapp}
          onChange={(v) => set({ whatsapp: v })}
        />
        <Row
          title="Phone notification while the app is closed"
          hint="Needs a Firebase key before it can be switched on."
          checked={settings.push}
          onChange={(v) => set({ push: v })}
          disabled
        />
        <Row
          title="Quiet hours"
          hint="Hold WhatsApp and phone notifications inside the window below (the in-app alert still appears)."
          checked={settings.quietHours}
          onChange={(v) => set({ quietHours: v })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="alert-numbers">Manager WhatsApp numbers</Label>
          <Input
            id="alert-numbers"
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            placeholder="6591234567, 6598765432"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quiet-from">Quiet from</Label>
          <Input
            id="quiet-from"
            type="time"
            value={settings.quietFrom}
            onChange={(e) => set({ quietFrom: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quiet-to">Quiet until</Label>
          <Input
            id="quiet-to"
            type="time"
            value={settings.quietTo}
            onChange={(e) => set({ quietTo: e.target.value })}
          />
        </div>
      </div>

      <Button onClick={() => void save()} disabled={saving} className="w-fit">
        Save
      </Button>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Recent day-end summaries</p>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing yet — the next closed shift will appear here.
          </p>
        ) : (
          recent.slice(0, 5).map((s) => (
            <pre
              key={s.id}
              className="whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-xs"
            >
              {s.summary}
            </pre>
          ))
        )}
      </div>
    </SettingsFrame>
  );
}
