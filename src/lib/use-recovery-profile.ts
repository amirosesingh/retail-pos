import { useEffect, useState } from "react";
import { readTerminalConfig, subscribeTerminalConfig, type TerminalConfig } from "@/core/activation/terminal-tokens";
import { hydrateConnectionProfile, isRegistrationRestoreError, registrationRestoreMessage, type RegistrationRecoveryCode } from "./connection-profile";
import { cloudKeyStatus, subscribeCloudKeys } from "./secure-cloud-config";
import { createRefreshQueue } from "./background-refresh";

type RecoveryProfile = {
  loading: boolean;
  error: boolean;
  connectionReady: boolean;
  registrationReady: boolean;
  registrationCode: RegistrationRecoveryCode | null;
  registrationMessage: string | null;
  config: TerminalConfig | null;
  cloud: boolean | null;
};

/** Local storage only: recovery must not depend on the service it repairs. */
export function useRecoveryProfile() {
  const [state, setState] = useState<RecoveryProfile>({ loading: true, error: false, connectionReady: false, registrationReady: false, registrationCode: null, registrationMessage: null, config: null, cloud: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let revision = 0;
    const reads = createRefreshQueue(async () => {
      const started = revision;
      try {
        await hydrateConnectionProfile();
        settled = true;
        const status = await cloudKeyStatus();
        if (cancelled || started !== revision) return;
        setState({ loading: false, error: false, connectionReady: true, registrationReady: true, registrationCode: null, registrationMessage: null, config: readTerminalConfig(), cloud: Boolean(status.configured) });
      } catch (cause) {
        if (isRegistrationRestoreError(cause)) {
          try {
            settled = true;
            const status = await cloudKeyStatus();
            if (!cancelled && started === revision) setState(previous => ({ ...previous, loading: false, error: true,
              connectionReady: true, registrationReady: false, registrationCode: cause.registrationCode,
              registrationMessage: registrationRestoreMessage(cause.registrationCode), cloud: Boolean(status.configured) }));
            return;
          } catch { /* A connection that also became unreadable stays blocked. */ }
        }
        // Unreadable is not missing. Preserve the last known snapshot and keep
        // setup forms unmounted until a retry can read the vault. A superseded
        // read must not replace the next queued snapshot with an old error.
        if (!cancelled && started === revision) setState(previous => ({ ...previous, loading: false, error: true, connectionReady: false, registrationReady: false, registrationCode: null, registrationMessage: null }));
      } finally {
        settled = true;
      }
    });
    const changed = () => { if (settled) { revision++; void reads.refresh(); } };
    const offTerminal = subscribeTerminalConfig(changed);
    const offCloud = subscribeCloudKeys(changed);
    void reads.refresh();
    return () => { cancelled = true; reads.stop(); offTerminal(); offCloud(); };
  }, [attempt]);
  return {
    ...state,
    retry: () => {
      setState(previous => ({ ...previous, loading: true, error: false, registrationCode: null, registrationMessage: null }));
      setAttempt(value => value + 1);
    },
  };
}
