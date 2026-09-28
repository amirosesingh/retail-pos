import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Dynamic UI scale for the whole POS.
 *
 * Windows tills run anywhere from a 1024x768 panel to a 4K desktop. Rather
 * than fixed pixel sizes we derive one multiplier from the viewport (or from
 * the operator's manual preference) and let CSS drive font sizes and control
 * heights from it, so buttons stay touch-friendly (>= 44px) on small screens
 * and readable on large ones.
 */
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type UiDensity = "comfortable" | "compact";
export type UiScalePrefs = {
  mode: "auto" | "manual";
  scale: number;
  /** Font-only multiplier, layered on top of the interface scale. */
  textScale: number;
  density: UiDensity;
  /** Register canvas zoom, set from Display & sizing and kept across sessions. */
  registerZoom: number;
};

const KEY = "pos.ui-scale";
export const REGISTER_ZOOM_MIN = 0.4;
export const REGISTER_ZOOM_MAX = 1.5;
export const REGISTER_ZOOM_DEFAULT = 0.7;
const DEFAULTS: UiScalePrefs = {
  mode: "auto",
  scale: 1,
  textScale: 1,
  density: "comfortable",
  registerZoom: REGISTER_ZOOM_DEFAULT,
};

let prefs: UiScalePrefs = DEFAULTS;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Older builds wrote the same preferences here; read once, then forget it. */
const LEGACY_KEY = "pos.ui.scale";

function load(): UiScalePrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    let raw = window.localStorage.getItem(KEY);
    if (!raw) {
      // Adopt an older device's value, then retire the old key.
      raw = window.localStorage.getItem(LEGACY_KEY);
      if (raw) {
        window.localStorage.setItem(KEY, raw);
        window.localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiScalePrefs>;

    return {
      mode: parsed.mode === "manual" ? "manual" : "auto",
      scale: clamp(Number(parsed.scale) || 1, 0.85, 1.5),
      textScale: clamp(Number(parsed.textScale) || 1, 0.9, 1.6),
      density: parsed.density === "compact" ? "compact" : "comfortable",
      registerZoom: clamp(
        Number(parsed.registerZoom) || REGISTER_ZOOM_DEFAULT,
        REGISTER_ZOOM_MIN,
        REGISTER_ZOOM_MAX,
      ),
    };
  } catch {
    return DEFAULTS;
  }
}

let hydrated = false;
const ensureHydrated = () => {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  prefs = load();
};

export function setUiScalePrefs(patch: Partial<UiScalePrefs>) {
  ensureHydrated();
  const next = { ...prefs, ...patch };
  // useSyncExternalStore listeners run synchronously. Re-emitting an
  // unchanged profile while a Radix control is dispatching onValueChange can
  // re-enter that control before its event has unwound (most visibly in the
  // Display settings radio groups). An unchanged value is not an update.
  if (
    next.mode === prefs.mode &&
    next.scale === prefs.scale &&
    next.textScale === prefs.textScale &&
    next.density === prefs.density &&
    next.registerZoom === prefs.registerZoom
  )
    return;
  prefs = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — keep the in-memory value */
  }
  emit();
}

const subscribe = (fn: () => void) => {
  ensureHydrated();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useUiScalePrefs(): UiScalePrefs {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensureHydrated();
      return prefs;
    },
    () => DEFAULTS,
  );
}

export function computeUiScale(width: number, height: number): number {
  // 1440x900 is the reference layout at scale 1.
  const byWidth = width / 1440;
  const byHeight = height / 900;
  return Number(clamp(Math.min(byWidth, byHeight), 0.85, 1.35).toFixed(3));
}

/** Applies the effective scale + density to the document root. */
export function useUiScale(): number {
  const { mode, scale: manual, textScale, density } = useUiScalePrefs();
  const [auto, setAuto] = useState(1);

  useEffect(() => {
    const apply = () => setAuto(computeUiScale(window.innerWidth, window.innerHeight));
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const scale = mode === "manual" ? manual : auto;

  useEffect(() => {
    document.documentElement.style.setProperty("--pos-scale", String(scale));
    document.documentElement.style.setProperty("--pos-text-scale", String(textScale));
    // Text size drives the root font size, so headings, tables, dialogs and
    // menus all resize together — not just the scaled register shell.
    document.documentElement.style.fontSize = `${Math.round(16 * textScale)}px`;
    document.documentElement.classList.toggle("pos-compact", density === "compact");
  }, [scale, textScale, density]);

  return scale;
}

/** Convenience setter for settings UI. */
export function useSetUiScale() {
  return useCallback((patch: Partial<UiScalePrefs>) => setUiScalePrefs(patch), []);
}
