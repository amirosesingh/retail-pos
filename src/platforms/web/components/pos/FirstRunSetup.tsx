import { useEffect, useState } from "react";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isDesktop, restoreBrandingFromDisk, writeBranding } from "@/lib/branding";
import { onRecoveryScreen } from "@/lib/recovery-route";

/**
 * Name this machine only. Shared company identity arrives from synchronization.
 */
export function FirstRunSetup({ children }: { children: React.ReactNode }) {
  // Emergency Access must open on a brand-new machine, before anyone has named
  // the shop: naming it is not a prerequisite for repairing the connection.
  const [recovery] = useState(() => onRecoveryScreen());
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [terminal, setTerminal] = useState("POS Terminal 01");

  useEffect(() => {
    if (recovery || !isDesktop()) {
      setChecked(true);
      return;
    }
    // The on-disk mirror wins: setup must only ever run on a fresh install.
    void restoreBrandingFromDisk().then((b) => {
      setNeeded(!b.configured);
      setChecked(true);
    });
  }, [recovery]);

  if (recovery) return <>{children}</>;
  if (!checked) return null;
  if (!needed) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          writeBranding({ terminal: terminal.trim() || "POS Terminal 01", configured: true });
          setNeeded(false);
        }}
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ReceiptText className="size-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">Set up this terminal</p>
            <p className="text-xs text-muted-foreground">
              One-time setup — you can change these later in Settings.
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Your company name, logo and company details will download automatically
          after connecting this terminal to your company database.
        </p>

        <div className="space-y-1">
          <Label htmlFor="terminal">Terminal name</Label>
          <Input
            id="terminal"
            autoFocus
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
            placeholder="POS Terminal 01"
          />
        </div>

        <Button type="submit" className="w-full">
          Start using the POS
        </Button>
      </form>
    </div>
  );
}
