import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePos } from "@/lib/pos-store";
import { TIME_ZONES, effectiveTimeZone, formatDateTime } from "@/lib/time-zone";
import type { DateFormat, TimeFormat } from "@/core/types/pos-types";

/** Countries the shop is likely to trade in, with a sensible default zone. */
const COUNTRIES: { code: string; name: string; zone: string }[] = [
  { code: "MY", name: "Malaysia", zone: "Asia/Kuala_Lumpur" },
  { code: "SG", name: "Singapore", zone: "Asia/Singapore" },
  { code: "TH", name: "Thailand", zone: "Asia/Bangkok" },
  { code: "ID", name: "Indonesia", zone: "Asia/Jakarta" },
  { code: "PH", name: "Philippines", zone: "Asia/Manila" },
  { code: "HK", name: "Hong Kong", zone: "Asia/Hong_Kong" },
  { code: "IN", name: "India", zone: "Asia/Kolkata" },
  { code: "AE", name: "United Arab Emirates", zone: "Asia/Dubai" },
  { code: "PK", name: "Pakistan", zone: "Asia/Karachi" },
  { code: "JP", name: "Japan", zone: "Asia/Tokyo" },
  { code: "AU", name: "Australia", zone: "Australia/Sydney" },
  { code: "GB", name: "United Kingdom", zone: "Europe/London" },
  { code: "DE", name: "Germany", zone: "Europe/Berlin" },
  { code: "US", name: "United States", zone: "America/New_York" },
];

export const Route = createFileRoute("/settings/region")({
  head: () => ({
    meta: [
      { title: "Region & Time — Retail" },
      {
        name: "description",
        content:
          "Choose the country, time zone, date order and clock used on every screen, receipt and report.",
      },
      { property: "og:title", content: "Region & Time — Retail" },
      {
        property: "og:description",
        content: "Country, time zone and date/time formats for the whole till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegionPage,
});

function RegionPage() {
  const { state, updateSettings } = usePos();
  const it = state.settings.integrations;

  const patch = (next: Partial<typeof it>) => updateSettings({ integrations: { ...it, ...next } });

  return (
    <SettingsFrame
      title="Region & time"
      description="Terminal clocks drift and travel. Pick the region here and every displayed and printed time follows it, whatever the PC thinks."
      scopeSections={["region"]}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Country</Label>
            <Select
              value={it.country ?? ""}
              onValueChange={(code) => {
                const found = COUNTRIES.find((c) => c.code === code);
                patch({ country: code, ...(found ? { timeZone: found.zone } : {}) });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Picking a country sets a matching time zone; you can still change it below.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Time zone</Label>
            <Select
              value={it.timeZone || "__local"}
              onValueChange={(v) => patch({ timeZone: v === "__local" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__local">Use this computer</SelectItem>
                {TIME_ZONES.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date format</Label>
            <Select
              value={it.dateFormat ?? "dmy"}
              onValueChange={(v) => patch({ dateFormat: v as DateFormat })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dmy">Day / Month / Year — 31/12/2026</SelectItem>
                <SelectItem value="mdy">Month / Day / Year — 12/31/2026</SelectItem>
                <SelectItem value="ymd">Year / Month / Day — 2026-12-31</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Clock</Label>
            <Select
              value={it.timeFormat ?? "24h"}
              onValueChange={(v) => patch({ timeFormat: v as TimeFormat })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-hour — 18:45</SelectItem>
                <SelectItem value="12h">12-hour — 6:45 PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">Right now, this till reads</p>
          <p className="numeric mt-1 text-lg font-semibold">{formatDateTime(new Date())}</p>
          <p className="text-[11px] text-muted-foreground">Zone in force: {effectiveTimeZone()}</p>
        </div>
      </div>
    </SettingsFrame>
  );
}
