/**
 * Day-end shift summary and where it is delivered.
 *
 * When a shift is closed the till builds one summary (sales, payments, cash,
 * discounts, refunds) and stores it centrally so any phone signed in to the
 * same business can show it. Each device chooses its own channels in
 * System & Settings -> Shift alerts.
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";
import type { Sale, Shift } from "@/core/types/pos-types";
import { getPosCallerAuth } from "./pos-caller-auth";
import { sendWhatsAppBill } from "./whatsapp.functions";
import { runOpLive } from "./sync-engine";

export type ShiftSummary = {
  id: string;
  shiftId: string;
  storeId: string;
  storeName: string;
  terminalName: string;
  closedBy: string;
  openedAt: string;
  closedAt: string;
  totalSales: number;
  transactions: number;
  discounts: number;
  refunds: number;
  expectedCash: number;
  countedCash: number;
  paymentBreakdown: Record<string, number>;
  summary: string;
};

export type ShiftAlertSettings = {
  inApp: boolean;
  whatsapp: boolean;
  push: boolean;
  /** digits only, international format */
  recipients: string[];
  quietFrom: string;
  quietTo: string;
  quietHours: boolean;
};

const SETTINGS_KEY = "pos.alerts.shift";

export const DEFAULT_ALERT_SETTINGS: ShiftAlertSettings = {
  inApp: true,
  whatsapp: false,
  push: false,
  recipients: [],
  quietFrom: "22:00",
  quietTo: "07:00",
  quietHours: false,
};

export function readAlertSettings(): ShiftAlertSettings {
  if (typeof window === "undefined") return DEFAULT_ALERT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw
      ? { ...DEFAULT_ALERT_SETTINGS, ...(JSON.parse(raw) as Partial<ShiftAlertSettings>) }
      : DEFAULT_ALERT_SETTINGS;
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export function writeAlertSettings(next: ShiftAlertSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

/** True when the clock sits inside the configured quiet window. */
export function inQuietHours(s: ShiftAlertSettings, at = new Date()): boolean {
  if (!s.quietHours) return false;
  const mins = at.getHours() * 60 + at.getMinutes();
  const parse = (v: string) => {
    const [h = "0", m = "0"] = v.split(":");
    return Number(h) * 60 + Number(m);
  };
  const from = parse(s.quietFrom);
  const to = parse(s.quietTo);
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

const money = (n: number) => n.toFixed(2);

/** Build the summary for a shift from the bills rung on it. */
export function buildShiftSummary(
  shift: Shift,
  sales: Sale[],
  storeName: string,
): Omit<ShiftSummary, "id"> {
  const mine = sales.filter((s) => s.shiftId === shift.id);
  const live = mine.filter((s) => !s.refunded);
  const totalSales = live.reduce((sum, s) => sum + s.total, 0);
  const discounts = live.reduce((sum, s) => sum + (s.discount ?? 0), 0);
  const refunds = mine.filter((s) => s.refunded).reduce((sum, s) => sum + s.total, 0);

  const paymentBreakdown: Record<string, number> = {};
  for (const sale of live) {
    const parts = sale.payments?.length
      ? sale.payments.map((p) => ({ method: String(p.method), amount: p.amount }))
      : [{ method: String(sale.method), amount: sale.total }];
    for (const part of parts) {
      paymentBreakdown[part.method] = (paymentBreakdown[part.method] ?? 0) + part.amount;
    }
  }

  const expectedCash =
    shift.expectedCash ?? shift.openingFloat + (paymentBreakdown["cash"] ?? 0);
  const countedCash = shift.countedCash ?? 0;

  const lines = [
    `Shift closed — ${storeName}`,
    `Closed by ${shift.closedBy ?? shift.cashier} at ${new Date(
      shift.closedAt ?? new Date().toISOString(),
    ).toLocaleString()}`,
    `Total sales: ${money(totalSales)} over ${live.length} bill(s)`,
    `Discounts: ${money(discounts)}   Refunds: ${money(refunds)}`,
    ...Object.entries(paymentBreakdown).map(([m, v]) => `  ${m}: ${money(v)}`),
    `Cash expected ${money(expectedCash)} / counted ${money(countedCash)} (difference ${money(
      countedCash - expectedCash,
    )})`,
  ];

  return {
    shiftId: shift.id,
    storeId: shift.storeId,
    storeName,
    terminalName: shift.terminalName ?? "",
    closedBy: shift.closedBy ?? shift.cashier,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? new Date().toISOString(),
    totalSales,
    transactions: live.length,
    discounts,
    refunds,
    expectedCash,
    countedCash,
    paymentBreakdown,
    summary: lines.join("\n"),
  };
}

type Row = Record<string, unknown>;

/**
 * `shift_notifications` may not be in generated types yet, so reach its read
 * query through a loose handle. Writes use the existing authenticated relay.
 */
type LooseTable = {
  select: (columns: string) => {
    order: (
      column: string,
      opts: { ascending: boolean },
    ) => {
      limit: (n: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }> & {
        eq: (
          column: string,
          value: string,
        ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
      };
    };
  };
};

const notifications = (): LooseTable =>
  (supabase.from as unknown as (table: string) => LooseTable)("shift_notifications");

const map = (row: Row): ShiftSummary => ({
  id: String(row["id"] ?? ""),
  shiftId: String(row["shift_id"] ?? ""),
  storeId: String(row["store_id"] ?? ""),
  storeName: String(row["store_name"] ?? ""),
  terminalName: String(row["terminal_name"] ?? ""),
  closedBy: String(row["closed_by"] ?? ""),
  openedAt: String(row["opened_at"] ?? ""),
  closedAt: String(row["closed_at"] ?? ""),
  totalSales: Number(row["total_sales"] ?? 0),
  transactions: Number(row["transactions"] ?? 0),
  discounts: Number(row["discounts"] ?? 0),
  refunds: Number(row["refunds"] ?? 0),
  expectedCash: Number(row["expected_cash"] ?? 0),
  countedCash: Number(row["counted_cash"] ?? 0),
  paymentBreakdown: (row["payment_breakdown"] as Record<string, number>) ?? {},
  summary: String(row["summary"] ?? ""),
});

/** Save the summary centrally; failures never block closing a shift. */
export async function publishShiftSummary(
  input: Omit<ShiftSummary, "id">,
  channels: string[],
): Promise<void> {
  try {
    await runOpLive("Publishing shift summary", {
      kind: "upsert",
      table: "shift_notifications",
      onConflict: "shift_id",
      rows: [
        {
          shift_id: input.shiftId,
          store_id: input.storeId,
          store_name: input.storeName,
          terminal_name: input.terminalName,
          closed_by: input.closedBy,
          opened_at: input.openedAt,
          closed_at: input.closedAt,
          total_sales: input.totalSales,
          transactions: input.transactions,
          discounts: input.discounts,
          refunds: input.refunds,
          expected_cash: input.expectedCash,
          counted_cash: input.countedCash,
          payment_breakdown: input.paymentBreakdown,
          summary: input.summary,
          channels,
        },
      ],
    });
  } catch {
    /* the summary is still shown on this device */
  }
}

/** Most recent day-end summaries, newest first. */
export async function listShiftSummaries(storeId?: string): Promise<ShiftSummary[]> {
  const base = notifications()
    .select("*")
    .order("closed_at", { ascending: false })
    .limit(30);
  const { data, error } = await (storeId ? base.eq("store_id", storeId) : base);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(map);
}

const SEEN_KEY = "pos.alerts.shift.seen";

export function markSummariesSeen(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(0, 100)));
}

export function readSeenSummaries(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Publish the summary and send it on every channel this device has switched
 * on. Nothing here can stop a shift from closing.
 */
export async function dispatchShiftSummary(
  input: Omit<ShiftSummary, "id">,
): Promise<string[]> {
  const settings = readAlertSettings();
  const quiet = inQuietHours(settings);
  const channels: string[] = [];
  if (settings.inApp) channels.push("in_app");
  if (settings.whatsapp && settings.recipients.length > 0 && !quiet) channels.push("whatsapp");
  if (settings.push && !quiet) channels.push("push");

  await publishShiftSummary(input, channels);

  if (channels.includes("whatsapp")) {
    const auth = await getPosCallerAuth();
    for (const to of settings.recipients) {
      await sendWhatsAppBill({ data: { ...auth, to, body: input.summary } }).catch(() => null);
    }
  }
  return channels;
}
