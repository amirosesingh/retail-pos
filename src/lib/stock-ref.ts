import { reserveDocument } from "./document-lock";
import { billPrefix, dayStamp } from "./bill-number";
/**
 * Stock Operations reference numbers.
 *
 *   [PREFIX]-[BRANCH]-[PLATFORM][TILL]-[PERIOD]-[SEQUENCE]
 *   SC-B101-WIN01-20260811-0007
 *
 * Styled after the bill numbering module, but with its own counter so a
 * physical count never borrows a receipt number. The reference is minted once,
 * the moment a draft row is first written, and never regenerated afterwards.
 */
import { localDb } from "@/core/local-db/local-db";

export type StockNumberReset = "never" | "yearly" | "monthly" | "daily";

/**
 * Which run of numbers a reference comes from. Each series keeps its own
 * counter, so a goods-received note can never take a stock count's number.
 */
export type RefSeries = "stock" | "receiving" | "request" | "transfer" | "sponsorship";

/** The prefix each series falls back to when the admin has not set one. */
const SERIES_PREFIX: Record<RefSeries, string> = {
  sponsorship: "SP",
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

const readAll = (): SeqStore => {
  try {
    const raw = store()?.getItem(SEQ_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SeqStore)
      : {};
  } catch {
    return {};
  }
};

/** The period segment for a reference, empty when numbering never resets. */
export function periodStamp(at: Date, reset: StockNumberReset): string {
  if (reset === "daily") return dayStamp(at);
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
  // Use the same operator-configured till identity as bills, without changing
  // the activation ID used by draft storage or authentication. Offline tills
  // must have distinct till numbers, just as they do for receipt numbering.
  parts.push(billPrefix(branchCode, at).replace(/-\d{8}$/, ""));
  const period = periodStamp(at, cfg.reset ?? "daily");
  if (period) parts.push(period);
  parts.push(String(seq).padStart(padOf(cfg), "0"));
  return parts.join("-");
};

/** The shared database reserves this plan atomically with a sponsorship draft. */
export function stockReferencePlan(cfg:StockNumberingSettings,branchCode:string,series:RefSeries,at=new Date()){
 return {prefix:build(cfg,branchCode,at,1,series).replace(/-0*1$/,""),minimum:Math.max(1,Math.round(cfg.startNumber??1)),padding:padOf(cfg)};
}

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
    cfg.reset ?? "daily",
  )}`;

/** Counter used before stock-count references changed their display prefix from SO to SC. */
const legacyStockCounterKey = (
  cfg: StockNumberingSettings,
  branchCode: string,
  at: Date,
  series: RefSeries,
) =>
  series === "stock" && !clean(cfg.prefix, "")
    ? `stock|SO|${clean(branchCode, "BR")}|${periodStamp(at, cfg.reset ?? "daily")}`
    : null;

const sequenceFor = (
  all: SeqStore,
  key: string,
  legacyKey: string | null,
  cfg: StockNumberingSettings,
) =>
  Math.max(
    1,
    ...[Math.round(cfg.startNumber ?? 1), all[key], legacyKey ? all[legacyKey] : 0].map((value) =>
      Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0,
    ),
  );

/**
 * Reserve the next reference for a new draft. Consumes the counter, so it is
 * called exactly once per record — when the draft row is first created.
 */
export async function nextStockRef(
  cfg: StockNumberingSettings,
  branchCode: string,
  series: RefSeries = "stock",
  at: Date = new Date(),
  storeId?: string,
): Promise<string> {
  return reserveDocument("pos-stock-reference", async () => {
    const bridge = localDb();
    if (bridge) {
      if (!bridge.reserveStockCounter)
        throw new Error("Restart or update the POS to enable safe SQL stock document numbering.");
      const prefix = build(cfg, branchCode, at, 1, series).replace(/-0*1$/, "");
      const minimum = Math.max(1, Math.round(cfg.startNumber ?? 1));
      const reserved = await bridge.reserveStockCounter(prefix, minimum);
      if (!reserved.ok || !Number.isSafeInteger(reserved.sequence) || reserved.sequence! < minimum)
        throw new Error(
          reserved.error || "The stock document counter could not be reserved in SQL Server.",
        );
      return build(cfg, branchCode, at, reserved.sequence!, series);
    }
    const prefix = build(cfg, branchCode, at, 1, series).replace(/-0*1$/, "");
    const { reserveCloudStockReference } = await import("./stock-ref-client");
    const { getPosCallerAuth } = await import("./pos-caller-auth");
    const result = await reserveCloudStockReference({
      data: {
        ...(await getPosCallerAuth()),
        prefix,
        minimum: sequenceFor(
          readAll(),
          counterKey(cfg, branchCode, at, series),
          legacyStockCounterKey(cfg, branchCode, at, series),
          cfg,
        ),
        series,
        storeId: storeId ?? branchCode,
      },
    });
    if (!result.ok) throw new Error(result.error);
    return build(cfg, branchCode, at, result.sequence, series);
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
  storeId?: string,
): Promise<string> {
  return nextStockRef(cfg, branchCode, series, at, storeId);
}

/**
 * Whether a posted record may be edited in place. Task 6/7 replaces the body
 * with the real approval check; every gated entry point reads this one flag.
 */
export function canEditPosted(): boolean {
  return false;
}

/** Recover only a new draft's reference collision, never merge or overwrite another draft. */
export async function saveStockDraftReference(
  reference: string | null,
  save: (reference: string | null) => Promise<unknown>,
  reserve: () => Promise<string>,
  allowRenumber: boolean,
): Promise<string | null> {
  try {
    await save(reference);
    return reference;
  } catch (error) {
    const failure = error as { table?: string; sqlNumber?: number; sqlDetail?: string };
    if (
      !allowRenumber ||
      failure?.table !== "stock_count_drafts" ||
      ![2601, 2627].includes(Number(failure.sqlNumber)) ||
      !/['"]UX_stock_count_drafts_reference['"]/i.test(failure.sqlDetail ?? "")
    )
      throw error;
    const fresh = await reserve();
    await save(fresh);
    return fresh;
  }
}
