/**
 * Group-wide analytics feed. Every figure is aggregated in the database by the
 * reporting views so one page load never pulls every sale line into the till.
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";

export type StoreDayRow = {
  sale_day: string;
  sale_month: string;
  store_id: string | null;
  bills: number;
  revenue: number;
  cost: number;
  profit: number;
  discount: number;
  foc_value: number;
  units: number;
};

export type ItemDayRow = {
  sale_day: string;
  store_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_category: string;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
};

export type BillRow = {
  store_id: string | null;
  created_at: string;
  total: number;
  discount_amount: number;
  coupon_discount: number;
};

export type BoardData = {
  storeDays: StoreDayRow[];
  itemDays: ItemDayRow[];
  bills: BillRow[];
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** `to` is inclusive, so the upper bound is pushed to the end of that day. */
const endOfDay = (to: string) => `${to}T23:59:59.999`;

export type BoardIssue = {
  /** Table or view that was refused. */
  source: string;
  kind: "permission" | "missing" | "other";
  /** The SQL file that creates (and grants) this source. */
  sqlFile: string;
  detail: string;
  advice: string;
};

export class BoardError extends Error {
  issues: BoardIssue[];
  constructor(issues: BoardIssue[]) {
    super(issues.map((i) => `${i.source}: ${i.detail}`).join(" · "));
    this.name = "BoardError";
    this.issues = issues;
  }
}

function classify(source: string, sqlFile: string, message: string): BoardIssue {
  const m = message.toLowerCase();
  if (m.includes("permission denied") || m.includes("not authorized") || m.includes("42501"))
    return {
      source,
      kind: "permission",
      sqlFile,
      detail: message,
      advice: `Access to "${source}" was refused. Re-run ${sqlFile} in the SQL editor — it re-applies the GRANT and policy statements for this ${source.startsWith("v_") ? "view" : "table"}.`,
    };
  if (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"))
    return {
      source,
      kind: "missing",
      sqlFile,
      detail: message,
      advice: `"${source}" does not exist in the database yet. Run ${sqlFile} in the SQL editor to create it.`,
    };
  return { source, kind: "other", sqlFile, detail: message, advice: `Reading "${source}" failed. Re-running ${sqlFile} usually repairs it.` };
}

export async function fetchBoard(from: string, to: string): Promise<BoardData> {
  const [storeRes, itemRes, billRes] = await Promise.all([
    supabase
      .from("v_daily_store_sales")
      .select("sale_day, sale_month, store_id, bills, revenue, cost, profit, discount, foc_value, units")
      .gte("sale_day", from)
      .lte("sale_day", to),
    supabase
      .from("v_daily_item_sales")
      .select("sale_day, store_id, product_id, product_name, units, revenue, cost, profit, product_category")
      .gte("sale_day", from)
      .lte("sale_day", to),
    supabase
      .from("sales")
      .select("store_id, created_at, total_amount, discount_amount, coupon_discount")
      .gte("created_at", from)
      .lte("created_at", endOfDay(to)),
  ]);

  const issues: BoardIssue[] = [];
  if (storeRes.error)
    issues.push(classify("v_daily_store_sales", "supabase/schema.sql", storeRes.error.message));
  if (itemRes.error)
    issues.push(classify("v_daily_item_sales", "supabase/schema.sql", itemRes.error.message));
  if (billRes.error)
    issues.push(classify("sales", "supabase/schema.sql", billRes.error.message));
  if (issues.length) throw new BoardError(issues);

  return {
    storeDays: (storeRes.data ?? []).map((r) => ({
      sale_day: String(r.sale_day),
      sale_month: String(r.sale_month ?? String(r.sale_day).slice(0, 7)),
      store_id: r.store_id,
      bills: n(r.bills),
      revenue: n(r.revenue),
      cost: n(r.cost),
      profit: n(r.profit),
      discount: n(r.discount),
      foc_value: n(r.foc_value),
      units: n(r.units),
    })),
    itemDays: (itemRes.data ?? []).map((r) => ({
      sale_day: String(r.sale_day),
      store_id: r.store_id,
      product_id: r.product_id,
      product_name: r.product_name,
      product_category: String(r.product_category || "Uncategorized"),
      units: n(r.units),
      revenue: n(r.revenue),
      cost: n(r.cost),
      profit: n(r.profit),
    })),
    bills: (billRes.data ?? []).map((r) => ({
      store_id: r.store_id,
      created_at: String(r.created_at),
      total: n(r.total_amount),
      discount_amount: n(r.discount_amount),
      coupon_discount: n(r.coupon_discount),
    })),
  };
}

export type ShopSlice = {
  storeId: string;
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
  sharePct: number;
  bills: number;
  itemDiscount: number;
  billDiscount: number;
  coupon: number;
  focValue: number;
  givenAway: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Roll the daily rows up into one slice per shop. */
export function shopSlices(
  data: BoardData,
  nameOf: (id: string) => string,
  storeIds?: Set<string>,
): ShopSlice[] {
  const keep = (id: string | null) => !storeIds || storeIds.has(id ?? "");
  const by = new Map<string, ShopSlice>();
  const blank = (id: string): ShopSlice => ({
    storeId: id,
    name: nameOf(id),
    revenue: 0,
    cost: 0,
    profit: 0,
    marginPct: 0,
    sharePct: 0,
    bills: 0,
    itemDiscount: 0,
    billDiscount: 0,
    coupon: 0,
    focValue: 0,
    givenAway: 0,
  });

  for (const row of data.storeDays) {
    if (!keep(row.store_id)) continue;
    const id = row.store_id ?? "";
    const cur = by.get(id) ?? blank(id);
    cur.revenue += row.revenue;
    cur.cost += row.cost;
    cur.bills += row.bills;
    cur.itemDiscount += row.discount;
    cur.focValue += row.foc_value;
    by.set(id, cur);
  }
  for (const b of data.bills) {
    if (!keep(b.store_id)) continue;
    const id = b.store_id ?? "";
    const cur = by.get(id) ?? blank(id);
    cur.coupon += b.coupon_discount;
    cur.billDiscount += b.discount_amount;
    by.set(id, cur);
  }

  const rows = [...by.values()].map((s) => {
    // The bill discount column already carries the line discounts, so only the
    // remainder is a true bill-level giveaway.
    const billOnly = Math.max(s.billDiscount - s.itemDiscount - s.coupon, 0);
    const revenue = r2(s.revenue);
    const cost = r2(s.cost);
    const profit = r2(revenue - cost);
    return {
      ...s,
      revenue,
      cost,
      profit,
      marginPct: revenue ? r2((profit / revenue) * 100) : 0,
      itemDiscount: r2(s.itemDiscount),
      billDiscount: r2(billOnly),
      coupon: r2(s.coupon),
      focValue: r2(s.focValue),
      givenAway: r2(s.itemDiscount + billOnly + s.coupon + s.focValue),
    };
  });
  const total = rows.reduce((a, s) => a + s.revenue, 0);
  return rows
    .map((s) => ({ ...s, sharePct: total ? r2((s.revenue / total) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

export type ItemSlice = { name: string; revenue: number; units: number };
export type CategorySlice = ItemSlice & { itemCount: number };

/** Category-first summary. Products are intentionally exposed only after a category opens. */
export function topCategories(
  rows: ItemDayRow[],
  by: "revenue" | "units",
  limit = 10,
): CategorySlice[] {
  const map = new Map<
    string,
    { name: string; revenue: number; units: number; productIds: Set<string> }
  >();
  for (const row of rows) {
    const name = row.product_category.trim() || "Uncategorized";
    const current = map.get(name) ?? { name, revenue: 0, units: 0, productIds: new Set<string>() };
    current.revenue += row.revenue;
    current.units += row.units;
    current.productIds.add(row.product_id ?? row.product_name ?? "?");
    map.set(name, current);
  }
  return [...map.values()]
    .map((category) => ({
      name: category.name,
      revenue: r2(category.revenue),
      units: r2(category.units),
      itemCount: category.productIds.size,
    }))
    .sort((a, b) => b[by] - a[by])
    .slice(0, limit);
}

/** Top sellers, with everything past the cut folded into one slice. */
export function topItems(
  rows: ItemDayRow[],
  by: "revenue" | "units",
  limit: number,
  withRest = true,
): ItemSlice[] {
  const map = new Map<string, ItemSlice>();
  for (const r of rows) {
    const key = r.product_id ?? r.product_name ?? "?";
    const cur = map.get(key) ?? { name: r.product_name ?? "Unnamed", revenue: 0, units: 0 };
    cur.revenue += r.revenue;
    cur.units += r.units;
    map.set(key, cur);
  }
  const all = [...map.values()]
    .map((x) => ({ ...x, revenue: r2(x.revenue), units: r2(x.units) }))
    .sort((a, b) => b[by] - a[by]);
  const head = all.slice(0, limit);
  const rest = all.slice(limit);
  if (withRest && rest.length) {
    head.push({
      name: `Everything else (${rest.length})`,
      revenue: r2(rest.reduce((a, x) => a + x.revenue, 0)),
      units: r2(rest.reduce((a, x) => a + x.units, 0)),
    });
  }
  return head;
}

export type TrendPoint = { label: string; revenue: number; profit: number };

export function trendSeries(rows: StoreDayRow[], grain: "daily" | "monthly"): TrendPoint[] {
  const by = new Map<string, TrendPoint>();
  for (const r of rows) {
    const label = grain === "daily" ? r.sale_day : r.sale_month;
    const cur = by.get(label) ?? { label, revenue: 0, profit: 0 };
    cur.revenue += r.revenue;
    cur.profit += r.revenue - r.cost;
    by.set(label, cur);
  }
  return [...by.values()]
    .map((p) => ({ ...p, revenue: r2(p.revenue), profit: r2(p.profit) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
