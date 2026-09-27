import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_PALETTE,
  isThemePalette,
  type ThemePalette,
} from "./theme-palettes";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "pos.theme";
const PALETTE_KEY = "pos.color-theme";
/** Older builds wrote the same preference here; read once, then forget it. */
const LEGACY_KEY = "pos.ui.theme";

/** Reads the choice from the current key, adopting an older device's value. */
const readStoredTheme = (): ThemeChoice | null => {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return current as ThemeChoice;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    localStorage.setItem(KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
    return legacy as ThemeChoice;
  } catch {
    return null;
  }
};


type Ctx = {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  palette: ThemePalette;
  setTheme: (t: ThemeChoice) => void;
  setPalette: (palette: ThemePalette) => void;
};

const ThemeContext = createContext<Ctx>({
  theme: "system",
  resolved: "dark",
  palette: DEFAULT_THEME_PALETTE,
  setTheme: () => {},
  setPalette: () => {},
});

/** Runs before paint so the terminal never flashes the wrong palette. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var p=localStorage.getItem("${PALETTE_KEY}")||"${DEFAULT_THEME_PALETTE}";document.documentElement.classList.toggle("dark",d);document.documentElement.setAttribute("data-pos-theme",p);}catch(e){}
try{var a=localStorage.getItem("pos.accent-color");if(a&&/^#[0-9a-fA-F]{6}$/.test(a)){var n=parseInt(a.slice(1),16);var ch=[(n>>16)&255,(n>>8)&255,n&255].map(function(c){var s=c/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);});var L=0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];var f=L>0.45?"#10131a":"#ffffff";var r=document.documentElement.style;r.setProperty("--primary",a);r.setProperty("--primary-foreground",f);r.setProperty("--sidebar-primary",a);r.setProperty("--sidebar-primary-foreground",f);r.setProperty("--ring",a);r.setProperty("--chart-1",a);}}catch(e){}})();`;

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [palette, setPaletteState] = useState<ThemePalette>(DEFAULT_THEME_PALETTE);
  // Seed from what the boot script already wrote on <html>, so the first
  // client render matches the server markup instead of flipping the palette.
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored === "light" || stored === "dark" || stored === "system") setThemeState(stored);
    try {
      const storedPalette = localStorage.getItem(PALETTE_KEY);
      if (isThemePalette(storedPalette)) setPaletteState(storedPalette);
    } catch {
      /* private mode */
    }


    setPrefersDark(systemDark());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" =
    theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    // Midnight deliberately stays dark even when the brightness preference is
    // light, so native form controls must follow the effective palette too.
    document.documentElement.style.colorScheme = palette === "midnight" ? "dark" : resolved;
  }, [palette, resolved]);

  useEffect(() => {
    document.documentElement.dataset.posTheme = palette;
  }, [palette]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode */
    }
  }, []);

  const setPalette = useCallback((next: ThemePalette) => {
    setPaletteState(next);
    try {
      localStorage.setItem(PALETTE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, palette, setTheme, setPalette }),
    [theme, resolved, palette, setTheme, setPalette],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
