import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * Server side of the activity feed.
 *
 * Events are written with the internal service key so a till cannot forge or
 * suppress one, and the table itself refuses updates and deletes. WhatsApp
 * fan-out happens here too, so a terminal that closes straight after the
 * action cannot skip the message.
 */
import { serviceRest } from "@/core/api/pos-relay.server";
import { defaultAndroidPushRules, type AndroidPushRules } from "./android-push-policy";

export type NotificationChannel = "off" | "app" | "whatsapp";

export type NotificationSettings = {
  enabled: boolean;
  recipients: string[];
  criticalOnly: boolean;
  quietFrom: string;
  quietTo: string;
  channels: Record<string, NotificationChannel>;
  inApp?: Record<string, boolean>;
  androidPush?: AndroidPushRules;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  recipients: [],
  criticalOnly: false,
  quietFrom: "",
  quietTo: "",
  channels: {},
  androidPush: defaultAndroidPushRules,
};

export async function readNotificationSettings(): Promise<NotificationSettings> {
  try {
    const res = await serviceRest("pos_settings?id=eq.1&select=notification_settings");
    if (!res.ok) return DEFAULT_NOTIFICATION_SETTINGS;
    const rows = (await res.json()) as { notification_settings?: Partial<NotificationSettings> }[];
    const saved = rows[0]?.notification_settings ?? {};
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...saved,
      recipients: Array.isArray(saved.recipients) ? saved.recipients : [],
      channels: (saved.channels as Record<string, NotificationChannel>) ?? {},
      androidPush: { ...defaultAndroidPushRules, ...saved.androidPush },
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function writeNotificationSettings(value: NotificationSettings): Promise<void> {
  const res = await serviceRest("rpc/save_global_notification_rules", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_settings: value }),
  });
  if (!res.ok) throw new Error(await res.text());
}

const minutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** True while the admin asked not to be messaged. */
export function inQuietHours(cfg: NotificationSettings, now = new Date()): boolean {
  const from = minutes(cfg.quietFrom);
  const to = minutes(cfg.quietTo);
  if (from === null || to === null || from === to) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from < to ? at >= from && at < to : at >= from || at < to;
}

export type EventRecord = {
  event_type: string;
  severity: string;
  title: string;
  message: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  terminal_id: string | null;
  terminal_name: string | null;
  store_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  amount: number | null;
  meta: Record<string, unknown>;
  client_event_id: string | null;
  created_at: string;
  whatsapp_status: string;
  whatsapp_error: string | null;
};

export async function sendWhatsApp(to: string, body: string): Promise<string | null> {
  const { readSecureSetting } = await import("./secure-settings.server");
  const token = (await readSecureSetting("whatsapp_token")) ?? process.env["WHATSAPP_TOKEN"];
  const phoneNumberId = await readSecureSetting("whatsapp_phone_number_id");
  if (!token || !phoneNumberId) return "WhatsApp is not configured";
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!res.ok) return `WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`;
  return null;
}

async function branchName(id: string | null): Promise<string> {
  if (!id) return "";
  try {
    const res = await serviceRest(`stores?id=eq.${encodeURIComponent(id)}&select=name&limit=1`);
    if (!res.ok) return "Unknown branch";
    const rows = (await res.json()) as { name?: string }[];
    return rows[0]?.name?.trim() || "Unknown branch";
  } catch {
    return "Unknown branch";
  }
}

async function alertText(row: EventRecord): Promise<string> {
  const branch = await branchName(row.store_id);
  const parts = [
    `*${row.title}*`,
    row.message,
    row.actor_name ? `By: ${row.actor_name}${row.actor_role ? ` (${row.actor_role})` : ""}` : "",
    row.terminal_name ? `Terminal: ${row.terminal_name}` : "",
    branch ? `Branch: ${branch}` : "",
    `At: ${posDisplayDateTime(new Date(row.created_at))}`,
  ];
  return parts.filter(Boolean).join("\n");
}

/** Store the event and, when the rules allow it, message the admins. */
export async function writeActivityEvent(
  row: Omit<EventRecord, "whatsapp_status" | "whatsapp_error">,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await readNotificationSettings();
  const channel = cfg.channels[row.event_type] ?? "app";
  if (channel === "off") return { ok: true };

  let status = "skipped";
  let error: string | null = null;
  const wantsWhatsApp =
    cfg.enabled &&
    channel === "whatsapp" &&
    cfg.recipients.length > 0 &&
    (!cfg.criticalOnly || row.severity === "critical") &&
    (row.severity === "critical" || !inQuietHours(cfg));

  const full: EventRecord = { ...row, meta: { ...row.meta, in_app_disabled: cfg.inApp?.[row.event_type] === false }, whatsapp_status: status, whatsapp_error: null };
  if (wantsWhatsApp) {
    const failures: string[] = [];
    for (const to of cfg.recipients) {
      const digits = to.replace(/\D/g, "");
      if (!digits) continue;
      const err = await sendWhatsApp(digits, await alertText(full));
      if (err) failures.push(err);
    }
    status = failures.length ? "failed" : "sent";
    error = failures[0] ?? null;
  }

  // Events that carry a logical identity (for example one cash-variance alert
  // per shift) are matched on it, so a retry or a replayed offline queue can
  // never leave two copies in the feed.
  const path = row.client_event_id
    ? "activity_events?on_conflict=client_event_id"
    : "activity_events";
  const res = await serviceRest(path, {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify([{ ...full, whatsapp_status: status, whatsapp_error: error }]),
  });
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
  if (cfg.androidPush?.enabled && process.env.POS_PUSH_SERVICE_URL) {
    // Fast path; the central service also polls durable events to recover missed calls.
    try {
      const rows = await res.json() as {id:string}[];
      const {centralPushRequest}=await import("./central-push.server");
      for(const event of rows) await centralPushRequest({action:"event",eventId:event.id});
    } catch { /* An audit write must still succeed if push is temporarily unavailable. */ }
  }
  return { ok: true };
}

/** Compare-and-save prevents two delivery dialogs from overwriting each other. */
export async function writeNotificationSection(incoming: NotificationSettings, section: "android" | "whatsapp" | "app"): Promise<NotificationSettings> {
  const {mergeNotificationSection} = await import("./notification-settings-sections");
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await serviceRest("pos_settings?id=eq.1&select=notification_settings");
    if (!response.ok) throw new Error("Could not read the current notification settings.");
    const rows = await response.json() as Array<{notification_settings: Partial<NotificationSettings> | null}>;
    if (!rows.length) throw new Error("Company notification settings are not initialized.");
    const raw = rows[0].notification_settings;
    const current = {...DEFAULT_NOTIFICATION_SETTINGS, ...(raw ?? {})};
    const next = mergeNotificationSection(current, incoming, section);
    const match = raw === null ? "is.null" : `eq.${encodeURIComponent(JSON.stringify(raw))}`;
    const update = await serviceRest(`pos_settings?id=eq.1&notification_settings=${match}`, {
      method: "PATCH", headers: {Prefer: "return=representation"},
      body: JSON.stringify({notification_settings: next}),
    });
    if (!update.ok) throw new Error("Could not save notification settings.");
    if ((await update.json() as unknown[]).length) return next;
  }
  throw new Error("Notification settings changed on another device. Reopen this dialog and retry.");
}
