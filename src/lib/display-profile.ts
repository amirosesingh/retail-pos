import { useEffect, useRef } from "react";
import { setUiScalePrefs, useUiScalePrefs, type UiScalePrefs } from "./use-ui-scale";
import { useTheme, type ThemeChoice } from "./theme";
import { setAccent, useAccent } from "./accent";
import { DEFAULT_THEME_PALETTE, type ThemePalette } from "./theme-palettes";
export type DisplayProfile = {
  scale: UiScalePrefs;
  theme: ThemeChoice;
  palette?: ThemePalette;
  accent?: string | null;
};
/** Apply resolved shared preferences while retaining this device's fallback. */
export function useDisplayProfile(profile: DisplayProfile | undefined) {
  const scale = useUiScalePrefs();
  const { theme, palette, setTheme, setPalette } = useTheme();
  const accent = useAccent();
  const fallback = useRef<DisplayProfile | null>(null);
  const local = useRef({ scale, theme, palette, accent });
  local.current = { scale, theme, palette, accent };
  useEffect(() => {
    if (!profile && !fallback.current) return;
    fallback.current ??= local.current;
    const next = profile ?? fallback.current;
    setUiScalePrefs(next.scale);
    setTheme(next.theme);
    setPalette(next.palette ?? DEFAULT_THEME_PALETTE);
    setAccent(next.accent ?? null);
  }, [profile, setTheme, setPalette]);
  useEffect(() => () => {
    if (fallback.current) {
      setUiScalePrefs(fallback.current.scale);
      setTheme(fallback.current.theme);
      setPalette(fallback.current.palette ?? DEFAULT_THEME_PALETTE);
      setAccent(fallback.current.accent ?? null);
    }
  }, [setTheme, setPalette]);
}
