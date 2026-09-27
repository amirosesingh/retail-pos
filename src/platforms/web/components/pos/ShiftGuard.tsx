import { useState, type ReactNode } from "react";
import { Loader2, Lock, LogOut, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shiftDuration } from "@/lib/shift-hours";
import { parsePositiveAmount } from "@/core/pricing/amount";
import { permissionMessage } from "@/platforms/web/components/pos/PermissionGate";
import { notifyError } from "@/lib/notify";
import { commitLabel } from "@/core/api/pos-db";
import { ShiftCloseDialog } from "@/platforms/web/components/pos/ShiftCloseDialog";

/**
 * Hard terminal lock.
 *
 * The register is only usable while the database holds an OPEN shift for the
 * current branch. A shift opened on any earlier day still counts — nothing
 * here looks at the calendar.
 *
 * With no open shift the whole shell stays on screen exactly as it looks when
 * trading, but dimmed, blurred and completely inert: no click, no keyboard
 * focus, no scanner wedge input reaches it. An un-dismissable panel floats on
 * top with the opening float form and a way to hand the terminal back.
 *
 * Staff holding `can_bypass_shift_lock` (admins and supervisors by default)
 * are never locked.
 */
export function ShiftGuard({ children }: { children: ReactNode }) {
  const { activeShift, openShift, currentStore, shiftReadError, shiftChecked } = usePos();
  const { user, lock, can, terminalStoreName } = useAuth();
  // The cashier is whoever is signed in — never typed in by hand.
  const cashier = user?.name ?? "Cashier";
  // A fresh shift starts with no assumed cash count; the hint stays visible.
  const [float, setFloat] = useState("");
  const [opening, setOpening] = useState(false);

  const bypass = can("can_bypass_shift_lock");
  const mayOpen = can("can_open_shift");
  // Never hardcode a branch: the terminal's registered branch wins, then the
  // active store, then a neutral phrase while the store list is still loading.
  const branchLabel = terminalStoreName?.trim() || currentStore?.name?.trim() || "this terminal";

  if (activeShift) {
    const opened = new Date(activeShift.openedAt);
    const closing = (activeShift.state ?? "ACTIVE") !== "ACTIVE";
    if (closing) {
      return (
        <div className="relative flex min-h-0 flex-1">
          <div
            {...({ inert: "" } as Record<string, string>)}
            aria-hidden="true"
            className="pointer-events-none flex min-h-0 flex-1 select-none opacity-30 blur-[1px]"
          >
            {children}
          </div>
          <ShiftCloseDialog open onOpenChange={() => undefined} />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-success/30 bg-success/10 px-4 py-1.5 text-[11px] text-success">
          <span className="font-semibold">Shift open</span>
          <span>
            Opened {opened.toLocaleDateString()} at {opened.toLocaleTimeString()}
          </span>
          <span>Float {money(activeShift.openingFloat)}</span>
          <span>Running {shiftDuration(activeShift)}</span>
          {shiftReadError && (
            <span className="flex items-center gap-1 text-warning-foreground">
              <WifiOff className="size-3" /> Reconnecting — trading continues
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  if (bypass) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[11px] text-warning-foreground">
          <Lock className="size-3" />
          <span className="font-semibold">No shift open at {branchLabel}</span>
          <span>Your account can use the terminal without one.</span>
        </div>
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  // Until the database has actually answered, the terminal is not "locked" —
  // it is still asking. Showing the lock here is what caused the flash.
  if (!shiftChecked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>Checking the open shift at {branchLabel}…</span>
        </div>
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* The real UI stays visible so the terminal looks normal — but frozen. */}
      <div
        // `inert` keeps keyboard, focus and scanner-wedge input out of the tree.
        {...({ inert: true } as unknown as Record<string, boolean>)}
        aria-hidden
        className="pointer-events-none flex min-h-0 flex-1 select-none opacity-40 blur-[1px] saturate-50"
      >
        {children}
      </div>

      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 p-6 backdrop-blur-[2px]">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-2xl">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold">Terminal locked</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No shift is open for {branchLabel}.{" "}
            {mayOpen
              ? "Enter the opening cash float to start trading on this terminal."
              : permissionMessage("can_open_shift")}
          </p>

          {mayOpen && (
            <div className="mt-5 space-y-3 text-left">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Cashier <span className="text-destructive">*</span>
                </Label>
                <Input value={cashier} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Opening float <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="numeric"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={float}
                  onChange={(e) => setFloat(e.target.value)}
                />
                {parsePositiveAmount(float) === null && (
                  <p className="text-[11px] text-destructive">
                    Count the drawer and enter the opening float.
                  </p>
                )}
              </div>
              <Button
                className="w-full"
                disabled={opening || !cashier.trim() || parsePositiveAmount(float) === null}
                onClick={async () => {
                  const amount = parsePositiveAmount(float);
                  if (amount === null) {
                    toast.error("Enter a valid opening float");
                    return;
                  }
                  setOpening(true);
                  try {
                    const target = await openShift(cashier.trim() || "Cashier", amount);
                    setFloat("");
                    // Only announced once the shift is confirmed stored.
                    toast.success(`Shift opened — ${commitLabel(target).toLowerCase()}`);
                  } catch (e) {
                    notifyError(e, "Opening the shift");
                  } finally {
                    setOpening(false);
                  }
                }}
              >
                {opening ? "Opening…" : "Open shift"}
              </Button>
            </div>
          )}

          <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => void lock()}>
            <LogOut className="size-3.5" /> Lock / switch user
          </Button>
        </div>
      </div>
    </div>
  );
}
