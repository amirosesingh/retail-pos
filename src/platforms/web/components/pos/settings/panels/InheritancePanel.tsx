import { Layers, MonitorCog, Store } from "lucide-react";

import { ScopePanel } from "@/platforms/web/components/pos/settings/ScopeControls";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/settings-sections";

const SECTION_ROUTE: Record<SettingsSectionId, string> = {
  workspace: "/settings/workspace",
  display: "/settings/display",
  printer: "/settings/printer",
  terminalSecurity: "/settings/rules",
  tax: "/settings/tax",
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

const BUSINESS_SECTIONS = SETTINGS_SECTIONS.filter(
  (section) => section.scopeFamily === "business",
).map((section) => section.id);

const TERMINAL_SECTIONS = SETTINGS_SECTIONS.filter(
  (section) => section.scopeFamily === "terminal",
).map((section) => section.id);

/** The single place where settings ownership is selected. */
export function InheritancePanel() {
  return (
    <div className="w-full max-w-full space-y-5">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="size-5 shrink-0 text-primary" /> Settings inheritance
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose where every settings block is owned here. Individual settings pages edit values
          only; they no longer contain their own scope selector.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Store className="size-4" /> Business settings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose Global, Cluster or Branch, then use Edit values for the selected block.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <MonitorCog className="size-4" /> Terminal settings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose Global, Cluster or Terminal. The selected terminal stays active while you edit.
          </p>
        </div>
      </div>

      <ScopePanel
        heading="Business settings ownership"
        sections={BUSINESS_SECTIONS}
        sectionRoutes={SECTION_ROUTE}
      />
      <ScopePanel
        heading="Terminal settings ownership"
        sections={TERMINAL_SECTIONS}
        sectionRoutes={SECTION_ROUTE}
      />
    </div>
  );
}
