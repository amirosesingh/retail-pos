import { serviceRest } from "@/core/api/pos-relay.server";
import type { PublicHostConfig } from "./public-host-routing";

export async function readPublicHostConfigServer(): Promise<PublicHostConfig> {
  const response = await serviceRest("pos_settings?id=eq.1&select=integration_settings&limit=1", { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("The site configuration could not be loaded.");
  const rows = await response.json() as { integration_settings?: Record<string, unknown> | null }[];
  const integrations = rows[0]?.integration_settings;
  return {
    member: typeof integrations?.memberDomain === "string" ? integrations.memberDomain : "",
    redeem: typeof integrations?.redeemDomain === "string" ? integrations.redeemDomain : "",
  };
}
