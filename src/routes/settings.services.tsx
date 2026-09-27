/**
 * Bookable services, e.g. racket re-stringing.
 *
 * A booking is often taken for work rather than goods, so the counter needs a
 * short list of jobs with a default fee that can still be overridden per
 * customer.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import type { BookingServiceType } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/services")({
  head: () => ({
    meta: [
      { title: "Booking Services — Retail" },
      {
        name: "description",
        content:
          "Set up the jobs customers book in for — re-stringing, repairs, custom orders — with a default service fee.",
      },
      { property: "og:title", content: "Booking Services — Retail" },
      { property: "og:description", content: "Service types and default fees for bookings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Booking services"
      description="What customers book in for, and what you normally charge. The fee can still be changed on the booking itself."
    >
      <SettingsTabs current="/settings/services" />

      <ServicesForm />
    </SettingsFrame>
  ),
});

function ServicesForm() {
  const { state, updateSettings } = usePos();
  const integrations = state.settings.integrations;
  const services = integrations.serviceTypes ?? [];

  const save = (next: BookingServiceType[]) =>
    updateSettings({ integrations: { ...integrations, serviceTypes: next } });

  const patch = (id: string, p: Partial<BookingServiceType>) =>
    save(services.map((s) => (s.id === id ? { ...s, ...p } : s)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm">Ask what the racket job is for</p>
          <p className="text-xs text-muted-foreground">
            Shows the service picker and labour charge box on a racket service job. General bookings
            never carry a service fee — they are priced from the cart alone.
          </p>
        </div>
        <Switch
          aria-label="Ask what the racket job is for"
          checked={!!integrations.useServiceTypes}
          onCheckedChange={(v) =>
            updateSettings({ integrations: { ...integrations, useServiceTypes: v } })
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm">Allow a typed-in service</p>
          <p className="text-xs text-muted-foreground">
            For one-off jobs that are not on the list.
          </p>
        </div>
        <Switch
          aria-label="Allow a typed-in service"
          checked={integrations.allowCustomServiceType !== false}
          onCheckedChange={(v) =>
            updateSettings({ integrations: { ...integrations, allowCustomServiceType: v } })
          }
        />
      </div>

      {services.map((s) => (
        <div
          key={s.id}
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_140px_auto_auto_auto]"
        >
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Service</Label>
            <Input
              placeholder="Racket re-stringing"
              value={s.name}
              onChange={(e) => patch(s.id, { name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default fee</Label>
            <Input
              className="numeric text-right"
              inputMode="decimal"
              value={s.fee || ""}
              onChange={(e) => patch(s.id, { fee: Number(e.target.value) || 0 })}
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
            <Switch
              aria-label={`${s.name || "Service"} active`}
              checked={s.active}
              onCheckedChange={(v) => patch(s.id, { active: v })}
            />
            Active
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
            <Switch
              aria-label={`${s.name || "Service"} is a racket or stringing job`}
              checked={!!s.isStringingJob}
              onCheckedChange={(v) => patch(s.id, { isStringingJob: v })}
            />
            Racket / stringing job
          </label>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${s.name || "service"}`}
            className="self-end"
            onClick={() => {
              save(services.filter((x) => x.id !== s.id));
              toast.success("Service removed");
            }}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}

      {services.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No services yet — add re-stringing, repairs or whatever customers book in for.
        </p>
      )}

      <Button
        size="sm"
        onClick={() =>
          save([...services, { id: crypto.randomUUID(), name: "", fee: 0, active: true }])
        }
      >
        <Plus className="size-3" /> Add service
      </Button>
    </div>
  );
}
