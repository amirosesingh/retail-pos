/**
 * The two independent checks the whole start-up flow is built on.
 *
 * `isRegistered()` only reads the sealed local activation record.
 * `isCloudConnected()` only reports whether the connection heartbeat is up.
 * Neither knows anything about the other — that separation is what stops a
 * dropped connection from being reported as "could not verify activation".
 */
import { useEffect, useState } from "react";

import {
  connectivity,
  lastHealth,
  subscribeConnectivity,
  checkHealth,
  cloudVerdict,
  hasProbedCloud,
  type CloudVerdict,
} from "@/core/activation/connection-health";
import { cloudKeyStatus, subscribeCloudKeys } from "@/lib/secure-cloud-config";
import {
  isRegistered,
  type RegistrationState,
} from "@/core/activation/activation-record";

export type { RegistrationState };

/** Live connection verdict from the shared heartbeat. No activation logic. */
export function isCloudConnected(): boolean {
  if (connectivity() === "online") return true;
  return Boolean(lastHealth()?.cloud);
}

/** Force a fresh probe (used by "Re-check connection"). */
export async function checkCloudConnected(): Promise<boolean> {
  try {
    const report = await checkHealth(true);
    return Boolean(report.cloud) || connectivity() === "online";
  } catch {
    return false;
  }
}

export type StartupGate = {
  registration: RegistrationState | null;
  cloudConnected: boolean;
  /** why the central database is or is not usable right now */
  verdict: CloudVerdict;
  /** central database URL + key are saved on this device */
  cloudConfigured: boolean | null;
  /** true while the first read of the sealed record is in flight */
  loading: boolean;
  /** true until this launch's first connection check has produced a verdict */
  probing: boolean;
  /** registered and using the durable offline desktop data path */
  offlineAvailable: boolean;
  refresh: () => void;
};

/**
 * Registration + connectivity as one reactive view. The two values are
 * computed independently and never folded into a single boolean.
 */
export function useStartupGate(): StartupGate {
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [cloudConnected, setCloudConnected] = useState(() => isCloudConnected());
  const [verdict, setVerdict] = useState<CloudVerdict>(() => cloudVerdict());
  const [cloudConfigured, setCloudConfigured] = useState<boolean | null>(null);
  const [probing, setProbing] = useState(() => !hasProbedCloud());
  const [tick, setTick] = useState(0);

  // Nothing else runs a connection check during start-up, so the launch
  // decision used to be taken while the verdict was still its "unreachable"
  // default — which sent a configured, registered terminal to the connection
  // screen. One awaited check per launch, before any decision is shown.
  useEffect(() => {
    if (hasProbedCloud() && tick === 0) {
      setProbing(false);
      return;
    }
    let cancelled = false;
    setProbing(true);
    void checkHealth(true)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setCloudConnected(isCloudConnected());
        setVerdict(cloudVerdict());
        setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await isRegistered();
      if (cancelled) return;
      setRegistration(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(
    () =>
      subscribeConnectivity(() => {
        setCloudConnected(isCloudConnected());
        setVerdict(cloudVerdict());
      }),
    [],
  );

  useEffect(() => {
    const read = () =>
      void cloudKeyStatus()
        .then((s) => setCloudConfigured(Boolean(s.configured)))
        .catch(() => { /* An unreadable vault does not mean credentials were removed. */ });
    read();
    return subscribeCloudKeys(read);
  }, [tick]);

  return {
    registration,
    cloudConnected,
    verdict,
    cloudConfigured,
    loading: registration === null,
    probing,
    offlineAvailable: registration === "registered" && !cloudConnected,
    refresh: () => setTick((v) => v + 1),
  };
}

/** The four Emergency Access branches, derived from the two checks. */
export type EmergencyMode =
  | "online-verified"
  | "offline-registered"
  | "online-unregistered"
  | "offline-unregistered";

export function emergencyMode(gate: {
  registration: RegistrationState | null;
  cloudConnected: boolean;
}): EmergencyMode {
  const registered = gate.registration === "registered";
  if (registered && gate.cloudConnected) return "online-verified";
  if (registered) return "offline-registered";
  return gate.cloudConnected ? "online-unregistered" : "offline-unregistered";
}


/* ------------------------------------------------------------------ */
/* Start-up decision                                                    */
/* ------------------------------------------------------------------ */

export type StartupDecision =
  /** ask for the central database URL + key */
  | "connect-database"
  /** connection proven, this terminal is not registered yet */
  | "activate"
  /** registered, but no usable connection and no offline entitlement */
  | "offline-blocked"
  /** sign-in and trading may proceed */
  | "ready";

/**
 * The one rule the whole start-up flow follows.
 *
 * A saved activation record alone is never enough to reach the login screen:
 * either the connection is *proven* (`verified`), or this registered platform
 * has the durable local database required for offline trading.
 */
export function startupDecision(input: {
  registration: RegistrationState | null;
  verdict: CloudVerdict;
  /** the terminal has a usable activation/config on this device */
  activated: boolean;
  /** this platform may trade with no connection (Windows till) */
  offlineCapable: boolean;
}): StartupDecision {
  const { registration, verdict, activated, offlineCapable } = input;
  // A missing or refused key is a configuration fault — always repairable.
  if (verdict === "unconfigured" || verdict === "rejected") return "connect-database";
  if (verdict === "verified") return activated ? "ready" : "activate";
  // Unreachable from here on.
  if (offlineCapable && activated && registration === "registered") return "ready";
  if (activated) return "offline-blocked";
  return "connect-database";
}
