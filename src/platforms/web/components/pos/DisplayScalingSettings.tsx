import { useEffect, useState } from "react";
import { usePos } from "@/lib/pos-store";
import { PresetNumber } from "@/components/ui/preset-number";
import type { DisplayProfile } from "@/lib/display-profile";
import { Check, Monitor, MonitorCog, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  computeUiScale,
  REGISTER_ZOOM_DEFAULT,
  REGISTER_ZOOM_MAX,
  REGISTER_ZOOM_MIN,
  useUiScalePrefs,
  type UiDensity,
} from "@/lib/use-ui-scale";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { ACCENT_PRESETS, setAccent, useAccent } from "@/lib/accent";
import {
  THEME_PALETTES,
  isThemePalette,
  themePalette,
  type ThemePalette,
} from "@/lib/theme-palettes";

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const MODES: { value: "auto" | "manual"; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Follows the window size" },
  { value: "manual", label: "Manual", hint: "Pick your own size" },
];

const DENSITIES: { value: UiDensity; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/** Terminal-local control for font size and control height across the app. */
export function DisplayScalingSettings({ bare = false }: { bare?: boolean }) {
  const prefs = useUiScalePrefs();
  const {
    theme,
    palette,
    setTheme: applyTheme,
    setPalette: applyPalette,
  } = useTheme();
  const accent = useAccent();
  const { state, updateSettings } = usePos();
  const saveProfile = (patch: Partial<DisplayProfile>) => updateSettings({ integrations: {
    ...state.settings.integrations,
    displayProfile: {
      ...state.settings.integrations.displayProfile,
      scale: prefs,
      theme,
      palette,
      accent,
      ...patch,
    },
  } });
  const setTheme = (value: ThemeChoice) => {
    applyTheme(value);
    saveProfile({ theme: value });
  };
  const setPalette = (value: ThemePalette) => {
    applyPalette(value);
    setAccent(null);
    saveProfile({ palette: value, accent: null });
  };
  const setAccentOverride = (value: string | null) => {
    if (value === null || /^#[0-9a-f]{6}$/i.test(value)) {
      setAccent(value);
      saveProfile({ accent: value });
    }
  };
  const setUiScalePrefs = (patch: Partial<typeof prefs>) => saveProfile({ scale: { ...prefs, ...patch } });
  const palettePrimary = themePalette(palette).preview.primary;
  const [accentDraft, setAccentDraft] = useState(accent ?? palettePrimary);
  useEffect(() => setAccentDraft(accent ?? palettePrimary), [accent, palettePrimary]);
  const commitAccentDraft = () => {
    if (/^#[0-9a-f]{6}$/i.test(accentDraft)) setAccentOverride(accentDraft);
    else setAccentDraft(accent ?? palettePrimary);
  };
  const auto =
    typeof window === "undefined" ? 1 : computeUiScale(window.innerWidth, window.innerHeight);
  const effective = prefs.mode === "manual" ? prefs.scale : auto;
  const text = prefs.textScale;
  const registerZoom = prefs.registerZoom;

  return (
    <section className={bare ? "" : "rounded-lg border border-border bg-card p-5"}>
      {!bare && (
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MonitorCog className="size-4 text-primary" /> Display &amp; text size
        </h2>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Applies to the selected settings scope. Buttons never drop below a touch-safe size.
      </p>

      <div className="mt-5 space-y-3">
        <div>
          <Label className="text-sm font-medium">Color theme</Label>
          <p className="text-[11px] text-muted-foreground">
            Preview and apply one shared palette. Canvas positions and sizes never change.
          </p>
        </div>
        <RadioGroup
          value={palette}
          onValueChange={(value) => {
            if (isThemePalette(value)) setPalette(value);
          }}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Color theme"
        >
          {THEME_PALETTES.map((option) => {
            const selected = option.id === palette;
            return (
              <Label
                key={option.id}
                htmlFor={`palette-${option.id}`}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-3 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm ${
                  selected ? "border-primary ring-2 ring-primary/20" : "border-border"
                }`}
              >
                <RadioGroupItem
                  id={`palette-${option.id}`}
                  value={option.id}
                  className="sr-only"
                />
                <div
                  className="mb-3 overflow-hidden rounded-lg border"
                  style={{ background: option.preview.background, borderColor: option.preview.secondary }}
                >
                  <div className="flex h-12 items-end gap-1 p-2">
                    <span className="h-7 flex-1 rounded" style={{ background: option.preview.primary }} />
                    <span className="h-5 flex-1 rounded" style={{ background: option.preview.secondary }} />
                    <span className="h-6 flex-1 rounded" style={{ background: option.preview.accent }} />
                  </div>
                </div>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {option.label}
                  {selected && (
                    <Badge className="ml-auto gap-1 px-1.5 py-0 text-[10px]">
                      <Check className="size-3" /> Selected
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {option.description}
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </div>

      <div className="mt-5 space-y-2">
        <Label className="text-sm font-medium">Brightness</Label>
        <RadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as ThemeChoice)}
          className="grid grid-cols-3 gap-2"
          aria-label="Brightness"
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Label
              key={value}
              htmlFor={`brightness-${value}`}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
                theme === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <RadioGroupItem id={`brightness-${value}`} value={value} className="sr-only" />
              <Icon className="size-4" /> {label}
            </Label>
          ))}
        </RadioGroup>
      </div>

      <details className="mt-5 rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced accent override</summary>
        <div className="mt-3 space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Optionally replace the palette's main action colour. Reset returns to the selected palette.
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.label}
              aria-label={p.label}
              onClick={() => setAccentOverride(p.hex)}
              style={{ background: p.hex }}
              className={`size-8 rounded-full border-2 ${
                accent === p.hex ? "border-foreground" : "border-transparent"
              }`}
            />
          ))}
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <input
            type="color"
            aria-label="Custom accent colour"
            value={accent ?? palettePrimary}
            onChange={(e) => setAccentOverride(e.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1"
          />
          <Input
            value={accentDraft}
            aria-label="Accent colour hex"
            onChange={(e) => setAccentDraft(e.target.value)}
            onBlur={commitAccentDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAccentDraft();
            }}
            className="numeric h-9 min-w-0 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setAccentOverride(null)}
          >
            Use palette
          </Button>
        </div>
        </div>
      </details>

      <details className="mt-4" open><summary className="cursor-pointer text-sm font-medium">Sizing & density</summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sizing mode</Label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setUiScalePrefs({ mode: m.value })}
                  className={`flex-1 px-3 py-2 text-xs ${
                    prefs.mode === m.value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                  <span className="block text-[10px] opacity-70">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Interface size</Label>
              <span className="numeric text-xs">{Math.round(effective * 100)}%</span>
            </div>
            <Slider
              aria-label="Interface size"
              min={85}
              max={150}
              step={5}
              disabled={prefs.mode !== "manual"}
              value={[Math.round(effective * 100)]}
              onValueChange={([v]) => setUiScalePrefs({ mode: "manual", scale: (v ?? 100) / 100 })}
            />
            <p className="text-[10px] text-muted-foreground">
              Buttons, inputs and overall layout density.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Text size</Label>
              <span className="numeric text-xs">{Math.round(text * 100)}%</span>
            </div>
            <Slider
              aria-label="Text size"
              min={90}
              max={160}
              step={5}
              value={[Math.round(text * 100)]}
              onValueChange={([v]) => setUiScalePrefs({ textScale: (v ?? 100) / 100 })}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <PresetNumber label="Text size percentage" value={Math.round(text * 100)} onChange={(value) => setUiScalePrefs({ textScale: value / 100 })} min={90} max={160}
                options={[90, 100, 110, 125, 150, 160].map((value) => ({ value, label: `${value}%` }))} />
              <span className="shrink-0 text-[11px] text-muted-foreground">% of normal</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Font size only — works independently of the display size.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Register zoom</Label>
              <span className="numeric text-xs">{Math.round(registerZoom * 100)}%</span>
            </div>
            <Slider
              aria-label="Register zoom"
              min={Math.round(REGISTER_ZOOM_MIN * 100)}
              max={Math.round(REGISTER_ZOOM_MAX * 100)}
              step={5}
              value={[Math.round(registerZoom * 100)]}
              onValueChange={([v]) =>
                setUiScalePrefs({ registerZoom: (v ?? REGISTER_ZOOM_DEFAULT * 100) / 100 })
              }
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <PresetNumber label="Register zoom percentage" value={Math.round(registerZoom * 100)} onChange={(value) => setUiScalePrefs({ registerZoom: value / 100 })} min={40} max={150}
                options={[40, 50, 60, 70, 80, 90, 100, 125, 150].map((value) => ({ value, label: `${value}%` }))} />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => setUiScalePrefs({ registerZoom: REGISTER_ZOOM_DEFAULT })}
              >
                Reset
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              How much of the register screen fits at once. Saved for the selected scope, so it stays
              the same each time the till is reopened.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Density</Label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {DENSITIES.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setUiScalePrefs({ density: d.value })}
                  className={`flex-1 px-3 py-2 text-xs ${
                    prefs.density === d.value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setUiScalePrefs({ mode: "auto", scale: 1, textScale: 1, density: "comfortable" })
            }
          >
            Reset to automatic
          </Button>
        </div>

        <div
          className="rounded-md border border-border p-4"
          style={{ fontSize: `calc(0.875rem * ${effective})` }}
        >
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Preview</p>
          <p className="mt-2 font-medium">Espresso Beans 250g</p>
          <p className="numeric text-muted-foreground">2 × $12.50</p>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-primary px-3 text-primary-foreground"
              style={{ minHeight: `calc(40px * ${effective})` }}
            >
              Charge
            </button>
            <button
              className="rounded-md border border-border px-3"
              style={{ minHeight: `calc(40px * ${effective})` }}
            >
              Hold
            </button>
          </div>
        </div>
      </div>
      </details>
    </section>
  );
}
