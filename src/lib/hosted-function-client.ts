import { isTerminalApp } from "@/platform-config/platform";
import { posFetch } from "./server-origin";

/** Stable native transport; the website keeps TanStack's original transport. */
export function hostedFunction<F extends (input: never) => Promise<unknown>>(
  action: string,
  direct: F,
): (...args: Parameters<F>) => ReturnType<F> {
  const call = async (...args: Parameters<F>) => {
    if (!isTerminalApp()) return direct(...args as [never]);
    const input = args[0] as { data?: unknown; signal?: AbortSignal };
    const response = await posFetch("/api/v1/pos/sync?operation=app_function", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: input.signal,
      body: JSON.stringify({ action, data: input.data }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `App service failed (${response.status})`);
    if (!result || typeof result !== "object") throw new Error("The app service returned an invalid response.");
    return result;
  };
  return call as (...args: Parameters<F>) => ReturnType<F>;
}
