import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PALETTE,
  THEME_PALETTES,
  isThemePalette,
  themePalette,
} from "@/lib/theme-palettes";

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
});
