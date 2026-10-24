import { z } from "zod";

export const notificationRuleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    event: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
    branches: z.array(z.string().min(1).max(64)).max(500),
    actorUsers: z.array(z.string().max(120)).max(500),
    actorRoles: z.array(z.string().max(60)).max(100),
    severities: z.array(z.enum(["info", "warning", "critical"])).max(3),
    minAmount: z.number().finite().nonnegative().nullable(),
    maxAmount: z.number().finite().nonnegative().nullable(),
    audience: z.enum(["selected", "branch", "audit", "original"]),
    users: z.array(z.string().min(1).max(120)).max(500),
    roles: z.array(z.string().min(1).max(60)).max(100),
    channels: z.array(z.enum(["app", "push", "whatsapp"])).max(3),
    phones: z.array(z.string().regex(/^\d{6,30}$/)).max(20),
    phoneUsers: z.record(z.string().regex(/^\d{6,30}$/), z.string().min(1).max(120)).default({}),
    template: z.string().max(1200),
    quietFrom: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/),
    quietTo: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid time zone"),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.minAmount !== null && rule.maxAmount !== null && rule.minAmount > rule.maxAmount)
      ctx.addIssue({
        code: "custom",
        path: ["maxAmount"],
        message: "Maximum amount must be at least the minimum",
      });
    if (!!rule.quietFrom !== !!rule.quietTo)
      ctx.addIssue({
        code: "custom",
        path: ["quietTo"],
        message: "Set both quiet-hour times or leave both empty",
      });
    if (rule.audience === "original" && rule.channels.includes("whatsapp"))
      ctx.addIssue({
        code: "custom",
        path: ["channels"],
        message: "Private approval notices cannot be sent to arbitrary phone numbers",
      });
    if (rule.channels.includes("whatsapp") && !rule.phones.length)
      ctx.addIssue({
        code: "custom",
        path: ["phones"],
        message: "Choose at least one WhatsApp number",
      });
    if (
      rule.enabled &&
      rule.channels.includes("whatsapp") &&
      rule.phones.some((phone) => !rule.phoneUsers[phone])
    )
      ctx.addIssue({
        code: "custom",
        path: ["phoneUsers"],
        message: "Assign each WhatsApp number to its staff recipient before enabling this rule",
      });
    if (
      rule.enabled &&
      rule.channels.length &&
      rule.audience === "selected" &&
      !rule.users.length &&
      !rule.roles.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["users"],
        message: "Choose a recipient or a user role",
      });
  });
export type NotificationRule = z.infer<typeof notificationRuleSchema>;
export const notificationRulesSchema = z
  .array(notificationRuleSchema)
  .max(200)
  .superRefine((rules, ctx) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      ctx.addIssue({ code: "custom", message: "Rule IDs must be unique" });
    if (new TextEncoder().encode(JSON.stringify(rules)).byteLength > 200 * 1024)
      ctx.addIssue({
        code: "custom",
        message:
          "The notification rules exceed the supported size. Reduce message or recipient lists.",
      });
  });
export const PRIVATE_NOTIFICATION_EVENTS = [
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "approval_expired",
  "approval_approved",
  "approval_denied",
  "approval_completed",
  "soft_token_approval",
];
export function newNotificationRule(event = "sale_complete"): NotificationRule {
  return {
    id: crypto.randomUUID(),
    name: "New notification",
    enabled: false,
    event,
    branches: [],
    actorUsers: [],
    actorRoles: [],
    severities: [],
    minAmount: null,
    maxAmount: null,
    audience: PRIVATE_NOTIFICATION_EVENTS.includes(event) ? "original" : "selected",
    users: [],
    roles: [],
    channels: ["app"],
    phones: [],
    phoneUsers: {},
    template: "{{title}}\n{{message}}\nBy {{cashier}} · {{branch}} · {{amount}}",
    quietFrom: "",
    quietTo: "",
    timeZone: "UTC",
  };
}

type LegacySettings = {
  enabled?: boolean;
  recipients?: string[];
  criticalOnly?: boolean;
  quietFrom?: string;
  quietTo?: string;
  channels?: Record<string, string>;
  inApp?: Record<string, boolean>;
  androidPush?: {
    enabled?: boolean;
    events?: string[];
    recipients?: string[];
    branches?: string[];
    criticalOnly?: boolean;
  };
  shiftAlerts?: {
    inApp?: boolean;
    whatsapp?: boolean;
    push?: boolean;
    recipients?: string[];
    quietHours?: boolean;
    quietFrom?: string;
    quietTo?: string;
  };
};
/** Draft conversion only: never writes settings or enables additional recipients. */
export function importNotificationRules(
  settings: LegacySettings,
  events: { type: string; label: string }[],
): NotificationRule[] {
  const financial = new Set([
    "sale_complete",
    "sale_refund",
    "sale_void",
    "shift_open",
    "shift_close",
    "shift_cash_variance",
    "drawer_open",
    "xreport_print",
  ]);
  const branch = new Set([
    "stock_request_received",
    "transfer_sent",
    "transfer_received",
    "po_finalised",
  ]);
  const result: NotificationRule[] = [];
  for (const event of events) {
    // Shift summaries had their own settings. Do not import a second generic
    // rule that changes those recipients or ignores the saved in-app switch.
    if (event.type === "shift_summary") continue;
    const privateEvent = PRIVATE_NOTIFICATION_EVENTS.includes(event.type);
    const channel = settings.channels?.[event.type] ?? "app";
    const base = {
      ...newNotificationRule(event.type),
      name: event.label,
      enabled: channel !== "off",
      audience: privateEvent
        ? ("original" as const)
        : branch.has(event.type)
          ? ("branch" as const)
          : financial.has(event.type)
            ? ("selected" as const)
            : ("audit" as const),
      roles: financial.has(event.type) ? ["admin"] : [],
    };
    if (settings.inApp?.[event.type] !== false && channel !== "off")
      result.push({ ...base, channels: ["app"] });
    if (settings.enabled && channel === "whatsapp" && settings.recipients?.length && !privateEvent)
      result.push({
        ...base,
        id: crypto.randomUUID(),
        name: `${event.label} · WhatsApp`,
        channels: ["whatsapp"],
        phones: settings.recipients,
        severities: settings.criticalOnly ? ["critical"] : [],
        quietFrom: settings.quietFrom ?? "",
        quietTo: settings.quietTo ?? "",
      });
    if (
      settings.androidPush?.enabled &&
      settings.androidPush.events?.includes(event.type) &&
      channel !== "off"
    )
      result.push({
        ...base,
        id: crypto.randomUUID(),
        name: `${event.label} · Android`,
        channels: ["push"],
        audience: privateEvent ? "original" : "selected",
        users: settings.androidPush.recipients ?? [],
        roles: [],
        branches: settings.androidPush.branches ?? [],
        severities: settings.androidPush.criticalOnly ? ["critical"] : [],
      });
  }
  const shift = settings.shiftAlerts;
  if (shift?.inApp !== false)
    result.push({
      ...newNotificationRule("shift_summary"),
      name: "Day-end shift summary",
      enabled: true,
      roles: ["admin"],
      template: "{{message}}",
    });
  if (shift?.whatsapp && shift.recipients?.length)
    result.push({
      ...newNotificationRule("shift_summary"),
      name: "Day-end shift summary",
      enabled: true,
      channels: ["whatsapp"],
      roles: ["admin"],
      phones: shift.recipients,
      quietFrom: shift.quietHours ? (shift.quietFrom ?? "") : "",
      quietTo: shift.quietHours ? (shift.quietTo ?? "") : "",
    });
  if (settings.androidPush?.enabled && settings.androidPush.events?.includes("shift_summary"))
    result.push({
      ...newNotificationRule("shift_summary"),
      name: "Day-end shift summary · Android",
      enabled: true,
      channels: ["push"],
      users: settings.androidPush.recipients ?? [],
      branches: settings.androidPush.branches ?? [],
      severities: settings.androidPush.criticalOnly ? ["critical"] : [],
    });
  return result;
}

export type NotificationDelivery = {
  id: string;
  event_id: string;
  rule_name: string;
  channel: string;
  recipient: string;
  status: string;
  reason: string;
  created_at: string;
  next_attempt: string;
  delivered_at: string | null;
  recipient_user_id: string | null;
};
