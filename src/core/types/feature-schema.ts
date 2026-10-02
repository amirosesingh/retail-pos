/**
 * Live schema & feature health probe.
 *
 * Nothing here is judged from the `.sql` files in the repo. Every feature
 * declares the exact columns its screens read and the exact columns its saves
 * send, and this runs those shapes against the live database:
 *
 *  - reads  → a zero-row select of those exact columns, so a missing table or
 *             a renamed column comes back as the database's own error;
 *  - writes → a harmless update carrying the same column set with a filter
 *             that matches no row, so the columns and the access rules are
 *             validated without ever changing a record;
 *  - shape  → the published table definition is compared against the payload
 *             to spot required fields the till never sends.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { checkFunction, type FunctionShapes } from "@/lib/health-function-metadata";
import { explainError } from "@/lib/db-health";
import { relayTableShapes } from "@/core/api/health-relay";


export type OpKind = "read" | "write";

/**
 * Where this data is meant to travel.
 *
 * `push` — made at the till, owed to head office. `pull` — owned centrally,
 * needed at the till. `both` — either side may change it. `cloud-only` — the
 * till reads it online and never keeps a copy.
 */
export type SyncDirection = "push" | "pull" | "both" | "cloud-only";

/** How badly a loss of this data hurts, in plain terms. */
export type SecurityClass = "financial" | "governance" | "operational" | "reference";

export type FeatureOp = {
  /** What this call does, in shop language. */
  label: string;
  table: string;
  kind: OpKind;
  /** Exact columns the query selects or the payload sends. */
  columns: string[];
  /** Column used to match nothing on a write probe. */
  pk?: string;
  /** Where the real call lives. */
  source: string;
  /** Part of a larger payload — do not chase required fields on this one. */
  partial?: boolean;
  /** Declared sync intent; checked against what the till actually does. */
  syncDirection?: SyncDirection;
  /** Must come back on a rebuilt terminal. */
  restoreRequired?: boolean;
  /** What kind of data this is, for the coverage report. */
  securityClass?: SecurityClass;
};

export type FeatureDef = {
  id: string;
  name: string;
  ops: FeatureOp[];
};

export type OpResult = FeatureOp & {
  ok: boolean;
  detail: string;
  /** Columns the live table does not have. */
  missing: string[];
  /** Required columns the payload never sends. */
  unmet: string[];
};

export type FeatureResult = {
  id: string;
  name: string;
  status: "healthy" | "fix-required" | "skipped";
  ops: OpResult[];
};

export type FeatureSchemaReport = {
  at: string;
  features: FeatureResult[];
  error: string | null;
};

/* ------------------------------------------------------------------ */
/* What each feature actually sends                                    */
/* ------------------------------------------------------------------ */

export const FEATURES: FeatureDef[] = [
  {
    id: "sales",
    name: "Direct sales & checkout",
    ops: [
      {
        label: "Bill header saved at checkout",
        table: "sales",
        kind: "write",
        source: "src/lib/pos-db.ts:560 (saleToRow)",
        columns: [
          "bill_number", "client_transaction_id", "member_id", "store_id", "shift_id",
          "cashier_name", "subtotal_amount", "total_amount", "discount_amount", "tax_amount",
          "payment_type", "payments", "points_earned", "points_redeemed", "is_exchange",
          "original_bill_number", "exchange_credit", "paid_amount", "change_amount",
          "is_refunded", "coupon_code", "coupon_promo_id", "coupon_scope", "coupon_discount",
          "created_at",
        ],
      },
      {
        label: "Line items, discounts and tax",
        table: "sale_items",
        kind: "write",
        source: "src/lib/pos-db.ts:589 (saleItemRows)",
        columns: [
          "sale_id", "product_id", "product_name", "variant_code", "unit_price", "unit_cost", "quantity",
          "discount_percent", "discount_amount", "tax_rate", "is_return", "is_foc",
          "promo_id", "coupon_code", "coupon_discount",
        ],
      },
      {
        label: "Split tenders ledger",
        table: "payment_transactions",
        kind: "write",
        source: "src/lib/pos-db.ts:611 (salePaymentRows)",
        columns: [
          "source_type", "sale_id", "member_id", "store_id", "shift_id", "amount", "method",
          "kind", "reference", "cashier_name", "note", "paid_at", "status", "metadata",
        ],
      },
      {
        label: "Receipt history read",
        table: "sales",
        kind: "read",
        source: "src/lib/pos-db.ts:492 (saleColumns)",
        columns: [
          "id", "bill_number", "store_id", "shift_id", "cashier_name", "member_id",
          "subtotal_amount", "total_amount", "discount_amount", "tax_amount", "payment_type",
          "payments", "points_earned", "is_refunded", "original_bill_number",
          "exchanged_to_bill_number", "created_at",
        ],
      },
      {
        label: "Item movement written per sold, received or transferred line",
        table: "item_activity_logs",
        kind: "write",
        source:
          "src/lib/pos-db.ts (saleActivityRows, receivingActivityRows) + stock_transfer_dispatch / stock_transfer_receive",
        columns: [
          "product_id", "product_name", "store_id", "activity_type", "reference",
          "quantity_delta", "unit_cost", "staff_name", "note", "created_at",
        ],
      },

    ],
  },
  {
    id: "transfers",
    name: "Stock transfers & adjustments",
    ops: [
      {
        label: "Transfer note raised",
        table: "stock_transfers",
        kind: "write",
        source: "src/lib/stock-transfers.ts:109 (saveTransfer)",
        columns: [
          "ref", "kind", "transfer_scope", "from_store_id", "from_store_name", "from_group_id",
          "to_store_id", "to_store_name", "to_group_id", "status", "note", "created_by",
          "approved_by", "approved_at", "received_by", "received_at", "rejected_reason",
          "verified_by", "verified_at", "posted_at", "discrepancy_reason",
        ],
      },
      {
        label: "Transfer lines",
        table: "stock_transfer_items",
        kind: "write",
        source: "src/lib/stock-transfers.ts:123 (saveTransfer lines)",
        columns: [
          "transfer_id", "product_id", "barcode", "sku", "product_name", "quantity",
          "quantity_approved", "quantity_dispatched", "quantity_received", "quantity_verified",
          "unit_cost",
        ],
      },
      {
        label: "Approval records the allowed quantity per line",
        table: "rpc:stock_transfer_approve",
        kind: "write",
        source: "src/lib/stock-transfers.ts (approveTransferInDb)",
        columns: ["p_transfer_id", "p_approved_by", "p_lines"],
      },
      {
        label: "Dispatch takes stock out and closes the request on what was sent",
        table: "rpc:stock_transfer_dispatch",
        kind: "write",
        source: "src/lib/stock-transfers.ts (dispatchTransferInDb)",
        columns: ["p_transfer_id", "p_dispatched_by", "p_lines"],
      },
      {
        label: "Arrival is recorded without moving stock",
        table: "rpc:stock_transfer_receive",
        kind: "write",
        source: "src/lib/stock-transfers.ts (receiveTransferInDb)",
        columns: ["p_transfer_id", "p_received_by", "p_lines"],
      },
      {
        label: "Physical verification posts the counted quantity to the shelf",
        table: "rpc:stock_transfer_verify",
        kind: "write",
        source: "src/lib/stock-transfers.ts (verifyTransferInDb)",
        columns: ["p_transfer_id", "p_verified_by", "p_lines", "p_reason"],
      },
      {
        label: "Manual stock adjustment",
        table: "stock_adjustments",
        kind: "write",
        source: "src/lib/pos-db.ts:1858 (recordStockAdjustment)",
        columns: [
          "product_id", "product_name", "sku", "barcode", "store_id", "terminal_id", "reason",
          "note", "previous_stock", "updated_stock", "delta", "cost_impact", "staff_id",
          "staff_name", "role",
        ],
      },
      {
        label: "Warehouse allocation on the product row",
        table: "products",
        kind: "read",
        source: "src/lib/pos-db.ts (productToRow / stock_by_store)",
        columns: ["id", "sku", "barcode", "name", "stock_quantity", "stock_by_store", "is_archived"],
      },
    ],
  },
  {
    id: "venue-bookings",
    name: "Table & venue bookings",
    ops: [
      {
        label: "Booking saved (slot, resource, deposit)",
        table: "bookings",
        kind: "write",
        source: "src/lib/bookings-db.ts:15 (toRow)",
        columns: [
          "ref", "store_id", "shift_id", "customer_name", "customer_phone", "member_id",
          "service_type_id", "service_name", "service_fee", "payment_timing", "lines",
          "subtotal", "discount", "tax", "total", "paid", "due_date", "note", "cashier",
          "status", "sale_receipt_no", "closed_at", "charges", "tag_id",
        ],
      },
      {
        label: "Deposit / part payment",
        table: "booking_payments",
        kind: "write",
        source: "src/lib/bookings-db.ts:121 (paymentRows)",
        columns: ["booking_id", "amount", "method", "cashier", "paid_at"],
      },
      {
        label: "Diary read for slot availability",
        table: "bookings",
        kind: "read",
        source: "src/lib/bookings-db.ts:180 (loadBookings)",
        columns: [
          "id", "ref", "store_id", "status", "due_date", "promised_at", "dropped_off_at",
          "service_name", "total", "paid", "created_at",
        ],
      },
    ],
  },
  {
    id: "ticket-bookings",
    name: "Ticket & event bookings",
    ops: [
      {
        label: "Job / ticket card written",
        table: "bookings",
        kind: "write",
        source: "src/lib/bookings-db.ts:15 (racket & ticket fields)",
        partial: true,
        columns: [
          "job_status", "job_status_by", "job_status_at", "racket_model", "string_type",
          "tension_main", "tension_cross", "tension_unit", "grommet_notes", "job_notes",
          "dropped_off_at", "promised_at", "notify_whatsapp", "intake_note", "string_origin",
          "string_source_product_id", "grip_product_id", "technician", "liability_accepted",
          "incident_note",
        ],
      },
      {
        label: "Ticket tiers / campaign the voucher belongs to",
        table: "coupon_campaigns",
        kind: "read",
        source: "src/lib/coupons.ts:198 (loadCampaigns)",
        columns: [
          "id", "name", "slug", "discount_type", "discount_value", "scope", "scope_value",
          "max_claims", "max_per_member", "claims_count", "starts_at", "expires_at",
          "is_active", "is_welcome",
        ],
      },
      {
        label: "Issued ticket / voucher with its barcode token",
        table: "issued_vouchers",
        kind: "read",
        source: "src/lib/coupons.ts:244 (loadVouchers)",
        columns: [
          "id", "token_slug", "campaign_id", "member_id", "status", "issued_at", "expires_at",
          "issued_by", "issued_source", "redeemed_at", "redeemed_by", "redeemed_sale_id",
          "store_id",
        ],
      },
      {
        label: "Redeem a ticket at the till",
        table: "rpc:voucher_redeem",
        kind: "write",
        source: "src/lib/coupons.ts (voucher_redeem)",
        columns: ["_token", "_sale_id", "_store_id", "_staff"],
      },
    ],
  },
  {
    id: "membership",
    name: "Customers & membership sync",
    ops: [
      {
        label: "Member saved with points and spend",
        table: "members",
        kind: "write",
        source: "src/lib/pos-db.ts:219 (memberToRow)",
        columns: [
          "member_code", "full_name", "phone", "email", "address", "date_of_birth", "tier_id",
          "loyalty_points", "total_spent",
        ],
      },
      {
        label: "Tier rules for upgrades",
        table: "membership_tiers",
        kind: "read",
        source: "src/lib/pos-db.ts (tier cache)",
        columns: ["id", "name", "discount_percentage", "points_multiplier"],
      },
      {
        label: "Member's live vouchers in the register",
        table: "issued_vouchers",
        kind: "read",
        source: "src/lib/coupons.ts:291 (loadMemberVouchers)",
        columns: ["id", "token_slug", "campaign_id", "member_id", "status"],
      },
    ],
  },
  {
    id: "inventory",
    name: "Inventory & item activity",
    ops: [
      {
        label: "Product saved from the catalogue",
        table: "products",
        kind: "write",
        source: "src/lib/pos-db.ts (productToRow)",
        columns: [
          "barcode", "name", "sku", "category", "sub_category", "product_group", "brand", "unit",
          "cost_price", "selling_price", "ecom_price", "ecom_visible", "stock_quantity",
          "stock_by_store", "reorder_level", "tax_rate", "custom_points", "point_multiplier",
          "packs", "barcode_aliases", "barcode_variants", "is_archived", "archived_at",
        ],
      },
      {
        label: "Extra barcodes and pack sizes",
        table: "product_barcodes",
        kind: "write",
        source: "src/lib/pos-db.ts (product barcode rows)",
        columns: ["product_id", "barcode", "label", "pack_size", "is_primary"],
      },
      {
        label: "Category tree read",
        table: "product_categories",
        kind: "read",
        source: "src/lib/taxonomy.ts (loadCategories)",
        columns: ["id", "name", "parent_id", "kind", "sort"],
      },
      {
        label: "Item history drawer",
        table: "item_activity_logs",
        kind: "read",
        source: "src/components/pos/ItemActivityDrawer.tsx",
        columns: [
          "id", "product_id", "product_name", "sku", "store_id", "activity_type", "reference",
          "quantity_delta", "stock_before", "stock_after", "unit_cost", "staff_name", "note",
          "created_at",
        ],
      },
    ],
  },
  {
    id: "purchasing",
    name: "Purchasing & suppliers",
    ops: [
      {
        label: "Purchase order header saved",
        table: "purchase_orders",
        kind: "write",
        source: "src/routes/purchasing.tsx (savePurchaseOrder)",
        columns: [
          "po_number", "supplier_id", "supplier_name", "operator_name", "store_id", "store_code",
          "invoice_date", "invoice_entry_date", "total_cost", "total_items_count",
        ],
      },
      {
        label: "Purchase order lines",
        table: "purchase_order_items",
        kind: "write",
        source: "src/routes/purchasing.tsx (line rows)",
        columns: [
          "po_id", "product_id", "barcode", "sku", "product_name", "cost_price", "selling_price",
          "quantity_received", "subtotal_cost",
        ],
      },
      {
        label: "Supplier book",
        table: "suppliers",
        kind: "write",
        source: "src/routes/suppliers.tsx (saveSupplier)",
        columns: [
          "name", "contact_name", "phone", "email", "address", "tax_number", "notes", "is_active",
        ],
      },
    ],
  },
  {
    id: "shifts",
    name: "Shifts & cash-up",
    ops: [
      {
        label: "Shift opened / closed",
        table: "shifts",
        kind: "write",
        source: "src/lib/pos-db.ts (shiftToRow)",
        columns: [
          "store_id", "terminal_id", "terminal_name", "opened_by_name", "opened_by_staff_id",
          "opened_by_role", "closed_by_name", "closed_by_staff_id", "closed_by_role", "opened_at",
          "closed_at", "opening_float", "closing_float", "counted_cash", "expected_cash", "note",
          "overdue", "status",
        ],
      },
      {
        label: "Mid-shift staff sign-ins",
        table: "shift_sessions",
        kind: "write",
        source: "src/lib/pos-db.ts (shiftSessionToRow)",
        columns: [
          "shift_id", "store_id", "terminal_id", "terminal_name", "staff_id", "staff_name", "role",
          "signed_in_at", "signed_out_at",
        ],
      },
      {
        label: "Cash drawer opens",
        table: "drawer_events",
        kind: "write",
        source: "src/lib/drawer.ts (recordDrawerEvent)",
        columns: [
          "store_id", "terminal_id", "shift_id", "staff_id", "staff_name", "role", "reason",
          "note", "approved_by",
        ],
      },
    ],
  },
  {
    id: "held-audit",
    name: "Held orders & audit trail",
    ops: [
      {
        label: "Ticket parked at the till",
        table: "held_orders",
        kind: "write",
        source: "src/lib/held-orders.ts (saveHold)",
        pk: "id",
        columns: [
          "label", "store_id", "shift_id", "held_by", "total", "lines", "cart_discount",
          "cart_discount_type", "exchange_ref", "member_id", "member_name", "coupon", "note",
          "cancelled_from", "held_at",
        ],
      },
      {
        label: "Activity feed entries",
        table: "activity_events",
        kind: "read",
        source: "src/components/pos/ActivityBell.tsx",
        columns: [
          "id", "event_type", "severity", "title", "message", "actor_name", "terminal_name",
          "store_id", "amount", "created_at",
        ],
      },
      {
        label: "Human-readable audit log",
        table: "audit_logs",
        kind: "read",
        source: "src/routes/audit.tsx",
        columns: [
          "id", "user_name", "action_category", "action_name", "target_module", "details",
          "store_id", "created_at",
        ],
      },
    ],
  },
  {
    id: "status-history",
    name: "Status history",
    ops: [
      {
        label: "State change recorded",
        table: "entity_status_history",
        kind: "write",
        source: "src/lib/status-history.ts (recordTransition)",
        pk: "id",
        columns: [
          "entity_type", "entity_id", "status_kind", "previous_status", "new_status", "reason",
          "actor_id", "actor_name", "actor_role", "store_id", "branch_id", "terminal_id",
          "related_entity_type", "related_entity_id", "metadata", "client_event_id",
          "occurred_at",
        ],
      },
      {
        label: "Timeline of one record",
        table: "entity_status_history",
        kind: "read",
        source: "src/lib/status-history.server.ts (readStatusHistory)",
        columns: [
          "entity_type", "entity_id", "status_kind", "previous_status", "new_status", "reason",
          "actor_name", "actor_role", "occurred_at",
        ],
      },
    ],
  },
  {
    id: "coupons",
    name: "Coupons & promotions",
    ops: [
      {
        label: "Campaign saved",
        table: "coupon_campaigns",
        kind: "write",
        source: "src/lib/coupons.ts (saveCampaign)",
        columns: [
          "name", "slug", "discount_type", "discount_value", "scope", "scope_value", "max_claims",
          "max_per_member", "claims_count", "starts_at", "expires_at", "is_active", "is_welcome",
        ],
      },
      {
        label: "Promotion rules read by the cart",
        table: "promotions",
        kind: "read",
        source: "src/lib/pos-promotions.ts",
        columns: [
          "id", "title", "promo_type", "min_spend", "discount_percent", "discount_amount",
          "foc_product_id", "points_per_dollar", "tier_rates", "is_active", "start_date", "end_date",
        ],
      },
      {
        label: "Coupon audit trail",
        table: "coupon_events",
        kind: "read",
        source: "src/components/pos/CouponAuditLog.tsx",
        columns: [
          "id", "event_type", "campaign_id", "campaign_name", "voucher_token", "member_id",
          "store_id", "staff_name", "sale_id", "created_at",
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Probe                                                               */
/* ------------------------------------------------------------------ */

const NO_ROW = "00000000-0000-0000-0000-000000000000";

type Loose = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: any }>;
};
const sb = () => supabaseExternal as unknown as Loose;

/** Column names PostgREST names in its error text, e.g. 'event_id'. */
function namedColumn(message: string): string | null {
  const m =
    /column ["']?([a-z0-9_.]+)["']? does not exist/i.exec(message) ??
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i.exec(message);
  return m?.[1]?.split(".").pop() ?? null;
}

type TableShape = { columns: Set<string>; required: Set<string> };

/** Plain lists from the server relay turned into the sets used below. */
function toShapes(
  tables: Record<string, { columns: string[]; required: string[] }>,
): Record<string, TableShape> {
  const out: Record<string, TableShape> = {};
  for (const [table, def] of Object.entries(tables)) {
    out[table] = { columns: new Set(def.columns), required: new Set(def.required) };
  }
  return out;
}

/**
 * Published table definitions straight from the live Data API — no repo file
 * is consulted. Used to name every gap at once instead of one error per run.
 */
async function loadShapes() {
  const metadata = await relayTableShapes();
  if (!metadata.ok) throw new Error(metadata.error);
  return { tables: toShapes(metadata.tables), functions: metadata.functions };
}

async function probeOp(
  op: FeatureOp,
  shapes: Record<string, TableShape>,
  functions: FunctionShapes,
  directAccess: boolean,
): Promise<OpResult> {
  const base: OpResult = { ...op, ok: true, detail: "", missing: [], unmet: [] };

  if (op.table.startsWith("rpc:")) {
    return { ...base, ...checkFunction(functions, op.table.slice(4), op.columns) };
  }

  const shape = shapes[op.table];
  if (!shape) {
    return {
      ...base,
      ok: false,
      detail: `Missing table '${op.table}' — the live database does not publish it`,
      missing: op.columns,
    };
  }

  const missing = op.columns.filter((c) => !shape.columns.has(c));
  if (missing.length) {
    return {
      ...base,
      ok: false,
      missing,
      detail: missing
        .map((c) => `Missing column '${c}' on table '${op.table}'`)
        .join("; "),
    };
  }

  if (op.kind === "read") {
    if (!directAccess)
      return { ...base, detail: `${op.columns.length} columns verified through the protected metadata relay` };
    const { error } = await sb()
      .from(op.table)
      .select(op.columns.join(","), { count: "exact", head: true });
    if (error) {
      const col = namedColumn(error.message ?? "");
      return {
        ...base,
        ok: false,
        missing: col ? [col] : [],
        detail: col
          ? `Missing column '${col}' on table '${op.table}'`
          : explainError(error),
      };
    }
    return { ...base, detail: `${op.columns.length} columns read cleanly` };
  }

  // Required fields the payload never sends — a save would trip the
  // "null value violates non-null constraint" rule the first time it runs.
  const unmet = (op.partial ? [] : [...shape.required]).filter(
    (c) => !op.columns.includes(c) && !["id", "created_at", "updated_at", "row_version"].includes(c),
  );

  const payload: Record<string, unknown> = {};
  for (const c of op.columns) payload[c] = null;
  if (!directAccess) {
    return {
      ...base,
      ok: unmet.length === 0,
      unmet,
      detail: unmet.length
        ? `Payload never sends required field${unmet.length === 1 ? "" : "s"}: ${unmet.join(", ")}`
        : `${op.columns.length} columns verified through the protected metadata relay`,
    };
  }
  const { error } = await sb().from(op.table).update(payload).eq(op.pk ?? "id", NO_ROW);
  if (error) {
    const col = namedColumn(error.message ?? "");
    return {
      ...base,
      ok: false,
      unmet,
      missing: col ? [col] : [],
      detail: col
        ? `Missing column '${col}' on table '${op.table}'`
        : explainError(error),
    };
  }
  return {
    ...base,
    ok: unmet.length === 0,
    unmet,
    detail: unmet.length
      ? `Payload never sends required field${unmet.length === 1 ? "" : "s"}: ${unmet.join(", ")}`
      : `${op.columns.length} columns accepted`,
  };
}

/** Run every feature's real query shapes against the live database. */
export async function runFeatureSchemaAudit(): Promise<FeatureSchemaReport> {
  let metadata: Awaited<ReturnType<typeof loadShapes>>;
  try {
    metadata = await loadShapes();
  } catch (e) {
    return {
      at: new Date().toISOString(),
      features: FEATURES.map((f) => ({
        id: f.id,
        name: f.name,
        status: "skipped" as const,
        ops: f.ops.map((o) => ({ ...o, ok: false, detail: "Not checked", missing: [], unmet: [] })),
      })),
      error: (e as Error).message,
    };
  }

  const directAccess = !!(await supabaseExternal.auth.getSession()).data.session;
  const features: FeatureResult[] = [];
  for (const feature of FEATURES) {
    const ops: OpResult[] = [];
    for (const op of feature.ops) {
      try {
        ops.push(await probeOp(op, metadata.tables, metadata.functions, directAccess));
      } catch (e) {
        ops.push({ ...op, ok: false, detail: (e as Error).message, missing: [], unmet: [] });
      }
    }
    features.push({
      id: feature.id,
      name: feature.name,
      status: ops.every((o) => o.ok) ? "healthy" : "fix-required",
      ops,
    });
  }
  return { at: new Date().toISOString(), features, error: null };
}

/** Plain text, for pasting into a support message. */
export function formatFeatureSchemaReport(report: FeatureSchemaReport): string {
  const lines = [`Feature & schema health — ${new Date(report.at).toLocaleString()}`, ""];
  if (report.error) lines.push(`Not checked: ${report.error}`, "");
  for (const f of report.features) {
    lines.push(`${f.status === "healthy" ? "[HEALTHY]" : "[SCHEMA FIX REQUIRED]"} ${f.name}`);
    for (const op of f.ops) {
      lines.push(`   ${op.ok ? "ok  " : "FAIL"} ${op.label} — ${op.table} — ${op.detail}`);
      lines.push(`        ${op.source}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
