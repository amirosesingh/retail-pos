import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { ensureTerminalSession } from "@/lib/terminal-session";
import { probeRelay, syncHealthResult } from "@/core/api/sync-relay";
import { isDesktop } from "@/lib/branding";
import { serverUnreachableOnDevice } from "@/lib/server-origin";
import { describeError } from "@/lib/notify";

import { isNative } from "@/platform-config/platform";

type Check = { label: string; ok: boolean; warn?: boolean; detail: string };

/** Tells staff, in plain words, whether this till can save to the cloud. */
export function ConnectionCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const results: Check[] = [];
    try {

    const config = readTerminalConfig();
    // In a plain browser (admins and supervisors sign in with email) no till is
    // meant to be registered, so this is information, not a fault.
    const tillExpected = isDesktop() || isNative();
    results.push({
      label: "Terminal registered",
      ok: !!config || !tillExpected,
      detail: config
        ? config.locationName || config.locationId
        : tillExpected
          ? "This till is not activated yet"
          : "Browser session — no till registered (not required here)",
    });

    const signedIn = await ensureTerminalSession();
    const session = (await supabaseExternal.auth.getSession()).data.session;
    results.push({
      label: "Signed in to the central database",
      ok: signedIn || !!session,
      detail:
        session?.user?.email ??
        (signedIn ? "Signed in" : "Not signed in — sign in with your staff account"),
    });

    const relay = await probeRelay();
    // A missing key is a server setup task, not a fault with this till, so it
    // reads as a warning with a clear instruction instead of a red failure.
    const keyMissing = relay.code === "NO_SERVICE_KEY";
    // "Failed to fetch" means the request never reached a server: no backend
    // address saved, the address does not answer, or the browser layer blocked
    // it. Say which, rather than repeating the browser's own wording.
    const noRoute = !relay.ok && /failed to fetch|load failed|networkerror/i.test(relay.error ?? "");
    results.push({
      label: "Server backup route",
      ok: relay.ok,
      warn: keyMissing,
      detail: relay.ok
        ? "Writes can go through the server"
        : noRoute
          ? serverUnreachableOnDevice()
            ? "No POS backend address is saved on this device — enter it in Settings → Database & Cloud Connection."
            : `The request never reached the server (${relay.error}) — check the backend address and that this device can open it.`
          : (relay.error ?? "Unavailable"),
    });


    // Say which server answered and whether it holds the central database key,
    // so a setup problem is not mistaken for a problem with this till. Every
    // failure names its own reason instead of one catch-all sentence.
    const health = await syncHealthResult();
    results.push({
      label: "Server setup",
      ok: health.ok && health.health.serviceKey,
      warn: !health.ok || !health.health.serviceKey,
      detail: !health.ok
        ? health.reason
        : health.health.serviceKey
          ? `Key present on ${health.health.host}`
          : `Key missing on ${health.health.host} — configure the service key on the hosted POS backend`,
    });
    results.push({
      label: "Membership gateway",
      ok: health.ok && health.health.membershipService,
      warn: !health.ok || !health.health.membershipService,
      detail: !health.ok
        ? health.reason
        : health.health.membershipService
          ? `Secure member lookup is ready on ${health.health.host}`
          : `Membership variables are missing on ${health.health.host} — configure them on the hosted backend, not on this till`,
    });


      setChecks(results);
    } catch (error) {
      results.push({
        label: "Connection check",
        ok: false,
        detail: describeError(error, "Checking the connection"),
      });
      setChecks(results);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm">Saving to the central database</p>
          <p className="text-xs text-muted-foreground">
            Checks that shifts, sales and sign-ins from this till are accepted by the server.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : "Run check"}
        </Button>
      </div>
      {checks && (
        <ul className="space-y-1 text-xs">
          {checks.map((c) => (
            <li
              key={c.label}
              className={
                c.ok ? "text-muted-foreground" : c.warn ? "text-amber-600" : "text-destructive"
              }
            >
              {c.ok ? "✓" : c.warn ? "!" : "✕"} {c.label} — {c.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
