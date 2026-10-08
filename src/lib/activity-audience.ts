export type ActivityAudienceIdentity = {
  userIds: string[];
  role?: string | null;
  storeId?: string | null;
  terminalId?: string | null;
  mayViewGeneralActivity: boolean;
};

let currentIdentity: ActivityAudienceIdentity | null = null;

export const setActivityAudienceIdentity = (identity: ActivityAudienceIdentity | null): void => {
  currentIdentity = identity;
};

export const activityAudienceIdentity = (): ActivityAudienceIdentity | null => currentIdentity;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).map((item) => item.toLowerCase()) : [];

/** Approval notifications are private; ordinary operational events follow audit access. */
export function activityVisibleTo(
  row: { store_id?: unknown; terminal_id?: unknown; meta?: unknown },
  identity: ActivityAudienceIdentity,
): boolean {
  const meta =
    row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {};
  const audience = String(meta["audience"] ?? "").toLowerCase();
  const targeted =
    audience === "configured_approvers" ||
    Boolean(audience) ||
    strings(meta["audience_user_ids"]).length > 0 ||
    strings(meta["audience_roles"]).length > 0 ||
    Boolean(meta["audience_terminal_id"]);
  if (!targeted) return identity.mayViewGeneralActivity;

  const ids = new Set(identity.userIds.map((value) => value.toLowerCase()).filter(Boolean));
  const exactUsers = strings(meta["audience_user_ids"]);
  if (audience && audience !== "configured_approvers") exactUsers.push(audience);
  const exactUser = exactUsers.some((value) => ids.has(value));
  const roleMatch = strings(meta["audience_roles"]).includes((identity.role ?? "").toLowerCase());
  const terminalTarget = String(meta["audience_terminal_id"] ?? "").toLowerCase();
  const terminalMatch =
    Boolean(terminalTarget) &&
    Boolean(identity.terminalId) &&
    terminalTarget === identity.terminalId!.toLowerCase();
  const rowStore = String(row.store_id ?? "").trim().toLowerCase();
  const sameBranch = !rowStore || (!!identity.storeId && rowStore === identity.storeId.trim().toLowerCase());
  return sameBranch && (exactUser || roleMatch || terminalMatch);
}
