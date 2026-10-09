/**
 * Builds a stand-in copy of a desktop bridge.
 *
 * The desktop shell hands its bridges to the page read-only, so their functions
 * can never be replaced in place — attempting it threw
 * "Cannot assign to read only property 'write'" and blanked the whole till.
 * (A Proxy cannot help either: a frozen target forces the get trap to return
 * the original function.) So we build a fresh plain object whose functions
 * forward every call to the real bridge and only add the administrator prompt
 * when a call comes back refused.
 */

export type Refusal = {
  ok?: boolean;
  code?: string;
  error?: string;
  requiredLevel?: "admin" | "supervisor";
};

export const isRefusal = (value: unknown): value is Refusal =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as Refusal).ok === false &&
  (value as Refusal).code === "EPRIVILEGE";

/** Calls that must never trigger the prompt: event subscriptions and unlock. */
const passthrough = (key: string) =>
  key.startsWith("on") || key === "subscribe" || key === "unlock";

export function wrapBridge<T extends object>(
  bridge: T,
  requestUnlock: (message: string, requiredLevel?: "admin" | "supervisor", allowPrompt?: boolean) => Promise<boolean>,
  promptPolicy?: (path: string) => boolean,
): T {
  const seen = new WeakMap<object, object>();

  const wrapObject = (source: object, parent = ""): object => {
    const existing = seen.get(source);
    if (existing) return existing;

    const copy: Record<string, unknown> = {};
    seen.set(source, copy);

    const keys = new Set<string>();
    for (const key of Object.getOwnPropertyNames(source)) keys.add(key);
    const proto = Object.getPrototypeOf(source) as object | null;
    if (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key !== "constructor") keys.add(key);
      }
    }

    for (const key of keys) {
      const callPath = parent ? `${parent}.${key}` : key;
      let value: unknown;
      try {
        value = (source as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      if (value && typeof value === "object") {
        copy[key] = wrapObject(value, callPath);
        continue;
      }
      if (typeof value !== "function" || passthrough(key)) {
        copy[key] = value;
        continue;
      }
      const original = (value as (...args: unknown[]) => unknown).bind(source);
      copy[key] = async (...args: unknown[]) => {
        // Capture intent before IPC awaits; background work cannot gain a
        // prompt because the operator happens to click something later.
        const allowPrompt = promptPolicy?.(callPath) ?? false;
        const first = await original(...args);
        if (!isRefusal(first)) return first;
        const unlocked = await requestUnlock(first.error ?? "", first.requiredLevel, allowPrompt);
        if (!unlocked) return first;
        return original(...args);
      };
    }

    return copy;
  };

  return wrapObject(bridge) as T;
}

export { registerDesktopBridge, desktopBridge } from "@/lib/desktop-bridge-registry";
