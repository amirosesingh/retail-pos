/**
 * The one place that decides which branch a record belongs to.
 *
 * Order of truth:
 *   1. the branch this terminal is registered to (hardware binding),
 *   2. the branch currently in view,
 *   3. the branch mirrored locally by the desktop shell.
 *
 * Every write path uses this so a record can never be saved without a branch
 * while the terminal actually knows one.
 */
import { readBranch } from "@/core/local-db/local-db";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { terminalRuntimePlatform } from "@/core/activation/terminal-platform";

/** Browser management must never inherit a cached native activation claim. */
export const branchTerminalConfig = () => terminalRuntimePlatform() === "web" ? null : readTerminalConfig();

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/** Where this terminal's own branch is kept between launches. */
const BOUND_ID_KEY = "terminal_branch_id";
const BOUND_NAME_KEY = "terminal_branch_name";

const readStored = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return clean(window.localStorage.getItem(key));
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string | null) => {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — the resolver still works from the claim */
  }
};

/** The branch this device was bound to, as persisted at start-up or sign-in. */
export function boundBranchId(): string | null {
  return readStored(BOUND_ID_KEY);
}

export function boundBranchName(): string | null {
  return readStored(BOUND_NAME_KEY);
}

/** Remove a previous hardware binding after an explicit mobile reassignment. */
export function clearTerminalBranchBinding(): void {
  writeStored(BOUND_ID_KEY, null);
  writeStored(BOUND_NAME_KEY, null);
  knownBranchIds = [];
}

/**
 * Pin this device to a branch. Called at start-up from the terminal's
 * activation claim and again on every sign-in, so whoever uses this till
 * trades in the terminal's branch even when their own record has none.
 */
export function bindTerminalBranch(id?: string | null, name?: string | null): string | null {
  const config = branchTerminalConfig();
  if (config?.deviceUse === "management" && !clean(config.locationId)) {
    clearTerminalBranchBinding();
    return null;
  }
  const nextId = clean(config?.locationId) ?? clean(id) ?? boundBranchId();
  const nextName = clean(config?.locationName) ?? clean(name) ?? boundBranchName();
  writeStored(BOUND_ID_KEY, nextId);
  writeStored(BOUND_NAME_KEY, nextName);
  return nextId;
}

/**
 * Branch directory as last loaded. A single-branch business needs no explicit
 * assignment anywhere: the one branch that exists is the branch in use.
 */
let knownBranchIds: string[] = [];

/** Publish the loaded branch directory so the resolver can use it. */
export function setKnownBranches(ids: Array<string | null | undefined>) {
  knownBranchIds = ids.map((id) => (id ?? "").trim()).filter(Boolean);
}

/** The only branch this business has, or null when there are none or many. */
export function soleBranchId(): string | null {
  return knownBranchIds.length === 1 ? knownBranchIds[0] : null;
}

/** Branch id for this till, or null when nothing knows one yet. */
export function activeBranchId(inView?: string | null): string | null {
  const config = branchTerminalConfig();
  if (terminalRuntimePlatform() === "web") return clean(inView) ?? boundBranchId() ?? clean(readBranch().branchId) ?? soleBranchId();
  if (config?.deviceUse === "management" && !clean(config.locationId)) return clean(inView);
  return (
    clean(config?.locationId) ??
    boundBranchId() ??
    clean(inView) ??
    clean(readBranch().branchId) ??
    soleBranchId()
  );
}

/** Human name for the branch, for messages and headers. */
export function activeBranchName(inView?: string | null): string | null {
  const config = branchTerminalConfig();
  if (terminalRuntimePlatform() === "web") return clean(inView) ?? boundBranchName() ?? clean(readBranch().branchName);
  if (config?.deviceUse === "management" && !clean(config.locationId)) return clean(inView);
  return (
    clean(config?.locationName) ??
    boundBranchName() ??
    clean(inView) ??
    clean(readBranch().branchName)
  );
}

/**
 * Same as {@link activeBranchId} but refuses to return nothing, so a caller
 * never silently writes an orphan row.
 */
export function requireBranchId(inView?: string | null): string {
  const id = activeBranchId(inView);
  if (!id) {
    throw new Error(
      "This terminal has no branch yet — activate it or pick a branch before saving.",
    );
  }
  return id;
}