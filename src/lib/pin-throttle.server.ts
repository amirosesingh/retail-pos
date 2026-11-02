/**
 * Server-side brake on PIN guessing.
 *
 * The keypad already slows a person down in the browser, but a browser check
 * proves nothing: the same call can be replayed straight at the server. This
 * counts failures in the central database, so a manager ID being guessed from
 * any device is locked out everywhere after a handful of wrong PINs.
 */
import { serviceRest } from "@/core/api/pos-relay.server";

export type ThrottleState = { locked: boolean; lockedUntil: string | null; attempts: number };

async function rpc(name: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await serviceRest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function read(value: unknown): ThrottleState {
  if (!value || typeof value !== "object") throw new Error("Central PIN protection is unavailable");
  const row = value as { locked?: boolean; locked_until?: string | null; attempts?: number };
  return {
    locked: row.locked === true,
    lockedUntil: row.locked_until ?? null,
    attempts: Number(row.attempts ?? 0),
  };
}

/** How long is left on a lock, in whole minutes (at least one). */
export function minutesLeft(state: ThrottleState): number {
  if (!state.lockedUntil) return 5;
  const ms = new Date(state.lockedUntil).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}

/** True when this key is currently locked out. */
export async function throttleStatus(key: string, signal?: AbortSignal): Promise<ThrottleState> {
  return read(await rpc("pin_throttle_status", { _key: key }, signal));
}

/** Record a wrong PIN and return the state after it. */
export async function throttleFail(key: string, limit = 5, signal?: AbortSignal): Promise<ThrottleState> {
  return read(
    await rpc("pin_throttle_fail", { _key: key, _limit: limit, _window_secs: 900, _lock_secs: 300 }, signal),
  );
}

/** Clear the counter after a correct PIN. */
export async function throttleReset(key: string, signal?: AbortSignal): Promise<void> {
  await rpc("pin_throttle_reset", { _key: key }, signal);
}
