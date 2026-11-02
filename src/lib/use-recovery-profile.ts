import { useEffect, useState } from "react";
import { readTerminalConfig, subscribeTerminalConfig, type TerminalConfig } from "@/core/activation/terminal-tokens";
import { hydrateConnectionProfile } from "./connection-profile";
import { cloudKeyStatus, subscribeCloudKeys } from "./secure-cloud-config";
import { createRefreshQueue } from "./background-refresh";

type RecoveryProfile = {
  loading: boolean;
  error: boolean;
  config: TerminalConfig | null;
  cloud: boolean | null;
};

/** Local storage only: recovery must not depend on the service it repairs. */
export function useRecoveryProfile() {
  const [state, setState] = useState<RecoveryProfile>({ loading: true, error: false, config: null, cloud: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let restored = false;
    let revision = 0;
    const reads = createRefreshQueue(async () => {
      const started = revision;
      try {
        await hydrateConnectionProfile();
        restored = true;
        const status = await cloudKeyStatus();
        if (cancelled || started !== revision) return;
        setState({ loading: false, error: false, config: readTerminalConfig(), cloud: Boolean(status.configured) });
      } catch {
        // Unreadable is not missing. Preserve the last known snapshot and keep
        // setup forms unmounted until a retry can read the vault. A superseded
        // read must not replace the next queued snapshot with an old error.
        if (!cancelled && started === revision) setState(previous => ({ ...previous, loading: false, error: true }));
      }
    });
    const changed = () => { if (restored) { revision++; void reads.refresh(); } };
    const offTerminal = subscribeTerminalConfig(changed);
    const offCloud = subscribeCloudKeys(changed);
    void reads.refresh();
    return () => { cancelled = true; reads.stop(); offTerminal(); offCloud(); };
  }, [attempt]);
  return {
    ...state,
    retry: () => {
      setState(previous => ({ ...previous, loading: true, error: false }));
      setAttempt(value => value + 1);
    },
  };
}
