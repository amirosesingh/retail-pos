import { canEditSettingsScope } from "@/lib/settings-edit-policy";
import { Link } from "@tanstack/react-router";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  getPath,
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

const scopeExplanation = (tier: SettingSource, family: "business" | "terminal") => {
  if (tier === "GLOBAL")
    return family === "business"
      ? "Saved once for every store; a cluster or store override may replace it."
      : "Saved once for every terminal; a cluster or terminal override may replace it.";
  if (tier === "CLUSTER") return "Saved for every store and terminal in the selected cluster.";
  if (tier === "BRANCH") return "Saved only for the selected store.";
  return "Saved only for the selected terminal.";
};

const displayValue = (value: unknown, inherited = false) => {
  if (value === undefined) return inherited ? "Inherited" : "Application default";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string" || typeof value === "number") return String(value) || "Empty";
  return JSON.stringify(value);
};

/** Read-only marker telling a cashier where the active rule comes from. */
export function ScopeBadge({ path, className = "" }: { path: string; className?: string }) {
  const { sourceOfPath, currentStore, scopeIds } = usePos();
  const source = sourceOfPath(path);
  const label =
    source === "BRANCH"
      ? `Store: ${currentStore.name}`
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
export function SectionScope({
  section,
  editRoute,
}: {
  section: SettingsSectionId;
  editRoute?: string;
}) {
  const {
    settingsScope,
    setSectionScope,
    setSectionLocked,
    scopeIds,
    currentStore,
    sourceOfPath,
    saveConfiguredSettings,
    settingsScopeLoading,
    configuredGlobalSettings,
    state,
  } = usePos();
  const [compareOpen, setCompareOpen] = useState(false);
  const { isAdmin, can } = useAuth();
  const def = SECTION_BY_ID[section];
  if (!def) return null;
  const allowedTiers = SETTING_TIERS.filter((tier) => sectionAllowsTier(section, tier));
  const selectableTiers: SettingSource[] = ["GLOBAL", ...allowedTiers];
  const locked = !!settingsScope.locks[section];
  const active: SettingSource =
    [...allowedTiers].reverse().find((t) => settingsScope.overrides[t][section]) ?? "GLOBAL";
  const activePatch = active === "GLOBAL" ? null : settingsScope.overrides[active][section];
  const configuredHere =
    !!activePatch && def.paths.some((path) => getPath(activePatch, path) !== undefined);
  const effectiveSources = new Set(def.paths.map((path) => sourceOfPath(path)));
  const inheritedSource = effectiveSources.size === 1 ? [...effectiveSources][0] : null;
  const sourceText =
    active === "GLOBAL"
      ? "Global value · application default where unset"
      : configuredHere
        ? `Value configured here · ${TIER_LABELS[active]}`
        : inheritedSource
          ? `Inherited from ${TIER_LABELS[inheritedSource]}`
          : "Inherited from multiple parent settings";
  const targetText = `Edits save to ${TIER_LABELS[active]} · ${scopeExplanation(active, def.scopeFamily)}`;

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
        <p className="mt-1 text-[11px] font-medium text-primary">Current value: {sourceText}</p>
        <p className="text-[11px] text-muted-foreground">{targetText}</p>
        <p className="text-[11px] text-muted-foreground">
          Available scopes: {selectableTiers.map((tier) => TIER_LABELS[tier]).join(" · ")}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {selectableTiers.map((tier) => (
          <Button
            key={tier}
            size="sm"
            variant={active === tier ? "default" : "outline"}
            className="h-7 text-[11px]"
            disabled={
              settingsScopeLoading ||
              !canEditSettingsScope(tier, isAdmin, can("can_access_pos_settings"), locked) ||
              (locked && tier !== "GLOBAL") ||
              (tier !== "GLOBAL" && !scopeIds[tier])
            }
            title={`${scopeName(tier) ? `${scopeName(tier)} · ` : ""}${scopeExplanation(tier, def.scopeFamily)}`}
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
        {editRoute && (
          <Button asChild size="sm" variant="ghost" className="h-7 text-[11px]">
            <Link to={editRoute as never}>Edit values</Link>
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => setCompareOpen(true)}
        >
          Compare values
        </Button>
      </div>
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[90vh] w-[min(96vw,70rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{def.label} values by scope</DialogTitle>
            <DialogDescription>
              Global is the business-wide value. “Inherited” means that scope stores no copy and
              follows its parent dynamically. Effective is what the selected POS uses now.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2 font-medium">Setting</th>
                  <th className="px-3 py-2 font-medium">Global</th>
                  {allowedTiers.map((tier) => (
                    <th key={tier} className="px-3 py-2 font-medium">
                      {TIER_LABELS[tier]}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Effective now</th>
                </tr>
              </thead>
              <tbody>
                {def.paths.map((path) => (
                  <tr key={path} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{path}</td>
                    <td className="max-w-64 break-words px-3 py-2">
                      {displayValue(getPath(configuredGlobalSettings, path))}
                    </td>
                    {allowedTiers.map((tier) => (
                      <td key={tier} className="max-w-64 break-words px-3 py-2">
                        {displayValue(getPath(settingsScope.overrides[tier][section], path), true)}
                      </td>
                    ))}
                    <td className="max-w-64 break-words bg-primary/5 px-3 py-2 font-medium">
                      {displayValue(getPath(state.settings, path))}
                      <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                        From {TIER_LABELS[sourceOfPath(path)]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Next edit target: <strong>{TIER_LABELS[active]}</strong>.{" "}
            {scopeExplanation(active, def.scopeFamily)}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Central scope selectors for a group of settings blocks. */
export function ScopePanel({
  sections,
  heading = "Applies to",
  sectionRoutes,
}: {
  sections: SettingsSectionId[];
  heading?: string;
  sectionRoutes?: Partial<Record<SettingsSectionId, string>>;
}) {
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
    };
  }, [terminalScoped]);
  if (!sections.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium">{heading}</p>
      <p className="text-[11px] text-muted-foreground">
        {terminalScoped && businessScoped
          ? "Business blocks use Store → Cluster → Global. Terminal blocks use Terminal → Cluster → Global."
          : terminalScoped
            ? "Terminal overrides Cluster; Cluster overrides Global."
            : "Store overrides Cluster; Cluster overrides Global."}
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
        <SectionScope key={id} section={id} editRoute={sectionRoutes?.[id]} />
      ))}
    </div>
  );
}

/** Convenience: scope badge resolved from a settings path's owning block. */
export function pathSection(path: string): SettingsSectionId | null {
  return (sectionOfPath(path)?.id as SettingsSectionId | undefined) ?? null;
}
