import type { NotificationSettings } from "./activity-events.server";
/** Independent dialogs may only change their own delivery fields. */
export function mergeNotificationSection(current: NotificationSettings, incoming: NotificationSettings, section?: "android" | "whatsapp" | "app"): NotificationSettings {
  if (!section) return incoming;
  if (section === "android") return {...current, androidPush: incoming.androidPush};
  if (section === "app") return {...current, inApp: incoming.inApp ?? {}};
  const {androidPush: _android, inApp: _inApp, ...whatsapp} = incoming;
  return {...current, ...whatsapp};
}
