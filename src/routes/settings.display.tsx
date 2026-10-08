import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { DisplayScalingSettings } from "@/platforms/web/components/pos/DisplayScalingSettings";

export const Route = createFileRoute("/settings/display")({
  head: () => ({
    meta: [
      { title: "Display & Text Size — Retail" },
      {
        name: "description",
        content:
          "Scale fonts, buttons and density so the till stays touch-friendly on any Windows screen, and switch between light and dark themes.",
      },
      { property: "og:title", content: "Display & Text Size — Retail" },
      {
        property: "og:description",
        content: "Color themes, interface scaling and density controls for the register.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Appearance"
      description="Your theme, language and display size follow your user account."
      permission="can_customize_display"
      showSaveBar={false}
      allowWhileScopeLoading
    >
      <DisplayScalingSettings bare />
    </SettingsFrame>
  ),
});
