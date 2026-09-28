/**
 * Approval calls from web run through TanStack server functions as usual.
 * A packaged terminal's current origin is its unprivileged bundled server,
 * so it sends the same validated request to the configured hosted backend.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { posFetch } from "./server-origin";
import {
  authorizeWithPin as authorizeWithPinFn,
  cancelAuthorizationRequest as cancelAuthorizationRequestFn,
  claimAuthorizationRequest as claimAuthorizationRequestFn,
  decideAuthorizationRequest as decideAuthorizationRequestFn,
  listAuthorizationRequests as listAuthorizationRequestsFn,
  submitAuthorizationRequest as submitAuthorizationRequestFn,
} from "./authorization.functions";

type DirectCall = (input: never) => Promise<unknown>;

async function callHosted<T>(action: string, data: unknown, direct: DirectCall): Promise<T> {
  if (!isTerminalApp()) return direct({ data } as never) as Promise<T>;
  const response = await posFetch("/api/v1/pos/authorization", {
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
    "authorize_pin", input.data, authorizeWithPinFn as DirectCall,
  );

export const submitAuthorizationRequest = (
  input: NonNullable<Parameters<typeof submitAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof submitAuthorizationRequestFn>>>(
    "submit", input.data, submitAuthorizationRequestFn as DirectCall,
  );

export const listAuthorizationRequests = (
  input: NonNullable<Parameters<typeof listAuthorizationRequestsFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof listAuthorizationRequestsFn>>>(
    "list", input.data, listAuthorizationRequestsFn as DirectCall,
  );

export const decideAuthorizationRequest = (
  input: NonNullable<Parameters<typeof decideAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof decideAuthorizationRequestFn>>>(
    "decide", input.data, decideAuthorizationRequestFn as DirectCall,
  );

export const claimAuthorizationRequest = (
  input: NonNullable<Parameters<typeof claimAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof claimAuthorizationRequestFn>>>(
    "claim", input.data, claimAuthorizationRequestFn as DirectCall,
  );

export const cancelAuthorizationRequest = (
  input: NonNullable<Parameters<typeof cancelAuthorizationRequestFn>[0]>,
) =>
  callHosted<Awaited<ReturnType<typeof cancelAuthorizationRequestFn>>>(
    "cancel", input.data, cancelAuthorizationRequestFn as DirectCall,
  );
