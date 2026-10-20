import { HelpTip } from "@/components/ui/help-tip";
import { useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  checked: boolean;
  onConfirmedChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
  /** shown in the dialog when the switch is being turned on / off */
  onWarning: string;
  offWarning: string;
  /** e.g. the branch name, so the dialog names exactly what is changing */
  subject?: string;
  disabled?: boolean;
};

/**
 * A switch that always asks first. Used for anything a mistaken tap would make
 * expensive: cutting a branch off from the group, hiding its stock, and so on.
 */
export function ConfirmSwitch({
  checked,
  onConfirmedChange,
  label,
  hint,
  onWarning,
  offWarning,
  subject,
  disabled,
}: Props) {
  const [pending, setPending] = useState<boolean | null>(null);
  const next = pending ?? false;

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm">{label}</p>
            {hint && <HelpTip text={hint} label={`About ${label}`} />}
          </div>
        </div>
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => setPending(v)}
        />
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {next ? "Turn on" : "Turn off"} {label.toLowerCase()}
              {subject ? ` — ${subject}` : ""}
            </DialogTitle>
            <DialogDescription>{next ? onWarning : offWarning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onConfirmedChange(next);
                setPending(null);
              }}
            >
              Yes, {next ? "turn on" : "turn off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
