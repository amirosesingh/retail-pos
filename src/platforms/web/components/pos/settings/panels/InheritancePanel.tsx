import { Link } from "@tanstack/react-router";
import { Layers, Loader2, Lock, MonitorCog, Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePos } from "@/lib/pos-store";
import { SETTING_TIERS, TIER_LABELS, type SettingSource } from "@/lib/branch-settings";
import {
  SETTINGS_SECTIONS,
  sectionAllowsTier,
  type SettingsSectionId,
} from "@/lib/settings-sections";

const SECTION_ROUTE: Record<SettingsSectionId, string> = {
  display: "/settings/display",
  printer: "/settings/printer",
  terminalSecurity: "/settings/rules",
  tax: "/settings/tax",
  review: "/settings/rules",
  hours: "/settings/rules",
  receiptIdentity: "/settings/identity",
  receiptLayout: "/settings/elements",
  payment: "/settings/payment",
  whatsapp: "/settings/whatsapp",
  booking: "/settings/booking-rules",
  paymentAccounts: "/settings/accounts",
  numbering: "/settings/numbering",
  stockNumbering: "/settings/stock-numbering",
  region: "/settings/region",
  rounding: "/settings/tax",
  publicDomains: "/settings/system",
  transferApproval: "/settings/system",
  categoryMap: "/settings/catalog",
  integrations: "/settings/system",
  visibility: "/settings/access",
};

/** Read-only map of the same section model used by every settings page. */
export function InheritancePanel() {
  const { currentStore, settingsScope, settingsScopeLoading, scopeIds } = usePos();

  const activeTier = (section: SettingsSectionId): SettingSource => {
    if (settingsScope.locks[section]) return "GLOBAL";
    return (
      [...SETTING_TIERS]
        .reverse()
        .find(
          (tier) => sectionAllowsTier(section, tier) && settingsScope.overrides[tier][section],
        ) ?? "GLOBAL"
    );
  };

  const tierDetail = (tier: SettingSource) => {
    if (tier === "BRANCH") return currentStore.name;
    if (tier === "CLUSTER") return scopeIds.CLUSTER || "No cluster assigned";
    if (tier === "TERMINAL") return scopeIds.TERMINAL || "No terminal registered";
    return "Company default";
  };

  return (
    <div className="w-full max-w-full space-y-5">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="size-5 shrink-0 text-primary" /> Settings inheritance
        </h2>
        <p className="text-sm text-muted-foreground">
          This is a read-only map of the settings the POS actually uses. Edit each block on its
          owning page; the same saved value is then used by checkout, printing and every terminal.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Store className="size-4" /> Business settings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Branch overrides Cluster; Cluster overrides Global.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <MonitorCog className="size-4" /> Terminal settings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Terminal overrides Cluster; Cluster overrides Global.
          </p>
        </div>
      </div>

      {settingsScopeLoading ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading the confirmed scope for this terminal…
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {SETTINGS_SECTIONS.map((section) => {
            const tier = activeTier(section.id);
            const locked = !!settingsScope.locks[section.id];
            return (
              <div
                key={section.id}
                className="grid gap-3 border-t border-border p-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{section.label}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {section.scopeFamily === "terminal" ? "Terminal setting" : "Business setting"}
                    </Badge>
                    {locked && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="size-3" /> Locked globally
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{section.blurb}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div className="text-right">
                    <p className="text-xs font-medium">{TIER_LABELS[tier]}</p>
                    <p
                      className="max-w-48 truncate text-[11px] text-muted-foreground"
                      title={tierDetail(tier)}
                    >
                      {tierDetail(tier)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={SECTION_ROUTE[section.id] as never}>Open setting</Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
