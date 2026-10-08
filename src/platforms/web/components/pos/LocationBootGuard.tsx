import { isLocationSetupRoute } from "@/lib/app-shell-routes";
import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { MapPinOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TillLoader } from "@/components/shared/TillLoader";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { activeLocations } from "@/lib/locations";

/**
 * Launch check: a till with no active location has nowhere to book stock or
 * attribute a sale, so the app is held here until one exists. Location setup
 * itself stays reachable, otherwise the operator could never leave this state.
 *
 * "No locations yet" and "the location list has not arrived yet" look
 * identical in the data — both are an empty list — so this screen never
 * guesses. Until the database has actually answered it says it is loading.
 */
export function LocationBootGuard({ children }: { children?: ReactNode }) {
  const { stores, storesLoaded, locationLoadError, loadPhase, retryLoad } = usePos();
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();

  if (activeLocations(stores).length > 0 || isLocationSetupRoute(pathname)) return <>{children}</>;

  // Still waiting on the answer — say so rather than claiming there is nothing.
  if (!storesLoaded && loadPhase !== "failed") return <TillLoader message="Loading locations…" />;

  if (!storesLoaded)
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface-1 p-6 text-center">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Could not load locations</h1>
            <p className="text-sm text-muted-foreground">
              {locationLoadError ||
                "The location list did not come back. Try again once the connection settles."}
            </p>
          </div>
          <Button className="w-full" onClick={retryLoad}>
            <RefreshCw className="mr-1.5 size-4" /> Try again
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" className="w-full">
              <Link to="/settings/database">Check database connection</Link>
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface-1 p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <MapPinOff className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">No active location</h1>
          <p className="text-sm text-muted-foreground">
            This system has no live store or warehouse yet. Selling, receiving and stock movements
            all need a location to belong to, so they stay locked until one is set up.
          </p>
        </div>
        {isAdmin ? (
          <Button asChild className="w-full">
            <Link to="/stores">Set up a location</Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ask an administrator to create or restore a location for this terminal.
          </p>
        )}
      </div>
    </div>
  );
}
