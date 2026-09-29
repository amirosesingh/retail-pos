/**
 * The authorisation framework, in one shared vocabulary.
 *
 * A sensitive action is never decided in the browser. This file only names
 * the actions, describes how a rule is shaped and works out which rule
 * applies to a branch; every check that matters happens on the server.
 */
import { GATE_RULE_KEY, type GateAction, type PosRules } from "./pos-rules";
import { normalizeSnapshot, type TicketSnapshot } from "./ticket-snapshot";

export type { TicketSnapshot } from "./ticket-snapshot";

/** How an action must be authorised. */
export type AuthMode = "none" | "pin" | "request" | "either";

/** Old approvals must not remain usable after the customer or prices changed. */
export const APPROVAL_TTL_MS = 15 * 60_000;

export const AUTH_MODES: { value: AuthMode; label: string; blurb: string }[] = [
  {
    value: "none",
    label: "No authorisation",
    blurb: "Runs straight away if the person's own permissions allow it.",
  },
  {
    value: "pin",
    label: "PIN only",
    blurb: "Someone with the right to authorise must type their PIN at the till.",
  },
  {
    value: "request",
    label: "Approval request",
    blurb: "The action waits in the approvals queue until it is decided.",
  },
  {
    value: "either",
    label: "Either",
    blurb: "The person chooses a PIN on the spot or sends it for approval.",
  },
];

/** Every action that can be gated. */
export type AuthActionKey =
  | GateAction
  | "below_cost_sale"
  | "tax_exemption"
  | "shift_close_variance"
  | "edit_posted_stock"
  | "edit_posted_purchase"
  | "discard_draft"
  | "delete_product"
  | "stock_transfer"
  | "member_points_adjust";

export type AuthActionDef = {
  key: AuthActionKey;
  label: string;
  blurb: string;
  group: string;
  /** Actions that only apply above a limit describe that limit here. */
  thresholdLabel?: string;
  /** Whether the action can sensibly wait for an approval decision. */
  deferrable: boolean;
};

export const AUTH_GROUPS: { id: string; label: string; blurb: string }[] = [
  { id: "sales", label: "Sales & pricing", blurb: "What may be changed on a ticket at the till." },
  { id: "cash", label: "Cash & shift", blurb: "The drawer, the count and the hand-back." },
  { id: "inventory", label: "Inventory", blurb: "Stock movements and the catalogue." },
  {
    id: "records",
    label: "Records & edits",
    blurb: "Changing something that has already been posted.",
  },
  { id: "admin", label: "Administration", blurb: "Terminal and member administration." },
];

export const AUTH_ACTIONS: AuthActionDef[] = [
  {
    key: "refund",
    group: "sales",
    label: "Refund",
    blurb: "Returning money to a customer.",
    deferrable: false,
  },
  {
    key: "void_cart",
    group: "sales",
    label: "Void the whole cart",
    blurb: "Abandoning a ticket in progress.",
    deferrable: false,
  },
  {
    key: "void_line",
    group: "sales",
    label: "Void / delete a line",
    blurb: "Removing an item already scanned.",
    deferrable: false,
  },
  {
    key: "reduce_qty",
    group: "sales",
    label: "Reduce a quantity",
    blurb: "Lowering the count on a scanned line.",
    deferrable: false,
  },
  {
    key: "manual_discount",
    group: "sales",
    label: "Manual discount",
    blurb: "Any hand-typed line or bill discount.",
    deferrable: false,
  },
  {
    key: "discount_over_limit",
    group: "sales",
    label: "Discount above the limit",
    blurb: "A discount larger than the cashier may give.",
    thresholdLabel: "Discount (%) allowed without authorisation",
    deferrable: false,
  },
  {
    key: "price_override",
    group: "sales",
    label: "Price override",
    blurb: "Typing a different price at the till.",
    deferrable: false,
  },
  {
    key: "below_cost_sale",
    group: "sales",
    label: "Sell below cost",
    blurb: "Selling an item under its unit cost.",
    deferrable: false,
  },
  {
    key: "tax_exemption",
    group: "sales",
    label: "Tax exemption",
    blurb: "Removing tax from a ticket.",
    deferrable: false,
  },
  {
    key: "edit_tenders",
    group: "sales",
    label: "Edit split payments",
    blurb: "Changing the tenders on a bill.",
    deferrable: false,
  },
  {
    key: "no_sale_drawer",
    group: "cash",
    label: "No-sale drawer open",
    blurb: "Opening the drawer without a sale.",
    deferrable: false,
  },
  {
    key: "shift_close",
    group: "cash",
    label: "Close a shift",
    blurb: "Running the Z-report and handing back the till.",
    deferrable: false,
  },
  {
    key: "shift_close_variance",
    group: "cash",
    label: "Close a shift over the variance limit",
    blurb: "The counted cash is short or over by more than allowed.",
    thresholdLabel: "Variance allowed without authorisation",
    deferrable: false,
  },
  {
    key: "stock_adjustment",
    group: "inventory",
    label: "Stock adjustment",
    blurb: "Recounting or writing off stock.",
    deferrable: true,
  },
  {
    key: "stock_transfer",
    group: "inventory",
    label: "Stock transfer",
    blurb: "Moving stock from one branch or warehouse to another.",
    deferrable: true,
  },
  {
    key: "delete_product",
    group: "inventory",
    label: "Delete a product",
    blurb: "Removing an item from the catalogue.",
    deferrable: true,
  },
  {
    key: "edit_posted_stock",
    group: "records",
    label: "Edit a posted stock record",
    blurb: "Changing a count that has already been posted.",
    deferrable: true,
  },
  {
    key: "edit_posted_purchase",
    group: "records",
    label: "Edit a received purchase",
    blurb: "Changing a goods-received entry after it was received.",
    deferrable: true,
  },
  {
    key: "discard_draft",
    group: "records",
    label: "Discard a draft with items",
    blurb: "Throwing away a draft that already has lines on it.",
    deferrable: true,
  },
  {
    key: "terminal_unpair",
    group: "admin",
    label: "Unpair / reset a terminal",
    blurb: "Sending a machine back to the activation screen.",
    deferrable: true,
  },
  {
    key: "member_points_adjust",
    group: "admin",
    label: "Adjust member points",
    blurb: "Adding or removing loyalty points by hand.",
    deferrable: true,
  },
];

export const AUTH_ACTION_LABEL: Record<string, string> = Object.fromEntries(
  AUTH_ACTIONS.map((a) => [a.key, a.label]),
);

export type AuthScopeType = "global" | "cluster" | "branch";

export type AuthorizationRule = {
  id: string;
  actionKey: AuthActionKey;
  scopeType: AuthScopeType;
  scopeId: string;
  mode: AuthMode;
  allowedRoles: string[];
  allowedUserIds: string[];
  /** Roles/users allowed to raise (not decide) a queued request. */
  requesterRoles: string[];
  requesterUserIds: string[];
  /** Maximum approvable value by `role:<role>` or `user:<id>`; absent means unlimited. */
  authorityLimits: Record<string, number>;
  /** Relative authority added to the requester's direct limit. */
  extraAuthority: Record<string, number>;
  /** Optional hard cap after applying relative authority. */
  absoluteCeilings: Record<string, number>;
  approvalTimeoutMinutes: number;
  escalationAfterMinutes: number | null;
  escalationRoles: string[];
  requireReason: boolean;
  threshold: number | null;
  isEnabled: boolean;
  rowVersion: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const defaultRule = (actionKey: AuthActionKey): AuthorizationRule => ({
  id: "",
  actionKey,
  scopeType: "global",
  scopeId: "",
  mode: "none",
  allowedRoles: ["admin", "manager"],
  allowedUserIds: [],
  requesterRoles: ["cashier", "staff", "manager", "admin"],
  requesterUserIds: [],
  authorityLimits: {},
  extraAuthority: {},
  absoluteCeilings: {},
  approvalTimeoutMinutes: 15,
  escalationAfterMinutes: null,
  escalationRoles: [],
  requireReason: false,
  threshold: null,
  isEnabled: true,
  rowVersion: 0,
  updatedAt: null,
  updatedBy: null,
});

const parsedJson = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const asStrings = (raw: unknown): string[] => {
  const value = parsedJson(raw);
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
};

const asMode = (raw: unknown): AuthMode =>
  raw === "pin" || raw === "request" || raw === "either" ? raw : "none";

const asLimits = (raw: unknown): Record<string, number> => {
  raw = parsedJson(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [key.toLowerCase(), Number(value)] as const)
      .filter(([, value]) => Number.isFinite(value) && value >= 0),
  );
};

/** Coerce an untrusted database row into a complete rule. */
export function normalizeRule(input: unknown): AuthorizationRule {
  const row = (input ?? {}) as Record<string, unknown>;
  const field = (databaseName: string, applicationName: string) =>
    row[databaseName] ?? row[applicationName];
  const key = String(field("action_key", "actionKey") ?? "") as AuthActionKey;
  const base = defaultRule(key);
  const scope = String(field("scope_type", "scopeType") ?? "global");
  const threshold = row["threshold"];
  return {
    ...base,
    id: String(row["id"] ?? ""),
    scopeType: scope === "branch" || scope === "cluster" ? scope : "global",
    scopeId: String(field("scope_id", "scopeId") ?? ""),
    mode: asMode(row["mode"]),
    allowedRoles: asStrings(field("allowed_roles", "allowedRoles")).length
      ? asStrings(field("allowed_roles", "allowedRoles"))
      : base.allowedRoles,
    allowedUserIds: asStrings(field("allowed_user_ids", "allowedUserIds")),
    requesterRoles: asStrings(field("requester_roles", "requesterRoles")).length
      ? asStrings(field("requester_roles", "requesterRoles"))
      : base.requesterRoles,
    requesterUserIds: asStrings(field("requester_user_ids", "requesterUserIds")),
    authorityLimits: asLimits(field("authority_limits", "authorityLimits")),
    extraAuthority: asLimits(field("extra_authority", "extraAuthority")),
    absoluteCeilings: asLimits(field("absolute_ceilings", "absoluteCeilings")),
    approvalTimeoutMinutes: Math.min(
      1440,
      Math.max(1, Number(field("approval_timeout_minutes", "approvalTimeoutMinutes")) || 15),
    ),
    escalationAfterMinutes:
      field("escalation_after_minutes", "escalationAfterMinutes") == null
        ? null
        : Math.min(
            1440,
            Math.max(
              1,
              Number(field("escalation_after_minutes", "escalationAfterMinutes")) || 1,
            ),
          ),
    escalationRoles: asStrings(field("escalation_roles", "escalationRoles")),
    requireReason: field("require_reason", "requireReason") === true,
    threshold: threshold === null || threshold === undefined ? null : Number(threshold),
    isEnabled: field("is_enabled", "isEnabled") !== false,
    rowVersion: Math.max(0, Number(field("row_version", "rowVersion") ?? 0) || 0),
    updatedAt:
      field("updated_at", "updatedAt") == null
        ? null
        : String(field("updated_at", "updatedAt")),
    updatedBy:
      field("updated_by", "updatedBy") == null
        ? null
        : String(field("updated_by", "updatedBy")),
  };
}

export type RuleMap = Record<string, AuthorizationRule>;

/**
 * The rule that applies to a branch: the branch row wins over the global row,
 * and an action with no row at all is not gated.
 */
export function resolveRules(rows: AuthorizationRule[], storeId: string): RuleMap {
  const out: RuleMap = {};
  AUTH_ACTIONS.forEach((a) => {
    out[a.key] = defaultRule(a.key);
  });
  rows
    .filter((r) => r.scopeType === "global")
    .forEach((r) => {
      out[r.actionKey] = r;
    });
  if (storeId) {
    rows
      .filter((r) => r.scopeType === "branch" && r.scopeId === storeId)
      .forEach((r) => {
        out[r.actionKey] = r;
      });
  }
  return out;
}

/**
 * Rules shown in the settings editor for one storage scope.
 *
 * A branch may inherit a global rule for display, but that global row version
 * must never be used as the expected version of a new branch override. The
 * override does not exist yet, so its correct optimistic-lock version is 0.
 */
export function resolveEditableRules(
  rows: AuthorizationRule[],
  scopeType: "global" | "branch",
  storeId: string,
): RuleMap {
  const scopeId = scopeType === "branch" ? storeId : "";
  const effective = resolveRules(rows, scopeId);
  const direct = new Map(
    rows
      .filter((rule) => rule.scopeType === scopeType && rule.scopeId === scopeId)
      .map((rule) => [rule.actionKey, rule]),
  );
  const out: RuleMap = {};
  for (const action of AUTH_ACTIONS) {
    const stored = direct.get(action.key);
    out[action.key] = stored ?? {
      ...effective[action.key],
      id: "",
      scopeType,
      scopeId,
      rowVersion: 0,
      updatedAt: null,
      updatedBy: null,
    };
  }
  return out;
}

export const isAuthorizationRuleConflict = (message: string): boolean =>
  /PT409|ESTALE_RULE|changed on another device|reload it before saving|reopen it to review/i.test(
    message,
  );

/**
 * The fall-back when the rules table cannot be read: the branch's existing
 * manager-PIN switches. An unmapped action stays gated by PIN rather than
 * quietly opening.
 */
export function rulesFromLegacy(rules: PosRules): RuleMap {
  const out: RuleMap = {};
  AUTH_ACTIONS.forEach((a) => {
    const legacyKey = (GATE_RULE_KEY as Record<string, keyof PosRules>)[a.key];
    const gated = legacyKey ? Boolean(rules[legacyKey]) : true;
    out[a.key] = { ...defaultRule(a.key), mode: gated ? "pin" : "none" };
  });
  return out;
}

/** Can this person decide requests for the action, or authorise it by PIN? */
export function canAuthorize(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
): boolean {
  if (!rule) return false;
  const role = (who.role ?? "").toLowerCase();
  if (role && rule.allowedRoles.map((r) => r.toLowerCase()).includes(role)) return true;
  const id = (who.userId ?? "").toLowerCase();
  return !!id && rule.allowedUserIds.map((u) => u.toLowerCase()).includes(id);
}

/** Authentication never implies authority: request and decision rights are separate. */
export function canRequestApproval(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
): boolean {
  if (!rule || !rule.isEnabled || (rule.mode !== "request" && rule.mode !== "either")) return false;
  const role = (who.role ?? "").toLowerCase();
  const id = (who.userId ?? "").toLowerCase();
  return (
    rule.requesterRoles.some((r) => r.toLowerCase() === role) ||
    (!!id && rule.requesterUserIds.some((u) => u.toLowerCase() === id))
  );
}

/** A configured personal limit wins over the role limit; no configured limit is unlimited. */
function authorityValue(
  map: Record<string, number>,
  who: { userId?: string | null; role?: string | null },
) {
  const userKey = `user:${(who.userId ?? "").toLowerCase()}`;
  const roleKey = `role:${(who.role ?? "").toLowerCase()}`;
  return map[userKey] ?? map[roleKey] ?? null;
}

/** Legacy absolute authority. Kept unchanged for already-deployed rules. */
export function approvalAuthority(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
): number | null {
  if (!rule) return null;
  return authorityValue(rule.authorityLimits, who);
}

export type EffectiveAuthority = {
  mode: "unlimited" | "legacy_absolute" | "relative";
  directLimit: number | null;
  extraAllowance: number | null;
  absoluteCeiling: number | null;
  effectiveMaximum: number | null;
};

/** New relative values take precedence; legacy absolute values retain their old meaning. */
export function effectiveApprovalAuthority(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
  directLimit?: number | null,
): EffectiveAuthority {
  if (!rule)
    return {
      mode: "unlimited",
      directLimit: null,
      extraAllowance: null,
      absoluteCeiling: null,
      effectiveMaximum: null,
    };
  const extra = authorityValue(rule.extraAuthority, who);
  const ceiling = authorityValue(rule.absoluteCeilings, who);
  if (extra !== null) {
    const direct = Number.isFinite(directLimit) ? Number(directLimit) : 0;
    const combined = direct + extra;
    return {
      mode: "relative",
      directLimit: direct,
      extraAllowance: extra,
      absoluteCeiling: ceiling,
      effectiveMaximum: ceiling === null ? combined : Math.min(combined, ceiling),
    };
  }
  const legacy = approvalAuthority(rule, who);
  if (legacy !== null)
    return {
      mode: "legacy_absolute",
      directLimit: directLimit ?? null,
      extraAllowance: null,
      absoluteCeiling: legacy,
      effectiveMaximum: legacy,
    };
  return {
    mode: "unlimited",
    directLimit: directLimit ?? null,
    extraAllowance: null,
    absoluteCeiling: ceiling,
    effectiveMaximum: ceiling,
  };
}

export function canAuthorizeAmount(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
  amount: number | null | undefined,
  directLimit?: number | null,
): boolean {
  if (!canAuthorize(rule, who)) return false;
  const limit = effectiveApprovalAuthority(rule, who, directLimit).effectiveMaximum;
  return (
    limit === null || amount == null || (Number.isFinite(amount) && amount >= 0 && amount <= limit)
  );
}

/** Backup roles become eligible only after the configured escalation delay. */
export function canAuthorizeEscalated(
  rule: AuthorizationRule | undefined,
  who: { role?: string | null },
  createdAt: string,
  now = Date.now(),
): boolean {
  if (!rule?.escalationAfterMinutes || !rule.escalationRoles.length) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const role = (who.role ?? "").toLowerCase();
  return (
    now - created >= rule.escalationAfterMinutes * 60_000 &&
    rule.escalationRoles.some((candidate) => candidate.toLowerCase() === role)
  );
}

export function canDecideRequestAmount(
  rule: AuthorizationRule | undefined,
  who: { userId?: string | null; role?: string | null },
  request: Pick<AuthorizationRequest, "createdAt" | "requestedAmount" | "requesterDirectLimit">,
  amount = request.requestedAmount,
): boolean {
  if (canAuthorizeAmount(rule, who, amount, request.requesterDirectLimit)) return true;
  if (!canAuthorizeEscalated(rule, who, request.createdAt)) return false;
  const limit = effectiveApprovalAuthority(
    rule,
    who,
    request.requesterDirectLimit,
  ).effectiveMaximum;
  return (
    limit === null || amount == null || (Number.isFinite(amount) && amount >= 0 && amount <= limit)
  );
}

/** Approval payloads stay flat so they survive the wire unchanged. */
export type PayloadValue = string | number | boolean | null;
export type AuthPayload = Record<string, PayloadValue>;

/** Stable binding carried by a signed grant and checked again by the mutation. */
export function authorizationBinding(payload: AuthPayload = {}, snapshotHash = ""): string {
  const material =
    JSON.stringify(
      Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
    ) + `|${snapshotHash}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${material.length.toString(16)}`;
}

export type AuthorizationRequest = {
  id: string;
  actionKey: string;
  requestedBy: string;
  requestedByName: string;
  storeId: string;
  terminalId: string;
  reason: string;
  payload: AuthPayload;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
  /** the value the cashier asked for, and the one that was actually granted */
  requestedAmount: number | null;
  requesterDirectLimit: number | null;
  valueUnit: "percent" | "currency" | "quantity" | "number";
  approvedAmount: number | null;
  approvedPayload: AuthPayload;
  /** the ticket the approver reviewed, and its fingerprint */
  snapshot: TicketSnapshot | null;
  snapshotHash: string;
  /** the parked ticket this request belongs to, when there is one */
  heldOrderId: string | null;
  consumedAt: string | null;
  /** Exact people and roles the request was routed to when it was created. */
  approvalRoute: ApprovalRouteSnapshot | null;
};

export type ApprovalRoutePerson = { id: string; name: string; role: string };

export type ApprovalRouteSnapshot = {
  primaryRoles: string[];
  primaryUserIds: string[];
  primaryApprovers: ApprovalRoutePerson[];
  escalationAfterMinutes: number | null;
  escalationRoles: string[];
  escalationApprovers: ApprovalRoutePerson[];
  ruleScopeType: AuthScopeType;
  ruleScopeId: string;
};

const numberOrNull = (raw: unknown): number | null =>
  raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))
    ? null
    : Number(raw);

export function normalizeRequest(input: unknown): AuthorizationRequest {
  const row = (input ?? {}) as Record<string, unknown>;
  const status = String(row["status"] ?? "pending");
  return {
    id: String(row["id"] ?? ""),
    actionKey: String(row["action_key"] ?? ""),
    requestedBy: String(row["requested_by"] ?? ""),
    requestedByName: String(row["requested_by_name"] ?? row["requested_by"] ?? ""),
    storeId: String(row["store_id"] ?? ""),
    terminalId: String(row["terminal_id"] ?? ""),
    reason: String(row["reason"] ?? ""),
    payload: (row["payload"] as AuthPayload) ?? {},
    status: (["pending", "approved", "rejected", "cancelled", "expired"].includes(status)
      ? status
      : "pending") as AuthorizationRequest["status"],
    decidedBy: (row["decided_by"] as string) ?? null,
    decidedByName: (row["decided_by_name"] as string) ?? null,
    decidedAt: (row["decided_at"] as string) ?? null,
    decisionNote: (row["decision_note"] as string) ?? null,
    expiresAt: String(row["expires_at"] ?? ""),
    createdAt: String(row["created_at"] ?? ""),
    requestedAmount: numberOrNull(row["requested_amount"]),
    requesterDirectLimit: numberOrNull(
      row["requester_direct_limit"] ??
        (row["payload"] as AuthPayload | undefined)?.["allowed_limit"],
    ),
    valueUnit: (["percent", "currency", "quantity", "number"].includes(String(row["value_unit"]))
      ? String(row["value_unit"])
      : String((row["payload"] as AuthPayload | undefined)?.["discount_type"]) === "percent"
        ? "percent"
        : "number") as AuthorizationRequest["valueUnit"],
    approvedAmount: numberOrNull(row["approved_amount"]),
    approvedPayload: (row["approved_payload"] as AuthPayload) ?? {},
    snapshot: normalizeSnapshotRow(row["bill_snapshot"]),
    snapshotHash: String(row["snapshot_hash"] ?? ""),
    heldOrderId: (row["held_order_id"] as string) ?? null,
    consumedAt: (row["consumed_at"] as string) ?? null,
    approvalRoute: normalizeApprovalRoute(row["approval_route"]),
  };
}

function normalizeApprovalRoute(raw: unknown): ApprovalRouteSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  // Existing/offline-created rows use the database default `{}`. Treat that
  // as a legacy request so current branch rules still govern it; an empty
  // route must never make a valid queued request permanently invisible.
  if (!Object.keys(row).length) return null;
  const people = (value: unknown): ApprovalRoutePerson[] =>
    Array.isArray(value)
      ? value
          .map((item) => item as Record<string, unknown>)
          .map((item) => ({
            id: String(item.id ?? ""),
            name: String(item.name ?? item.id ?? ""),
            role: String(item.role ?? "staff"),
          }))
          .filter((item) => item.id)
      : [];
  const scope = String(row.ruleScopeType ?? "global");
  return {
    primaryRoles: asStrings(row.primaryRoles),
    primaryUserIds: asStrings(row.primaryUserIds),
    primaryApprovers: people(row.primaryApprovers),
    escalationAfterMinutes: numberOrNull(row.escalationAfterMinutes),
    escalationRoles: asStrings(row.escalationRoles),
    escalationApprovers: people(row.escalationApprovers),
    ruleScopeType: scope === "branch" || scope === "cluster" ? scope : "global",
    ruleScopeId: String(row.ruleScopeId ?? ""),
  };
}

/** A request may only be shown to people it was originally routed to. */
export function isRoutedApprover(
  request: Pick<AuthorizationRequest, "approvalRoute" | "createdAt">,
  who: { userId?: string | null },
  now = Date.now(),
): boolean {
  const route = request.approvalRoute;
  if (!route) return true; // Backward compatibility for requests created before route snapshots.
  const id = (who.userId ?? "").toLowerCase();
  if (!id) return false;
  if (route.primaryApprovers.some((person) => person.id.toLowerCase() === id)) return true;
  if (!route.escalationAfterMinutes) return false;
  const created = Date.parse(request.createdAt);
  return (
    Number.isFinite(created) &&
    now - created >= route.escalationAfterMinutes * 60_000 &&
    route.escalationApprovers.some((person) => person.id.toLowerCase() === id)
  );
}

/** An empty jsonb column means "no ticket was attached", not an empty ticket. */
function normalizeSnapshotRow(raw: unknown): TicketSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  if (Object.keys(raw as Record<string, unknown>).length === 0) return null;
  return normalizeSnapshot(raw);
}

/** The value that applies once a request is decided: the granted one wins. */
export const effectiveAmount = (r: AuthorizationRequest): number | null =>
  r.approvedAmount ?? r.requestedAmount;
