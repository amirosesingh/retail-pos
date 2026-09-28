/**
 * Terminal-local accent colour.
 *
 * The till ships amber, but a shop may want its own colour for buttons, icons
 * and highlights. The choice is stored per machine and written straight onto
 * the <html> element as inline custom properties, so it overrides both the
 * light and dark palettes without touching the design tokens themselves.
 */
import { useSyncExternalStore } from "react";

export type AccentPreset = { id: string; label: string; hex: string };

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "amber", label: "Amber (default)", hex: "#e8a33d" },
  { id: "blue", label: "Ocean blue", hex: "#3b82f6" },
  { id: "emerald", label: "Emerald", hex: "#10b981" },
  { id: "violet", label: "Violet", hex: "#8b5cf6" },
  { id: "rose", label: "Rose", hex: "#f43f5e" },
  { id: "slate", label: "Graphite", hex: "#64748b" },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0]!.hex;

const KEY = "pos.accent-color";
let accent: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

const clean = (hex: string | null | undefined) =>
  hex && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim().toLowerCase() : null;

/** Relative luminance decides whether text on the accent is black or white. */
function readableForeground(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? "#10131a" : "#ffffff";
}

const ACCENT_PROPERTIES = [
  "--primary",
  "--primary-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--ring",
  "--chart-1",
] as const;

export function applyAccent(hex: string | null) {
  if (typeof document === "undefined") return;
  const value = clean(hex);
  const root = document.documentElement.style;
  if (!value) {
    for (const property of ACCENT_PROPERTIES) root.removeProperty(property);
    return;
  }
  const fg = readableForeground(value);
  root.setProperty("--primary", value);
  root.setProperty("--primary-foreground", fg);
  root.setProperty("--sidebar-primary", value);
  root.setProperty("--sidebar-primary-foreground", fg);
  root.setProperty("--ring", value);
  root.setProperty("--chart-1", value);
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    accent = clean(window.localStorage.getItem(KEY));
  } catch {
    accent = null;
  }
  applyAccent(accent);
}

export function setAccent(hex: string | null) {
  ensureHydrated();
  const next = clean(hex);
  // The accent store is synchronous. Do not notify React (and controlled UI
  // primitives) when a synchronized profile merely reapplies the same value.
  if (next === accent) return;
  accent = next;
  try {
    if (accent) window.localStorage.setItem(KEY, accent);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode — the colour lasts for this session only */
  }
  applyAccent(accent);
  listeners.forEach((l) => l());
}

export function useAccent(): string | null {
  return useSyncExternalStore(
    (fn) => {
      ensureHydrated();
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => {
      ensureHydrated();
      return accent;
    },
    () => null,
  );
}
