import type { CloudIssue, Connectivity } from "@/core/activation/connection-health";

type SnapshotScope = {
  authReady: boolean;
  dataReady: boolean;
  active: boolean;
  personId: string | null | undefined;
  branchId: string | null | undefined;
  accountBranchId: string | null | undefined;
  epoch: number;
  mode: string;
  role: string | null | undefined;
  roles: readonly string[];
  permissions: object;
};

/** Opaque in-memory identity only. No credentials, cached records or new reads. */
export function offlineSnapshotScope(input: SnapshotScope): string | null {
  if (!input.authReady || !input.dataReady || !input.active || !input.personId?.trim() || !input.branchId?.trim()) return null;
  const permissions = Object.entries(input.permissions).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([input.epoch,input.personId,input.branchId.trim().toLowerCase(),
    input.accountBranchId,input.mode,input.role,[...input.roles].sort(),permissions]);
}

/** Presentation only: retained content is always inert, never offline access. */
export function retainOfflineSnapshot(input: {
  web: boolean;
  state: Connectivity;
  issue: CloudIssue;
  currentScope: string | null;
  onlineScope: string | null;
}): boolean {
  return input.web && input.state !== "online" && Boolean(input.currentScope) &&
    input.currentScope === input.onlineScope &&
    ["device-offline","timeout","service-error","rate-limited","transport"].includes(input.issue);
}

/** React capture also reaches a child's body portal, outside HTML inert. */
export function pauseOfflineInteraction(event: { preventDefault(): void; stopPropagation(): void }): void {
  event.preventDefault();
  event.stopPropagation();
}

/** Do not suppress an infinite indicator when settling retained popup motion. */
export function hasOnlyFiniteEntrance(animationName: string, iterationCount: string): boolean {
  const names = animationName.split(",").map(name => name.trim());
  const counts = iterationCount.split(",").map(count => count.trim());
  return names.some(name => Boolean(name) && name !== "none") && names.every((name, index) => {
    const count = counts[index % counts.length];
    return name === "none" || Boolean(count) && Number.isFinite(Number(count)) && Number(count) >= 0;
  });
}
