import { useEffect, useState } from "react";
import { CURRENCIES, currencyCode, formatMoney } from "@/lib/currency";
import { HelpTip } from "@/components/ui/help-tip";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame, useSettingsCtx } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePos } from "@/lib/pos-store";
import { TIME_ZONES, formatDateTime } from "@/lib/time-zone";
import type { TimeFormat } from "@/core/types/pos-types";

/** Countries the shop is likely to trade in, with a sensible default zone. */
const COUNTRIES: { code: string; name: string; zone: string }[] = [
  { code: "BN", name: "Brunei", zone: "Asia/Brunei" },
  { code: "KE", name: "Kenya", zone: "Africa/Nairobi" },
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
  return <SettingsFrame title="Region & time" description="Terminal clocks drift and travel. Pick the region here and every displayed and printed time follows it, whatever the PC thinks."><RegionForm /></SettingsFrame>;
}

function RegionForm() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const { state } = usePos();
  const { updateSettings } = useSettingsCtx();
  const it = state.settings.integrations;

  const patch = (next: Partial<typeof it>) => updateSettings({ integrations: { ...it, ...next } });

  return (
    <>
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">Country</Label>
              <HelpTip
                text={
                  <>Picking a country sets a matching time zone; you can still change it below.</>
                }
              />
            </div>
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
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Currency</Label>
            <Select value={currencyCode(it.currency)} onValueChange={currency => patch({ currency })}>
              <SelectTrigger aria-label="Business currency"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Display currency only; existing amounts are not converted. Country and currency can be selected independently.</p>
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
            <p className="rounded-md border border-border px-3 py-2 text-sm">
              DD-MM-YYYY · 31-12-2026
            </p>
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
          <p className="numeric mt-1 text-lg font-semibold">{formatDateTime(now, { timeZone: it.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
          <p className="text-[11px] text-muted-foreground">Selected zone: {it.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          <p className="mt-2 text-sm">Currency: {currencyCode(it.currency)} · {formatMoney(1234.56, it.currency)}</p>
        </div>
      </div>
    </>
  );
}
