import { DEFAULT_THEME_PALETTE, isThemePalette, type ThemePalette } from "./theme-palettes";

export const THEME_PALETTE_STORAGE_KEY = "pos.color-theme";

export function readStoredPalette(): ThemePalette {
  try {
    const stored = localStorage.getItem(THEME_PALETTE_STORAGE_KEY);
    return isThemePalette(stored) ? stored : DEFAULT_THEME_PALETTE;
  } catch {
    return DEFAULT_THEME_PALETTE;
  }
}

export function persistThemePalette(palette: ThemePalette) {
  try {
    localStorage.setItem(THEME_PALETTE_STORAGE_KEY, palette);
  } catch {
    /* private mode */
  }
}
