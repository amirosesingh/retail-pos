export const THEME_PALETTES = [
  {
    id: "ocean",
    label: "Ocean",
    description: "Clear blue and cyan",
    preview: { background: "#f5faff", primary: "#087ac1", secondary: "#dcefff", accent: "#0891b2" },
  },
  {
    id: "emerald",
    label: "Emerald",
    description: "Emerald and teal",
    preview: { background: "#f5fbf8", primary: "#087f5b", secondary: "#dff5ea", accent: "#0f8f83" },
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Amber and warm neutral",
    preview: { background: "#fffaf4", primary: "#c96a0a", secondary: "#f8ead9", accent: "#b65c35" },
  },
  {
    id: "violet",
    label: "Violet",
    description: "Violet and indigo",
    preview: { background: "#faf8ff", primary: "#7251c9", secondary: "#ece7fb", accent: "#4f63c8" },
  },
  {
    id: "candy",
    label: "Candy",
    description: "Pink, purple and soft blue",
    preview: { background: "#fff8fc", primary: "#c43c83", secondary: "#f8e5f1", accent: "#697bd1" },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy and cyan",
    preview: { background: "#101827", primary: "#38bdf8", secondary: "#1e2b41", accent: "#22d3ee" },
  },
] as const;

export type ThemePalette = (typeof THEME_PALETTES)[number]["id"];

export const DEFAULT_THEME_PALETTE: ThemePalette = "sunset";

export function isThemePalette(value: unknown): value is ThemePalette {
  return THEME_PALETTES.some((palette) => palette.id === value);
}

export function themePalette(id: unknown) {
  return THEME_PALETTES.find((palette) => palette.id === id) ?? THEME_PALETTES[2];
}
