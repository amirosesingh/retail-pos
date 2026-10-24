import { hostedFunction } from "./hosted-function-client";
import {
  loadNotificationRuleTable as load,
  saveNotificationRuleTable as save,
  processNotificationDeliveries as process,
} from "./notification-rules.functions";
export const loadNotificationRuleTable = hostedFunction(
  "notification-rules.loadNotificationRuleTable",
  load,
);
export const saveNotificationRuleTable = hostedFunction(
  "notification-rules.saveNotificationRuleTable",
  save,
);
export const processNotificationDeliveries = hostedFunction(
  "notification-rules.processNotificationDeliveries",
  process,
);
