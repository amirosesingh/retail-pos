import { z } from "zod";
import { DEFAULT_THEME_PALETTE, THEME_PALETTES } from "./theme-palettes";

/** Personal preferences never accept business configuration or notification rules. */
export const personalAppearanceSchema = z
  .object({
    workspace: z.enum(["retail", "warehouse", "inventory", "receiving", "management"]).optional(),
    theme: z.enum(["system", "light", "dark"]),
    palette: z.enum(THEME_PALETTES.map((p) => p.id)),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    language: z.enum(["en", "ms", "zh-Hans", "ta", "hi"]),
    scale: z
      .object({
        mode: z.enum(["auto", "manual"]),
        scale: z.number().finite().min(0.85).max(1.5),
        textScale: z.number().finite().min(0.9).max(1.6),
        density: z.enum(["comfortable", "compact"]),
        registerZoom: z.number().finite().min(0.4).max(1.5),
      })
      .strict(),
  })
  .strict();
export type PersonalAppearance = z.infer<typeof personalAppearanceSchema>;
export const DEFAULT_PERSONAL_APPEARANCE: PersonalAppearance = {
  theme: "system",
  palette: DEFAULT_THEME_PALETTE,
  accent: null,
  language: "en",
  scale: { mode: "auto", scale: 1, textScale: 1, density: "comfortable", registerZoom: 0.7 },
};
