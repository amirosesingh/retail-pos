import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PALETTE,
  THEME_PALETTES,
  isThemePalette,
  themePalette,
} from "@/lib/theme-palettes";
import {
  persistThemePalette,
  readStoredPalette,
  THEME_PALETTE_STORAGE_KEY,
} from "@/lib/theme";

afterEach(() => vi.unstubAllGlobals());

describe("shared POS colour themes", () => {
  it("offers the six approved palettes through one registry", () => {
    expect(THEME_PALETTES.map((palette) => palette.id)).toEqual([
      "ocean",
      "emerald",
      "sunset",
      "violet",
      "candy",
      "midnight",
    ]);
    expect(new Set(THEME_PALETTES.map((palette) => palette.id)).size).toBe(6);
  });

  it("falls back safely when an older or invalid setting is loaded", () => {
    expect(isThemePalette("midnight")).toBe(true);
    expect(isThemePalette("unknown")).toBe(false);
    expect(themePalette("unknown").id).toBe(DEFAULT_THEME_PALETTE);
  });

  it("saves a selected palette and restores it after reload", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    persistThemePalette("violet");

    expect(values.get(THEME_PALETTE_STORAGE_KEY)).toBe("violet");
    expect(readStoredPalette()).toBe("violet");
  });
});
