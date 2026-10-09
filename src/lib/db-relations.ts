/**
 * Relational health of the operational tables.
 *
 * Only trading data is inspected — sales, bookings, catalogue, members,
 * purchasing, stock and coupons. Sign-in tables (staff accounts, roles,
 * sessions, PIN throttling, terminal tokens) are deliberately excluded so this
 * screen never reads or displays identity data.
 *
 * The database does the work in `operational_relational_health()`: it reads the
 * declared foreign keys and counts child rows whose parent no longer exists.
 * Nothing is written.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { relayRelationalHealth } from "@/core/api/health-relay";

/** Never inspected here, whatever the database contains. */
export const IDENTITY_TABLES = [
  "app_users",
  "user_roles",
  "staff_roles",
  "cashiers",
  "pin_attempts",
  "terminal_tokens",
  "shift_sessions",
  "secure_settings",
  "security_findings",
] as const;

/** The links the POS is designed around — used to spot a missing relation. */
export const EXPECTED_RELATIONS: Record<
  string,
  { column: string; parent: string; label: string }[]
> = {
  sales: [{ column: "member_id", parent: "members", label: "Sale → member" }],
  sale_items: [
    { column: "sale_id", parent: "sales", label: "Sale line → sale" },
    { column: "product_id", parent: "products", label: "Sale line → product" },
  ],
  bookings: [{ column: "member_id", parent: "members", label: "Booking → member" }],
  booking_payments: [{ column: "booking_id", parent: "bookings", label: "Payment → booking" }],
  payment_transactions: [
    { column: "sale_id", parent: "sales", label: "Payment → sale" },
    { column: "booking_id", parent: "bookings", label: "Payment → booking" },
    { column: "member_id", parent: "members", label: "Payment → member" },
  ],
  products: [],
  product_barcodes: [{ column: "product_id", parent: "products", label: "Barcode → product" }],
  product_categories: [
    { column: "parent_id", parent: "product_categories", label: "Category → parent" },
  ],
  members: [{ column: "tier_id", parent: "membership_tiers", label: "Member → tier" }],
  membership_tiers: [],
  purchase_orders: [
    { column: "supplier_id", parent: "suppliers", label: "Purchase order → supplier" },
  ],
  purchase_order_items: [
    { column: "po_id", parent: "purchase_orders", label: "PO line → purchase order" },
    { column: "product_id", parent: "products", label: "PO line → product" },
  ],
  stock_transfers: [],
  stock_transfer_items: [
    { column: "transfer_id", parent: "stock_transfers", label: "Transfer line → transfer" },
    { column: "product_id", parent: "products", label: "Transfer line → product" },
  ],
  promotions: [{ column: "foc_product_id", parent: "products", label: "Promotion → free product" }],
  coupon_campaigns: [],
  issued_vouchers: [
    { column: "campaign_id", parent: "coupon_campaigns", label: "Voucher → campaign" },
    { column: "member_id", parent: "members", label: "Voucher → member" },
  ],
  stock_adjustments: [{ column: "product_id", parent: "products", label: "Adjustment → product" }],
  item_activity_logs: [
    { column: "product_id", parent: "products", label: "Item history → product" },
  ],
};

export const TABLE_LABELS: Record<string, string> = {
  sales: "Sales",
  sale_items: "Sale lines",
  bookings: "Bookings",
  booking_payments: "Booking payments",
  payment_transactions: "Payments",
  products: "Products",
  product_barcodes: "Product barcodes",
  product_categories: "Categories",
  members: "Members",
  membership_tiers: "Membership tiers",
  purchase_orders: "Purchase orders",
  purchase_order_items: "Purchase order lines",
  stock_transfers: "Stock transfers",
  stock_transfer_items: "Transfer lines",
  promotions: "Promotions",
  coupon_campaigns: "Coupon campaigns",
  issued_vouchers: "Issued vouchers",
  stock_adjustments: "Stock adjustments",
  item_activity_logs: "Item history",
};

export type RelationStatus = "healthy" | "missing-fk" | "integrity-risk";

export type RelationLink = {
  label: string;
  column: string;
  parent: string;
  declared: boolean;
  orphans: number | null;
};

export type TableRelationHealth = {
  table: string;
  label: string;
  rows: number;
  status: RelationStatus;
  links: RelationLink[];
};

export type RelationalReport = {
  at: string;
  tables: TableRelationHealth[];
  error: string | null;
};

type RawLink = {
  column: string;
  parent_table: string;
  parent_column: string;
  orphans: number;
};
type RawTable = { table: string; rows: number; links: RawLink[] };

type LocalBridge = {
  localRelationalHealth?: () => Promise<{
    ok: boolean;
    data?: { at: string; tables: RawTable[] };
    error?: string;
  }>;
};

/**
 * Desktop shell fallback: the same picture read from the local mirror's own
 * catalogue, so an offline terminal still gets a real answer.
 */
async function localRelational(): Promise<{ at: string; tables: RawTable[] } | null> {
  if (typeof window === "undefined") return null;
  const shell = (window as unknown as { pos?: LocalBridge }).pos;
  if (!shell?.localRelationalHealth) return null;
  try {
    const res = await shell.localRelationalHealth();
    return res.ok && res.data ? res.data : null;
  } catch {
    return null;
  }
}

export const STATUS_LABEL: Record<RelationStatus, string> = {
  healthy: "Connected & healthy",
  "missing-fk": "Disconnected / missing FK",
  "integrity-risk": "Integrity risk",
};

export const STATUS_CLASS: Record<RelationStatus, string> = {
  healthy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "missing-fk": "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "integrity-risk": "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Read the live relational picture from the central database. */
export async function runRelationalHealth(): Promise<RelationalReport> {
  try {
    let { data, error } = await (
      supabaseExternal as unknown as {
        rpc: (
          fn: string,
        ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
      }
    ).rpc("operational_relational_health");
    if (error) {
      const code = error.code ?? "";
      const msg = error.message ?? "";
      const refused =
        code === "42501" || /permission denied/i.test(msg) || /jwt|unauthor/i.test(msg);
      // A till signed in with a PIN has no cloud account, so the database
      // refuses it. Our own server can run the same check on its behalf.
      if (refused) {
        const relayed = await relayRelationalHealth();
        if (relayed.ok) {
          data = relayed.data;
          error = null;
        }
      }
    }
    if (error) {
      const code = error.code ?? "";
      const msg = error.message ?? "";
      // 42883 is the only answer that truly means "the function is not there".
      if (code === "42883" || /could not find the function/i.test(msg)) {
        const local = await localRelational();
        if (local) {
          data = local;
          error = null;
        } else {
          throw new Error(
            "The relationship check is not installed on this database. Apply the pending POS migrations following docs/database-upgrade.md to install operational_relational_health().",
          );
        }
      }
      if (
        error &&
        (code === "42501" || /permission denied/i.test(msg) || /jwt|unauthor/i.test(msg))
      ) {
        throw new Error(
          "Sign in with a staff account to run the relationship check — it is only available to signed-in staff.",
        );
      }
      if (error) throw new Error(msg);
    }

    const payload = data as { at: string; tables: RawTable[] } | null;
    const raw = payload?.tables ?? [];

    const tables: TableRelationHealth[] = Object.keys(EXPECTED_RELATIONS)
      .filter((t) => !(IDENTITY_TABLES as readonly string[]).includes(t))
      .map((table) => {
        const found = raw.find((r) => r.table === table);
        const expected = EXPECTED_RELATIONS[table] ?? [];
        const links: RelationLink[] = expected.map((exp) => {
          const actual = found?.links.find(
            (l) => l.column === exp.column && l.parent_table === exp.parent,
          );
          return {
            label: exp.label,
            column: exp.column,
            parent: exp.parent,
            declared: !!actual,
            orphans: actual ? Number(actual.orphans) : null,
          };
        });
        const orphaned = links.some((l) => (l.orphans ?? 0) > 0);
        const undeclared = links.some((l) => !l.declared);
        return {
          table,
          label: TABLE_LABELS[table] ?? table,
          rows: found?.rows ?? 0,
          status: orphaned ? "integrity-risk" : undeclared ? "missing-fk" : "healthy",
          links,
        };
      });

    return { at: payload?.at ?? new Date().toISOString(), tables, error: null };
  } catch (e) {
    return {
      at: new Date().toISOString(),
      tables: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function formatRelationalReport(report: RelationalReport): string {
  if (report.error) return `Relational check failed: ${report.error}`;
  const lines = [`Operational table links — ${new Date(report.at).toLocaleString()}`, ""];
  for (const t of report.tables) {
    lines.push(`${t.label} (${t.table}) — ${STATUS_LABEL[t.status]}, ${t.rows} rows`);
    for (const l of t.links) {
      lines.push(
        `  ${l.label}: ${l.declared ? "linked" : "NO FOREIGN KEY"}${
          l.orphans ? `, ${l.orphans} orphan row(s)` : ""
        }`,
      );
    }
  }
  return lines.join("\n");
}
