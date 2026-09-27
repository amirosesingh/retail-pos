import { useEffect, useState } from "react";
import { listTerminalTokens, type TerminalToken } from "@/core/activation/terminal-tokens";
/**
 * Scope controls for the settings pages.
 *
 * Business settings resolve Global → Cluster → Branch. Terminal settings
 * resolve Global → Cluster → Terminal. The access device is never a scope.
 */
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import {
  SETTING_TIERS,
  TIER_LABELS,
  type SettingSource,
  type SettingTier,
} from "@/lib/branch-settings";
import {
  SECTION_BY_ID,
  sectionAllowsTier,
  sectionOfPath,
  type SettingsSectionId,
} from "@/lib/settings-sections";

const TONE: Record<SettingSource, string> = {
  GLOBAL: "bg-muted text-muted-foreground",
  CLUSTER: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  BRANCH: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  TERMINAL: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
};

/** Read-only marker telling a cashier where the active rule comes from. */
export function ScopeBadge({ path, className = "" }: { path: string; className?: string }) {
  const { sourceOfPath, currentStore, scopeIds } = usePos();
  const source = sourceOfPath(path);
  const label =
    source === "BRANCH"
      ? `Branch: ${currentStore.name}`
      : source === "CLUSTER"
        ? `Cluster: ${scopeIds.CLUSTER || "—"}`
        : source === "TERMINAL"
          ? `Terminal: ${scopeIds.TERMINAL || "—"}`
          : "Global";
  return (
    <Badge
      variant="outline"
      className={`h-5 border-transparent text-[10px] ${TONE[source]} ${className}`}
    >
      {label}
    </Badge>
  );
}

/** Scope selector for one block: pick which tier owns it, or lock it globally. */
export function SectionScope({ section }: { section: SettingsSectionId }) {
  const {
    settingsScope,
    setSectionScope,
    setSectionLocked,
    scopeIds,
    currentStore,
    saveConfiguredSettings,
    settingsScopeLoading,
  } = usePos();
  const { isAdmin } = useAuth();
  const def = SECTION_BY_ID[section];
  if (!def) return null;
  const allowedTiers = SETTING_TIERS.filter((tier) => sectionAllowsTier(section, tier));
  const locked = !!settingsScope.locks[section];
  const active: SettingSource =
    [...allowedTiers].reverse().find((t) => settingsScope.overrides[t][section]) ?? "GLOBAL";

  const choose = async (tier: SettingSource) => {
    if (tier === active) return;
    try {
      await saveConfiguredSettings();
      const order: SettingSource[] = ["GLOBAL", ...allowedTiers];
      // Keep inherited lower scopes; remove only overrides above the chosen tier.
      for (const existing of [...allowedTiers].reverse()) {
        if (
          order.indexOf(existing) > order.indexOf(tier) &&
          settingsScope.overrides[existing]?.[section]
        )
          await setSectionScope(section, false, existing);
      }
      if (tier !== "GLOBAL") await setSectionScope(section, true, tier as SettingTier);
      toast.success(
        tier === "GLOBAL"
          ? `${def.label} follows the global rule`
          : `${def.label} → ${TIER_LABELS[tier]}`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const scopeName = (tier: SettingSource) =>
    tier === "BRANCH"
      ? currentStore.name
      : tier === "CLUSTER"
        ? scopeIds.CLUSTER || "no cluster"
        : tier === "TERMINAL"
          ? scopeIds.TERMINAL || "no terminal"
          : "";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium">{def.label}</p>
        <p className="text-[11px] text-muted-foreground">{def.blurb}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {(["GLOBAL", ...allowedTiers] as SettingSource[]).map((tier) => (
          <Button
            key={tier}
            size="sm"
            variant={active === tier ? "default" : "outline"}
            className="h-7 text-[11px]"
            disabled={
              settingsScopeLoading ||
              (locked && tier !== "GLOBAL") ||
              (tier !== "GLOBAL" && !scopeIds[tier])
            }
            title={scopeName(tier)}
            onClick={() => void choose(tier)}
          >
            {TIER_LABELS[tier]}
          </Button>
        ))}
        {isAdmin && (
          <label className="ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" />
            <Switch
              aria-label={`Lock ${def.label} globally`}
              disabled={settingsScopeLoading}
              checked={locked}
              onCheckedChange={(on) => void setSectionLocked(section, on)}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/** Scope selectors for a whole settings page. */
export function ScopePanel({ sections }: { sections: SettingsSectionId[] }) {
  const { currentStore, settingsTerminalId, setSettingsTerminalId, saveConfiguredSettings } =
    usePos();
  const [terminals, setTerminals] = useState<TerminalToken[]>([]);
  const [terminalError, setTerminalError] = useState("");
  const terminalScoped = sections.some(
    (section) => SECTION_BY_ID[section]?.scopeFamily === "terminal",
  );
  const businessScoped = sections.some(
    (section) => SECTION_BY_ID[section]?.scopeFamily === "business",
  );
  useEffect(() => {
    if (!terminalScoped) return;
    let cancelled = false;
    void listTerminalTokens()
      .then((rows) => {
        if (!cancelled) setTerminals(rows);
      })
      .catch((error) => {
        if (!cancelled) setTerminalError((error as Error).message);
      });
    return () => {
      cancelled = true;
      setSettingsTerminalId("");
    };
  }, [setSettingsTerminalId, terminalScoped]);
  if (!sections.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium">Applies to</p>
      <p className="text-[11px] text-muted-foreground">
        {terminalScoped && businessScoped
          ? "Business blocks use Branch → Cluster → Global. Terminal blocks use Terminal → Cluster → Global."
          : terminalScoped
            ? "Terminal overrides Cluster; Cluster overrides Global."
            : "Branch overrides Cluster; Cluster overrides Global."}
      </p>
      {terminalScoped && (
        <label className="grid gap-1 text-xs">
          Terminal to configure
          <select
            aria-label="Terminal to configure"
            className="h-9 rounded border border-input bg-background px-2"
            value={settingsTerminalId}
            onChange={(event) => {
              const id = event.target.value;
              void saveConfiguredSettings()
                .then(() => setSettingsTerminalId(id))
                .catch((error) => toast.error((error as Error).message));
            }}
          >
            <option value="">This registered terminal</option>
            {terminals
              .filter(
                (terminal) =>
                  terminal.locationId === currentStore.id && terminal.status !== "revoked",
              )
              .map((terminal) => (
                <option key={terminal.id} value={terminal.id}>
                  {terminal.deviceName || terminal.id} ({terminal.platform})
                </option>
              ))}
          </select>
          {terminalError && (
            <span className="text-destructive">Terminal list unavailable: {terminalError}</span>
          )}
        </label>
      )}
      {sections.map((id) => (
        <SectionScope key={id} section={id} />
      ))}
    </div>
  );
}

/** Convenience: scope badge resolved from a settings path's owning block. */
export function pathSection(path: string): SettingsSectionId | null {
  return (sectionOfPath(path)?.id as SettingsSectionId | undefined) ?? null;
}
