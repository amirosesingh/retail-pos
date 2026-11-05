import { useRef } from "react";

export type ConfirmedPresentation<T> = { key: string; value: T } | null;

/** Presentation memory only; unknown/error data never establishes a new snapshot. */
export function confirmedPresentation<T>(previous: ConfirmedPresentation<T>, key: string | null, value: T, resolved: boolean): ConfirmedPresentation<T> {
  if (!key) return null;
  if (resolved) return { key, value };
  return previous?.key === key ? previous : null;
}

/** Keep a same-scope confirmed view through refresh, never across identity changes. */
export function useConfirmedPresentation<T>(key: string | null, value: T, resolved: boolean): T | null {
  const snapshot = useRef<ConfirmedPresentation<T>>(null);
  snapshot.current = confirmedPresentation(snapshot.current, key, value, resolved);
  return snapshot.current?.value ?? null;
}
