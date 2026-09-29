/**
 * Manager-gated "forget this machine" control. Purging the vault sends the
 * till back to the activation screen, so it is kept behind a PIN.
 */
import { useState } from "react";
import { Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isTerminalApp } from "@/platform-config/platform";
import {
  readTerminalConfig,
  revokeTerminalToken,
  unpairTerminal,
} from "@/core/activation/terminal-tokens";
import { useManagerGate } from "@/lib/manager-gate";
import { useAuthOptional } from "@/lib/pos-auth";

export function UnpairTerminalCard() {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const { authorize } = useManagerGate();
  const auth = useAuthOptional();
  const config = readTerminalConfig();

  if (!isTerminalApp()) return null;

  /**
   * One authorisation path: administrators go straight through (the approval
   * is recorded server-side), everyone else meets the manager PIN dialog when
   * the branch rules ask for it.
   */
  const ask = async () => {
    const res = await authorize({
      action: "terminal_unpair",
      title: "Unpair this terminal",
      reason: "Removing the saved activation from this machine",
      ...(config?.locationId ? { storeId: config.locationId } : {}),
      ...(config?.tokenId ? { terminalId: config.tokenId } : {}),
      ...(auth?.user?.staffId ? { requestedBy: auth.user.staffId } : {}),
    });
    if (res.ok) setConfirming(true);
  };

  const run = async () => {
    setWorking(true);
    try {
      // A branch may only leave this working database after its durable local
      // changes have reached the server. Old branch rows remain an inactive,
      // branch-scoped archive; the next activation bootstraps only its new
      // branch and therefore cannot expose or upload the previous branch.
      const sync = window.pos?.sync;
      let status = await sync?.getStatus?.();
      if ((status?.pending ?? 0) > 0 && sync?.runNow) {
        await sync.runNow({ batchSize: 500 });
        status = await sync.getStatus?.();
      }
      if ((status?.pending ?? 0) > 0 || (status?.failed ?? 0) > 0 || (status?.conflicts ?? 0) > 0) {
        throw new Error(
          `This terminal still has ${status?.pending ?? 0} pending, ${status?.failed ?? 0} failed, and ${status?.conflicts ?? 0} conflicted local change(s). Resolve synchronization before changing branches.`,
        );
      }
      await sync?.pause?.();

      // Retire the registration centrally first, so credentials restored from
      // an old machine backup are refused. Never silently clear only the local
      // activation when the server could not confirm the retirement.
      if (config?.tokenId) await revokeTerminalToken(config.tokenId);
      await unpairTerminal();
      toast.success("Terminal cleared — enter a new activation code");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      await window.pos?.sync?.resume?.().catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "The terminal could not be unpaired safely.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2">
        <Unplug className="size-4 text-destructive" />
        <h2 className="text-sm font-semibold">Unpair / reset terminal</h2>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Removes this machine&apos;s saved activation, its connection details and its machine
        account from the secure vault. The till returns to the activation screen and needs a new
        one-time code. Requires a manager PIN.
      </p>
      {config && (
        <p className="text-[11px] text-muted-foreground">
          Currently registered to <span className="font-medium">{config.locationName || "—"}</span>{" "}
          · token {config.tokenId.slice(0, 8)}…
        </p>
      )}
      <Button size="sm" variant="destructive" onClick={() => void ask()}>
        <Unplug className="size-4" /> Unpair / reset terminal
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpair this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This machine will forget its branch, its database connection and its saved sign-in.
              Nothing can be sold on it until an administrator issues a new activation code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it paired</AlertDialogCancel>
            <AlertDialogAction disabled={working} onClick={(event) => { event.preventDefault(); void run(); }}>
              {working ? "Checking synchronization…" : "Unpair terminal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
