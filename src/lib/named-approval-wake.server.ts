import { serviceRest } from "@/core/api/pos-relay.server";
import type { AuthorizationRequest } from "./authorization";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";

export function namedApprovalWakeProject(): string | undefined {
  const configured = runtimeEnvValue("POS_NAMED_APPROVAL_WAKE_PROJECT_URL");
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && url.origin === configured && supabaseConfig().url === configured)
      return configured;
  } catch { /* Leave the normal approval refresh active. */ }
  return undefined;
}

export async function wakeNamedApprovers(request: AuthorizationRequest): Promise<void> {
  if (!namedApprovalWakeProject() || request.approvalRoute?.ruleScopeType !== "global" ||
      !request.approvalRoute.primaryUserIds.length) return;
  try {
    const response = await serviceRest("rpc/pos_send_named_approval_wake_v1", {
      method: "POST",
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({ p_request_id: request.id }),
    });
    await response.body?.cancel();
  } catch { /* The committed request and its authorized refresh are durable. */ }
}
