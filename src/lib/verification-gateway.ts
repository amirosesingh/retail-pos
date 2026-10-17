/**
 * Client-side view of the member verification gateway.
 *
 * One fetch per session, shared by every screen that offers the verify action,
 * so the button simply disappears when the gateway is switched off.
 */
import { useEffect, useState } from "react";
import { getPosCallerAuth } from "./pos-caller-auth";
import { getVerificationSettings } from "./verification-client";

export type GatewayConfig = { channel: string; strict: boolean; active: boolean };

let cached: GatewayConfig | null = null;
let inflight: Promise<GatewayConfig | null> | null = null;

export async function loadGateway(): Promise<GatewayConfig | null> {
  if (cached) return cached;
  inflight ??= (async () => {
    const { accessToken, cashierToken } = await getPosCallerAuth();
    const res = await getVerificationSettings({ data: { accessToken, cashierToken } }).catch(
      () => ({ ok: false as const }),
    );
    cached = res.ok ? res.config : null;
    inflight = null;
    return cached;
  })();
  return inflight;
}

/** Forget the cached copy after the settings panel saves a change. */
export function resetGateway() {
  cached = null;
  inflight = null;
}

export function useVerificationGateway(): GatewayConfig | null {
  const [config, setConfig] = useState<GatewayConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    void loadGateway().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
