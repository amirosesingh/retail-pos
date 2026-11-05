/** Exact shared approval/policy functions; no native/browser I/O. */
export const DEFAULT_POS_RULES = {
    block_shift_close_on_hold: true,
    require_daily_sales_for_shift_close: true,
    require_counted_cash_on_close: true,
    require_opening_float_count: true,
    enable_blind_cash_count: true,
    max_drawer_cash_limit: 0,
    require_reason_for_payout: true,
    allow_multiple_shifts_per_terminal: false,
    allow_branch_shift_sharing: true,
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
export function normalizeRules(input) {
    const row = (input ?? {});
    const out = { ...DEFAULT_POS_RULES };
    Object.keys(DEFAULT_POS_RULES).forEach((key) => {
        const raw = row[key];
        if (raw === undefined || raw === null)
            return;
        if (typeof DEFAULT_POS_RULES[key] === "boolean") {
            // Only a recognisable yes/no changes a gate. Anything else is junk and
            // must keep the shipped rule, so a bad row can never silently open one.
            const on = raw === true || raw === "true" || raw === 1 || raw === "1";
            const off = raw === false || raw === "false" || raw === 0 || raw === "0";
            if (on || off)
                out[key] = on;
        }
        else {
            const n = Number(raw);
            if (Number.isFinite(n))
                out[key] = n;
        }
    });
    return out;
}
export const includedAuthorizationUserIds = (values) => values.filter((value) => value.trim() && !value.startsWith("!"));
export const excludedAuthorizationUserIds = (values) => values.filter((value) => value.startsWith("!")).map((value) => value.slice(1));
export const encodeAuthorizationUsers = (included, excluded) => [
    ...new Set(included.map((value) => value.trim()).filter(Boolean)),
    ...[...new Set(excluded.map((value) => value.trim()).filter(Boolean))].map((value) => `!${value}`),
];
const userIsExcluded = (values, userId) => excludedAuthorizationUserIds(values).some((value) => value.toLowerCase() === userId);
export const defaultRule = (actionKey) => ({
    id: "",
    actionKey,
    scopeType: "global",
    scopeId: "",
    mode: actionKey === "sponsorship" || actionKey === "cross_group_transfer_approval" ? "request" : "none",
    allowedRoles: actionKey === "sponsorship" ? ["admin"] : ["admin", "manager"],
    allowedUserIds: [],
    requesterRoles: actionKey === "sponsorship" ? ["cashier", "staff", "manager", "admin", "warehouse"] : ["cashier", "staff", "manager", "admin"],
    requesterUserIds: [],
    authorityLimits: {},
    extraAuthority: {},
    absoluteCeilings: {},
    approvalTimeoutMinutes: 15,
    escalationAfterMinutes: null,
    escalationRoles: [],
    requireReason: actionKey === "sponsorship",
    threshold: null,
    isEnabled: true,
    rowVersion: 0,
    updatedAt: null,
    updatedBy: null,
});
const parsedJson = (raw) => {
    if (typeof raw !== "string")
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
};
const asStrings = (raw) => {
    const value = parsedJson(raw);
    return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
};
const asMode = (raw) => raw === "pin" || raw === "request" || raw === "either" ? raw : "none";
const asLimits = (raw) => {
    raw = parsedJson(raw);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    return Object.fromEntries(Object.entries(raw)
        .map(([key, value]) => [key.toLowerCase(), Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value >= 0));
};
export function normalizeRule(input) {
    const row = (input ?? {});
    const field = (databaseName, applicationName) => row[databaseName] ?? row[applicationName];
    const key = String(field("action_key", "actionKey") ?? "");
    const base = defaultRule(key);
    const scope = String(field("scope_type", "scopeType") ?? "global");
    const threshold = row["threshold"];
    return {
        ...base,
        id: String(row["id"] ?? ""),
        scopeType: scope === "branch" || scope === "cluster" ? scope : "global",
        scopeId: String(field("scope_id", "scopeId") ?? ""),
        mode: asMode(row["mode"]),
        // An empty saved audience means named people only, not the default roles.
        // Defaults apply only to legacy rows that do not contain this field.
        allowedRoles: field("allowed_roles", "allowedRoles") == null
            ? base.allowedRoles
            : asStrings(field("allowed_roles", "allowedRoles")),
        allowedUserIds: asStrings(field("allowed_user_ids", "allowedUserIds")),
        requesterRoles: field("requester_roles", "requesterRoles") == null
            ? base.requesterRoles
            : asStrings(field("requester_roles", "requesterRoles")),
        requesterUserIds: asStrings(field("requester_user_ids", "requesterUserIds")),
        authorityLimits: asLimits(field("authority_limits", "authorityLimits")),
        extraAuthority: asLimits(field("extra_authority", "extraAuthority")),
        absoluteCeilings: asLimits(field("absolute_ceilings", "absoluteCeilings")),
        approvalTimeoutMinutes: Math.min(1440, Math.max(1, Number(field("approval_timeout_minutes", "approvalTimeoutMinutes")) || 15)),
        escalationAfterMinutes: field("escalation_after_minutes", "escalationAfterMinutes") == null
            ? null
            : Math.min(1440, Math.max(1, Number(field("escalation_after_minutes", "escalationAfterMinutes")) || 1)),
        escalationRoles: asStrings(field("escalation_roles", "escalationRoles")),
        requireReason: field("require_reason", "requireReason") === true,
        threshold: threshold === null || threshold === undefined ? null : Number(threshold),
        isEnabled: field("is_enabled", "isEnabled") !== false,
        rowVersion: Math.max(0, Number(field("row_version", "rowVersion") ?? 0) || 0),
        updatedAt: field("updated_at", "updatedAt") == null ? null : String(field("updated_at", "updatedAt")),
        updatedBy: field("updated_by", "updatedBy") == null ? null : String(field("updated_by", "updatedBy")),
    };
}
export const authorizationRole = (role) => {
    const value = (role ?? "").trim().toLowerCase();
    return value === "supervisor" ? "manager" : value;
};
export function canAuthorize(rule, who) {
    if (!rule)
        return false;
    const id = (who.userId ?? "").toLowerCase();
    if (id && userIsExcluded(rule.allowedUserIds, id))
        return false;
    const role = authorizationRole(who.role);
    if (role && rule.allowedRoles.map(authorizationRole).includes(role))
        return true;
    return (!!id && includedAuthorizationUserIds(rule.allowedUserIds).some((u) => u.toLowerCase() === id));
}
function authorityValue(map, who) {
    const userKey = `user:${(who.userId ?? "").toLowerCase()}`;
    if (map[userKey] != null)
        return map[userKey];
    const exactKey = `role:${(who.role ?? "").trim().toLowerCase()}`;
    if (map[exactKey] != null)
        return map[exactKey];
    const role = authorizationRole(who.role);
    const limits = Object.entries(map).filter(([key]) => key.startsWith("role:") &&
        authorizationRole(key.slice(5)) === role).map(([, value]) => value);
    // Preserve an explicit saved role limit; only fill a missing alias.
    return limits.length ? Math.min(...limits) : null;
}
export function approvalAuthority(rule, who) {
    if (!rule)
        return null;
    return authorityValue(rule.authorityLimits, who);
}
export function effectiveApprovalAuthority(rule, who, directLimit) {
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
export function requiresAuthorizationAmount(action) {
    return ["manual_discount", "discount_over_limit", "price_override", "refund", "stock_transfer", "sponsorship"].includes(action);
}
function amountWithinAuthority(action, amount, limit) {
    if (amount == null)
        return !requiresAuthorizationAmount(action);
    return Number.isFinite(amount) && amount >= 0 && (limit === null || amount <= limit);
}
export function canAuthorizeAmount(rule, who, amount, directLimit) {
    if (!canAuthorize(rule, who))
        return false;
    const limit = effectiveApprovalAuthority(rule, who, directLimit).effectiveMaximum;
    return amountWithinAuthority(rule?.actionKey ?? "", amount, limit);
}
export function ticketDiscounts(payload, field = "requested_discounts") {
    if (typeof payload[field] !== "string")
        return [];
    try {
        const values = JSON.parse(payload[field]);
        if (!Array.isArray(values) || values.length > 201)
            return [];
        const valid = values.every((entry) => entry && Number.isInteger(entry.index) && entry.index >= -1 &&
            typeof entry.productId === "string" && typeof entry.name === "string" &&
            [entry.qty, entry.price, entry.value, entry.base].every(Number.isFinite) &&
            entry.value >= 0 && entry.base >= 0 && ["percent", "amount"].includes(entry.type) &&
            entry.value <= (entry.type === "percent" ? 100 : entry.base) &&
            typeof entry.requiresApproval === "boolean");
        return valid && new Set(values.map(entry => entry.index)).size === values.length ? values : [];
    }
    catch {
        return [];
    }
}
export function discountApprovalPercent(entry) {
    return entry.type === "percent" ? entry.value : entry.base > 0 ? entry.value / entry.base * 100 : 0;
}
export function ticketDiscountApprovalPercent(entries, requestedEntries = entries) {
    const bill = entries.find(entry => entry.index === -1);
    const itemAmount = (entry) => (entry.type === "percent" ? entry.base * entry.value / 100 : entry.value) * Math.abs(entry.qty);
    // Reducing an item discount increases the balance on which a bill amount is
    // applied. Use that new balance when checking the approver's authority.
    const restoredBase = requestedEntries.filter(entry => entry.index >= 0).reduce((sum, entry) => {
        const approved = entries.find(candidate => candidate.index === entry.index);
        return sum + itemAmount(entry) - (approved ? itemAmount(approved) : 0);
    }, 0);
    const billPercent = bill ? discountApprovalPercent({ ...bill, base: Math.max(0, bill.base + restoredBase) }) : 0;
    return Math.max(0, billPercent, ...entries.filter(entry => entry.index >= 0).map(entry => {
        const itemPercent = discountApprovalPercent(entry);
        return itemPercent + (100 - itemPercent) * billPercent / 100;
    }));
}
