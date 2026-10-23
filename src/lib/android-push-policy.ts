import { activityVisibleTo } from "./activity-audience";

export type AndroidPushRules = {
  enabled: boolean;
  events: string[];
  recipients: string[];
  branches: string[];
  criticalOnly: boolean;
};
export const defaultAndroidPushRules: AndroidPushRules = {
  enabled: false,
  events: [],
  recipients: [],
  branches: [],
  criticalOnly: false,
};
export function maySendAndroidPush(
  rules: AndroidPushRules,
  event: {
    event_type: string;
    severity: string;
    store_id?: string | null;
    meta?: unknown;
    terminal_id?: string | null;
  },
  user: {
    user_id: string;
    id: string;
    role: string;
    role_slug?: string;
    store_id?: string;
    is_active: boolean;
    permissions?: Record<string, boolean>;
  },
  terminalId?: string,
) {
  if (!rules.enabled || !user.is_active || !rules.events.includes(event.event_type)) return false;
  if (!rules.recipients.includes(user.user_id)) return false;
  if (rules.criticalOnly && event.severity !== "critical") return false;
  if (
    rules.branches.length &&
    !rules.branches.some((branch) => branch.toLowerCase() === event.store_id?.toLowerCase())
  )
    return false;
  return activityVisibleTo(event, {
    userIds: [user.id, user.user_id],
    role: user.role_slug || user.role,
    storeId: user.store_id,
    terminalId,
    mayViewGeneralActivity:
      user.permissions?.can_view_audit_trail === true ||
      user.role === "admin" ||
      user.role_slug === "admin",
  }, "push");
}
