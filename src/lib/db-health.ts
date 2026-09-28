import { relayTableShapes } from "@/core/api/health-relay";
import { checkFunction } from "./health-function-metadata";
/**
 * Per-table read/write probe against the central database.
 *
 * Reading uses a `head` count, so no customer data is pulled down. Writing is
 * proven with a harmless update that matches nothing: the database still runs
 * the access rules, so a refusal is reported exactly as a real save would fail,
 * but no row is ever changed.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { supabaseConfig } from "./external-supabase-config";
import { canRelay, hasStaffSession, probeRelay } from "@/core/api/sync-relay";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";

export type ProbeState = "ok" | "fail" | "skipped";

export type TableProbe = {
  table: string;
  label: string;
  read: ProbeState;
  readDetail: string;
  rows: number | null;
  write: ProbeState;
  writeDetail: string;
};

export type HeaderCheck = { label: string; ok: boolean; detail: string };

export type DbHealthReport = {
  at: string;
  header: HeaderCheck[];
  tables: TableProbe[];
};

/** Tables that must carry a branch id on every row. */
export const BRANCH_TABLES: { table: string; label: string; column: string }[] = [
  { table: "sales", label: "Sales", column: "store_id" },
  { table: "shifts", label: "Shifts", column: "store_id" },
  { table: "shift_sessions", label: "Shift sign-ins", column: "store_id" },
  { table: "held_orders", label: "Held bills", column: "store_id" },
  { table: "bookings", label: "Bookings", column: "store_id" },
  { table: "drawer_events", label: "Drawer events", column: "store_id" },
  { table: "stock_adjustments", label: "Stock adjustments", column: "store_id" },
  { table: "sku_audit", label: "SKU changes", column: "store_id" },
  { table: "issued_vouchers", label: "Issued vouchers", column: "store_id" },
];

export type BranchCoverage = {
  table: string;
  label: string;
  total: number | null;
  missing: number | null;
  error: string | null;
};

export type RecentRows = {
  table: string;
  label: string;
  rows: Record<string, unknown>[];
  error: string | null;
};

/** Core tables the POS cannot work without. */
export const CORE_TABLES: { table: string; label: string; writable: boolean }[] = [
  { table: "products", label: "Products", writable: true },
  { table: "product_categories", label: "Categories", writable: true },
  { table: "members", label: "Members", writable: true },
  { table: "membership_tiers", label: "Membership tiers", writable: false },
  { table: "sales", label: "Sales", writable: true },
  { table: "sale_items", label: "Sale items", writable: true },
  { table: "shifts", label: "Shifts", writable: true },
  { table: "shift_sessions", label: "Shift sign-ins", writable: true },
  { table: "held_orders", label: "Held bills", writable: true },
  { table: "bookings", label: "Bookings", writable: true },
  { table: "booking_payments", label: "Booking payments", writable: true },
  { table: "stores", label: "Branches", writable: true },
  { table: "pos_settings", label: "Settings", writable: false },
  { table: "coupon_campaigns", label: "Coupon campaigns", writable: false },
  { table: "issued_vouchers", label: "Issued vouchers", writable: false },
  { table: "stock_transfers", label: "Stock transfers", writable: true },
  { table: "stock_transfer_items", label: "Transfer items", writable: true },
  { table: "purchase_orders", label: "Purchase orders", writable: true },
  { table: "purchase_order_items", label: "Purchase order items", writable: true },
  { table: "stock_adjustments", label: "Stock adjustments", writable: true },
  { table: "audit_logs", label: "Activity log", writable: true },
  { table: "drawer_events", label: "Drawer events", writable: true },
];

type Loose = {
  select: (
    cols: string,
    opts: { count: "exact"; head: true },
  ) => PromiseLike<{
    error: { message: string; code?: string } | null;
    count: number | null;
  }>;
  update: (values: unknown) => {
    eq: (
      col: string,
      val: unknown,
    ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
};

const from = (table: string) =>
  (supabaseExternal as unknown as { from: (t: string) => Loose }).from(table);

type AnyQuery = {
  from: (t: string) => {
    select: (cols: string, opts?: Record<string, unknown>) => any;
  };
};
const anyFrom = (table: string) => (supabaseExternal as unknown as AnyQuery).from(table);

/** How many rows in each branch-scoped table have no branch id. */
export async function runBranchCoverage(): Promise<BranchCoverage[]> {
  const out: BranchCoverage[] = [];
  for (const entry of BRANCH_TABLES) {
    const row: BranchCoverage = {
      table: entry.table,
      label: entry.label,
      total: null,
      missing: null,
      error: null,
    };
    try {
      const total = await anyFrom(entry.table).select("*", { count: "exact", head: true });
      if (total.error) throw total.error;
      row.total = total.count ?? 0;

      const blank = await anyFrom(entry.table)
        .select("*", { count: "exact", head: true })
        .or(`${entry.column}.is.null,${entry.column}.eq.`);
      if (blank.error) throw blank.error;
      row.missing = blank.count ?? 0;
    } catch (e) {
      row.error = explainError(e as { message: string; code?: string });
    }
    out.push(row);
  }
  return out;
}

/** The newest rows the till actually wrote, for eyeballing the real data. */
export async function loadRecentRows(
  table: string,
  columns: string,
  limit = 10,
): Promise<RecentRows> {
  const label = [...CORE_TABLES, ...BRANCH_TABLES].find((t) => t.table === table)?.label ?? table;
  try {
    const res = await anyFrom(table)
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (res.error) throw res.error;
    return { table, label, rows: (res.data ?? []) as Record<string, unknown>[], error: null };
  } catch (e) {
    return { table, label, rows: [], error: explainError(e as { message: string; code?: string }) };
  }
}

/** Operational tables shown in the data inspector. */
export const INSPECTOR_TABLES: { table: string; label: string; columns: string }[] = [
  {
    table: "sales",
    label: "Sales",
    columns: "bill_number, store_id, cashier_name, total_amount, payment_type, created_at",
  },
  {
    table: "shifts",
    label: "Shifts",
    columns: "store_id, terminal_name, opened_by_name, status, opened_at, closed_at",
  },
  {
    table: "shift_sessions",
    label: "Shift sign-ins",
    columns: "store_id, staff_name, role, signed_in_at, signed_out_at",
  },
  {
    table: "drawer_events",
    label: "Drawer events",
    columns: "store_id, staff_name, reason, created_at",
  },
  {
    table: "held_orders",
    label: "Held bills",
    columns: "id, store_id, label, total, held_by, held_at",
  },
  {
    table: "audit_logs",
    label: "Activity log",
    columns: "user_name, action_category, action_name, target_module, created_at",
  },
];

/** Turn a database error into something a shop owner can act on. */
export function explainError(error: { message: string; code?: string }): string {
  if (/no api key found|apikey.*not found/i.test(error.message)) {
    return "The central database request is missing its publishable API header — refresh after updating the app";
  }
  if (error.code === "PGRST205" || /does not exist/i.test(error.message)) {
    return `Table missing — the setup script has not been run on this database (${error.message})`;
  }
  if (/permission denied for function/i.test(error.message)) {
    return `${error.message} — run supabase/schema.sql once`;
  }
  if (error.code === "42501" || /permission denied/i.test(error.message)) {
    return `No access rule allows this account here (${error.message})`;
  }
  if (error.code === "PGRST301" || /jwt|not signed in/i.test(error.message)) {
    return "Not signed in to the central database";
  }
  if (/row-level security/i.test(error.message)) {
    return `Blocked by the row access rules (${error.message})`;
  }
  return error.message;
}

const NO_ROW = "00000000-0000-0000-0000-000000000000";

async function probeTable(entry: {
  table: string;
  label: string;
  writable: boolean;
}): Promise<TableProbe> {
  const probe: TableProbe = {
    table: entry.table,
    label: entry.label,
    read: "fail",
    readDetail: "",
    rows: null,
    write: "skipped",
    writeDetail: "Not tested",
  };

  try {
    const { error, count } = await from(entry.table).select("*", { count: "exact", head: true });
    if (error) {
      probe.readDetail = explainError(error);
    } else {
      probe.read = "ok";
      probe.rows = count ?? 0;
      probe.readDetail = `${count ?? 0} row${count === 1 ? "" : "s"} readable`;
    }
  } catch (e) {
    probe.readDetail = (e as Error).message;
  }

  if (!entry.writable) return probe;

  try {
    // Matches no row, so nothing is changed — but the rules still run.
    const { error } = await from(entry.table).update({}).eq("id", NO_ROW);
    if (error && !/empty|no values|payload/i.test(error.message)) {
      probe.write = "fail";
      probe.writeDetail = explainError(error);
    } else {
      probe.write = "ok";
      probe.writeDetail = "Saving is allowed";
    }
  } catch (e) {
    probe.write = "fail";
    probe.writeDetail = (e as Error).message;
  }

  return probe;
}

/** Check activation signatures without claiming or checking in a dummy terminal. */
async function activationChecks(): Promise<HeaderCheck[]> {
  const probes = [
    { label: "Activation lookup", fn: "terminal_token_status", args: ["p_token_id"] },
    { label: "Activation claim", fn: "terminal_token_claim", args: ["p_token_id", "p_device", "p_proof_hash", "p_platform", "p_os"] },
    { label: "Terminal check-in", fn: "terminal_token_heartbeat", args: ["p_token_id", "p_activate", "p_version", "p_synced", "p_proof_hash"] },
  ];
  const metadata = await relayTableShapes();
  return probes.map((probe) => ({
    label: probe.label,
    ...(metadata.ok ? checkFunction(metadata.functions, probe.fn, probe.args)
      : { ok: false, detail: `Not checked: ${metadata.error}` }),
  }));
}

/** Run the whole check. Safe to run at any time — nothing is modified. */
export async function runDbHealth(): Promise<DbHealthReport> {
  const session = (await supabaseExternal.auth.getSession()).data.session;
  const terminal = readTerminalConfig();
  const relay = await probeRelay();

  const header: HeaderCheck[] = [
    {
      label: "Database in use",
      ok: true,
      detail: supabaseConfig().url,
    },
    {
      label: "Signed in",
      ok: !!session,
      detail: session?.user?.email ?? "No staff account signed in on this device",
    },
    {
      label: "Branch assigned",
      ok: !!terminal?.locationId,
      detail: terminal?.locationName ?? terminal?.locationId ?? "No branch on this device",
    },
    {
      label: "Server save route",
      ok: relay.ok,
      detail: relay.ok
        ? "Available as a fallback when a direct save is refused"
        : (relay.error ?? "Unavailable"),
    },
    {
      label: "Fallback allowed here",
      ok: canRelay(),
      detail: canRelay()
        ? hasStaffSession()
          ? "Yes — signed-in browser session"
          : "Yes — activated till"
        : "No — sign in or activate this till",
    },
  ];

  header.push(...(await activationChecks()));
  header.push({
    label: "Ready to trade",
    ok: !!terminal?.locationId && !!(session || terminal?.tokenId),
    detail: terminal?.locationId
      ? "This device has a branch and an identity"
      : "No branch yet — check the activation routines above before re-activating",
  });

  const tables: TableProbe[] = [];
  // Direct Data API probes are meaningful only with a Supabase Auth session.
  // PIN-only tills use the protected metadata relay and must not probe every
  // RLS table as `anon`, which only creates permission-denied log noise.
  if (session) {
    for (const entry of await probeList()) tables.push(await probeTable(entry));
  }

  return { at: new Date().toISOString(), header, tables };
}

/**
 * The tables to probe: the core list, plus anything else the live database
 * reports through `schema_inventory()`. New features therefore show up in the
 * health report without anyone editing this file.
 */
async function probeList(): Promise<{ table: string; label: string; writable: boolean }[]> {
  const list = [...CORE_TABLES];
  try {
    const rpc = supabaseExternal as unknown as {
      rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await rpc.rpc("schema_inventory");
    if (error || !data) return list;
    const reported = (data as { tables?: unknown }).tables;
    // Older or reshaped helpers can answer with an object instead of a list;
    // that means "nothing extra to probe", never a crash mid-report.
    const inventory = Array.isArray(reported) ? (reported as { name?: string }[]) : [];
    const known = new Set(list.map((t) => t.table));
    for (const row of inventory) {
      const name = String(row?.name ?? "").trim();
      if (!name || known.has(name)) continue;
      known.add(name);
      list.push({ table: name, label: prettyTable(name), writable: false });
    }
  } catch {
    // An older database without the inventory helper simply keeps the core list.
  }
  return list;
}

const prettyTable = (name: string) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Plain-text version of the report, for pasting into a support message. */
export function formatReport(report: DbHealthReport): string {
  const lines = [`Database health — ${new Date(report.at).toLocaleString()}`, ""];
  for (const h of report.header) lines.push(`${h.ok ? "OK  " : "FAIL"} ${h.label}: ${h.detail}`);
  lines.push("", "Table                 Read                 Write");
  for (const t of report.tables) {
    lines.push(
      `${t.label.padEnd(22)}${t.read === "ok" ? "OK" : "FAIL"} ${t.readDetail} | ${
        t.write === "skipped" ? "not tested" : t.write === "ok" ? "OK" : `FAIL ${t.writeDetail}`
      }`,
    );
  }
  return lines.join("\n");
}
