import { hostedFunction } from "./hosted-function-client";
import { pushActivityEvent as pushActivityEventDirect, loadNotificationSettings as loadNotificationSettingsDirect, saveNotificationSettings as saveNotificationSettingsDirect } from "./activity-events.functions";
export const pushActivityEvent = hostedFunction("activity-events.pushActivityEvent", pushActivityEventDirect);
export const loadNotificationSettings = hostedFunction("activity-events.loadNotificationSettings", loadNotificationSettingsDirect);
export const saveNotificationSettings = hostedFunction("activity-events.saveNotificationSettings", saveNotificationSettingsDirect);
