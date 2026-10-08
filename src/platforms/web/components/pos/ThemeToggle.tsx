import { usePersonalAppearance } from "@/lib/personal-appearance";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeChoice } from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/** Header control cycling System → Light → Dark. */
export function ThemeToggle() {
  const { theme, resolved } = useTheme();
  const { update, editable } = usePersonalAppearance();
  const Icon = theme === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
      title={`Theme: ${theme}`}
      disabled={!editable}
      onClick={() => update({ theme: NEXT[theme] })}
    >
      <Icon className="size-4" />
    </Button>
  );
}
