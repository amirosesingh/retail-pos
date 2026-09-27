import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ReceiptPrinterSettings } from "@/platforms/web/components/pos/ReceiptPrinterSettings";

export const Route = createFileRoute("/settings/printer")({
  head: () => ({
    meta: [
      { title: "Receipt Printer — Retail" },
      {
        name: "description",
        content:
          "Choose the thermal printer for this till, set encoding, line endings, page margins and the cash drawer kick pin, then print a test slip.",
      },
      { property: "og:title", content: "Receipt Printer — Retail" },
      {
        property: "og:description",
        content: "Printer, margins and cash drawer settings for this terminal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt printer"
      description="Edit the printer profile for the ownership selected in Settings inheritance: device, encoding, margins and cash drawer."
    >
      <SettingsTabs current="/settings/printer" />

      <ReceiptPrinterSettings />
    </SettingsFrame>
  ),
});
