import { createFileRoute } from "@tanstack/react-router";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { WhatsAppFields } from "@/platforms/web/components/pos/settings/panels/IntegrationsPanel";

export const Route = createFileRoute("/settings/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Bills — Retail" },
      {
        name: "description",
        content:
          "Send receipts and booking slips over the WhatsApp Cloud API, with message format, greeting and auto-send controls.",
      },
      { property: "og:title", content: "WhatsApp Bills — Retail" },
      { property: "og:description", content: "WhatsApp receipt delivery settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="WhatsApp bills"
      description="Send receipts and booking slips straight to the shopper's phone."
    >
      <WhatsAppForm />
    </SettingsFrame>
  ),
});

function WhatsAppForm() {
  const { whatsapp, setWhatsApp } = useSettingsCtx();
  return <WhatsAppFields whatsapp={whatsapp} setWhatsApp={setWhatsApp} />;
}
