import { isDesktop } from "@/lib/branding";
import { isManagementDevice } from "@/lib/management-device";
import { usePersonalAppearance } from "@/lib/personal-appearance";
import { createFileRoute } from "@tanstack/react-router";
import { Boxes, ClipboardCheck, LayoutDashboard, Store, Warehouse } from "lucide-react";
import type { TerminalPurpose } from "@/core/types/pos-types";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { usePos } from "@/lib/pos-store";

const PURPOSES: Array<{
  value: TerminalPurpose;
  label: string;
  description: string;
  icon: typeof Store;
}> = [
  {
    value: "retail",
    label: "Retail selling",
    description: "Open the register first for fast checkout.",
    icon: Store,
  },
  {
    value: "warehouse",
    label: "Warehouse",
    description: "Prioritize stock movement, requests and dispatch.",
    icon: Warehouse,
  },
  {
    value: "inventory",
    label: "Inventory",
    description: "Prioritize catalog, counts and stock adjustments.",
    icon: Boxes,
  },
  {
    value: "receiving",
    label: "Receiving",
    description: "Prioritize incoming deliveries and purchase orders.",
    icon: ClipboardCheck,
  },
  {
    value: "management",
    label: "Management",
    description: "Prioritize live performance, approvals and reports.",
    icon: LayoutDashboard,
  },
];

function WorkspaceSettings() {
  const { state, updateSettings } = usePos();
  const personal = usePersonalAppearance();
  const usesTerminalPurpose = isDesktop() && !isManagementDevice();
  const integrations = state.settings.integrations;
  const purpose = integrations.terminalPurpose ?? "retail";

  const update = (patch: { terminalPurpose?: TerminalPurpose }) =>
    updateSettings({ integrations: { ...integrations, ...patch } });

  return (
    <SettingsFrame
      title="Terminal workspace"
      description="User workspace and terminal purpose are independent. Permissions still decide which actions are available."
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">My workspace</h2>
          <p className="text-sm text-muted-foreground">Applies to your account on web and mobile, and Management PCs. Operations PCs keep their terminal purpose. This never changes permissions or branch access.</p>
          <RadioGroup value={personal.profile.workspace ?? "automatic"} disabled={!personal.editable}
            onValueChange={(value) => personal.update({ workspace: value === "automatic" ? undefined : value as TerminalPurpose })}
            className="grid gap-3 sm:grid-cols-2">
            <Label htmlFor="workspace-automatic" className="flex items-center gap-2 rounded-lg border p-3"><RadioGroupItem id="workspace-automatic" value="automatic" />User default: Retail; Warehouse for warehouse users; Management for administrators</Label>
            {PURPOSES.map(option => <Label key={option.value} htmlFor={`workspace-${option.value}`} className="flex items-center gap-2 rounded-lg border p-3"><RadioGroupItem id={`workspace-${option.value}`} value={option.value} />{option.label}</Label>)}
          </RadioGroup>
          {personal.pending && <p className="text-xs text-muted-foreground">Saving your workspace preference…</p>}
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Terminal purpose</h2>
            <p className="text-sm text-muted-foreground">{usesTerminalPurpose ? "This Operations PC follows the terminal purpose below, not My workspace." : "This web or management session follows My workspace above. Terminal purpose below applies only to Operations PCs in the selected settings scope."}</p>
            <p className="text-sm text-muted-foreground">
              This changes navigation emphasis only; it never grants access.
            </p>
          </div>
          <RadioGroup
            value={purpose}
            onValueChange={(value) => update({ terminalPurpose: value as TerminalPurpose })}
            className="grid gap-3 sm:grid-cols-2"
          >
            {PURPOSES.map((option) => (
              <Label
                key={option.value}
                htmlFor={`purpose-${option.value}`}
                className="cursor-pointer"
              >
                <Card
                  className={
                    purpose === option.value
                      ? "border-primary bg-primary/5"
                      : "transition-colors hover:border-primary/50"
                  }
                >
                  <CardContent className="flex gap-3 p-4">
                    <RadioGroupItem
                      id={`purpose-${option.value}`}
                      value={option.value}
                      className="mt-1"
                    />
                    <option.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span>
                      <span className="block font-medium">{option.label}</span>
                      <span className="mt-1 block text-sm font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </CardContent>
                </Card>
              </Label>
            ))}
          </RadioGroup>
        </section>
      </div>
    </SettingsFrame>
  );
}

export const Route = createFileRoute("/settings/workspace")({
  head: () => ({ meta: [{ title: "Terminal Workspace — Retail" }] }),
  component: WorkspaceSettings,
});
