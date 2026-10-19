import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { HeartPulse, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAppHealth } from "@/lib/app-health";

const when = (iso: string | null | undefined) =>
  iso ? posDisplayDateTime(new Date(iso)) : "—";

/** Desktop-only: start health, last known-good build, and manual roll back. */
export function SystemHealthCard() {
  const { state, supported, busy, error, rollback } = useAppHealth();
  if (!supported || !state) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <HeartPulse className="size-4 text-primary" /> System health
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        If an update stops this till from starting, it reopens in safe mode and offers to roll back.
        Rolling back keeps your terminal registration, local database and settings.
      </p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Installed version</dt>
        <dd className="numeric">v{state.version}</dd>
        <dt className="text-muted-foreground">Last clean start</dt>
        <dd className="numeric">
          {state.lastGoodVersion ? `v${state.lastGoodVersion}` : "—"}
          <span className="ml-2 text-xs text-muted-foreground">{when(state.lastGoodAt)}</span>
        </dd>
        <dt className="text-muted-foreground">Failed starts</dt>
        <dd className="numeric">{state.failures}</dd>
        {state.lastFailureAt && (
          <>
            <dt className="text-muted-foreground">Last failure</dt>
            <dd>
              {when(state.lastFailureAt)}
              {state.reason ? ` — ${state.reason}` : ""}
            </dd>
          </>
        )}
      </dl>

      {state.failures > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <ShieldAlert className="size-3.5 text-amber-500" />
          A recent launch did not reach the till screen. Two in a row open safe mode.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {!state.canRollback && state.rollbackHint && (
        <p className="mt-2 text-xs text-muted-foreground">{state.rollbackHint}</p>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button className="mt-4" variant="outline" size="sm" disabled={!state.canRollback || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            Roll back to v{state.lastGoodVersion ?? "—"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              Version {state.lastGoodVersion} will be downloaded and installed over the current
              build, then the POS restarts. Your registration, settings and local data stay in
              place — you will not need to activate this terminal again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rollback()}>Roll back</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
