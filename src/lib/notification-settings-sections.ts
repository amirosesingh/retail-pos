import type { NotificationSettings } from "./activity-events.server";
/** Independent dialogs may only change their own delivery fields. */
export function mergeNotificationSection(current: NotificationSettings, incoming: NotificationSettings, section?: "android" | "whatsapp"): NotificationSettings {
  if (!section) return incoming;
  if (section === "android") return {...current, androidPush: incoming.androidPush};
  const {androidPush: _android, ...whatsapp} = incoming;
  return {...current, ...whatsapp};
}
