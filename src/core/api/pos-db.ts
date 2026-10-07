import {
  authenticatedExternalClientSnapshot,
  supabaseExternal as supabase,
} from "@/integrations/supabase/external-client";
import { defaultSettings, sampleState } from "@/lib/pos-seed";
import { broadcastSettingsChange, runOpLive } from "@/lib/sync-engine";
import { localDb } from "@/core/local-db/local-db";
import { routedQuery } from "@/core/api/db-query";
import type { SyncOp } from "@/lib/sync-outbox";
import {
  AllTargetsFailed,
  effectiveDatabaseMode,
  isConnectionError,
  noteConnectionLost,
  noteConnectionRestored,
  setCloudDirect,
} from "@/core/local-db/db-mode";
import { notifyError, showNotification } from "@/lib/notify";
import { recordDiagnostic, reasonCode } from "@/lib/diagnostics";
import { applyStockDeltaBatch } from "@/lib/stock-recovery";
import {
  canRelay,
  hasStaffSession,
  relayActiveShift,
  relayOp,
  relayStores,
} from "@/core/api/sync-relay";
import { hydrateTerminalConfig, readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isOperationalTable } from "@/lib/pos-auth-route";
import { keyset, nextCursor, PAGE_SIZE, type Cursor, type Page } from "@/lib/keyset";
import { MAX_ROWS, PAGE, readAllPages, type PagedRead, type PageResult } from "@/lib/paged-read";
import { canonicalBranchId, canonicalStockMap } from "@/lib/branch-id";
import { loadCashierToken, readCredentials } from "@/lib/pos-credentials";
import { normalizeReceiptLogoLayout } from "@/lib/receipt-logo";
import {
  acknowledgeBrowserBatch,
  persistBrowserBatch,
  wakeBrowserOutbox,
} from "@/lib/browser-sync-outbox";
import { withRelativeStock, type StockDelta } from "@/lib/sync-stock";
import { safeCreatedAt, safeReceiptNo } from "@/lib/report-data-safety";

import { isLinkedRecordError, usageBlock, type ProductUsage } from "@/lib/product-delete";
import type {
  AppSettings,
  Member,
  MemberTier,
  PosState,
  Product,
  Promotion,
  Sale,
  Shift,
  ShiftSession,
  Store,
  PaperSize,
  PaymentMethod,
  PromoType,
  TaxMode,
} from "@/core/types/pos-types";

/** Slices of app state that live in the cloud database. */
export type CloudSlice = Pick<
  PosState,
  "products" | "members" | "sales" | "promotions" | "settings"
> & { stores: Store[]; shifts: Shift[] };

type Row = Record<string, any>;

export function dbError(context: string, error: unknown) {
  if (import.meta.env.DEV) console.error(`[db] ${context}:`, error);
  // Offline is a normal state for a till: the change is already stored here
  // and will sync later. Only claim that when the failure really is a
  // connection failure — validation and permission refusals never sync.
  if (typeof navigator !== "undefined" && !navigator.onLine && isConnectionError(error)) {
    showNotification(
      `${context} saved on this terminal — it will sync when the connection is back.`,
      "info",
    );
    return;
  }
  notifyError(error, context);
}

const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v));

/** Guard verdict: blocked with a reason, clear to delete, or not verifiable. */
export type DeleteGuardVerdict =
  { state: "blocked"; code: string; reason: string } | { state: "clear" } | { state: "unknown" };

/**
 * Which records still point at a product.
 *
 * The database routine is the guard. When it cannot be reached the answer is
 * "unknown" and the caller must refuse the delete — guessing from constraint
 * messages is only ever used to word a refusal, never to allow one.
 */
export async function productDeleteBlock(id: string): Promise<DeleteGuardVerdict> {
  try {
    const rpc = (await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("product_delete_guard", { _product_id: id })) as { data: unknown; error: unknown };
    if (rpc.error || !rpc.data) {
      recordDiagnostic({
        kind: "backend_object_missing",
        entity: "products",
        code: reasonCode(rpc.error ?? "no answer"),
        recordId: id,
      });
      return { state: "unknown" };
    }
    const block = usageBlock(rpc.data as ProductUsage);
    return block ? { state: "blocked", ...block } : { state: "clear" };
  } catch (e) {
    recordDiagnostic({
      kind: "backend_object_missing",
      entity: "products",
      code: reasonCode(e),
      recordId: id,
    });
    return { state: "unknown" };
  }
}

/* ------------------------------- mappers ------------------------------- */

export const rowToProduct = (r: Row): Product => ({
  id: r.id,
  createdAt: r.created_at ?? undefined,
  name: r.name,
  sku: r.sku ?? r.barcode ?? "",
  barcode: r.barcode ?? "",
  category: r.category ?? "",
  group: r.product_group ?? undefined,
  subCategory: r.sub_category ?? undefined,
  unit: r.unit ?? undefined,
  packs: Array.isArray(jsonValue(r.packs, [])) ? jsonValue(r.packs, []) : [],
  barcodes: Array.isArray(jsonValue(r.barcode_aliases, [])) ? jsonValue(r.barcode_aliases, []) : [],
  variants: Array.isArray(jsonValue(r.barcode_variants, []))
    ? (jsonValue(r.barcode_variants, []) as Product["variants"])
    : [],
  price: num(r.selling_price),
  cost: num(r.cost_price),
  ecomPrice: r.ecom_price == null ? undefined : num(r.ecom_price),
  ecomVisible: r.ecom_visible ?? true,
  archived: r.is_archived === true,
  stockByStore: canonicalStockMap(jsonValue<Record<string, number>>(r.stock_by_store, {})),
  reorderLevel: num(r.reorder_level),
  taxRate: num(r.tax_rate),
  customPoints: r.custom_points == null ? undefined : num(r.custom_points),
  ownerStoreId: (r.owner_store_id as string | null | undefined) ?? null,
});

/**
 * Resolve scoped price records without ever rewriting the product's global
 * price. The current deployment models a physical register as its terminal;
 * priority is therefore global < cluster < branch < terminal.
 */
export function applyScopedProductPrices(
  products: Product[],
  rows: Row[],
  scope: { branchId?: string | null; terminalId?: string | null; clusterId?: string | null },
): Product[] {
  const priority: Record<string, number> = { global: 0, cluster: 1, branch: 2, terminal: 3 };
  const selected = new Map<string, { priority: number; value: Row }>();
  for (const row of rows) {
    const key = String(row.key ?? "");
    if (!key.startsWith("product_price:")) continue;
    const kind = String(row.scope ?? "").toLowerCase();
    const id = String(row.scope_id ?? "");
    if (
      (kind === "branch" && id !== scope.branchId) ||
      (kind === "terminal" && id !== scope.terminalId) ||
      (kind === "cluster" && id !== (scope.clusterId || "default")) ||
      !(kind in priority)
    )
      continue;
    const value = jsonValue<Row>(row.value, {});
    const productId = key.slice("product_price:".length);
    const candidate = { priority: priority[kind], value };
    if (candidate.priority >= (selected.get(productId)?.priority ?? -1))
      selected.set(productId, candidate);
  }
  return products.map((product) => {
    const value = selected.get(product.id)?.value;
    if (!value) return product;
    const selling =
      value.selling_price == null ? product.price : safeNum(value.selling_price, product.price);
    const ecom =
      value.ecom_price == null
        ? product.ecomPrice
        : safeNum(value.ecom_price, product.ecomPrice ?? selling);
    return { ...product, price: selling, ecomPrice: ecom };
  });
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value ?? fallback) as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** SQL Server returns structured settings as text; cloud reads return objects. */
function settingsObject(value: unknown): Record<string, unknown> {
  const parsed = jsonValue<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
}

/** Strict numeric coercion: "" / null / NaN / Infinity never reach the database. */
export const safeNum = (value: unknown, fallback = 0): number => {
  if (value === "" || value == null || typeof value === "boolean") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Integer columns must never receive a decimal. */
const safeInt = (value: unknown, fallback = 0): number => Math.round(safeNum(value, fallback));

/** Optional numeric columns keep NULL rather than collapsing to zero. */
const safeNumOrNull = (value: unknown): number | null => {
  if (value === "" || value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const safeArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const safeStockMap = (value: unknown): Record<string, number> => {
  const canonical = canonicalStockMap(value);
  const out: Record<string, number> = {};
  for (const [key, qty] of Object.entries(canonical)) {
    out[key] = safeInt(qty);
  }
  return out;
};

export const productToRow = (p: Product): Row => {
  const stock =
    p.stockByStore && typeof p.stockByStore === "object" && !Array.isArray(p.stockByStore)
      ? safeStockMap(p.stockByStore)
      : null;
  return {
    id: p.id,
    barcode: p.barcode || p.sku || p.id,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category ?? null,
    product_group: p.group ?? null,
    sub_category: p.subCategory ?? null,
    unit: p.unit ?? null,
    packs: safeArray(p.packs),
    barcode_aliases: safeArray<string>(p.barcodes)
      .map((b) => String(b ?? "").trim())
      .filter(Boolean),
    barcode_variants: safeArray<{
      code?: string;
      label?: string;
      cost?: number;
      price?: number;
    }>(p.variants)
      .map((v) => ({
        code: String(v?.code ?? "").trim(),
        label: v?.label?.trim() || undefined,
        cost: safeNumOrNull(v?.cost) ?? undefined,
        price: safeNumOrNull(v?.price) ?? undefined,
      }))
      .filter((v) => v.code),
    cost_price: safeNum(p.cost),
    selling_price: safeNum(p.price),
    ecom_price: safeNumOrNull(p.ecomPrice),
    ecom_visible: p.ecomVisible ?? true,
    is_archived: p.archived === true,
    archived_at: p.archived ? new Date().toISOString() : null,
    // Stock is only ever written when the caller actually carries the per-branch
    // map. A product saved without it (a price or name edit, a partial import)
    // must never zero the quantity that is already banked in the database.
    ...(stock
      ? {
          stock_quantity: safeInt(Object.values(stock).reduce((a, b) => a + b, 0)),
          stock_by_store: stock,
        }
      : {}),
    reorder_level: safeInt(p.reorderLevel),
    tax_rate: safeNum(p.taxRate),
    custom_points: safeNumOrNull(p.customPoints),
    owner_store_id: p.ownerStoreId ? canonicalBranchId(p.ownerStoreId) : null,
  };
};

const rowToMember = (r: Row, tierName: (id: string | null) => MemberTier): Member => ({
  id: r.id,
  code: r.member_code,
  name: r.full_name,
  phone: r.phone ?? "",
  email: r.email ?? "",
  tier: tierName(r.tier_id),
  points: num(r.loyalty_points),
  totalSpend: num(r.total_spent),
  joinedAt: (r.created_at ?? new Date().toISOString()).slice(0, 10),
  homeStoreId: r.address ?? undefined,
  birthday: r.date_of_birth ?? undefined,
  // Verification is written by the gateway, so it is read here but never sent
  // back up in `memberToRow` — a till edit must not un-verify anybody.
  verified: r.is_verified === true,
  verifiedAt: r.verified_at ?? undefined,
  verifiedChannel: r.verified_channel ?? undefined,
  directoryRevision: num(r.membership_revision),
  membershipId: r.membership_member_id ?? undefined,
  membershipStatus: r.membership_status ?? "active",
  updatedAt: r.updated_at ?? undefined,
});

const memberToRow = (m: Member, tierId: (name: MemberTier) => string | null): Row => ({
  id: m.id,
  member_code: m.code,
  full_name: m.name,
  phone: m.phone,
  tier_id: tierId(m.tier),
  loyalty_points: m.points ?? 0,
  total_spent: m.totalSpend ?? 0,
  // Membership identity, lifecycle and revision belong to the protected
  // membership gateway. A till may read them but must never echo a stale
  // directory snapshot back into the POS mirror.
});

const rowToPromotion = (r: Row): Promotion => ({
  id: r.id,
  name: r.title,
  type: r.promo_type as PromoType,
  active: !!r.is_active,
  startDate: r.start_date ?? undefined,
  endDate: r.end_date ?? undefined,
  pointsPerDollar: num(r.points_per_dollar, 1),
  minBill: num(r.min_spend),
  focProductId: r.foc_product_id ?? undefined,
  focQty: 1,
  value: num(r.discount_percent) || num(r.discount_amount),
  valueType: num(r.discount_percent) ? "percent" : "amount",
  tierRates: (r.tier_rates ?? undefined) as Record<MemberTier, number> | undefined,
  partner: r.partner ?? undefined,
});

export const rowToStore = (r: Row): Store => ({
  id: r.id,
  code: r.code ?? "",
  name: r.name ?? "",
  address: r.address ?? "",
  phone: r.phone ?? "",
  // NULL means the location is not assigned to a saved cluster. Do not invent
  // a `default` foreign key: a clean database intentionally has no group rows.
  groupId: r.group_id ?? undefined,
  locationType: (r.location_type ?? "store") as Store["locationType"],
  parentId: r.parent_id ?? null,
  isCentral: !!r.is_central,
  isPrimarySub: !!r.is_primary_sub,
  buildingName: r.building_name ?? "",
  floorLabel: r.floor_label ?? "",
  // Databases that predate the column report `undefined`; treat those as live.
  active: r.is_active === undefined || r.is_active === null ? true : !!r.is_active,
  archivedAt: r.archived_at ?? null,
  privateCatalogue: r.private_catalogue === true,
});

export const storeToRow = (s: Store): Row => ({
  id: s.id,
  code: s.code,
  name: s.name,
  address: s.address || null,
  phone: s.phone || null,
  group_id: s.groupId?.trim() || null,
  location_type: s.locationType ?? "store",
  parent_id: s.parentId || null,
  is_central: !!s.isCentral,
  is_primary_sub: !!s.isPrimarySub,
  building_name: s.buildingName?.trim() || null,
  floor_label: s.floorLabel?.trim() || null,
  is_active: s.active !== false,
  private_catalogue: s.privateCatalogue === true,
});

const promotionToRow = (p: Promotion): Row => ({
  id: p.id,
  title: p.name,
  promo_type: p.type,
  is_active: p.active,
  start_date: p.startDate || null,
  end_date: p.endDate || null,
  points_per_dollar: p.pointsPerDollar ?? 1,
  min_spend: p.minBill ?? 0,
  foc_product_id: p.focProductId ?? null,
  discount_percent: p.valueType === "percent" ? (p.value ?? 0) : 0,
  discount_amount: p.valueType === "amount" ? (p.value ?? 0) : 0,
  tier_rates: p.tierRates ?? null,
  partner: p.partner?.trim() ? p.partner.trim() : null,
});

/** Older SQL copies may expose a JSON-encoded scalar rather than text. */
const settingsText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  if (value.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      if (typeof decoded === "string") return decoded;
    } catch { /* ordinary text beginning with a quote */ }
  }
  return value;
};

export const rowToSettings = (r: Row | null): AppSettings =>
  r
    ? {
        tax: {
          enabled: !!r.enable_tax,
          rate: num(r.tax_percentage),
          mode: (r.tax_mode ?? "exclusive") as TaxMode,
        },
        receipt: {
          ...defaultSettings.receipt,
          paper: (r.paper_size ?? "80mm") as PaperSize,
          companyName: settingsText(r.company_name),
          taxNumber: settingsText(r.tax_number),
          regNumber: settingsText(r.reg_number),
          phone: settingsText(r.phone),
          website: settingsText(r.website),
          headerText: settingsText(r.header_text),
          footerText: settingsText(r.footer_text),
          showLogo: r.show_logo ?? true,
          logo: settingsText((r as { logo_data_url?: unknown }).logo_data_url),
          logoLayout: normalizeReceiptLogoLayout(
            settingsObject(r.receipt_design).logoLayout,
          ),
          showPoints: r.show_points ?? true,
          showBarcode: r.show_barcode ?? true,
          showTax: r.show_tax_details ?? true,
          fonts: {
            ...defaultSettings.receipt.fonts,
            ...settingsObject(r.fonts),
          },
          customLines: Array.isArray(jsonValue(r.custom_lines, [])) ? jsonValue(r.custom_lines, []) : [],
          qr: { ...defaultSettings.receipt.qr, ...settingsObject(r.qr) },
          css: (r as { receipt_css?: string | null }).receipt_css ?? "",
          bookingSlip: {
            ...defaultSettings.receipt.bookingSlip,
            ...settingsObject(r.booking_slip),
          },
        },
        payment: {
          ...defaultSettings.payment,
          ...settingsObject(r.payment_details),
        },
        whatsapp: {
          ...defaultSettings.whatsapp,
          ...settingsObject(r.whatsapp_settings),
        },
        visibility: {
          hidden: ((settingsObject(r.ui_visibility).hidden as Record<string, string[]> | undefined) ??
            {}) as Record<string, string[]>,
        },
        integrations: {
          ...defaultSettings.integrations,
          ...settingsObject(r.integration_settings),
        },
      }
    : defaultSettings;

/**
 * Columns this database does not have (older POS schema). Once the API tells
 * us a column is unknown we stop sending it, so the rest of the settings keep
 * saving instead of the whole record failing.
 */
const missingSettingsColumns = new Set<string>();

/** "Could not find the 'x' column of 'pos_settings' in the schema cache" */
const unknownSettingsColumn = (message: string): string | null => {
  const m = /could not find the '([^']+)' column/i.exec(message);
  return m?.[1] ?? null;
};

const buildSettingsRow = (s: AppSettings): Row => ({
  id: 1,
  tax_percentage: s.tax.rate,
  enable_tax: s.tax.enabled,
  tax_mode: s.tax.mode,
  paper_size: s.receipt.paper,
  company_name: s.receipt.companyName,
  tax_number: s.receipt.taxNumber,
  reg_number: s.receipt.regNumber,
  phone: s.receipt.phone,
  website: s.receipt.website,
  fonts: s.receipt.fonts,
  custom_lines: s.receipt.customLines,
  qr: s.receipt.qr,
  receipt_css: s.receipt.css ?? "",
  booking_slip: s.receipt.bookingSlip,
  payment_details: s.payment,
  whatsapp_settings: s.whatsapp,
  header_text: s.receipt.headerText,
  footer_text: s.receipt.footerText,
  show_logo: s.receipt.showLogo,
  logo_data_url: s.receipt.logo ?? "",
  receipt_design: { logoLayout: s.receipt.logoLayout },
  show_points: s.receipt.showPoints,
  show_barcode: s.receipt.showBarcode,
  show_tax_details: s.receipt.showTax,
  ui_visibility: s.visibility ?? { hidden: {} },
  integration_settings: s.integrations ?? {},
  updated_at: new Date().toISOString(),
});

const settingsToRow = (s: AppSettings): Row => {
  const row = buildSettingsRow(s);
  missingSettingsColumns.forEach((col) => delete (row as Record<string, unknown>)[col]);
  return row;
};

const SETTINGS_SECTION_COLUMNS: Record<keyof AppSettings, string[]> = {
  tax: ["tax_percentage", "enable_tax", "tax_mode"],
  receipt: [
    "paper_size",
    "company_name",
    "tax_number",
    "reg_number",
    "phone",
    "website",
    "fonts",
    "custom_lines",
    "qr",
    "receipt_css",
    "booking_slip",
    "header_text",
    "footer_text",
    "show_logo",
    "logo_data_url",
    "receipt_design",
    "show_points",
    "show_barcode",
    "show_tax_details",
  ],
  payment: ["payment_details"],
  whatsapp: ["whatsapp_settings"],
  visibility: ["ui_visibility"],
  integrations: ["integration_settings"],
};

/** Physical database fields affected by this UI patch. */
const settingsPatchRow = (s: AppSettings, patch: Partial<AppSettings>): Row => {
  const full = buildSettingsRow(s);
  const keys = new Set(
    Object.keys(patch).flatMap(
      (section) => SETTINGS_SECTION_COLUMNS[section as keyof AppSettings] ?? [],
    ),
  );
  const row = Object.fromEntries(
    Object.entries(full).filter(([key]) => key === "id" || key === "updated_at" || keys.has(key)),
  );
  return row;
};

const settingsFieldRows = (row: Row): Row[] => {
  const updatedAt = String(row.updated_at ?? new Date().toISOString());
  const writerId = readTerminalConfig()?.tokenId ?? "web";
  return Object.entries(row)
    .filter(([key]) => !["id", "updated_at", "row_version"].includes(key))
    .map(([fieldKey, value]) => ({
      scope: "GLOBAL",
      scope_id: "",
      key: `pos_field:${fieldKey}`,
      value,
      is_overridden: true,
      updated_at: updatedAt,
      updated_by: writerId,
    }));
};

/** Overlay independently versioned fields onto the legacy settings snapshot. */
export const applySettingsFields = (base: Row | null, fields: Row[] | null | undefined): Row | null => {
  if (!base && !fields?.length) return null;
  const merged: Row = { ...(base ?? { id: 1 }) };
  for (const field of fields ?? []) {
    const rawKey = String(field.key ?? "");
    if (!rawKey.startsWith("pos_field:")) continue;
    const key = rawKey.slice("pos_field:".length);
    if (key === "company_name") {
      const name = typeof field.value === "string" ? settingsText(field.value)
        : typeof field.value === "number" ? String(field.value) : "";
      // A stale, empty field row must not erase a name already pulled from
      // the cloud snapshot. Missing names still remain missing for the admin.
      if (name.trim() || !String(merged.company_name ?? "").trim()) merged[key] = name;
    } else if (key && key !== "id") merged[key] = field.value;
  }
  return merged;
};

const rowToShift = (r: Row): Shift => ({
  id: r.id,
  storeId: r.store_id ?? "",
  cashier: r.opened_by_name ?? "",
  openedAt: r.opened_at,
  closedAt: r.closed_at ?? null,
  openingFloat: Number(r.opening_float ?? 0),
  countedCash: r.counted_cash == null ? null : Number(r.counted_cash),
  note: r.note ?? "",
  status: (r.status as "OPEN" | "CLOSED" | null) ?? (r.closed_at ? "CLOSED" : "OPEN"),
  closingFloat: r.closing_float == null ? null : Number(r.closing_float),
  userId: r.user_id ?? null,
  terminalId: r.terminal_id ?? undefined,
  terminalName: r.terminal_name ?? undefined,
  openedByStaffId: r.opened_by_staff_id ?? undefined,
  openedByRole: r.opened_by_role ?? undefined,
  closedBy: r.closed_by_name ?? undefined,
  closedByStaffId: r.closed_by_staff_id ?? undefined,
  closedByRole: r.closed_by_role ?? undefined,
  expectedCash: r.expected_cash == null ? null : Number(r.expected_cash),
  countedCard: r.counted_card == null ? null : Number(r.counted_card),
  countedDigital: r.counted_digital == null ? null : Number(r.counted_digital),
  expectedCard: r.expected_card == null ? null : Number(r.expected_card),
  expectedDigital: r.expected_digital == null ? null : Number(r.expected_digital),
  varianceCash: r.variance_cash == null ? null : Number(r.variance_cash),
  varianceCard: r.variance_card == null ? null : Number(r.variance_card),
  varianceDigital: r.variance_digital == null ? null : Number(r.variance_digital),
  varianceTotal: r.variance_total == null ? null : Number(r.variance_total),
  overdue: Boolean(r.overdue),
  state: (r.state as Shift["state"]) ?? (r.closed_at ? "CLOSED" : "ACTIVE"),
  closeReason: r.close_reason ?? null,
  closingStartedAt: r.closing_started_at ?? null,
  closingStartedBy: r.closing_started_by ?? null,
  finalCountedCash: r.final_counted_cash == null ? null : Number(r.final_counted_cash),
  varianceStatus: r.variance_status ?? null,
});

const shiftToRow = (s: Shift): Row => ({
  id: s.id,
  store_id: s.storeId,
  terminal_id: s.terminalId ?? null,
  terminal_name: s.terminalName ?? null,
  opened_by_name: s.cashier,
  opened_by_staff_id: s.openedByStaffId ?? null,
  opened_by_role: s.openedByRole ?? null,
  closed_by_name: s.closedBy ?? null,
  closed_by_staff_id: s.closedByStaffId ?? null,
  closed_by_role: s.closedByRole ?? null,
  opened_at: s.openedAt,
  opening_float: s.openingFloat,
  user_id: s.userId ?? null,
  // Closing lifecycle, counts, expected totals and variances belong to the
  // controlled shift workflow. A later UI mirror must not overwrite those
  // database-owned values with a stale in-memory null.
  note: s.note,
  overdue: s.overdue ?? false,
  updated_at: new Date().toISOString(),
});

const rowToShiftSession = (r: Row): ShiftSession => ({
  id: r.id,
  shiftId: r.shift_id ?? "",
  storeId: r.store_id ?? "",
  terminalId: r.terminal_id ?? null,
  terminalName: r.terminal_name ?? null,
  staffId: r.staff_id ?? null,
  staffName: r.staff_name ?? "",
  role: r.role ?? null,
  signedInAt: r.signed_in_at,
  signedOutAt: r.signed_out_at ?? null,
});

const shiftSessionToRow = (s: ShiftSession): Row => ({
  id: s.id,
  shift_id: s.shiftId,
  store_id: s.storeId,
  terminal_id: s.terminalId ?? null,
  terminal_name: s.terminalName ?? null,
  staff_id: s.staffId ?? null,
  staff_name: s.staffName,
  role: s.role ?? null,
  signed_in_at: s.signedInAt,
  signed_out_at: s.signedOutAt ?? null,
  updated_at: new Date().toISOString(),
});

/**
 * Exactly the bill and line columns the till renders — no `SELECT *`, so a
 * schema that grows new columns never inflates the payload of every read.
 */
const SALE_COLUMNS_BASE =
  "id, bill_number, store_id, shift_id, cashier_name, member_id, subtotal_amount, " +
  "discount_amount, tax_amount, total_amount, paid_amount, change_amount, payment_type, " +
  "payments, points_earned, is_refunded, original_bill_number, exchanged_to_bill_number, " +
  "exchange_credit, coupon_code, coupon_promo_id, coupon_scope, coupon_discount, created_at, " +
  "store_name_snapshot, store_address_snapshot, " +
  "sale_items(product_id, product_name, variant_code, unit_price, quantity, tax_rate, discount_percent, " +
  "discount_amount, is_return, is_foc, promo_id, coupon_code, coupon_discount, unit_cost)";

/**
 * Older databases have not had the checkout-attempt column added yet. Asking
 * for it there fails the whole read, so the first refusal switches every later
 * query to the columns that definitely exist.
 */
let hasClientTxnColumn = true;
/** Same story for the branch-name snapshot columns. */
let hasStoreSnapshotColumns = true;
/** …and for the total-rounding columns. */
let hasRoundingColumns = true;

const saleColumns = () =>
  [
    SALE_COLUMNS_BASE,
    hasStoreSnapshotColumns ? "store_name_snapshot, store_address_snapshot" : "",
    hasClientTxnColumn ? "client_transaction_id" : "",
    hasRoundingColumns ? "rounding_adjustment, rounding_label" : "",
  ]
    .filter(Boolean)
    .join(", ");

/** True when a failure is "that column is not in this database (yet)". */
export const isMissingTxnColumn = (message: string | undefined | null) =>
  !!message &&
  /client_transaction_id|store_name_snapshot|store_address_snapshot|rounding_adjustment|rounding_label/.test(
    message,
  ) &&
  /does not exist|schema cache/i.test(message);

/**
 * Schema drift used to be invisible: the read simply got quieter. Each column
 * we stop asking for is announced once, so a database left behind by an
 * upgrade shows up in the console instead of silently dropping fields.
 */
const announcedDrift = new Set<string>();
const announceDrift = (column: string) => {
  if (announcedDrift.has(column)) return;
  announcedDrift.add(column);
  if (import.meta.env.DEV)
    console.warn(`[schema] sales compatibility column unavailable: ${column}`);
};

const forgetTxnColumn = (message?: string | null) => {
  if (!message || /client_transaction_id/.test(message)) {
    if (hasClientTxnColumn) announceDrift("client_transaction_id");
    hasClientTxnColumn = false;
  }
  if (!message || /store_(name|address)_snapshot/.test(message)) {
    if (hasStoreSnapshotColumns) announceDrift("store_name_snapshot/store_address_snapshot");
    hasStoreSnapshotColumns = false;
  }
  if (!message || /rounding_(adjustment|label)/.test(message)) {
    if (hasRoundingColumns) announceDrift("rounding_adjustment/rounding_label");
    hasRoundingColumns = false;
  }
};

export const rowToSale = (r: Row): Sale => ({
  id: r.id,
  // Historic/imported SQL rows can predate bill numbering. Reports and the
  // register counter require a string; use the stable row id as a visible,
  // deterministic fallback instead of letting `.split()` crash the shell.
  receiptNo: safeReceiptNo(r.bill_number, r.id),
  clientTxnId: r.client_transaction_id ?? undefined,
  storeId: r.store_id ?? "",
  storeName: r.store_name_snapshot ?? undefined,
  storeAddress: r.store_address_snapshot ?? undefined,
  shiftId: r.shift_id ?? "",
  lines: ((r.sale_items ?? []) as Row[]).map((l) => ({
    productId: l.product_id ?? "",
    name: l.product_name,
    variantCode: l.variant_code ?? undefined,
    price: num(l.unit_price),
    qty: Number(l.quantity),
    taxRate: num(l.tax_rate),
    discount: num(l.discount_percent) || num(l.discount_amount),
    discountType: num(l.discount_percent) ? "percent" : "amount",
    credit: !!l.is_return,
    foc: !!l.is_foc,
    promoId: l.promo_id ?? undefined,
    couponCode: l.coupon_code ?? undefined,
    couponDiscount: num(l.coupon_discount) || undefined,
    cost: l.unit_cost === null || l.unit_cost === undefined ? undefined : num(l.unit_cost),
  })),
  subtotal: num(r.subtotal_amount),
  discount: num(r.discount_amount),
  tax: num(r.tax_amount),
  total: num(r.total_amount),
  paid: num(r.paid_amount),
  change: num(r.change_amount),
  method: (r.payment_type ?? "cash") as PaymentMethod,
  payments: (() => {
    if (Array.isArray(r.payments)) return r.payments as Sale["payments"];
    if (typeof r.payments !== "string" || !r.payments.trim()) return undefined;
    try {
      const parsed = JSON.parse(r.payments);
      return Array.isArray(parsed) ? (parsed as Sale["payments"]) : undefined;
    } catch {
      return undefined;
    }
  })(),
  memberId: r.member_id ?? null,
  pointsEarned: num(r.points_earned),
  cashier: r.cashier_name ?? "",
  createdAt: safeCreatedAt(r.created_at),
  refunded: !!r.is_refunded,
  exchangeOfReceiptNo: r.original_bill_number ?? undefined,
  exchangedToReceiptNo: r.exchanged_to_bill_number ?? undefined,
  exchangeCredit: num(r.exchange_credit) || undefined,
  couponCode: r.coupon_code ?? undefined,
  couponPromoId: r.coupon_promo_id ?? undefined,
  couponScope: (r.coupon_scope ?? undefined) as Sale["couponScope"],
  couponDiscount: num(r.coupon_discount) || undefined,
  roundingAdjustment: num(r.rounding_adjustment) || undefined,
  roundingLabel: r.rounding_label ?? undefined,
});

export async function findReceiptExact(
  value: string,
  branchId: string,
): Promise<{ sale: Sale; source: "local" | "cloud" } | null> {
  const lookup = value.trim();
  if (!lookup || !branchId) return null;
  const local = localDb();
  if (!local?.findReceipt) return null;
  const state = await local.database?.getState?.().catch(() => null);
  if (!state?.connected) return null;
  const { sessionToken, cashierToken, accessToken } = await readCredentials();
  const result = await local.findReceipt(lookup, branchId, {
    sessionToken,
    cashierToken,
    accessToken,
  });
  if (!result?.sale) return null;
  const payments =
    Array.isArray(result.sale.payments) && result.sale.payments.length
      ? result.sale.payments
      : (result.payments ?? []).map((payment) => ({
          method: payment.method ?? "cash",
          amount: num(payment.amount),
          reference: payment.reference ?? undefined,
        }));
  return {
    source: result.source,
    sale: rowToSale({ ...result.sale, sale_items: result.items ?? [], payments }),
  };
}

const saleToRow = (s: Sale): Row => ({
  id: s.id,
  bill_number: s.receiptNo,
  client_transaction_id: s.clientTxnId ?? null,
  member_id: s.memberId,
  store_id: s.storeId,
  // Only sent to databases that carry the snapshot columns, so an older
  // schema still accepts the bill.
  ...(hasStoreSnapshotColumns
    ? {
        store_name_snapshot: s.storeName ?? null,
        store_address_snapshot: s.storeAddress ?? null,
      }
    : {}),
  shift_id: s.shiftId,
  cashier_name: s.cashier,
  subtotal_amount: s.subtotal,
  total_amount: s.total,
  discount_amount: s.discount,
  tax_amount: s.tax,
  payment_type: s.method,
  payments: s.payments ?? [],
  points_earned: s.pointsEarned,
  points_redeemed: s.method === "points" ? s.paid : 0,
  is_exchange: !!s.exchangeOfReceiptNo,
  original_bill_number: s.exchangeOfReceiptNo ?? null,
  exchange_credit: s.exchangeCredit ?? 0,
  paid_amount: s.paid,
  change_amount: s.change,
  is_refunded: !!s.refunded,
  coupon_code: s.couponCode ?? null,
  coupon_promo_id: s.couponPromoId ?? null,
  coupon_scope: s.couponScope ?? null,
  coupon_discount: s.couponDiscount ?? 0,
  // The approval that permitted a gated action on this bill, so the bill and
  // the decision that allowed it can never be read apart.
  authorization_request_id: s.authorizationRequestId ?? null,
  authorized_by: s.authorizedBy ?? null,
  authorized_at: s.authorizedAt ?? null,
  ...(hasRoundingColumns
    ? {
        rounding_adjustment: s.roundingAdjustment ?? 0,
        rounding_label: s.roundingLabel ?? null,
      }
    : {}),
  created_at: s.createdAt,
});

const saleItemRows = (s: Sale) =>
  s.lines.map((l, index) => ({
    id: stableChildId(s.id, "1", index),
    sale_id: s.id,
    // The central sync boundary validates every child row independently.
    // Without this field SQL Server accepts the item, but Supabase correctly
    // rejects the aggregate as SYNC_BRANCH_FORBIDDEN.
    branch_id: s.storeId,
    product_id: l.productId || null,
    product_name: l.name,
    variant_code: l.variantCode ?? null,
    unit_price: l.price,
    unit_cost: l.cost ?? 0,
    quantity: l.qty,
    discount_percent: l.discountType === "percent" ? (l.discount ?? 0) : 0,
    discount_amount: l.discountType === "percent" ? 0 : (l.discount ?? 0),
    tax_rate: l.taxRate ?? 0,
    is_return: !!l.credit,
    is_foc: !!l.foc,
    promo_id: l.promoId ?? null,
    coupon_code: l.couponCode ?? null,
    coupon_discount: l.couponDiscount ?? 0,
  }));

/**
 * One ledger row per tender on the bill, so partial settlements across sales
 * and bookings can be read from a single place.
 */
const salePaymentRows = (s: Sale) => {
  const tenders =
    s.payments && s.payments.length
      ? s.payments.map((p) => ({
          method: String(p.method),
          amount: Number(p.amount) || 0,
          reference: (p.reference ?? p.ref ?? "").trim(),
          referenceNote: (p.referenceNote ?? "").trim(),
          bankName: (p.bankName ?? "").trim(),
        }))
      : [
          {
            method: String(s.method),
            amount: s.paid,
            reference: "",
            referenceNote: "",
            bankName: "",
          },
        ];
  return tenders
    .filter((t) => t.amount !== 0)
    .map((t, index) => ({
      id: stableChildId(s.id, "2", index),
      // Idempotency key per tender: a retry after a half-failed push resolves
      // against the row already stored instead of raising a duplicate key.
      client_transaction_id: s.clientTxnId ? `${s.clientTxnId}:pay:${index}` : null,
      source_type: "sale",
      sale_id: s.id,
      member_id: s.memberId,
      store_id: s.storeId,
      shift_id: s.shiftId,
      amount: t.amount,
      method: t.method,
      kind: s.refunded ? "refund" : "payment",
      reference: t.reference || s.receiptNo,
      cashier_name: s.cashier,
      note: "",
      paid_at: s.createdAt,
      created_at: s.createdAt,
      // The ledger columns are optional on older databases, so always send a
      // concrete value rather than relying on a column default that may be missing.
      status: "completed",
      metadata: {
        bill: s.receiptNo,
        ...(t.reference ? { voucher_reference: t.reference } : {}),
        ...(t.referenceNote ? { reference_note: t.referenceNote } : {}),
        ...(t.bankName ? { bank: t.bankName } : {}),
        captured_at: s.createdAt,
        captured_by: s.cashier,
      },
    }));
};

/** One inventory-movement row per sold line, for the unified item history. */
const saleActivityRows = (s: Sale) =>
  s.lines
    .filter((l) => l.productId)
    .map((l, index) => ({
      id: stableChildId(s.id, "3", index),
      product_id: l.productId,
      product_name: l.name,
      store_id: s.storeId,
      activity_type: l.credit ? "return" : "sale",
      reference: s.receiptNo,
      quantity_delta: -Math.round(l.qty),
      unit_cost: l.cost ?? 0,
      staff_name: s.cashier,
      note: "",
      created_at: s.createdAt,
    }));

/**
 * One inventory-movement row per received line, so item history shows stock
 * arriving as well as leaving. Ids are derived from the invoice, so re-posting
 * a resumed draft or correcting an invoice rewrites the same rows instead of
 * doubling them. Drafts and cancelled orders never touch stock, so they write
 * nothing.
 */
const receivingActivityRows = (inv: ReceivingInvoice, storeId: string | null) =>
  inv.lines
    .filter((l) => l.productId && Math.round(l.qty) !== 0)
    .map((l, index) => ({
      id: stableChildId(inv.id, "4", index),
      product_id: l.productId,
      product_name: l.name,
      sku: l.sku || null,
      barcode: l.barcode || null,
      store_id: storeId ?? inv.storeId,
      activity_type: "receive",
      reference: inv.reference || inv.invoiceNo,
      quantity_delta: Math.round(l.qty),
      unit_cost: l.cost ?? 0,
      staff_name: inv.operator,
      note: "",
      created_at: inv.entryDate || inv.createdAt,
    }));

/** Pricing never writes absolute stock: movement commits own quantities. */
export const receivingPriceOps = (inv: ReceivingInvoice): SyncOp[] =>
  inv.status !== "posted"
    ? []
    : inv.lines
        .filter((line) => line.productId)
        .map((line) => ({
          kind: "update",
          table: "products",
          match: { id: line.productId },
          values: { cost_price: safeNum(line.cost), selling_price: safeNum(line.price) },
        }));

/** Corrections get new movement IDs; retries of the same edit reuse them. */
export function receivingCorrectionOps(
  inv: ReceivingInvoice,
  previous: ReceivingInvoice,
  attemptId: string,
): SyncOp[] {
  const delta = new Map<string, number>();
  for (const line of previous.lines)
    if (line.productId) delta.set(line.productId, (delta.get(line.productId) ?? 0) - line.qty);
  for (const line of inv.lines)
    if (line.productId) delta.set(line.productId, (delta.get(line.productId) ?? 0) + line.qty);
  const rows = [...delta]
    .filter(([, qty]) => qty !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productId, qty], index) => ({
      id: stableChildId(attemptId, "5", index),
      product_id: productId,
      product_name:
        inv.lines.find((line) => line.productId === productId)?.name ??
        previous.lines.find((line) => line.productId === productId)?.name ??
        "",
      store_id: inv.storeId,
      activity_type: "receive",
      reference: inv.reference || inv.invoiceNo,
      quantity_delta: Math.round(qty),
      staff_name: inv.operator,
      note: "Receiving correction",
      created_at: new Date().toISOString(),
    }));
  return rows.length
    ? [{ kind: "upsert", table: "item_activity_logs", rows, onConflict: "id" }]
    : [];
}

/** The movement rows for a receiving commit, or nothing for an unposted one. */
const receivingActivityOps = (inv: ReceivingInvoice, storeId?: string | null) => {
  if (inv.status !== "posted") return [];
  const rows = receivingActivityRows(inv, storeId ?? inv.storeId);
  return rows.length
    ? [{ kind: "upsert" as const, table: "item_activity_logs", rows, onConflict: "id" }]
    : [];
};

/** Stable UUID children: rebuilding a checkout after a restart reuses the same keys. */
export function stableChildId(parentId: string, group: string, index: number): string {
  const hex = parentId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return crypto.randomUUID();
  const suffix = `${group}${index.toString(16).padStart(11, "0")}`.slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${suffix}`;
}

/* --------------------------- tier name cache --------------------------- */

let tierIdByName: Record<string, string> = {};
let tierNameById: Record<string, MemberTier> = {};

const tierId = (name: MemberTier) => tierIdByName[name] ?? null;
const tierName = (id: string | null): MemberTier => (id && tierNameById[id]) || "Bronze";

/* ------------------------------ bootstrap ------------------------------ */

/**
 * Copy the built-in sample catalogue into the database. Never called on start
 * up — only from the explicit "Load sample data" action, so deleted records
 * stay deleted.
 */
export async function importSampleData() {
  const idMap = new Map<string, string>();
  const products = sampleState.products.map((p) => {
    const id = crypto.randomUUID();
    idMap.set(p.id, id);
    return productToRow({ ...p, id });
  });
  await commitOps("Loading sample catalogue", [
    { kind: "insert", table: "products", rows: products as Row[] },
  ]);

  const members = sampleState.members.map((m) =>
    memberToRow({ ...m, id: crypto.randomUUID() }, tierId),
  );
  await commitOps("Loading sample members", [
    { kind: "insert", table: "members", rows: members as Row[] },
  ]);

  const promotions = sampleState.promotions.map((p) =>
    promotionToRow({
      ...p,
      id: crypto.randomUUID(),
      focProductId: p.focProductId ? idMap.get(p.focProductId) : undefined,
    }),
  );
  await commitOps("Loading sample promotions", [
    { kind: "insert", table: "promotions", rows: promotions as Row[] },
  ]);
}

/** Load every cloud-backed slice of the POS state. */
export type LocationDirectoryResult =
  { ok: true; stores: Store[]; source: "relay" | "direct" } | { ok: false; error: Error };

/**
 * Resolve the small location directory independently of catalogue bootstrap.
 * Registered terminals prefer the proven relay. In particular, an anonymous
 * RLS-filtered `200 []` must never overwrite a relay-visible directory.
 */
export async function loadLocationDirectory(): Promise<LocationDirectoryResult> {
  await hydrateTerminalConfig();
  const registered = Boolean(readTerminalConfig()?.tokenId);
  const cashierToken = await loadCashierToken();
  const relayAvailable = canRelay() && (registered || Boolean(cashierToken));
  let relayError: Error | null = null;

  const relayed = async (): Promise<LocationDirectoryResult | null> => {
    if (!relayAvailable) return null;
    const result = await relayStores();
    if (!result.ok) {
      relayError = new Error(result.error || "Could not verify terminal location access");
      return null;
    }
    return {
      ok: true,
      stores: ((result.rows ?? []) as Row[]).map(rowToStore),
      source: "relay",
    };
  };

  try {
    // PIN-only and registered devices may not yet have a Supabase Auth bearer.
    // The relay already proves both person and terminal, so it is the correct
    // first source and avoids treating an anonymous RLS result as truth.
    const relayFirst = await relayed();
    if (relayFirst) return relayFirst;

    // Never probe the protected directory with only a publishable key. This
    // path is shared by web, Electron and Android, so it must wait for the
    // concrete GoTrue client that owns the verified staff bearer.
    if (!hasStaffSession()) {
      return {
        ok: false,
        error: relayError ?? new Error("No verified cloud staff session is active."),
      };
    }
    const directClient = await authenticatedExternalClientSnapshot();
    if (!directClient) {
      return {
        ok: false,
        error: relayError ?? new Error("The verified cloud staff session is still being restored."),
      };
    }
    const direct = await readAllPages<Row>((from, to, withCount) =>
      directClient
        .from("stores")
        .select("*", withCount ? { count: "exact" } : {})
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(from, to),
    );
    if (!direct.error) {
      // A terminal with a relay must corroborate an empty direct result. This
      // is the exact failure mode produced by a cashier bootstrap race.
      if (!(direct.data ?? []).length) {
        const relayFallback = await relayed();
        if (relayFallback) return relayFallback;
      }
      return { ok: true, stores: (direct.data ?? []).map(rowToStore), source: "direct" };
    }
    const relayFallback = await relayed();
    if (relayFallback) return relayFallback;
    return { ok: false, error: new Error(direct.error.message || "Could not load locations") };
  } catch (error) {
    const relayFallback = await relayed().catch(() => null);
    if (relayFallback) return relayFallback;
    return {
      ok: false,
      error: error instanceof Error ? error : new Error("Could not load locations"),
    };
  }
}

/**
 * Read the complete active catalogue with an immutable ID cursor. Product
 * updates cannot move a row between pages, which avoids the omissions caused
 * by offset windows ordered by mutable updated_at values.
 */
async function loadCompleteProductCatalogue(client: typeof supabase): Promise<PagedRead<Row>> {
  type ProductPageQuery = PromiseLike<PageResult<Row>> & {
    gt: (column: string, value: string) => PromiseLike<PageResult<Row>>;
  };
  const rows: Row[] = [];
  let afterId = "";
  let total: number | null = null;
  for (;;) {
    if (!hasStaffSession()) {
      return {
        data: null,
        error: { message: "The verified staff session ended while loading the catalogue." },
        total,
        capped: false,
      };
    }
    const baseQuery = client
      .from("products")
      .select("*", total === null ? { count: "exact" } : {})
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(PAGE) as unknown as ProductPageQuery;
    const result: PageResult<Row> = await (afterId ? baseQuery.gt("id", afterId) : baseQuery);
    if (result.error) return { data: null, error: result.error, total, capped: false };
    if (total === null) total = typeof result.count === "number" ? result.count : null;
    const page = (result.data as Row[] | null) ?? [];
    rows.push(...page);
    // A full final window is still complete when the exact count says we have
    // reached the end (for example exactly 100,000 products).
    if (total !== null && rows.length >= total)
      return { data: rows.slice(0, total), error: null, total, capped: false };
    if (page.length < PAGE)
      return { data: rows, error: null, total: total ?? rows.length, capped: false };
    if (rows.length >= MAX_ROWS)
      return { data: rows.slice(0, MAX_ROWS), error: null, total, capped: true };
    const lastId = page.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId)
      return {
        data: null,
        error: { message: "Product catalogue pagination returned a row without an ID." },
        total,
        capped: false,
      };
    afterId = lastId;
  }
}

export async function loadCloudState(
  storeId?: string | null,
  locationTask?: Promise<LocationDirectoryResult>,
  onCompanyName?: (name: string) => void,
): Promise<CloudSlice> {
  await hydrateTerminalConfig();
  // A Windows till with no network must not wait for a cloud timeout before
  // loading its durable SQL Server snapshot. Browser and mobile clients have
  // no local bridge, so they continue through the normal online path.
  if (typeof navigator !== "undefined" && !navigator.onLine && localDb())
    return loadLocalState(new Error("Central database is offline."));
  // A PIN-only Electron session intentionally has no Supabase Auth JWT. Its
  // durable SQL Server snapshot is the data source; probing protected cloud
  // tables with only the publishable key creates noisy 42501 errors before the
  // normal fallback runs.
  if (localDb() && !hasStaffSession())
    return loadLocalState(new Error("No direct cloud staff session is active."));
  // Browsers and mobile shells have no local snapshot to fall back to. Do not
  // start a burst of protected table reads from a merely persisted, unverified
  // token while AuthProvider is expiring it.
  if (!hasStaffSession()) {
    throw new Error("No verified cloud staff session is active.");
  }
  const authenticatedClient = await authenticatedExternalClientSnapshot();
  if (!authenticatedClient) {
    throw new Error("The verified cloud staff session is still being restored.");
  }
  // These reads are independent. Start membership tiers alongside the other
  // slices so a full network round trip is not added to every sign-in.
  const [
    tiers,
    products,
    priceOverrides,
    members,
    sales,
    promotions,
    settings,
    settingFields,
    stores,
    shifts,
  ] = await Promise.all([
    authenticatedClient.from("membership_tiers").select("id, name").is("deleted_at", null),
    loadCompleteProductCatalogue(authenticatedClient),
    authenticatedClient
      .from("settings_scoped")
      .select("scope, scope_id, key, value")
      .like("key", "product_price:%")
      .limit(5000),
    authenticatedClient
      .from("members")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(1000),

    (async () => {
      const read = () => {
        let query = authenticatedClient.from("sales").select(saleColumns());
        if (storeId) query = query.eq("store_id", storeId);
        return query.order("created_at", { ascending: false }).limit(500);
      };
      const first = await read();
      if (first.error && isMissingTxnColumn(first.error.message)) {
        forgetTxnColumn(first.error.message);
        return await read();
      }
      return first;
    })(),
    authenticatedClient
      .from("promotions")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(1000),

    // Publish the small identity row as soon as it answers; the catalogue can
    // take many pages, and the shell should not show a placeholder meanwhile.
    authenticatedClient.from("pos_settings").select("*").eq("id", 1).maybeSingle()
      .then((result) => {
        if (!result.error && result.data) onCompanyName?.(settingsText((result.data as Row).company_name));
        return result;
      }),
    (async () => {
      try {
        const rows = await routedQuery("settings_scoped", { limit: 5000 });
        return {
          data: (rows as Row[]).filter((row) => String(row.key ?? "").startsWith("pos_field:")),
          error: null,
        };
      } catch (error) {
        return { data: [] as Row[], error };
      }
    })(),
    locationTask ?? loadLocationDirectory(),
    (async (): Promise<{ data: Row[] | null }> => {
      try {
        const res = await authenticatedClient.rpc(
          "shift_list_secure" as never,
          { p_store_id: storeId ?? null, p_limit: 300 } as never,
        );
        return { data: (res.data as Row[] | null) ?? null };
      } catch {
        return { data: null };
      }
    })(),
  ]);

  const err =
    tiers.error ||
    products.error ||
    (products.capped
      ? new Error(
          `The product catalogue has ${products.total ?? `more than ${MAX_ROWS}`} rows and cannot be loaded completely.`,
        )
      : null) ||
    priceOverrides.error ||
    members.error ||
    sales.error ||
    promotions.error ||
    settings.error ||
    settingFields.error ||
    // Location discovery is critical. `null` means the query did not answer;
    // `[]` is a valid authoritative answer and must be allowed through so stale
    // cached branches are removed instead of being restored.
    (!stores.ok ? stores.error : null);
  if (err) return loadLocalState(err);

  tierIdByName = {};
  tierNameById = {};
  for (const t of tiers.data ?? []) {
    tierIdByName[t.name] = t.id;
    tierNameById[t.id] = t.name as MemberTier;
  }

  const terminal = readTerminalConfig();
  const activeStore = stores.ok ? stores.stores.find((store) => store.id === storeId) : undefined;
  return {
    products: applyScopedProductPrices(
      [...new Map((products.data ?? []).map((row) => [String(row.id), row])).values()].map(
        rowToProduct,
      ),
      (priceOverrides.data ?? []) as Row[],
      { branchId: storeId, terminalId: terminal?.tokenId, clusterId: activeStore?.groupId },
    ),
    members: (members.data ?? []).map((m) => rowToMember(m, tierName)),
    sales: (sales.data ?? []).map(rowToSale),
    promotions: (promotions.data ?? []).map(rowToPromotion),
    settings: rowToSettings(applySettingsFields(settings.data as Row | null, settingFields.data)),
    stores: stores.ok ? stores.stores : [],
    shifts: ((shifts.data as Row[] | null) ?? []).map(rowToShift),
  };
}

/**
 * Read from the database that owns the running platform.
 *
 * An activated Electron till is SQL Server local-first even while the network
 * is available. Cloud reads are reserved for browser/mobile clients and for a
 * desktop installation whose local database is deliberately disabled. This
 * keeps locally committed, not-yet-synced receipts visible after a restart.
 */
export async function loadPrimaryState(
  storeId?: string | null,
  locationTask?: Promise<LocationDirectoryResult>,
  onCompanyName?: (name: string) => void,
): Promise<CloudSlice> {
  const bridge = localDb();
  if (effectiveDatabaseMode() === "local" && bridge?.snapshot) {
    const status = await bridge.database?.getState?.().catch(() => null);
    if (status?.enabled && status.connected && (status.tradingReady ?? status.connected)) {
      return loadLocalState(
        new Error("The connected local SQL Server snapshot could not be read."),
      );
    }
    if (status?.enabled && status.tradingReady === false) {
      const terminal = readTerminalConfig() ?? (await hydrateTerminalConfig());
      // A freshly installed or recovered desktop can have a saved SQL Server
      // connection before it has a branch identity. An authenticated admin
      // still needs the central location directory in order to register this
      // machine; treating EBRANCH as a fatal local-database error deadlocks
      // that recovery screen. RLS remains the authority for this cloud read.
      if (!terminal?.locationId && hasStaffSession()) {
        return loadCloudState(storeId, locationTask, onCompanyName);
      }
      throw new Error(
        "Local SQL Server is enabled but not ready for trading. Open Database & Cloud Connection, restore the connection, and apply the current local database update if requested.",
      );
    }
  }
  return loadCloudState(storeId, locationTask, onCompanyName);
}

/** Refresh a settings notification without downloading the whole POS state. */
export async function loadCloudSettings(): Promise<AppSettings> {
  const [rows, fields] = await Promise.all([
    routedQuery("pos_settings", { match: { id: 1 }, limit: 1 }),
    routedQuery("settings_scoped", { limit: 5000 }).then((rows) =>
      (rows as Row[]).filter((row) => String(row.key ?? "").startsWith("pos_field:")),
    ),
  ]);
  return rowToSettings(applySettingsFields((rows[0] as Row | undefined) ?? null, fields as Row[]));
}

/**
 * Fetch changed catalogue rows after a pull/Realtime invalidation.
 *
 * A delta page can contain hundreds of products. Keep that as one bounded
 * `id IN (...)` read instead of turning it into hundreds of simultaneous
 * one-row requests, which Chromium eventually rejects with
 * ERR_INSUFFICIENT_RESOURCES.
 */
export async function loadCloudProducts(ids: string[]): Promise<Product[]> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const rows: Row[] = [];
  for (let start = 0; start < wanted.length; start += 500) {
    const group = wanted.slice(start, start + 500);
    rows.push(
      ...(await routedQuery("products", {
        match: { deleted_at: null },
        in: { column: "id", values: group },
        limit: group.length,
      })),
    );
  }
  return rows.map((row) => rowToProduct(row));
}

/** Fetch one changed catalogue row after a Realtime invalidation. */
export async function loadCloudProduct(id: string): Promise<Product | null> {
  return (await loadCloudProducts([id]))[0] ?? null;
}

/** Fetch one changed member without re-reading the full member directory. */
export async function loadCloudMember(id: string): Promise<Member | null> {
  const rows = await routedQuery("members", { match: { id, deleted_at: null }, limit: 1 });
  return rows[0] ? rowToMember(rows[0] as Row, tierName) : null;
}

/** Bounded, indexed member lookup used when the in-memory bootstrap window is insufficient. */
export async function searchCloudMembers(term: string, limit = 10): Promise<Member[]> {
  const needle = term.replace(/[(),*]/g, " ").trim();
  if (!needle) return [];
  const like = `%${needle}%`;
  const res = await supabase
    .from("members")
    .select("*")
    .is("deleted_at", null)
    .or(
      [
        `name.ilike.${like}`,
        `phone.ilike.${like}`,
        `code.ilike.${like}`,
        `email.ilike.${like}`,
      ].join(","),
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (res.error || !res.data) return [];
  return (res.data as Row[]).map((row) => rowToMember(row, tierName));
}

/** Fetch one changed promotion without re-reading the full promotion set. */
export async function loadCloudPromotion(id: string): Promise<Promotion | null> {
  const rows = await routedQuery("promotions", { match: { id, deleted_at: null }, limit: 1 });
  return rows[0] ? rowToPromotion(rows[0] as Row) : null;
}

async function loadLocalState(cause: unknown): Promise<CloudSlice> {
  const bridge = localDb();
  if (!bridge) throw cause;
  const result = await bridge.snapshot();
  if (!result.ok) {
    throw new Error(
      result.error ??
        (cause instanceof Error
          ? cause.message
          : "The local SQL Server snapshot could not be read."),
    );
  }
  tierIdByName = {};
  tierNameById = {};
  for (const tier of result.tiers ?? []) {
    const name = String(tier.name ?? "Member") as MemberTier;
    tierIdByName[name] = String(tier.id);
    tierNameById[String(tier.id)] = name;
  }
  return {
    products: (result.products ?? []).map(rowToProduct),
    members: (result.members ?? []).map((row) => rowToMember(row, tierName)),
    sales: (result.sales ?? []).map(rowToSale),
    promotions: (result.promotions ?? []).map(rowToPromotion),
    settings: rowToSettings(
      applySettingsFields(
        (result.settings as Row | null) ?? null,
        (result.settingFields as Row[] | undefined) ?? [],
      ),
    ),
    stores: (result.stores ?? []).map(rowToStore),
    shifts: (result.shifts ?? []).map(rowToShift),
  };
}

/** Read the current branch's complete receipt graphs from Electron SQL Server. */
export async function loadLocalSales(): Promise<Sale[]> {
  const bridge = localDb();
  if (!bridge?.snapshot) return [];
  const result = await bridge.snapshot();
  if (!result.ok) throw new Error(result.error ?? "Could not read local sales.");
  return (result.sales ?? []).map(rowToSale);
}

/* ------------------------------- writers ------------------------------- */

/**
 * The one authoritative "is the till open?" question.
 *
 * Strictly status-driven: a shift opened on any past date stays active until
 * something explicitly closes it. No date or time filtering here, ever.
 */
/**
 * The open shift according to this terminal's own copy. `undefined` means the
 * terminal has no copy to answer with, which is different from "no shift".
 */
async function localOpenShift(storeId: string): Promise<Shift | null | undefined> {
  if (!localDb()?.query) return undefined;
  const rows = await routedQuery("shifts", {
    match: { store_id: storeId, status: "OPEN" },
    orderBy: { column: "opened_at", ascending: false },
    limit: 1,
  });
  return rows[0] ? rowToShift(rows[0] as Row) : null;
}

export async function loadActiveShift(storeId: string): Promise<Shift | null> {
  const local = await localOpenShift(storeId);
  if (local !== undefined) return local;
  // A cashier signed in with a PIN has no account on the central database, so
  // the direct read is refused or filtered out. The proven server relay answers
  // for those tills — without it the register would flip back to "locked"
  // moments after a shift was opened.
  if (hasStaffSession()) {
    // The server routine answers for every staff account, whatever branch is
    // written on their profile, and hands back the whole row in one call.
    const rpc = await supabase.rpc(
      "shift_active_secure" as never,
      {
        p_store_id: storeId,
      } as never,
    );
    if (!rpc.error) {
      const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as Row | null;
      return row?.id ? rowToShift(row) : null;
    }
    // Direct `select=*` is intentionally forbidden because tender/count
    // columns are permission-redacted by the secure RPC. Relay if the RPC is
    // unavailable; retrying the forbidden table query only creates 403 noise.
    if (!canRelay()) throw rpc.error;
  }

  if (!canRelay()) {
    const local = await localOpenShift(storeId);
    if (local !== undefined) return local;
    throw new Error("This till cannot read the central database yet");
  }
  const relayed = await relayActiveShift(storeId);
  if (!relayed.ok) {
    const local = await localOpenShift(storeId);
    if (local !== undefined) return local;
    throw new Error(relayed.error ?? "Could not read the open shift");
  }
  return relayed.row ? rowToShift(relayed.row as Row) : null;
}

/**
 * Open a shift through the server routine, which stores the row and hands the
 * stored record straight back — no second, rule-checked read to unlock the
 * till. Returns `null` when the central database cannot be reached, so the
 * caller falls back to the usual local/offline commit path.
 */
export async function openShiftOnServer(s: Shift): Promise<Shift | null> {
  // A desktop till is local-first even while the network is healthy. Writing
  // the cloud first here made shift opening depend on internet latency and
  // bypassed SQL Server Change Tracking. The normal commit path below stores
  // it locally and the background coordinator publishes it afterwards.
  if (localDb()?.writeBatch) return null;
  if (!hasStaffSession()) return null;
  try {
    const res = await supabase.rpc(
      "shift_open" as never,
      {
        p_id: s.id,
        p_store_id: s.storeId,
        p_opened_by_name: s.cashier,
        p_opening_float: s.openingFloat,
        p_terminal_id: s.terminalId ?? null,
        p_terminal_name: s.terminalName ?? null,
        p_opened_by_staff_id: s.openedByStaffId ?? null,
        p_opened_by_role: s.openedByRole ?? null,
        p_user_id: s.userId ?? null,
      } as never,
    );
    if (res.error) return null;
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as Row | null;
    return row?.id ? rowToShift(row) : null;
  } catch {
    return null;
  }
}

/**
 * One page of older bills for a branch, newest first.
 *
 * Keyset paging on `(created_at, id)`: the register keeps the most recent 500
 * bills in memory, and history screens walk further back a page at a time
 * without ever paying for an OFFSET.
 */
export async function loadSalesPage(
  storeId: string,
  cursor: Cursor = null,
  limit = PAGE_SIZE,
): Promise<Page<Sale>> {
  if (localDb()?.query) {
    const heads = (await routedQuery("sales", {
      match: { store_id: storeId },
      orderBy: { column: "created_at", ascending: false },
      ...(cursor ? { cursor: { column: "created_at", value: cursor.ts, id: cursor.id } } : {}),
      limit,
    })) as Row[];
    const items: Row[] = [];
    const ids = heads.map((row) => String(row.id));
    for (let start = 0; start < ids.length; start += 50) {
      items.push(
        ...((await routedQuery("sale_items", {
          in: { column: "sale_id", values: ids.slice(start, start + 50) },
          limit: 2000,
        })) as Row[]),
      );
    }
    const bySale = new Map<string, Row[]>();
    for (const item of items) {
      const saleId = String(item.sale_id);
      bySale.set(saleId, [...(bySale.get(saleId) ?? []), item]);
    }
    const complete = heads.map((row) => ({ ...row, sale_items: bySale.get(String(row.id)) ?? [] }));
    return {
      rows: complete.map(rowToSale),
      cursor: nextCursor(complete, "created_at", limit),
      hasMore: complete.length >= limit,
    };
  }
  const query = () => {
    let q = supabase.from("sales").select(saleColumns());
    if (storeId) q = q.eq("store_id", storeId) as typeof q;
    return keyset(q as never, "created_at", cursor, limit);
  };
  let res = await query();
  let err = (res as { error?: { message: string } }).error;
  if (err && isMissingTxnColumn(err.message)) {
    forgetTxnColumn(err.message);
    res = await query();
    err = (res as { error?: { message: string } }).error;
  }
  if (err) {
    throw new Error(err.message);
  }
  const rows = ((res as { data?: Row[] | null }).data ?? []) as Row[];
  return {
    rows: rows.map(rowToSale),
    cursor: nextCursor(rows, "created_at", limit),
    hasMore: rows.length >= limit,
  };
}

/** Recent sign-in sessions for a branch, newest first. */
export async function loadShiftSessions(storeId: string, limit = 200): Promise<ShiftSession[]> {
  const rows = await routedQuery("shift_sessions", {
    match: { store_id: storeId },
    orderBy: { column: "signed_in_at", ascending: false },
    limit,
  });
  return rows.map(rowToShiftSession);
}

/* --------------------- receiving invoices (purchase orders) -------------- */

export type ReceivingLine = {
  id: string;
  productId: string | null;
  barcode: string;
  sku: string;
  name: string;
  cost: number;
  price: number;
  qty: number;
};

/** Lifecycle of a receiving order: unfinished, received, or abandoned. */
export type ReceivingStatus = "draft" | "posted" | "cancelled";

export type ReceivingInvoice = {
  id: string;
  /** Our own goods-received number, minted when the draft is created. */
  reference: string | null;
  /** The supplier's invoice number, typed in from their paperwork. */
  invoiceNo: string;
  supplier: string;
  supplierId: string | null;
  operator: string;
  storeId: string | null;
  storeCode: string | null;
  invoiceDate: string | null;
  entryDate: string;
  totalCost: number;
  itemCount: number;
  createdAt: string;
  /** Legacy rows carry no status; they are treated as posted. */
  status: ReceivingStatus;
  /** Set while an edit of this posted entry waits for approval. */
  pendingEditRequestId: string | null;
  pendingEditBy: string | null;
  lines: ReceivingLine[];
};

const rowToReceivingLine = (r: Row): ReceivingLine => ({
  id: r.id,
  productId: r.product_id ?? null,
  barcode: r.barcode ?? "",
  sku: r.sku ?? r.barcode ?? "",
  name: r.product_name ?? "",
  cost: num(r.cost_price),
  price: num(r.selling_price),
  qty: num(r.quantity_received),
});

const rowToReceivingInvoice = (r: Row): ReceivingInvoice => ({
  id: r.id,
  reference: r.reference ?? null,
  invoiceNo: r.po_number ?? "",
  supplier: r.supplier_name ?? "",
  supplierId: r.supplier_id ?? null,
  operator: r.operator_name ?? "",
  storeId: r.store_id ?? null,
  storeCode: r.store_code ?? null,
  invoiceDate: r.invoice_date ?? null,
  entryDate: r.invoice_entry_date ?? r.created_at ?? new Date().toISOString(),
  totalCost: num(r.total_cost),
  itemCount: num(r.total_items_count),
  createdAt: r.created_at ?? new Date().toISOString(),
  status: (r.status as ReceivingStatus) || "posted",
  pendingEditRequestId: r.pending_edit_request_id ?? null,
  pendingEditBy: r.pending_edit_by ?? null,
  lines: (Array.isArray(r.purchase_order_items) ? (r.purchase_order_items as Row[]) : []).map(
    rowToReceivingLine,
  ),
});

const invoiceRow = (inv: ReceivingInvoice): Row => ({
  id: inv.id,
  reference: inv.reference,
  po_number: inv.invoiceNo,
  supplier_name: inv.supplier,
  supplier_id: inv.supplierId,
  operator_name: inv.operator,
  store_id: inv.storeId,
  store_code: inv.storeCode,
  invoice_date: inv.invoiceDate,
  invoice_entry_date: inv.entryDate,
  total_cost: inv.totalCost,
  total_items_count: inv.itemCount,
  status: inv.status ?? "posted",
});

const invoiceLineRow = (poId: string, l: ReceivingLine): Row => ({
  id: l.id,
  po_id: poId,
  product_id: l.productId,
  barcode: l.barcode,
  sku: l.sku || l.barcode || null,
  product_name: l.name,
  cost_price: l.cost,
  selling_price: l.price,
  quantity_received: l.qty,
  subtotal_cost: Number((l.cost * l.qty).toFixed(2)),
});

/**
 * Receiving invoices for a branch, newest first, with their lines.
 *
 * Invoices saved before this screen carried a branch have no `store_id`; they
 * are included so nothing that was already recorded disappears from view.
 */
export async function loadReceivingInvoices(
  storeId: string | null,
  limit = 100,
  allStores = false,
  status: ReceivingStatus | "any" = "posted",
): Promise<ReceivingInvoice[]> {
  if (effectiveDatabaseMode() === "local" && localDb()?.query) {
    // A locally committed draft must remain visible even before cloud sync.
    // SQL Server enforces terminal branch scope for both headers and lines.
    const statuses = status === "posted" ? ["posted", null] : [status];
    const heads = (await Promise.all(statuses.map((value) =>
      routedQuery("purchase_orders", {
        ...(value === "any" ? {} : { match: { status: value } }),
        orderBy: { column: "invoice_entry_date", ascending: false },
        limit,
      }),
    ))).flat()
      .filter((row) => allStores || !storeId || row.store_id === storeId || row.store_id == null)
      .sort((a, b) => String(b.invoice_entry_date ?? b.created_at ?? "")
        .localeCompare(String(a.invoice_entry_date ?? a.created_at ?? "")))
      .slice(0, limit);
    const lines: Row[] = [];
    for (let start = 0; start < heads.length; start += 500) {
      const ids = heads.slice(start, start + 500).map((row) => row.id);
      for (let offset = 0; ; offset += 2000) {
        const page = await routedQuery("purchase_order_items", {
          in: { column: "po_id", values: ids }, limit: 2000, offset,
        });
        lines.push(...page);
        if (page.length < 2000) break;
      }
    }
    const byOrder = new Map<string, Row[]>();
    for (const line of lines) {
      const key = String(line.po_id);
      byOrder.set(key, [...(byOrder.get(key) ?? []), line]);
    }
    return heads.map((row) => rowToReceivingInvoice({
      ...row, purchase_order_items: byOrder.get(String(row.id)) ?? [],
    }));
  }
  let q = supabase
    .from("purchase_orders" as never)
    .select("*, purchase_order_items(*)")
    .order("invoice_entry_date", { ascending: false })
    .limit(limit);
  // Rows written before drafts existed have no status; they are received stock.
  if (status !== "any") {
    q = (
      status === "posted" ? q.or("status.eq.posted,status.is.null") : q.eq("status", status)
    ) as typeof q;
  }
  if (storeId && !allStores) {
    // PostgREST needs the literal quoted; branch ids are free text and may hold
    // a comma, dot or space that would otherwise break the filter (400).
    const quoted = `"${storeId.replace(/"/g, '\\"')}"`;
    q = q.or(`store_id.eq.${quoted},store_id.is.null`) as typeof q;
  }
  const res = await q;
  if (res.error) throw res.error;
  return ((res.data as Row[] | null) ?? []).map(rowToReceivingInvoice);
}

/** Complete posted receiving history for reports that derive product arrival dates. */
export async function loadCompleteReceivingHistory(
  storeId: string | null,
  allStores = false,
): Promise<ReceivingInvoice[]> {
  const result = await readAllPages<Row>((from, to, withCount) => {
    let query = supabase
      .from("purchase_orders" as never)
      .select("*, purchase_order_items(*)", withCount ? { count: "exact" } : {})
      .or("status.eq.posted,status.is.null")
      .order("invoice_entry_date", { ascending: false })
      .order("id", { ascending: false });
    if (storeId && !allStores) {
      const quoted = `"${storeId.replace(/"/g, '\\"')}"`;
      query = query.or(`store_id.eq.${quoted},store_id.is.null`) as typeof query;
    }
    return query.range(from, to);
  });
  if (result.error) throw result.error;
  if (result.capped)
    throw new Error(
      `Receiving history is incomplete (${result.data?.length ?? 0} of ${result.total ?? "more"} rows).`,
    );
  return (result.data ?? []).map(rowToReceivingInvoice);
}

/** Unfinished receiving orders for a branch, newest first. */
export const loadReceivingDrafts = (storeId: string | null, allStores = false) =>
  loadReceivingInvoices(storeId, 50, allStores, "draft");

/**
 * True when another *finalized* invoice already uses this number. Drafts are
 * ignored: their number is provisional until the order is posted.
 */
export async function invoiceNumberTaken(invoiceNo: string, exceptId?: string): Promise<boolean> {
  if (effectiveDatabaseMode() === "local" && localDb()?.query) {
    const rows = await routedQuery("purchase_orders", { match: { po_number: invoiceNo }, limit: 20 });
    return rows.some((r) => r.id !== exceptId && (r.status ?? "posted") === "posted");
  }
  const res = await supabase
    .from("purchase_orders" as never)
    .select("id, status")
    .eq("po_number", invoiceNo)
    .limit(20);
  if (res.error) return false; // offline: the unique index is still the last word
  return ((res.data as Row[] | null) ?? []).some(
    (r) => r.id !== exceptId && (r.status ?? "posted") === "posted",
  );
}

/** Latest catalogue rows for a set of products, straight from the database. */
export async function loadProductsByIds(
  ids: string[],
  scope: { branchId?: string | null; clusterId?: string | null } = {},
): Promise<Product[]> {
  if (!ids.length) return [];
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    rows.push(
      ...((await routedQuery("products", {
        in: { column: "id", values: ids.slice(start, start + 500) },
        limit: 500,
      })) as Row[]),
    );
  }
  const terminal = readTerminalConfig();
  const overrides = await routedQuery("settings_scoped", { limit: 5000 }).catch(() => [] as Row[]);
  return applyScopedProductPrices(rows.map(rowToProduct), overrides as Row[], {
    branchId: scope.branchId ?? terminal?.locationId,
    terminalId: terminal?.tokenId,
    clusterId: scope.clusterId,
  });
}

/**
 * Writes never hit the network directly.
 *
 * Until the final Windows SQL Server release gate, every platform writes
 * centrally and surfaces failure without persisting business payloads in the renderer.
 */
const queue = (context: string, op: SyncOp) => {
  // Legacy-shaped model helpers return the authoritative acknowledgement.
  // Callers must await this promise before changing business UI state.
  return commitOps(context, [op]);
};

/**
 * Best-effort write, routed exactly like `queue`, but a failure is recorded in
 * diagnostics instead of interrupting the cashier. Used for visibility-only
 * records — the sign-in log, drawer openings — which must never stop trading
 * on a till whose database has not had the latest script applied.
 */
const queueSoft = (context: string, op: SyncOp) => {
  const note = (e: unknown) =>
    recordDiagnostic({ kind: "soft_write_failed", entity: op.table, code: reasonCode(e) });
  void commitOps(context, [op]).catch(note);
};

/** Does this failure mean "a bill with that number is already stored"? */
export function isDuplicateBillNumber(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  if (e?.code === "23505") return true;
  const text = String(e?.message ?? error ?? "").toLowerCase();
  return (
    /duplicate|already exists|unique constraint|unique index|violation of unique/.test(text) &&
    /bill_number|receipt|sales/.test(text)
  );
}

/* ---------------------------- durable commits --------------------------- */

/** Where a committed change actually landed. */
export type CommitTarget = "cloud" | "local" | "offline";

/**
 * Copy rows that are already safe centrally onto this terminal, in the
 * background. A failure here is only written to the sync log: the sale is
 * finished and the operator must never be interrupted for it.
 */
export async function mirrorToLocal(context: string, ops: SyncOp[]) {
  void context;
  void ops;
}

/** One relative stock change, keyed on the movement row that caused it. */
/** Apply stock movements immediately; an online refusal fails the operation. */
async function applyStockDeltas(deltas: StockDelta[]) {
  if (deltas.length) await applyStockDeltaBatch(deltas);
}

/** Run one batch directly against the central database in order. */
async function runBatchLive(context: string, ops: SyncOp[]) {
  for (const op of ops) await runOpLive(context, op);
}

/**
 * Store a group of writes and only resolve once they are committed to the
 * cloud database or the local desktop database.
 *
 * Callers await this before printing, clearing the cart or starting the next
 * action — nothing moves on while the data is still only in memory.
 */
export async function commitOps(context: string, ops: SyncOp[]): Promise<CommitTarget> {
  if (!ops.length) return noteCommitTarget("cloud");
  // A packaged or browser till may carry an encrypted tenant override. Never
  // let an early write resolve the client against the build-time tenant first.
  await hydrateTerminalConfig();

  // Stock never travels centrally as an absolute figure: the movement rows go
  // up and the central database applies each one as a relative change, keyed
  // on the movement id so a retry can never deduct twice. The terminal copy
  // still receives the full row, so the till shows the new count at once.
  const { ops: cloudOps, deltas } = withRelativeStock(ops);

  const local = localDb();
  if (local?.writeBatch) {
    const state = await local.database?.getState?.().catch(() => null);
    if (state?.enabled && state?.connected && (state.tradingReady ?? state.connected)) {
      const refund =
        ops.length === 1 && ops[0].kind === "rpc" && ops[0].fn === "sale_refund" ? ops[0] : null;
      const sharedPosSettings = ops.some((op) => op.table === "pos_settings") &&
        ops.every((op) => op.table === "pos_settings" || op.table === "settings_scoped");
      const aggregateKind = sharedPosSettings
        ? "settings"
        : /sale/i.test(context)
          ? "sale"
          : /payment|tender/i.test(context)
            ? "payment"
            : /refund/i.test(context)
              ? "refund"
              : /shift/i.test(context)
                ? "shift"
                : /product|inventory/i.test(context)
                  ? "product"
                  : /receiv|purchase|invoice/i.test(context)
                    ? "receiving"
                    : /stock/i.test(context)
                      ? "stock"
                      : /transfer/i.test(context)
                        ? "transfer"
                        : /booking/i.test(context)
                          ? "booking"
                          : /hold|ticket/i.test(context)
                            ? "held_order"
                            : "general";
      const branchRow = ops
        .flatMap((op): Row[] => {
          if (op.kind === "insert" || op.kind === "upsert") return op.rows as Row[];
          if (op.kind === "update") return [{ ...op.match, ...op.values } as Row];
          if (op.kind === "delete") return [op.match as Row];
          return [op.args as Row];
        })
        .find(
          (row) =>
            row &&
            ("store_id" in row ||
              "branch_id" in row ||
              "from_store_id" in row ||
              "to_store_id" in row),
        );
      const branchId = String(
        branchRow?.store_id ??
          branchRow?.branch_id ??
          branchRow?.from_store_id ??
          branchRow?.to_store_id ??
          "",
      );
      const stored =
        refund && local.refundReceipt
          ? await local.refundReceipt({
              saleId: String(refund.args._sale_id),
              refundId: String(refund.args._client_refund_id),
              branchId: String((refund.args as Record<string, unknown>)._branch_id ?? ""),
              reason: refund.args._reason == null ? null : String(refund.args._reason),
            })
          : local.commitAggregate && aggregateKind !== "settings"
            ? await local.commitAggregate({
                kind: aggregateKind,
                branchId: branchId || undefined,
                operations: ops,
              })
            : await local.writeBatch(context, ops);
      if (!stored.ok) {
        throw Object.assign(new Error(stored.error ?? `${context} was not committed locally.`), {
          code: stored.code,
          stage: stored.stage,
          table: stored.table,
          sqlNumber: stored.sqlNumber,
        });
      }
      return noteCommitTarget("local");
    }
    if (state?.enabled && state?.connected && state.tradingReady === false) {
      throw new Error(
        "Local SQL Server is connected, but its POS schema is not ready. Open Database & Cloud Connection and apply the current local database update before taking payment.",
      );
    }
  }

  const operational = ops.every((op) => isOperationalTable(op.table));
  // Browser/Capacitor has no SQL Server. Keep only this pending batch in
  // IndexedDB before starting the network request, then remove it immediately
  // after a confirmed cloud commit. This closes the tab/app-close loss window
  // without turning the browser cache into a second permanent database.
  const pendingId = await persistBrowserBatch(context, ops, { wake: false }).catch(() => null);
  try {
    await runBatchLive(context, cloudOps);
    await applyStockDeltas(deltas);
    if (pendingId) await acknowledgeBrowserBatch(pendingId);
    noteConnectionRestored();
    setCloudDirect(operational);
    return noteCommitTarget("cloud");
  } catch (cloud) {
    if (!isConnectionError(cloud)) {
      if (pendingId) await acknowledgeBrowserBatch(pendingId).catch(() => undefined);
      throw cloud;
    }
    noteConnectionLost();
    if (pendingId) {
      wakeBrowserOutbox();
      return noteCommitTarget("offline");
    }
    throw new AllTargetsFailed(context, cloud);
  }
}

/** Human wording for a completed commit. */
export const commitLabel = (t: CommitTarget) =>
  t === "cloud" ? "Saved" : t === "local" ? "Saved on this terminal" : "Saved offline — will sync";

let lastTarget: CommitTarget = "cloud";
/** Where the most recent successful commit landed (for the "Saved…" note). */
export const lastCommitTarget = () => lastTarget;
export const noteCommitTarget = (t: CommitTarget) => {
  lastTarget = t;
  return t;
};

export type StockAdjustmentInput = {
  id?: string;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  storeId: string | null;
  terminalId?: string | null;
  reason: string;
  note?: string;
  previousStock: number;
  updatedStock: number;
  delta: number;
  costImpact?: number;
  staffId?: string | null;
  staffName?: string | null;
  role?: string | null;
  draftId?: string | null;
  at?: string;
};

export type ProductImportMovement = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  storeId: string;
  terminalId?: string | null;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  unitCost: number;
  staffId?: string | null;
  staffName?: string | null;
  role?: string | null;
  reference: string;
  createdAt?: string;
};

const productImportMovementToRow = (movement: ProductImportMovement): Row => ({
  id: movement.id,
  product_id: movement.productId,
  product_name: movement.productName,
  sku: movement.sku || null,
  barcode: movement.barcode || null,
  store_id: movement.storeId,
  terminal_id: movement.terminalId ?? null,
  activity_type: "adjustment",
  reference: movement.reference,
  quantity_delta: Math.round(movement.quantityDelta),
  stock_before: Math.round(movement.stockBefore),
  stock_after: Math.round(movement.stockAfter),
  unit_cost: movement.unitCost,
  staff_id: movement.staffId ?? null,
  staff_name: movement.staffName ?? null,
  role: movement.role ?? null,
  note: "Bulk inventory import",
  created_at: movement.createdAt ?? new Date().toISOString(),
});

const stockAdjustmentToRow = (row: StockAdjustmentInput): Row => ({
  id: row.id ?? crypto.randomUUID(),
  product_id: row.productId,
  product_name: row.productName,
  sku: row.sku,
  store_id: row.storeId,
  terminal_id: row.terminalId ?? null,
  reason: row.reason,
  note: row.note ?? "",
  previous_stock: Math.round(row.previousStock),
  updated_stock: Math.round(row.updatedStock),
  delta: Math.round(row.delta),
  cost_impact: row.costImpact ?? 0,
  staff_id: row.staffId ?? null,
  staff_name: row.staffName ?? null,
  role: row.role ?? null,
  draft_id: row.draftId ?? null,
  created_at: row.at ?? new Date().toISOString(),
});

export const db = {
  upsertProduct: (p: Product) =>
    queue("Saving product", { kind: "upsert", table: "products", rows: [productToRow(p)] }),
  upsertProducts: (list: Product[]) => {
    if (!list.length) return;
    queue("Saving products", { kind: "upsert", table: "products", rows: list.map(productToRow) });
  },
  deleteProduct: (id: string) =>
    queue("Deleting product", { kind: "delete", table: "products", match: { id } }),
  /**
   * Asks the database which records still point at a product before anything
   * is deleted, so the screen can explain the refusal instead of relying on a
   * raw constraint error. A guard that cannot be reached returns null and the
   * delete goes ahead — the foreign keys are still the final word.
   */
  /**
   * Delete a product and wait for the answer.
   *
   * Unlike the queued version this surfaces a refusal from the database (for
   * example the item is on past bills) so the screen can explain it instead of
   * silently dropping the row. A plain connectivity failure still falls back to
   * the durable queue.
   */
  deleteProductNow: async (id: string): Promise<void> => {
    const op: SyncOp = { kind: "delete", table: "products", match: { id } };
    const bridge = localDb();
    if (bridge) {
      await commitOps("Deleting product", [op]);
      return;
    }
    try {
      const guard = await productDeleteBlock(id);
      if (guard.state === "blocked") throw new Error(`${guard.code}: ${guard.reason}`);
      if (guard.state === "unknown")
        throw new Error(
          "PRODUCT_DELETE_UNVERIFIED: we could not confirm this product is safe to remove — try again",
        );
      await runOpLive("Deleting product", op);
    } catch (e) {
      const message = (e as { message?: string })?.message ?? String(e);
      if (isLinkedRecordError(message)) throw e instanceof Error ? e : new Error(message);
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (
        effectiveDatabaseMode() === "local" &&
        (offline || /failed to fetch|network|timeout/i.test(message))
      ) {
        await commitOps("Deleting product", [op]);
        return;
      }
      throw e instanceof Error ? e : new Error(message);
    }
  },

  upsertStore: (s: Store) =>
    queue("Saving location", { kind: "upsert", table: "stores", rows: [storeToRow(s)] }),
  upsertStores: (list: Store[]) => {
    if (!list.length) return;
    queue("Saving locations", { kind: "upsert", table: "stores", rows: list.map(storeToRow) });
  },
  // Locations are archived, never deleted — receipts and reports must keep
  // resolving them forever.

  upsertMember: (m: Member) =>
    queue("Saving member", { kind: "upsert", table: "members", rows: [memberToRow(m, tierId)] }),
  deleteMember: (id: string) =>
    queue("Deleting member", { kind: "delete", table: "members", match: { id } }),

  upsertPromotion: (p: Promotion) =>
    queue("Saving promotion", { kind: "upsert", table: "promotions", rows: [promotionToRow(p)] }),
  deletePromotion: (id: string) =>
    queue("Deleting promotion", { kind: "delete", table: "promotions", match: { id } }),

  upsertShift: (s: Shift) =>
    queue("Saving shift", { kind: "upsert", table: "shifts", rows: [shiftToRow(s)] }),

  // Sign-in visibility only: a till on an older database must keep trading.
  upsertShiftSession: (s: ShiftSession) =>
    queueSoft("Saving shift sign-in", {
      kind: "upsert",
      table: "shift_sessions",
      rows: [shiftSessionToRow(s)],
    }),

  saveSettings: (s: AppSettings) =>
    queue("Saving settings", {
      kind: "upsert",
      table: "pos_settings",
      rows: [settingsToRow(s)],
    }),

  /**
   * Explicit "Save settings" from a settings page: writes the whole record and
   * waits for confirmation, so the page can say whether it really landed.
   */
  async saveSettingsNow(s: AppSettings, patch?: Partial<AppSettings>): Promise<void> {
    const fieldSourceRow = patch ? settingsPatchRow(s, patch) : buildSettingsRow(s);
    const snapshotRow = { ...fieldSourceRow };
    missingSettingsColumns.forEach((column) => delete snapshotRow[column]);
    const fieldRows = settingsFieldRows(fieldSourceRow);
    const op: SyncOp = {
      kind: "upsert",
      table: "pos_settings",
      rows: [snapshotRow],
    };
    const fieldOp: SyncOp = {
      kind: "upsert",
      table: "settings_scoped",
      rows: fieldRows,
      onConflict: "scope,scope_id,key",
    };
    const bridge = localDb();
    if (bridge) {
      await commitOps("Saving settings", [fieldOp, op]);
      return;
    }
    const op2: SyncOp = op;
    let res: { error: { message: string } | null };
    try {
      const fields = await supabase.from("settings_scoped").upsert(fieldRows as never);
      if (fields.error) throw new Error(fields.error.message);
      res = await supabase.from("pos_settings").upsert(snapshotRow as never);
    } catch (e) {
      // The line is down: park the change so it lands when it is back.
      if (!isConnectionError(e)) throw e;
      await commitOps("Saving settings", [fieldOp, op2]);
      return;
    }
    if (!res.error) {
      await broadcastSettingsChange("pos_settings");
      return;
    }
    if (isConnectionError(new Error(res.error.message))) {
      await commitOps("Saving settings", [fieldOp, op2]);
      return;
    }
    // The database is missing a newer column: drop it and save the rest, so a
    // single missing field never blocks the whole settings record.
    const col = unknownSettingsColumn(res.error.message);
    if (!col) throw new Error(res.error.message);
    missingSettingsColumns.add(col);
    const compatibleRow = { ...snapshotRow };
    delete compatibleRow[col];
    const retry = await supabase.from("pos_settings").upsert(compatibleRow as never);
    if (retry.error) throw new Error(retry.error.message);
    await broadcastSettingsChange("pos_settings");
    if (import.meta.env.DEV) console.warn(`[settings] compatibility column unavailable: ${col}`);
  },

  /*
   * There is deliberately no fire-and-forget sale writer here. A bill is only
   * real once it is stored, so the register awaits `commitSale` and shows the
   * failure; an unawaited version would let a checkout finish and print while
   * the sale was quietly lost.
   */

  /**
   * Hand a bill back. The till sends only the bill and the refund's own id:
   * the database works out how much may still be returned, puts exactly that
   * much stock back, and marks the bill. Replaying the same refund id (retry,
   * double tap, queued replay) changes nothing a second time.
   */
  refundSale(saleId: string, refundId: string, reason?: string, branchId?: string) {
    return queue("Refunding sale", {
      kind: "rpc",
      table: "sales",
      fn: "sale_refund",
      args: {
        _sale_id: saleId,
        _lines: null,
        _client_refund_id: refundId,
        _reason: reason ?? null,
        _branch_id: branchId ?? null,
      },
    });
  },

  /** Correct the tender recorded against a completed bill (e.g. card -> cash). */
  updateSalePayment(saleId: string, method: PaymentMethod) {
    return queue("Correcting bill payment", {
      kind: "update",
      table: "sales",
      values: { payment_type: method },
      match: { id: saleId },
    });
  },

  /** Batch-push pending audit rows; returns the ids that landed in the cloud. */
  async pushAuditLogs(
    rows: {
      id: string;
      at: string;
      staffName: string;
      category: string;
      action: string;
      module: string;
      details: Record<string, unknown>;
    }[],
  ) {
    if (localDb()?.writeBatch) {
      await commitOps("Saving audit logs", [
        {
          kind: "upsert",
          table: "audit_logs",
          rows: rows.map((r) => ({
            id: r.id,
            user_name: r.staffName,
            action_category: r.category,
            action_name: r.action,
            target_module: r.module,
            details: r.details,
            // Main process owns the paired terminal identity and stamps the
            // verified branch. Renderer audit context can contain a stale
            // alias after branch canonicalisation and must not override it.
            store_id: null,
            created_at: r.at,
          })),
        },
      ]);
      return rows.map((r) => r.id);
    }
    if (!hasStaffSession()) {
      if (!canRelay()) throw new Error("Sign in before uploading audit logs.");
      const result = await relayOp({
        kind: "upsert",
        table: "audit_logs",
        onConflict: "id",
        rows: rows.map((r) => ({
          id: r.id,
          user_name: r.staffName,
          action_category: r.category,
          action_name: r.action,
          target_module: r.module,
          details: r.details,
          store_id: typeof r.details.storeId === "string" ? r.details.storeId : null,
          created_at: r.at,
        })),
      });
      if (!result.ok) throw new Error(result.error ?? "Could not upload audit logs.");
      return rows.map((r) => r.id);
    }
    const { error } = await supabase.from("audit_logs").upsert(
      rows.map((r) => ({
        id: r.id,
        user_name: r.staffName,
        action_category: r.category,
        action_name: r.action,
        target_module: r.module,
        details: r.details as never,
        store_id: typeof r.details.storeId === "string" ? r.details.storeId : null,
        created_at: r.at,
      })) as never,
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return rows.map((r) => r.id);
  },

  /** Bounded local history for audit/report screens; never retained as app cache. */
  async queryAuditLogs(limit = 2000): Promise<Row[]> {
    return routedQuery("audit_logs", {
      orderBy: { column: "created_at", ascending: false },
      limit: Math.min(Math.max(limit, 1), 2000),
    });
  },

  /** Purchase order / receiving invoice. */
  /** No-sale cash-drawer open, queued so it survives an offline till. */
  recordDrawerEvent(row: {
    id: string;
    storeId: string | null;
    terminalId: string | null;
    shiftId: string | null;
    staffId: string | null;
    staffName: string | null;
    role: string | null;
    reason: string;
    note: string | null;
    approvedBy: string | null;
    at: string;
  }) {
    queue("Logging drawer open", {
      kind: "insert",
      table: "drawer_events",
      rows: [
        {
          id: row.id,
          store_id: row.storeId,
          terminal_id: row.terminalId,
          shift_id: row.shiftId,
          staff_id: row.staffId,
          staff_name: row.staffName,
          role: row.role,
          reason: row.reason,
          note: row.note,
          approved_by: row.approvedBy,
          created_at: row.at,
        },
      ],
    });
  },

  /**
   * Store a receiving invoice and its lines, and wait until they are committed
   * to the cloud or local database. Nothing on screen is
   * cleared until this resolves, so an invoice can no longer vanish.
   *
   * `movementStoreId` is the branch the stock actually lands in. Passing it
   * writes the goods-received movement rows in the very same commit, so a
   * received line can never change stock without leaving a history row.
   */
  commitReceivingInvoice: (inv: ReceivingInvoice, movementStoreId?: string | null) =>
    commitOps("Saving receiving invoice", [
      { kind: "upsert", table: "purchase_orders", rows: [invoiceRow(inv)] },
      ...(inv.lines.length
        ? [
            {
              kind: "upsert" as const,
              table: "purchase_order_items",
              rows: inv.lines.map((l) => invoiceLineRow(inv.id, l)),
            },
          ]
        : []),
      ...receivingActivityOps(inv, movementStoreId),
      ...receivingPriceOps(inv),
    ]),

  /**
   * Save corrections to an existing invoice in place. Removed lines are
   * deleted by id; everything else is updated, so history and the invoice id
   * survive the edit.
   */
  updateReceivingInvoice: (
    inv: ReceivingInvoice,
    removedLineIds: string[],
    movementStoreId?: string | null,
    correction?: { previous: ReceivingInvoice; attemptId: string },
  ) =>
    commitOps("Updating receiving invoice", [
      { kind: "upsert", table: "purchase_orders", rows: [invoiceRow(inv)] },
      ...(inv.lines.length
        ? [
            {
              kind: "upsert" as const,
              table: "purchase_order_items",
              rows: inv.lines.map((l) => invoiceLineRow(inv.id, l)),
            },
          ]
        : []),
      ...removedLineIds.map((id) => ({
        kind: "delete" as const,
        table: "purchase_order_items",
        match: { id },
      })),
      ...(correction
        ? receivingCorrectionOps(inv, correction.previous, correction.attemptId)
        : receivingActivityOps(inv, movementStoreId)),
      ...receivingPriceOps(inv),
    ]),

  /**
   * Autosave an unfinished receiving order. Same rows as a finalized one, but
   * flagged `draft` so it never reaches history or touches stock.
   */
  saveReceivingDraft: (inv: ReceivingInvoice, removedLineIds: string[] = []) =>
    db.updateReceivingInvoice({ ...inv, status: "draft" }, removedLineIds),

  /** Abandon a draft. Kept in the table for audit, hidden from every list. */
  discardReceivingDraft: (id: string) =>
    commitOps("Discarding receiving draft", [
      {
        kind: "update",
        table: "purchase_orders",
        values: { status: "cancelled", updated_at: new Date().toISOString() },
        match: { id },
      },
    ]),

  /* --------------------- awaited, confirmed versions --------------------- */

  /** Save a completed bill and wait until it is stored somewhere. */
  async commitSale(sale: Sale, products: Product[], member: Member | null): Promise<CommitTarget> {
    // A retry may find the header already committed. Reuse its real id and
    // reconcile every required child rather than mistaking a partial sale for completion.
    const onlineOnly = effectiveDatabaseMode() === "online";
    const storedId =
      onlineOnly && sale.clientTxnId ? await db.saleAttemptId(sale.clientTxnId) : null;
    if (storedId) sale.id = storedId;
    // SQL Server enforces these foreign keys immediately. Materialize parent
    // records before the sale graph so a newly synced member or product cannot
    // make the otherwise atomic local transaction fail.
    const ops: SyncOp[] = [];
    if (products.length)
      ops.push({ kind: "upsert", table: "products", rows: products.map(productToRow) });
    if (member) ops.push({ kind: "upsert", table: "members", rows: [memberToRow(member, tierId)] });
    ops.push(
      { kind: "upsert", table: "sales", rows: [saleToRow(sale)], onConflict: "id" },
      { kind: "upsert", table: "sale_items", rows: saleItemRows(sale), onConflict: "id" },
    );
    const tenders = salePaymentRows(sale);
    if (tenders.length)
      ops.push({ kind: "upsert", table: "payment_transactions", rows: tenders, onConflict: "id" });
    const movements = saleActivityRows(sale);
    if (movements.length)
      ops.push({ kind: "upsert", table: "item_activity_logs", rows: movements, onConflict: "id" });
    if (sale.exchangeOfReceiptNo) {
      if (!onlineOnly && !sale.exchangeOfSaleId)
        throw Object.assign(
          new Error("The original exchange bill is missing its stable local identifier."),
          { code: "EEXCHANGE_STATE" },
        );
      ops.push({
        kind: "update",
        table: "sales",
        values: { exchanged_to_bill_number: sale.receiptNo },
        match: {
          id: sale.exchangeOfSaleId,
          bill_number: sale.exchangeOfReceiptNo,
          exchanged_to_bill_number: null,
          is_refunded: false,
        },
        // The exchange link is part of the financial aggregate. If the
        // original bill is missing, refunded, or already consumed by another
        // exchange, the new bill and every stock/payment row must roll back.
        requireMatch: true,
      });
    }
    if (onlineOnly) {
      // One central transaction owns the immutable financial graph, member
      // effect and stock deltas. Product rows remain a separate projection,
      // with absolute stock stripped before they are sent.
      await runOpLive("Saving sale", {
        kind: "rpc",
        table: "sales",
        fn: "pos_sale_commit",
        args: {
          _sale: saleToRow(sale),
          _items: saleItemRows(sale),
          _payments: tenders,
          _movements: movements,
          _member: member ? memberToRow(member, tierId) : null,
          _exchange_bill: sale.exchangeOfReceiptNo ?? null,
        },
      });
      const projections = ops.filter((op) => op.table === "products");
      if (projections.length) {
        const { ops: safeProjections } = withRelativeStock(projections);
        await runBatchLive("Updating sale projections", safeProjections);
      }
      return noteCommitTarget("cloud");
    }
    return commitOps("Saving sale", ops);
  },

  async saleAttemptId(clientTxnId: string): Promise<string | null> {
    try {
      const res = await supabase
        .from("sales" as never)
        .select("id")
        .eq("client_transaction_id", clientTxnId)
        .limit(1);
      if (res.error) return null;
      const first = Array.isArray(res.data)
        ? (res.data[0] as { id?: string } | undefined)
        : undefined;
      return first?.id ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Has this checkout attempt already been stored centrally? "unknown" when
   * the read itself failed — the caller then saves as usual, and the unique
   * index on the attempt id is the final guard against a duplicate.
   */
  async saleAttemptExists(clientTxnId: string): Promise<"yes" | "no" | "unknown"> {
    try {
      const res = await supabase
        .from("sales" as never)
        .select("id")
        .eq("client_transaction_id", clientTxnId)
        .limit(1);
      if (res.error) {
        recordDiagnostic({
          kind: "sale_idempotency_unavailable",
          entity: "sales",
          code: reasonCode(res.error),
          recordId: clientTxnId,
        });
        return "unknown";
      }
      return Array.isArray(res.data) && res.data.length > 0 ? "yes" : "no";
    } catch (e) {
      recordDiagnostic({
        kind: "sale_idempotency_unavailable",
        entity: "sales",
        code: reasonCode(e),
        recordId: clientTxnId,
      });
      return "unknown";
    }
  },

  /** Save a shift open/close and wait until it is stored somewhere. */
  commitShift: (s: Shift) =>
    commitOps("Saving shift", [{ kind: "upsert", table: "shifts", rows: [shiftToRow(s)] }]),

  /**
   * Read a shift straight back from the central database.
   *
   * Used after opening a shift so the till only unlocks once the row really
   * exists — a cashier must never be told "Shift opened" on a write the
   * database quietly refused.
   */
  async shiftExists(id: string, storeId?: string): Promise<"yes" | "no" | "unknown"> {
    try {
      const bridge = localDb();
      if (effectiveDatabaseMode() === "local" && bridge?.query) {
        const rows = await routedQuery("shifts", { columns: "id", match: { id }, limit: 1 });
        return rows.length > 0 ? "yes" : "no";
      }

      // Direct SELECT on shifts is intentionally revoked. Use the existing
      // branch-scoped projection so web verification does not weaken grants.
      if (!storeId) return "unknown";
      const res = await supabase.rpc(
        "shift_list_secure" as never,
        { p_store_id: storeId, p_limit: 300 } as never,
      );
      // A refused or failed read tells us nothing about the write itself.
      if (res.error) {
        recordDiagnostic({
          kind: "shift_lookup_unavailable",
          entity: "shifts",
          code: reasonCode(res.error),
          recordId: id,
        });
        return "unknown";
      }
      // This projection is deliberately bounded. It can prove presence, but
      // absence from the page does not prove the row was not saved.
      return Array.isArray(res.data) &&
        (res.data as Array<Record<string, unknown>>).some((row) => row.id === id)
        ? "yes"
        : "unknown";
    } catch (e) {
      recordDiagnostic({
        kind: "shift_lookup_unavailable",
        entity: "shifts",
        code: reasonCode(e),
        recordId: id,
      });
      return "unknown";
    }
  },

  /** Log a manual drawer open and wait until it is stored somewhere. */
  commitDrawerEvent: (row: {
    id: string;
    storeId: string | null;
    terminalId: string | null;
    shiftId: string | null;
    staffId: string | null;
    staffName: string | null;
    role: string | null;
    reason: string;
    note: string | null;
    approvedBy: string | null;
    at: string;
  }) =>
    commitOps("Logging drawer open", [
      {
        kind: "insert",
        table: "drawer_events",
        rows: [
          {
            id: row.id,
            store_id: row.storeId,
            terminal_id: row.terminalId,
            shift_id: row.shiftId,
            staff_id: row.staffId,
            staff_name: row.staffName,
            role: row.role,
            reason: row.reason,
            note: row.note,
            approved_by: row.approvedBy,
            created_at: row.at,
          },
        ],
      },
    ]),

  /** Save a staff sign-in and wait until it is stored somewhere. */
  commitShiftSession: (s: ShiftSession) =>
    commitOps("Saving shift sign-in", [
      { kind: "upsert", table: "shift_sessions", rows: [shiftSessionToRow(s)] },
    ]),

  /** Save stock changes and wait until they are stored somewhere. */
  commitProducts: (list: Product[], movements: ProductImportMovement[] = []) =>
    list.length
      ? commitOps("Saving products", [
          { kind: "upsert", table: "products", rows: list.map(productToRow) },
          ...(movements.length
            ? [
                {
                  kind: "upsert" as const,
                  table: "item_activity_logs",
                  rows: movements.map(productImportMovementToRow),
                  onConflict: "id",
                },
              ]
            : []),
        ])
      : Promise.resolve<CommitTarget>("cloud"),

  /** Save a member and wait until it is stored somewhere. */
  commitMember: (m: Member) =>
    commitOps("Saving member", [
      { kind: "upsert", table: "members", rows: [memberToRow(m, tierId)] },
    ]),

  /** Save one product and wait until it is stored somewhere. */
  commitProduct: (p: Product) =>
    commitOps("Saving product", [{ kind: "upsert", table: "products", rows: [productToRow(p)] }]),

  /**
   * Save a branch price as a scoped record. The product's global prices stay
   * untouched, and the next server revision decides conflicts authoritatively.
   */
  commitProductPriceOverride: async (
    productId: string,
    branchId: string,
    price: number,
    ecomPrice?: number,
    updatedBy?: string | null,
  ) => {
    const key = `product_price:${productId}`;
    const current = (await routedQuery("settings_scoped", {
      match: { scope: "BRANCH", scope_id: branchId, key },
      limit: 1,
    }).catch(() => [] as Row[])) as Row[];
    const rowVersion = Math.max(1, safeInt(current[0]?.row_version, 0) + 1);
    return commitOps("Saving branch price", [
      {
        kind: "upsert",
        table: "settings_scoped",
        rows: [
          {
            scope: "BRANCH",
            scope_id: branchId,
            key,
            value: { selling_price: safeNum(price), ecom_price: safeNumOrNull(ecomPrice) },
            is_overridden: true,
            updated_by: updatedBy ?? null,
            updated_at: new Date().toISOString(),
            row_version: rowVersion,
          },
        ],
      },
    ]);
  },

  /** Save a promotion and wait until it is stored somewhere. */
  commitPromotion: (p: Promotion) =>
    commitOps("Saving promotion", [
      { kind: "upsert", table: "promotions", rows: [promotionToRow(p)] },
    ]),

  /* ------------------------- held tickets ------------------------- */

  /** Park a ticket in the database so it survives a reload or a swapped till. */
  commitHeldOrder: (row: {
    id: string;
    label: string;
    storeId: string | null;
    heldBy: string | null;
    billNo?: string | null;
    total: number;
    lines: unknown;
    cartDiscount?: number;
    cartDiscountType?: string;
    exchangeRef?: string | null;
    memberId?: string | null;
    memberName?: string | null;
    coupon?: unknown;
    note?: string;
    cancelledFrom?: string | null;
    heldAt: string;
    status?: "held" | "waiting" | "ready";
    pendingRequestId?: string | null;
  }) =>
    commitOps("Holding ticket", [
      {
        kind: "upsert",
        table: "held_orders",
        rows: [
          {
            id: row.id,
            label: row.label,
            store_id: row.storeId,
            held_by: row.heldBy,
            bill_no: row.billNo ?? null,
            total: row.total,
            lines: row.lines,
            cart_discount: row.cartDiscount ?? 0,
            cart_discount_type: row.cartDiscountType ?? "amount",
            exchange_ref: row.exchangeRef ?? null,
            member_id: row.memberId ?? null,
            member_name: row.memberName ?? null,
            coupon: row.coupon ?? null,
            note: row.note ?? "",
            cancelled_from: row.cancelledFrom ?? null,
            held_at: row.heldAt,
            status: row.status ?? "held",
            pending_request_id: row.pendingRequestId ?? null,
          },
        ],
      },
    ]),

  /** Remove a parked ticket once it has been resumed or discarded. */
  removeHeldOrder: (id: string) =>
    queue("Releasing held ticket", { kind: "delete", table: "held_orders", match: { id } }),

  /** Every ticket still parked, newest first. */
  async listHeldOrders() {
    const { data, error } = await supabase
      .from("held_orders")
      .select("*")
      .order("held_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /* ----------------------- stock adjustments ---------------------- */

  /** Record a stock correction with its reason and cost impact. */
  recordStockAdjustment: (row: StockAdjustmentInput) =>
    queue("Recording stock adjustment", {
      kind: "insert",
      table: "stock_adjustments",
      rows: [stockAdjustmentToRow(row)],
    }),

  /** Product quantities and their audit movements share one durable batch. */
  commitStockAdjustments: (
    products: Product[],
    adjustments: StockAdjustmentInput[],
    postedDraft?: { id: string; by?: string | null; record?: {
      reason: string; note: string; lines: unknown[]; totalImpact: number;
    } },
  ) =>
    commitOps("Saving stock adjustment", [
      ...(products.length
        ? [{ kind: "upsert" as const, table: "products", rows: products.map(productToRow) }]
        : []),
      ...(adjustments.length
        ? [
            {
              kind: "upsert" as const,
              table: "stock_adjustments",
              rows: adjustments.map(stockAdjustmentToRow),
            },
          ]
        : []),
      ...(postedDraft
        ? [
            {
              kind: "update" as const,
              table: "stock_count_drafts",
              values: {
                status: "posted",
                posted_at: new Date().toISOString(),
                posted_by: postedDraft.by ?? null,
                updated_at: new Date().toISOString(),
                ...(postedDraft.record ? {
                  reason: postedDraft.record.reason,
                  note: postedDraft.record.note,
                  lines: JSON.stringify(postedDraft.record.lines),
                  line_count: postedDraft.record.lines.length,
                  total_impact: postedDraft.record.totalImpact,
                } : {}),
              },
              match: { id: postedDraft.id },
            },
          ]
        : []),
    ]),

  /* --------------------- stock count drafts ----------------------- */

  /**
   * Save (or re-save) an in-progress physical count. One row per counting
   * session: the same id is written every time the queue changes, so a till
   * can never leave two drafts behind for one session.
   */
  saveStockCountDraft: (row: {
    id: string;
    reference?: string | null;
    storeId: string | null;
    storeCode?: string | null;
    terminalId?: string | null;
    staffId?: string | null;
    staffName?: string | null;
    status?: "draft" | "posted" | "discarded";
    reason?: string | null;
    note?: string;
    lines: unknown[];
    totalImpact: number;
    postedAt?: string | null;
    postedBy?: string | null;
    createdAt?: string;
  }) =>
    queue("Saving stock count draft", {
      kind: "upsert",
      table: "stock_count_drafts",
      onConflict: "id",
      rows: [
        {
          id: row.id,
          reference: row.reference ?? null,
          store_id: row.storeId,
          store_code: row.storeCode ?? null,
          terminal_id: row.terminalId ?? null,
          staff_id: row.staffId ?? null,
          staff_name: row.staffName ?? null,
          status: row.status ?? "draft",
          reason: row.reason ?? null,
          note: row.note ?? "",
          lines: JSON.stringify(row.lines ?? []),
          line_count: Array.isArray(row.lines) ? row.lines.length : 0,
          total_impact: row.totalImpact ?? 0,
          posted_at: row.postedAt ?? null,
          posted_by: row.postedBy ?? null,
          created_at: row.createdAt ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }),

  /** Close a draft off: posted (locked) or discarded (no stock impact). */
  setStockCountDraftStatus: (id: string, status: "posted" | "discarded", by?: string | null) =>
    queue(status === "posted" ? "Posting stock count draft" : "Discarding stock count draft", {
      kind: "update",
      table: "stock_count_drafts",
      values: {
        status,
        posted_at: status === "posted" ? new Date().toISOString() : null,
        posted_by: status === "posted" ? (by ?? null) : null,
        updated_at: new Date().toISOString(),
      },
      match: { id },
    }),

  /** Open drafts for a branch, newest first. */
  async listStockCountDrafts(storeId: string) {
    const rows = await routedQuery("stock_count_drafts", {
      match: { store_id: storeId, status: "draft" },
      orderBy: { column: "updated_at", ascending: false },
      limit: 50,
    });
    return rows as Row[];
  },

  /**
   * Every stock count record for the history list: one branch, or all of them
   * when `storeId` is omitted. Status filtering happens in the caller so the
   * same read serves the tab's filter chips.
   */
  async listStockCountRecords(opts: { storeId?: string | null; limit?: number } = {}) {
    const rows = await routedQuery("stock_count_drafts", {
      ...(opts.storeId ? { match: { store_id: opts.storeId } } : {}),
      orderBy: { column: "created_at", ascending: false },
      limit: opts.limit ?? 200,
    });
    return rows as Row[];
  },

  /* ------------------------ whatsapp outbox ----------------------- */

  /** Park a WhatsApp bill so it is not lost when the branch is offline. */
  queueWhatsAppMessage: (row: {
    id: string;
    phoneNumberId: string;
    to: string;
    body: string;
    reference: string | null;
    storeId?: string | null;
    queuedAt: string;
  }) =>
    queue("Queuing WhatsApp bill", {
      kind: "upsert",
      table: "whatsapp_queue",
      rows: [
        {
          id: row.id,
          phone_number_id: row.phoneNumberId,
          recipient: row.to,
          body: row.body,
          reference: row.reference,
          store_id: row.storeId ?? null,
          status: "QUEUED",
          queued_at: row.queuedAt,
        },
      ],
    }),

  /** Mark a queued WhatsApp bill as sent (or failed). */
  settleWhatsAppMessage: (id: string, ok: boolean, error?: string) =>
    queue("Updating WhatsApp bill", {
      kind: "update",
      table: "whatsapp_queue",
      values: {
        status: ok ? "SENT" : "FAILED",
        error: error ?? null,
        sent_at: ok ? new Date().toISOString() : null,
      },
      match: { id },
    }),
};
