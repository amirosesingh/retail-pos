import type { ScopeIds } from "./branch-settings";
import { isCurrentEpoch, sessionEpoch } from "./session-epoch";
import { desktopAuthorityFailure } from "./desktop-authority-error";

export type ScopedSettingsReadStatus = { phase: "loading" | "ready" | "failed"; error: string | null };

/** A prior person's/mode's confirmation cannot authorize a new settings view. */
export function scopedSettingsReadKey(identity: string | null, ids: ScopeIds, epoch = sessionEpoch()): string {
  return JSON.stringify([epoch, identity, ids.CLUSTER, ids.BRANCH, ids.TERMINAL]);
}

/** Bound the loading UI, keeping the raw read alive for a safe late answer. */
export function createScopedSettingsReader<T>({
  read, writes, isCurrent, accept, status, confirmed = false, epoch = sessionEpoch(),
}: {
  read: () => Promise<T>;
  writes: { readonly pending: boolean; readonly revision: number };
  isCurrent: () => boolean;
  accept: (value: T) => void;
  status: (next: ScopedSettingsReadStatus) => void;
  confirmed?: boolean;
  epoch?: number;
}) {
  let active = true;
  let pendingRead: Promise<void> | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let rearmDeadline: (() => void) | null = null;
  const current = () => active && isCurrentEpoch(epoch) && isCurrent();
  const failed = (error: string) => {
    if (current() && !confirmed) status({ phase: "failed", error });
  };
  return {
    refresh(): Promise<void> {
      if (pendingRead) return pendingRead;
      if (!current()) return Promise.resolve();
      if (writes.pending) {
        failed("Pending settings changes must finish before this store's settings can be loaded. Try again after saving those changes.");
        return Promise.resolve();
      }
      const revision = writes.revision;
      if (!confirmed) status({ phase: "loading", error: null });
      const changed = () => writes.pending || revision !== writes.revision;
      const failure = () => failed("Settings changed while this store's settings were loading. Try again to load the saved values.");
      const armDeadline = () => {
        clearTimeout(deadline);
        if (!confirmed) deadline = setTimeout(() => {
          if (changed()) failure();
          else failed("Store settings are taking too long to load. Try again without changing your saved connection.");
        }, 15_000);
      };
      rearmDeadline = () => {
        if (!current() || confirmed) return;
        if (changed()) { failure(); return; }
        status({ phase: "loading", error: null });
        armDeadline();
      };
      const pending = Promise.resolve().then(async () => {
        if (!current()) return;
        if (changed()) { failure(); return; }
        armDeadline();
        try {
          const next = await read();
          if (!current()) return;
          if (changed()) { failure(); return; }
          accept(next);
          confirmed = true;
          status({ phase: "ready", error: null });
        } catch (error) {
          const authority = desktopAuthorityFailure(error);
          failed(authority
            ? `${authority.error} Your saved settings have not been replaced.`
            : "Store settings could not be loaded. Check the connection and try again; saved settings have not been replaced.");
        } finally {
          clearTimeout(deadline);
          deadline = undefined;
          rearmDeadline = null;
        }
      });
      pendingRead = pending;
      const clear = () => { if (pendingRead === pending) pendingRead = null; };
      void pending.then(clear, clear);
      return pending;
    },
    /** UI-only retry while pending; the persistent subscription owns I/O. */
    retryStatus() { if (pendingRead) rearmDeadline?.(); },
    stop() { active = false; clearTimeout(deadline); rearmDeadline = null; },
  };
}
