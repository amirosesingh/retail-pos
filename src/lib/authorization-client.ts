/**
 * Approval calls from web run through TanStack server functions as usual.
 * A packaged terminal's current origin is its unprivileged bundled server,
 * so it sends the same validated request to the configured hosted backend.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { localDb } from "@/core/local-db/local-db";
import { localStaffRoster } from "@/core/local-db/local-staff";
import { normalizeRule } from "./authorization";
import { posFetch } from "./server-origin";
import {
  authorizeWithPin as authorizeWithPinFn,
  cancelAuthorizationRequest as cancelAuthorizationRequestFn,
  claimAuthorizationRequest as claimAuthorizationRequestFn,
  decideAuthorizationRequest as decideAuthorizationRequestFn,
  getAuthorizationRules as getAuthorizationRulesFn,
  listAuthorizationRequests as listAuthorizationRequestsFn,
  listAuthorizationPeople as listAuthorizationPeopleFn,
  saveAuthorizationRule as saveAuthorizationRuleFn,
  setStaffAuthorizationPin as setStaffAuthorizationPinFn,
  submitAuthorizationRequest as submitAuthorizationRequestFn,
  verifyBusinessAuthorization as verifyBusinessAuthorizationFn,
} from "./authorization.functions";

type DirectCall = (input: never) => Promise<unknown>;

async function callHosted<T>(action: string, data: unknown, direct: DirectCall): Promise<T> {
  if (!isTerminalApp()) return direct({ data } as never) as Promise<T>;
  // Reuse the established sync route so a stale hosted route manifest cannot
  // turn an otherwise valid approval request into an HTML 404/CORS failure.
  const response = await posFetch("/api/v1/pos/sync?operation=authorization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(result && typeof result === "object" && "error" in result))
    throw new Error(`Approval service failed (${response.status})`);
  return result;
}

export const authorizeWithPin = (input: NonNullable<Parameters<typeof authorizeWithPinFn>[0]>) =>
  callHosted<Awaited<ReturnType<typeof authorizeWithPinFn>>>(
    "authorize_pin",
    input.data,
    authorizeWithPinFn as DirectCall,
  );

export const submitAuthorizationRequest = (
  input: NonNullable<Parameters<typeof submitAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof submitAuthorizationRequestFn>>>(
    "submit",
    input.data,
    submitAuthorizationRequestFn as DirectCall,
  );

export const listAuthorizationRequests = (
  input: NonNullable<Parameters<typeof listAuthorizationRequestsFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof listAuthorizationRequestsFn>>>(
    "list",
    input.data,
    listAuthorizationRequestsFn as DirectCall,
  );

export const decideAuthorizationRequest = (
  input: NonNullable<Parameters<typeof decideAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof decideAuthorizationRequestFn>>>(
    "decide",
    input.data,
    decideAuthorizationRequestFn as DirectCall,
  );

export const claimAuthorizationRequest = (
  input: NonNullable<Parameters<typeof claimAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof claimAuthorizationRequestFn>>>(
    "claim",
    input.data,
    claimAuthorizationRequestFn as DirectCall,
  );

export const cancelAuthorizationRequest = (
  input: NonNullable<Parameters<typeof cancelAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof cancelAuthorizationRequestFn>>>(
    "cancel",
    input.data,
    cancelAuthorizationRequestFn as DirectCall,
  );

export const getAuthorizationRules = async (
  input: NonNullable<Parameters<typeof getAuthorizationRulesFn>[0]>,
) => {
  if (isTerminalApp() && localDb()?.query) {
    const result = await localDb()!.query!("authorization_actions", { limit: 2000 });
    if (!result.ok) return { ok: false as const, error: result.error ?? "Could not load local authorization rules", rules: [] };
    return { ok: true as const, rules: (result.rows ?? []).map(normalizeRule) };
  }
  return callHosted<Awaited<ReturnType<typeof getAuthorizationRulesFn>>>(
    "rules",
    input.data,
    getAuthorizationRulesFn as DirectCall,
  );
};

export const saveAuthorizationRule = async (
  input: NonNullable<Parameters<typeof saveAuthorizationRuleFn>[0]>,
) => {
  if (isTerminalApp() && localDb()?.saveAuthorizationRule) {
    const result = await localDb()!.saveAuthorizationRule!(input.data as unknown as Record<string, unknown>);
    return result.ok
      ? { ok: true as const, rule: normalizeRule(result.rule) }
      : { ok: false as const, error: result.error ?? "Could not save the rule" };
  }
  const result = await callHosted<Awaited<ReturnType<typeof saveAuthorizationRuleFn>>>(
    "save_rule",
    input.data,
    saveAuthorizationRuleFn as DirectCall,
  );
  if (result.ok) {
    const { broadcastSettingsChange } = await import("./sync-engine");
    await broadcastSettingsChange("authorization_actions");
  }
  return result;
};

export const setStaffAuthorizationPin = (
  input: NonNullable<Parameters<typeof setStaffAuthorizationPinFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof setStaffAuthorizationPinFn>>>(
    "set_pin",
    input.data,
    setStaffAuthorizationPinFn as DirectCall,
  );

export const listAuthorizationPeople = async (
  input: NonNullable<Parameters<typeof listAuthorizationPeopleFn>[0]>,
) => {
  if (isTerminalApp()) {
    const data = input.data as { storeId?: string };
    const rows = await localStaffRoster(data.storeId ?? null);
    return { ok: true as const, people: rows.map((row) => ({ id: row.id, name: row.fullName || row.username, role: row.roleSlug || "staff", storeId: row.storeId ?? "" })) };
  }
  return callHosted<Awaited<ReturnType<typeof listAuthorizationPeopleFn>>>(
    "people",
    input.data,
    listAuthorizationPeopleFn as DirectCall,
  );
};

export const verifyBusinessAuthorization = (
  input: NonNullable<Parameters<typeof verifyBusinessAuthorizationFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof verifyBusinessAuthorizationFn>>>(
    "verify_mutation",
    input.data,
    verifyBusinessAuthorizationFn as DirectCall,
  );
