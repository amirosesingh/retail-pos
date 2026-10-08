import { reserveDocument } from "./document-lock";
import { documentOrigin } from "./document-origin";
/**
 * Stock Operations reference numbers.
 *
 *   [PREFIX]-[BRANCH]-[PLATFORM]-[DEVICE]-[PERIOD]-[SEQUENCE]
 *   SC-B101-202608-0007
 *
 * Styled after the bill numbering module, but with its own counter so a
 * physical count never borrows a receipt number. The reference is minted once,
 * the moment a draft row is first written, and never regenerated afterwards.
 */
import { readLocalSetting, writeLocalSetting } from "@/core/local-db/local-db";

export type StockNumberReset = "never" | "yearly" | "monthly";

/**
 * Which run of numbers a reference comes from. Each series keeps its own
 * counter, so a goods-received note can never take a stock count's number.
 */
export type RefSeries = "stock" | "receiving" | "request" | "transfer";

/** The prefix each series falls back to when the admin has not set one. */
const SERIES_PREFIX: Record<RefSeries, string> = {
  stock: "SC",
  receiving: "GRN",
  request: "SR",
  transfer: "ST",
};

/** Everything an admin can change about stock reference numbers. */
export type StockNumberingSettings = {
  /** Leading marker, default "SC" for stock counts. */
  prefix?: string;
  /** First running number to hand out, default 1. */
  startNumber?: number;
  /** Digits in the running number, 3–6. */
  padding?: number;
  /** When the running number starts again. */
  reset?: StockNumberReset;
  /** Include the branch code in the reference. */
  includeBranch?: boolean;
};

const SEQ_KEY = "pos.stockref.seq";

type SeqStore = Record<string, number>;

const clean = (v: string | null | undefined, fallback: string) =>
  (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || fallback;

const store = (): Storage | null => {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
};

let memoryCounters: SeqStore = {};
const readAll = (): SeqStore => {
  const s = store();
  if (!s || (typeof window !== "undefined" && (window as unknown as { pos?: unknown }).pos)) return { ...memoryCounters };
  try {
    const raw = s.getItem(SEQ_KEY);
    const parsed = raw ? (JSON.parse(raw) as SeqStore) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { ...memoryCounters };
  } catch {
    return {};
  }
};

const writeAll = async (value: SeqStore) => {
  const native = typeof window !== "undefined" && !!(window as unknown as { pos?: unknown }).pos;
  const s = native ? null : store();
  let stored = false;
  if (s) { s.setItem(SEQ_KEY, JSON.stringify(value)); stored = true; }
  const durable = await writeLocalSetting(SEQ_KEY, JSON.stringify(value));
  if (!stored && !durable) throw new Error("The document counter could not be saved. Check database connectivity and retry.");
  memoryCounters = value;
};

/** Restore the counter from the till database at start-up. */
export async function restoreStockRefCounter(): Promise<void> {
  const s = store();
  if (!s) return;
  try {
    const raw = await readLocalSetting(SEQ_KEY);
    if (!raw) return;
    const durable = JSON.parse(raw) as SeqStore;
    const local = readAll();
    const merged: SeqStore = { ...local };
    for (const [k, v] of Object.entries(durable)) {
      if (typeof v === "number" && v > (merged[k] ?? 0)) merged[k] = v;
    }
    memoryCounters = merged;
    if (!(typeof window !== "undefined" && (window as unknown as { pos?: unknown }).pos)) s.setItem(SEQ_KEY, JSON.stringify(merged));
  } catch {
    /* nothing durable to restore */
  }
}

/** The period segment for a reference, empty when numbering never resets. */
export function periodStamp(at: Date, reset: StockNumberReset): string {
  if (reset === "yearly") return String(at.getFullYear());
  if (reset === "monthly") return `${at.getFullYear()}${`${at.getMonth() + 1}`.padStart(2, "0")}`;
  return "";
}

const padOf = (cfg: StockNumberingSettings) =>
  Math.min(6, Math.max(3, Math.round(cfg.padding ?? 4)));

const build = (
  cfg: StockNumberingSettings,
  branchCode: string,
  at: Date,
  seq: number,
  series: RefSeries,
) => {
  const parts = [clean(cfg.prefix, SERIES_PREFIX[series])];
  parts.push(documentOrigin(branchCode));
  const period = periodStamp(at, cfg.reset ?? "monthly");
  if (period) parts.push(period);
  parts.push(String(seq).padStart(padOf(cfg), "0"));
  return parts.join("-");
};

/** What the next reference would look like, without consuming it. */
export function previewStockRef(
  cfg: StockNumberingSettings,
  branchCode: string,
  series: RefSeries = "stock",
  at: Date = new Date(),
): string {
  const key = counterKey(cfg, branchCode, at, series);
  const all = readAll();
  const next = sequenceFor(all, key, legacyStockCounterKey(cfg, branchCode, at, series), cfg);
  return build(cfg, branchCode, at, next, series);
}

const counterKey = (cfg: StockNumberingSettings, branchCode: string, at: Date, series: RefSeries) =>
  `${series}|${clean(cfg.prefix, SERIES_PREFIX[series])}|${clean(branchCode, "BR")}|${periodStamp(
    at,
    cfg.reset ?? "monthly",
  )}`;

/** Counter used before stock-count references changed their display prefix from SO to SC. */
const legacyStockCounterKey = (
  cfg: StockNumberingSettings,
  branchCode: string,
  at: Date,
  series: RefSeries,
) =>
  series === "stock" && !clean(cfg.prefix, "")
    ? `stock|SO|${clean(branchCode, "BR")}|${periodStamp(at, cfg.reset ?? "monthly")}`
    : null;

const sequenceFor = (
  all: SeqStore,
  key: string,
  legacyKey: string | null,
  cfg: StockNumberingSettings,
) =>
  all[key] ??
  (legacyKey ? all[legacyKey] : undefined) ??
  Math.max(1, Math.round(cfg.startNumber ?? 1));

/**
 * Reserve the next reference for a new draft. Consumes the counter, so it is
 * called exactly once per record — when the draft row is first created.
 */
export async function nextStockRef(
  cfg: StockNumberingSettings,
  branchCode: string,
  series: RefSeries = "stock",
  at: Date = new Date(),
): Promise<string> {
  return reserveDocument("pos-stock-reference", async () => {
    const key = counterKey(cfg, branchCode, at, series);
    const all = readAll();
    const seq = sequenceFor(all, key, legacyStockCounterKey(cfg, branchCode, at, series), cfg);
    all[key] = seq + 1;
    await writeAll(all);
    return build(cfg, branchCode, at, seq, series);
  });
}

/**
 * Step the counter past a reference the central database refused as a
 * duplicate, and hand back a fresh one.
 */
export function bumpStockRef(
  cfg: StockNumberingSettings,
  branchCode: string,
  series: RefSeries = "stock",
  at: Date = new Date(),
): Promise<string> {
  return nextStockRef(cfg, branchCode, series, at);
}

/**
 * Whether a posted record may be edited in place. Task 6/7 replaces the body
 * with the real approval check; every gated entry point reads this one flag.
 */
export function canEditPosted(): boolean {
  return false;
}
