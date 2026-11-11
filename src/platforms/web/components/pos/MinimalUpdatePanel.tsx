import { displayReleaseVersion } from "@/lib/release-version";
import { useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { APP_VERSION, type useAppUpdates } from "@/lib/app-updates";

type Updates = ReturnType<typeof useAppUpdates>;

export function UpdateConfirmation({ updates, open, onOpenChange }: { updates: Updates; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, installing, installError, install, download } = updates;
  const ready = state.status === "ready";
  const downloading = state.status === "downloading";
  const actionable = ready || (state.status !== "unavailable" && state.status !== "current" && !!state.available);
  return <Dialog open={open} onOpenChange={value => { if (!installing) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-md" onEscapeKeyDown={event => { if (installing) event.preventDefault(); }} onInteractOutside={event => { if (installing) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{ready ? "Restart Retail and install" : "Download update"}{state.available ? ` v${displayReleaseVersion(state.available)}` : ""}?</DialogTitle>
        <DialogDescription>{ready
          ? "Retail will finish saving local changes before restarting. Saved records waiting to upload will resume syncing when the connection returns."
          : "Download the update now and choose when to restart and install it."}</DialogDescription>
      </DialogHeader>
      {state.status === "downloading" && <div role="status" className="space-y-2"><p className="text-sm">Downloading · {state.percent}%</p><Progress value={state.percent} aria-label="Update download progress" /></div>}
      {installing && <p role="status" className="text-sm text-muted-foreground">Saving local changes before restart. Keep the application open.</p>}
      {(installError || state.error) && <p role="alert" className="text-sm text-destructive">{installError || state.error}</p>}
      <DialogFooter>
        <Button variant="ghost" disabled={installing} onClick={() => onOpenChange(false)}>Later</Button>
        <Button disabled={installing || downloading || !actionable} onClick={() => void (ready ? install() : download())}>
          {installing || downloading
            ? <Loader2 className="size-4 animate-spin" />
            : ready ? <RefreshCw className="size-4" /> : <Download className="size-4" />}
          {installing ? "Preparing update…" : downloading ? "Downloading…" : ready ? "Restart and install" : "Download update"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function MinimalUpdatePanel({ updates }: { updates: Updates }) {
  const [open, setOpen] = useState(false);
  const { state, supported, check, download, manifestChecking, installing, releaseNotes } = updates;
  const available = state.status !== "unavailable" && state.status !== "current" && (state.status === "ready" || !!state.available);
  const busy = installing || manifestChecking || state.status === "checking" || state.status === "downloading";
  const ready = state.status === "ready";
  return <section className="space-y-4 rounded-2xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-medium">{available ? state.available ? `Version ${displayReleaseVersion(state.available)} is available` : "Update ready to install" : "Software updates"}</p><p className="text-sm text-muted-foreground">Installed v{displayReleaseVersion(state.version || APP_VERSION)}</p></div>
      {supported && available ? (
        <Button disabled={busy} onClick={() => {
          if (ready) setOpen(true);
          else void download();
        }}>
          {state.status === "downloading" ? "Downloading…" : ready ? "Restart and install" : "Download update"}
        </Button>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => void check().catch(() => undefined)}>
          {busy ? "Checking…" : "Check for updates"}
        </Button>
      )}
    </div>
    {state.status === "downloading" && <div className="space-y-2" role="status"><p className="text-sm text-muted-foreground">Downloading · {state.percent}%</p><Progress value={state.percent} aria-label="Update download progress" /></div>}
    {state.status === "ready" && <p className="text-sm text-muted-foreground">Downloaded and ready when you are.</p>}
    {state.status === "current" && <p className="text-sm text-muted-foreground">You are up to date.</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {releaseNotes && <details><summary className="cursor-pointer text-sm">What’s new</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{releaseNotes}</p></details>}
    <UpdateConfirmation updates={updates} open={open} onOpenChange={setOpen} />
  </section>;
}
