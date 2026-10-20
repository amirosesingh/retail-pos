import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { CurrentTerminalPanel } from "@/platforms/web/components/pos/CurrentTerminalPanel";
import { TerminalTokens } from "@/platforms/web/components/pos/TerminalTokens";

export const Route = createFileRoute("/settings/mobile-terminals")({
  head: () => ({
    meta: [
      { title: "Mobile Terminals — POS Settings" },
      {
        name: "description",
        content:
          "Register and manage phones and tablets running the POS, separately from the Windows counter tills.",
      },
      { property: "og:title", content: "Mobile Terminals — POS Settings" },
      {
        property: "og:description",
        content: "Issue activation codes for phones and tablets and disconnect them remotely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      showSaveBar={false}
      terminalManagement
      title="Mobile terminals"
      description="Register Android and iOS devices for branch operations or management. Management devices use the signed-in administrator or supervisor’s branch access; branch devices keep their assigned location. Windows PCs are managed under Terminal activation."
    >
      <div className="space-y-5">
        <CurrentTerminalPanel />
        <TerminalTokens only="mobile" />
      </div>
    </SettingsFrame>
  ),
});
