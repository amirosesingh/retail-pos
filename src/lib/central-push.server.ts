import { serviceRest } from "@/core/api/pos-relay.server";
import { readNotificationSettings } from "./activity-events.server";
import { defaultAndroidPushRules, maySendAndroidPush } from "./android-push-policy";

export function centralPushConfig() {
  const url = process.env.POS_PUSH_SERVICE_URL;
  const tenant = process.env.POS_PUSH_TENANT_ID;
  const secret = process.env.POS_PUSH_TENANT_SECRET;
  if (!url || !tenant || !secret)
    throw new Error("Android push service is not configured for this company.");
  if (new URL(url).protocol !== "https:") throw new Error("The push service must use HTTPS.");
  return { url, tenant, secret };
}
export async function centralPushRequest(body: Record<string, unknown>) {
  const { url, tenant, secret } = centralPushConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "X-POS-Tenant": tenant,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error("The central phone notification service could not complete this request.");
}
export async function verifyPushService(request: Request) {
  const { tenant, secret } = centralPushConfig();
  if (request.headers.get("X-POS-Tenant") !== tenant) return false;
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([
    digest(request.headers.get("Authorization") ?? ""),
    digest(`Bearer ${secret}`),
  ]);
  return new Uint8Array(a).every((byte, index) => byte === new Uint8Array(b)[index]);
}
export async function authorizePhoneEvent(eventId: string) {
  const response = await serviceRest(`activity_events?id=eq.${eventId}&select=*&limit=1`);
  if (!response.ok) throw new Error("Could not read the event.");
  const event = (await response.json())[0];
  if (!event) return { recipients: [] };
  const config = await readNotificationSettings();
  const rules = config.androidPush ?? defaultAndroidPushRules;
  if (
    !rules.enabled ||
    !rules.events.includes(event.event_type) ||
    config.channels[event.event_type] === "off"
  )
    return { recipients: [] };
  const recipients: string[] = [];
  // Resolve current permissions before every delivery; never trust a device's cached role.
  for (let offset = 0; offset < rules.recipients.length; offset += 50) {
    const ids = rules.recipients
      .slice(offset, offset + 50)
      .map((id) => JSON.stringify(id))
      .join(",");
    const result = await serviceRest(
      `app_users?user_id=in.${encodeURIComponent("(" + ids + ")")}&select=id,user_id,role,role_slug,store_id,is_active,permissions&limit=50`,
    );
    if (!result.ok) throw new Error("Could not check recipient permissions.");
    const users = await result.json();
    for (const user of users)
      if (maySendAndroidPush(rules, event, user)) recipients.push(user.user_id);
  }
  return { recipients };
}
