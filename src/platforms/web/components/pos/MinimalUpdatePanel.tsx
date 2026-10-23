import { displayReleaseVersion } from "@/lib/release-version";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { APP_VERSION, type useAppUpdates } from "@/lib/app-updates";

type Updates = ReturnType<typeof useAppUpdates>;

export function UpdateConfirmation({ updates, open, onOpenChange }: { updates: Updates; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, installing, installError, install, downloadAndInstall } = updates;
  const canInstall = state.status !== "unavailable" && state.status !== "current" && (state.status === "ready" || !!state.available);
  return <Dialog open={open} onOpenChange={value => { if (!installing) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-md" onEscapeKeyDown={event => { if (installing) event.preventDefault(); }} onInteractOutside={event => { if (installing) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Update Retail{state.available ? ` to v${state.available}` : ""}?</DialogTitle>
        <DialogDescription>The app will download the update if needed, synchronize pending data, then restart. Your terminal registration and local database are preserved.</DialogDescription>
      </DialogHeader>
      {state.status === "downloading" && <div role="status" className="space-y-2"><p className="text-sm">Downloading · {state.percent}%</p><Progress value={state.percent} aria-label="Update download progress" /></div>}
      {installing && <p role="status" className="text-sm text-muted-foreground">Preparing the update and synchronizing. Keep the application open.</p>}
      {(installError || state.error) && <p role="alert" className="text-sm text-destructive">{installError || state.error}</p>}
      <DialogFooter>
        <Button variant="ghost" disabled={installing} onClick={() => onOpenChange(false)}>Later</Button>
        <Button disabled={installing || !canInstall} onClick={() => void (state.status === "ready" ? install() : downloadAndInstall())}>
          {installing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {installing ? "Preparing update…" : "Update and restart"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function MinimalUpdatePanel({ updates }: { updates: Updates }) {
  const [open, setOpen] = useState(false);
  const { state, supported, check, manifestChecking, installing, releaseNotes } = updates;
  const available = state.status !== "unavailable" && state.status !== "current" && (state.status === "ready" || !!state.available);
  const busy = installing || manifestChecking || state.status === "checking";
  return <section className="space-y-4 rounded-2xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-medium">{available ? state.available ? `Version ${state.available} is available` : "Update ready to install" : "Software updates"}</p><p className="text-sm text-muted-foreground">Installed v{displayReleaseVersion(state.version || APP_VERSION)}</p></div>
      {supported && available ? <Button disabled={installing} onClick={() => setOpen(true)}>Update and restart</Button> : <Button variant="outline" disabled={busy} onClick={() => void check().catch(() => undefined)}>{busy ? "Checking…" : "Check for updates"}</Button>}
    </div>
    {state.status === "downloading" && <div className="space-y-2" role="status"><p className="text-sm text-muted-foreground">Downloading · {state.percent}%</p><Progress value={state.percent} aria-label="Update download progress" /></div>}
    {state.status === "ready" && <p className="text-sm text-muted-foreground">Downloaded and ready when you are.</p>}
    {state.status === "current" && <p className="text-sm text-muted-foreground">You are up to date.</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {releaseNotes && <details><summary className="cursor-pointer text-sm">What’s new</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{releaseNotes}</p></details>}
    <UpdateConfirmation updates={updates} open={open} onOpenChange={setOpen} />
  </section>;
}
