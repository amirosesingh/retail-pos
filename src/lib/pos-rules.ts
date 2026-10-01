/**
 * Database-backed POS operational rules.
 *
 * These are business security rules, so they are never persisted in
 * localStorage or sessionStorage. The browser only ever holds the copy it
 * fetched from the server for the current session, and every privileged
 * action is re-validated server-side before anything is written.
 */

export type PosRules = {
  /* A · shift & cash */
  block_shift_close_on_hold: boolean;
  require_daily_sales_for_shift_close: boolean;
  require_counted_cash_on_close: boolean;
  require_opening_float_count: boolean;
  enable_blind_cash_count: boolean;
  max_drawer_cash_limit: number;
  require_reason_for_payout: boolean;
  allow_multiple_shifts_per_terminal: boolean;
  /* A2 · shift close screen & X report */
  enable_cashier_x_report: boolean;
  show_opening_float_at_close: boolean;
  show_expected_totals_at_close: boolean;
  show_live_variance_at_close: boolean;
  show_itemized_tender_breakdown: boolean;
  require_manager_pin_on_variance: boolean;
  variance_pin_threshold: number;
  /* B · discount, pricing & overrides */
  max_cashier_discount_percent: number;
  max_cart_discount_amount: number;
  allow_discount_stacking: boolean;
  require_reason_for_price_override: boolean;
  prevent_below_cost_sale: boolean;
  allow_tax_exemption: boolean;
  /* C · inventory, orders & refunds */
  prevent_negative_stock_sale: boolean;
  require_receipt_for_refund: boolean;
  require_manager_pin_for_refund: boolean;
  max_refund_days_limit: number;
  track_item_voids: boolean;
  /* D · terminal security */
  auto_lock_timeout_seconds: number;
  require_manager_pin_for_cash_drawer_open: boolean;
  enable_manager_pin_audit_log: boolean;
  /* E · which actions need a manager PIN */
  require_pin_void_cart: boolean;
  require_pin_void_line: boolean;
  require_pin_reduce_qty: boolean;
  require_pin_manual_discount: boolean;
  require_pin_price_override: boolean;
  require_pin_stock_adjustment: boolean;
  require_pin_shift_close: boolean;
  require_pin_edit_tenders: boolean;
  require_pin_terminal_reset: boolean;
  /* F · what may be approved while the line is down */
  allow_offline_approvals: boolean;
  offline_approval_requires_pin: boolean;
  online_only_refund: boolean;
  online_only_void_cart: boolean;
  online_only_void_line: boolean;
  online_only_reduce_qty: boolean;
  online_only_manual_discount: boolean;
  online_only_price_override: boolean;
  online_only_stock_adjustment: boolean;
  online_only_shift_close: boolean;
  online_only_edit_tenders: boolean;
  online_only_terminal_reset: boolean;
};

export type PosRuleKey = keyof PosRules;

/** Shipped defaults — also the "most restrictive" set used while loading. */
export const DEFAULT_POS_RULES: PosRules = {
  block_shift_close_on_hold: true,
  require_daily_sales_for_shift_close: true,
  require_counted_cash_on_close: true,
  require_opening_float_count: true,
  enable_blind_cash_count: true,
  max_drawer_cash_limit: 1000,
  require_reason_for_payout: true,
  allow_multiple_shifts_per_terminal: false,
  enable_cashier_x_report: false,
  show_opening_float_at_close: true,
  show_expected_totals_at_close: false,
  show_live_variance_at_close: false,
  show_itemized_tender_breakdown: true,
  require_manager_pin_on_variance: true,
  variance_pin_threshold: 10,
  max_cashier_discount_percent: 10,
  max_cart_discount_amount: 100,
  allow_discount_stacking: false,
  require_reason_for_price_override: true,
  prevent_below_cost_sale: true,
  allow_tax_exemption: false,
  prevent_negative_stock_sale: false,
  require_receipt_for_refund: true,
  require_manager_pin_for_refund: true,
  max_refund_days_limit: 30,
  track_item_voids: true,
  auto_lock_timeout_seconds: 90,
  require_manager_pin_for_cash_drawer_open: true,
  enable_manager_pin_audit_log: true,
  require_pin_void_cart: true,
  require_pin_void_line: false,
  require_pin_reduce_qty: false,
  require_pin_manual_discount: true,
  require_pin_price_override: true,
  require_pin_stock_adjustment: true,
  require_pin_shift_close: false,
  require_pin_edit_tenders: false,
  require_pin_terminal_reset: true,
  allow_offline_approvals: true,
  offline_approval_requires_pin: true,
  online_only_refund: false,
  online_only_void_cart: false,
  online_only_void_line: false,
  online_only_reduce_qty: false,
  online_only_manual_discount: false,
  online_only_price_override: false,
  online_only_stock_adjustment: false,
  online_only_shift_close: false,
  online_only_edit_tenders: false,
  online_only_terminal_reset: false,
};

/** Coerce an untrusted payload (API row) into a complete rule set. */
export function normalizeRules(input: unknown): PosRules {
  const row = (input ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_POS_RULES };
  (Object.keys(DEFAULT_POS_RULES) as PosRuleKey[]).forEach((key) => {
    const raw = row[key];
    if (raw === undefined || raw === null) return;
    if (typeof DEFAULT_POS_RULES[key] === "boolean") {
      // Only a recognisable yes/no changes a gate. Anything else is junk and
      // must keep the shipped rule, so a bad row can never silently open one.
      const on = raw === true || raw === "true" || raw === 1 || raw === "1";
      const off = raw === false || raw === "false" || raw === 0 || raw === "0";
      if (on || off) (out as Record<string, unknown>)[key] = on;
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = n;
    }
  });
  return out;
}

export type RuleField = {
  key: PosRuleKey;
  label: string;
  blurb: string;
  kind: "switch" | "number";
};

export type RuleGroup = { id: string; label: string; blurb: string; fields: RuleField[] };

export const RULE_GROUPS: RuleGroup[] = [
  {
    id: "shift",
    label: "Shift & cash management",
    blurb: "How a till is opened, counted and handed back.",
    fields: [
      {
        key: "block_shift_close_on_hold",
        kind: "switch",
        label: "Block shift close on held bills",
        blurb: "The shift cannot be closed while tickets are parked.",
      },
      {
        key: "require_daily_sales_for_shift_close",
        kind: "switch",
        label: "Require closing cash count",
        blurb: "Counted cash must be declared before closing.",
      },
      {
        key: "require_counted_cash_on_close",
        kind: "switch",
        label: "Require counted cash before shift close",
        blurb: "The drawer amount must be typed in — an empty box blocks the close.",
      },
      {
        key: "require_opening_float_count",
        kind: "switch",
        label: "Require opening float count",
        blurb: "Cashier confirms the starting drawer balance.",
      },
      {
        key: "enable_blind_cash_count",
        kind: "switch",
        label: "Blind cash count",
        blurb: "Hide the expected drawer total while counting.",
      },
      {
        key: "max_drawer_cash_limit",
        kind: "number",
        label: "Max cash in drawer",
        blurb: "Prompts for a safe drop above this amount.",
      },
      {
        key: "require_reason_for_payout",
        kind: "switch",
        label: "Reason for pay-in / pay-out",
        blurb: "Petty cash movements need a reason code.",
      },
      {
        key: "allow_multiple_shifts_per_terminal",
        kind: "switch",
        label: "Allow multiple shifts per terminal",
        blurb: "Off means one open shift per till.",
      },
    ],
  },
  {
    id: "shift-close",
    label: "Shift close screen",
    blurb: "What the cashier sees while counting the drawer, and the mid-shift X report.",
    fields: [
      {
        key: "enable_cashier_x_report",
        kind: "switch",
        label: "Cashiers may print the X report",
        blurb: "Off means only supervisors and admins can take a mid-shift snapshot.",
      },
      {
        key: "show_opening_float_at_close",
        kind: "switch",
        label: "Show opening float at close",
        blurb: "Display the float the shift started with. It is read-only.",
      },
      {
        key: "show_expected_totals_at_close",
        kind: "switch",
        label: "Show expected totals at close",
        blurb: "Display the system-expected cash, card and mobile figures while counting.",
      },
      {
        key: "show_live_variance_at_close",
        kind: "switch",
        label: "Show live variance at close",
        blurb: "Update the shortage / overage as the count is typed.",
      },
      {
        key: "show_itemized_tender_breakdown",
        kind: "switch",
        label: "Itemised tender breakdown",
        blurb: "Show card, mobile and voucher lines instead of a single cash total.",
      },
      {
        key: "require_manager_pin_on_variance",
        kind: "switch",
        label: "Manager PIN on large variance",
        blurb:
          "A manager must approve the close when the count is off by more than the limit below.",
      },
      {
        key: "variance_pin_threshold",
        kind: "number",
        label: "Variance limit before manager PIN",
        blurb: "Absolute shortage or overage allowed without approval.",
      },
    ],
  },
  {
    id: "discount",
    label: "Discounts, pricing & overrides",
    blurb: "What a cashier may change without a manager.",
    fields: [
      {
        key: "max_cashier_discount_percent",
        kind: "number",
        label: "Max cashier discount (%)",
        blurb: "Above this a manager PIN is required.",
      },
      {
        key: "max_cart_discount_amount",
        kind: "number",
        label: "Max flat bill discount",
        blurb: "Above this a manager PIN is required.",
      },
      {
        key: "allow_discount_stacking",
        kind: "switch",
        label: "Allow discount stacking",
        blurb: "Line discounts together with bill coupons.",
      },
      {
        key: "require_reason_for_price_override",
        kind: "switch",
        label: "Reason for price override",
        blurb: "Manual price changes need a reason code.",
      },
      {
        key: "prevent_below_cost_sale",
        kind: "switch",
        label: "Prevent below-cost sale",
        blurb: "Selling under unit cost needs a manager.",
      },
      {
        key: "allow_tax_exemption",
        kind: "switch",
        label: "Allow tax exemption",
        blurb: "Needs a customer tax ID and manager approval.",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory, orders & refunds",
    blurb: "Stock guards and the returns policy.",
    fields: [
      {
        key: "prevent_negative_stock_sale",
        kind: "switch",
        label: "Prevent negative stock sale",
        blurb: "Block adding an out-of-stock item.",
      },
      {
        key: "require_receipt_for_refund",
        kind: "switch",
        label: "Require receipt for refund",
        blurb: "The original bill must be looked up.",
      },
      {
        key: "max_refund_days_limit",
        kind: "number",
        label: "Refund window (days)",
        blurb: "Older purchases cannot be refunded.",
      },
      {
        key: "track_item_voids",
        kind: "switch",
        label: "Track item voids",
        blurb: "Log line removals; manager PIN after 3.",
      },
    ],
  },
  {
    id: "terminal",
    label: "Terminal security & access",
    blurb: "Locking the screen and guarding the drawer.",
    fields: [
      {
        key: "enable_manager_pin_audit_log",
        kind: "switch",
        label: "Manager override audit log",
        blurb: "Record who approved what, and when.",
      },
    ],
  },
  {
    id: "pin-gates",
    label: "Manager PIN requirements",
    blurb:
      "Switch on the actions that need a manager's authorisation. Admins are never prompted — their approval is recorded automatically.",
    fields: [
      {
        key: "require_manager_pin_for_refund",
        kind: "switch",
        label: "Refunds",
        blurb: "Returning money to a customer.",
      },
      {
        key: "require_pin_void_cart",
        kind: "switch",
        label: "Void the whole cart",
        blurb: "Abandoning a ticket in progress.",
      },
      {
        key: "require_pin_void_line",
        kind: "switch",
        label: "Void / delete a line",
        blurb: "Removing an item already scanned.",
      },
      {
        key: "require_pin_reduce_qty",
        kind: "switch",
        label: "Reduce a quantity",
        blurb: "Lowering the count on a scanned line.",
      },
      {
        key: "require_pin_manual_discount",
        kind: "switch",
        label: "Manual discounts",
        blurb: "Any hand-typed line or bill discount.",
      },
      {
        key: "require_pin_price_override",
        kind: "switch",
        label: "Price override",
        blurb: "Typing a different price at the till.",
      },
      {
        key: "require_manager_pin_for_cash_drawer_open",
        kind: "switch",
        label: "No-sale drawer open",
        blurb: "Opening the drawer without a sale.",
      },
      {
        key: "require_pin_stock_adjustment",
        kind: "switch",
        label: "Stock adjustment",
        blurb: "Recounting or writing off stock.",
      },
      {
        key: "require_pin_shift_close",
        kind: "switch",
        label: "Close a shift",
        blurb: "Running the Z-report and handing back the till.",
      },
      {
        key: "require_pin_edit_tenders",
        kind: "switch",
        label: "Edit split payments",
        blurb: "Changing tenders on a bill.",
      },
      {
        key: "require_pin_terminal_reset",
        kind: "switch",
        label: "Unpair / reset a terminal",
        blurb: "Sending this machine back to the activation screen.",
      },
    ],
  },
  {
    id: "offline-approvals",
    label: "Approvals while offline",
    blurb:
      "What a manager may authorise at the till when the central system cannot be reached. Every offline approval is recorded and uploaded with everything else.",
    fields: [
      {
        key: "allow_offline_approvals",
        kind: "switch",
        label: "Allow approvals while offline",
        blurb: "Off means no approval can be given until the connection is back.",
      },
      {
        key: "offline_approval_requires_pin",
        kind: "switch",
        label: "Offline approval needs a manager PIN",
        blurb: "Off lets a recent approval on this till stand in for a fresh PIN.",
      },
      {
        key: "online_only_refund",
        kind: "switch",
        label: "Refunds need the central system",
        blurb: "Refund approvals are refused while offline.",
      },
      {
        key: "online_only_void_cart",
        kind: "switch",
        label: "Void the whole cart needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_void_line",
        kind: "switch",
        label: "Void a line needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_reduce_qty",
        kind: "switch",
        label: "Reduce a quantity needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_manual_discount",
        kind: "switch",
        label: "Manual discounts need the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_price_override",
        kind: "switch",
        label: "Price override needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_stock_adjustment",
        kind: "switch",
        label: "Stock adjustment needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_shift_close",
        kind: "switch",
        label: "Shift close needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_edit_tenders",
        kind: "switch",
        label: "Editing split payments needs the central system",
        blurb: "Refused while offline.",
      },
      {
        key: "online_only_terminal_reset",
        kind: "switch",
        label: "Terminal reset needs the central system",
        blurb: "Refused while offline.",
      },
    ],
  },
];

// --------------------------------------------------------------------------
// Named actions the till can ask authorisation for, and the toggle that
// decides whether a manager PIN is needed.
// --------------------------------------------------------------------------
export type GateAction =
  | "refund"
  | "void_cart"
  | "void_line"
  | "reduce_qty"
  | "manual_discount"
  | "discount_over_limit"
  | "price_override"
  | "no_sale_drawer"
  | "stock_adjustment"
  | "shift_close"
  | "edit_tenders"
  | "terminal_unpair";

export const GATE_RULE_KEY: Record<GateAction, PosRuleKey> = {
  refund: "require_manager_pin_for_refund",
  void_cart: "require_pin_void_cart",
  void_line: "require_pin_void_line",
  reduce_qty: "require_pin_reduce_qty",
  manual_discount: "require_pin_manual_discount",
  discount_over_limit: "require_pin_manual_discount",
  price_override: "require_pin_price_override",
  no_sale_drawer: "require_manager_pin_for_cash_drawer_open",
  stock_adjustment: "require_pin_stock_adjustment",
  shift_close: "require_pin_shift_close",
  edit_tenders: "require_pin_edit_tenders",
  terminal_unpair: "require_pin_terminal_reset",
};

/** Which rule says this action may only be approved with a live connection. */
export const GATE_ONLINE_ONLY_KEY: Record<GateAction, PosRuleKey> = {
  refund: "online_only_refund",
  void_cart: "online_only_void_cart",
  void_line: "online_only_void_line",
  reduce_qty: "online_only_reduce_qty",
  manual_discount: "online_only_manual_discount",
  discount_over_limit: "online_only_manual_discount",
  price_override: "online_only_price_override",
  no_sale_drawer: "online_only_void_cart",
  stock_adjustment: "online_only_stock_adjustment",
  shift_close: "online_only_shift_close",
  edit_tenders: "online_only_edit_tenders",
  terminal_unpair: "online_only_terminal_reset",
};

/**
 * What this till may do about an approval when the central system cannot be
 * reached: refuse it, accept a manager PIN checked against the credentials
 * already held on this device, or accept a recent approval on this till.
 */
export type OfflineApprovalMode = "refused" | "manager_pin" | "cached";

export function offlineApprovalMode(rules: PosRules, action: GateAction): OfflineApprovalMode {
  if (!rules.allow_offline_approvals) return "refused";
  if (rules[GATE_ONLINE_ONLY_KEY[action]]) return "refused";
  return rules.offline_approval_requires_pin ? "manager_pin" : "cached";
}

/** Does this action need a manager's PIN under the current branch rules? */
export const requiresManagerPin = (rules: PosRules, action: GateAction): boolean =>
  Boolean(rules[GATE_RULE_KEY[action]]);

/** Voided lines above this count in one ticket need a manager. */
export const VOID_PIN_THRESHOLD = 3;
