import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { AdminWebActivations } from "@/platforms/web/components/pos/AdminWebActivations";
import { useAuth } from "@/lib/pos-auth";
import { isTerminalApp } from "@/platform-config/platform";

export const Route = createFileRoute("/settings/admin-terminals")({
  head: () => ({ meta: [{ title: "Admin Terminal Activation — POS Settings" }] }),
  component: AdminTerminalSettings,
});

function AdminTerminalSettings() {
  const { isAdmin } = useAuth();
  return (
    <SettingsFrame showSaveBar={false} wide terminalManagement
      title="Admin terminal activation"
      description="Manage admin browser activation codes and registrations separately from Windows and mobile terminals.">
      {!isAdmin ? <p role="alert">Only administrators can manage admin activations.</p>
        : isTerminalApp() ? <p>Open the web portal to manage admin terminal activations.</p>
          : <AdminWebActivations />}
    </SettingsFrame>
  );
}
