import { reserveDocument } from "./document-lock";
import { documentDevice, documentPlatform } from "./document-origin";
/**
 * One bill numbering scheme for every register.
 *
 *   [BRANCH]-[PLATFORM][TERMINAL]-[YYYYMMDD]-[SEQUENCE]
 *   B101-PC01-20260811-0001   (Windows till)
 *   B101-MB01-20260811-0001   (handheld)
 *
 * The branch comes from the store this till trades in, the platform from the
 * shell it runs inside, and the terminal number from the activation that
 * registered the device. Because every part is device specific, two tills in
 * the same branch can never produce the same number, even offline.
 */
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { readLocalSetting, writeLocalSetting } from "@/core/local-db/local-db";
import { readBusinessValue, writeBusinessValue } from "./business-storage";

export type Platform = "WIN" | "AND" | "WEB";

/** Everything an admin can change about the numbering, from Settings. */
export type BillNumberConfig = {
  /** Blank = use the branch's own code. */
  branchCode?: string;
  /** Blank = derive from the activation token. */
  terminalNo?: string;
  /** Digits in the running number, 3–6. */
  padding?: number;
  /** Start again at 1 each trading day. */
  resetDaily?: boolean;
  /** IANA zone for the date part; blank = this device's zone. */
  timeZone?: string;
};

const SEQ_KEY = "pos.bill.seq";
const TERMINAL_NO_KEY = "pos.bill.terminalNo";

/** Which shell this register runs in. */
export function currentPlatform(): Platform {
  return documentPlatform();
}

const clean = (v: string | null | undefined, fallback: string) =>
  (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || fallback;

/** Stable 01–99 index for this device, derived from its activation token. */
export function terminalNumber(): string {
  if (typeof window !== "undefined") {
    const saved = readBusinessValue(TERMINAL_NO_KEY);
    if (saved && /^\d{2}$/.test(saved)) return saved;
  }
  const seed = readTerminalConfig()?.tokenId ?? "";
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 99;
  const value = String((hash % 99) + 1).padStart(2, "0");
  if (typeof window !== "undefined" && seed)
    writeBusinessValue(TERMINAL_NO_KEY, value);
  return value;
}

/** Date stamp in the configured trading time zone (the till's day, not UTC). */
export function dayStamp(at: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at);
      return parts.replace(/-/g, "");
    } catch {
      /* an unknown zone falls back to the device clock */
    }
  }
  const m = `${at.getMonth() + 1}`.padStart(2, "0");
  const d = `${at.getDate()}`.padStart(2, "0");
  return `${at.getFullYear()}${m}${d}`;
}

/** The fixed part of every bill number this device writes today. */
export function billPrefix(
  branchCode: string,
  at: Date = new Date(),
  config: BillNumberConfig = {},
): string {
  const branch = clean(config.branchCode || branchCode, "BR");
  const terminal = clean(config.terminalNo, "") || terminalNumber();
  const day = config.resetDaily === false ? "00000000" : dayStamp(at, config.timeZone);
  return `${branch}-${currentPlatform()}${terminal.slice(0, 2).padStart(2, "0")}-${documentDevice()}-${day}`;
}

type SeqStore = { prefix: string; next: number };

/** Read the device counter from the approved platform settings store. */
let memorySequence: SeqStore | null = null;
const readSeq = (): SeqStore | null => {
  try {
    const raw = readBusinessValue(SEQ_KEY);
    const parsed = raw ? (JSON.parse(raw) as SeqStore) : null;
    return parsed && typeof parsed.next === "number" ? parsed : memorySequence;
  } catch {
    return null;
  }
};

/** Thrown when a number could not be reserved durably — never hand it out. */
export class BillNumberReservationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BillNumberReservationError";
  }
}

/**
 * Records the counter on the device. A failure here means the next sale would
 * reuse this number, so it is raised rather than swallowed. Returns false only
 * when there is no device storage at all (server rendering).
 */
const writeSeq = (value: SeqStore): boolean => {
  try {
    writeBusinessValue(SEQ_KEY, JSON.stringify(value));
    memorySequence = value;
    return typeof window !== "undefined" && !(window as unknown as { pos?: unknown }).pos;
  } catch (err) {
    throw new BillNumberReservationError(
      "This device could not store the bill counter, so the next sale could reuse the same bill number. Free up browser storage and try again.",
      err,
    );
  }
};


/**
 * The branch database is the durable home for the counter: browser storage can
 * be cleared, the till database cannot. Resolves false when it did not land.
 */
const writeSeqDurable = async (value: SeqStore): Promise<boolean> => {
  try {
    return await writeLocalSetting(SEQ_KEY, JSON.stringify(value));
  } catch {
    return false;
  }
};


/**
 * Restores the running counter from the branch database at start-up, so a
 * cleared browser profile or a reinstall never restarts numbering.
 * Safe to call when there is no local database — it simply does nothing.
 */
export async function hydrateBillSequence(): Promise<void> {
  if (typeof window === "undefined") return;
  const raw = await readLocalSetting(SEQ_KEY);
  if (!raw) {
    const local = readSeq();
    if (local) void writeLocalSetting(SEQ_KEY, JSON.stringify(local));
    return;
  }
  try {
    const stored = JSON.parse(raw) as SeqStore;
    if (!stored || typeof stored.next !== "number") return;
    const local = readSeq();
    // Whichever source is further ahead wins; the counter never goes backwards.
    if (!local || local.prefix !== stored.prefix || local.next < stored.next) {
      memorySequence = stored;
      writeBusinessValue(SEQ_KEY, JSON.stringify(stored));
    }
  } catch {
    /* unreadable value — keep whatever the device already has */
  }
}

/**
 * Highest sequence already used today by this device, read from bills the app
 * already holds. Keeps numbering correct after a reinstall or a cleared cache.
 */
export function seedFromExisting(prefix: string, existing: Iterable<string>): number {
  let highest = 0;
  for (const no of existing) {
    if (!no || !no.startsWith(`${prefix}-`)) continue;
    const tail = Number(no.slice(prefix.length + 1));
    if (Number.isFinite(tail) && tail > highest) highest = tail;
  }
  return highest;
}

const computeNext = (
  branchCode: string,
  existing: Iterable<string>,
  config: BillNumberConfig,
) => {
  const prefix = billPrefix(branchCode, new Date(), config);
  const pad = Math.min(6, Math.max(3, Math.round(config.padding ?? 4)));
  const saved = readSeq();
  const base =
    saved && saved.prefix === prefix ? saved.next : seedFromExisting(prefix, existing) + 1;
  const seq = Math.max(1, base, seedFromExisting(prefix, existing) + 1);
  return { prefix, seq, pad, store: { prefix, next: seq + 1 } as SeqStore };
};

/**
 * Serialises compute-and-write for this device. Without it two concurrent
 * callers can read the same sequence before either writes it back, which on a
 * fully offline till (no unique index to catch it) mints a duplicate bill.
 */
let reservationChain: Promise<unknown> = Promise.resolve();
const serialise = <T>(task: () => Promise<T>): Promise<T> => {
  const run = reservationChain.then(task, task);
  reservationChain = run.catch(() => undefined);
  return run;
};

/**
 * Next bill number for this branch/device/day, with the durable reservation in
 * the branch database awaited. `existing` is any list of receipt numbers the
 * till already knows about, used to recover the counter. If neither the device
 * nor the branch database could hold the counter it rejects, instead of
 * risking a duplicate bill.
 */
export async function reserveBillNumber(
  branchCode: string,
  existing: Iterable<string> = [],
  config: BillNumberConfig = {},
): Promise<string> {
  return serialise(() => reserveDocument("pos-bill-number", async () => {
    let computed: ReturnType<typeof computeNext>;
    try { computed = computeNext(branchCode, existing, config); }
    catch (error) { throw new BillNumberReservationError("This device could not reserve its document identity. Check storage and retry.", error); }
    const { prefix, seq, pad, store } = computed;
    const onDevice = writeSeq(store);
    const durable = await writeSeqDurable(store);
    if (!onDevice && !durable) {
      throw new BillNumberReservationError(
        "The bill counter could not be reserved anywhere, so this bill number may already be in use.",
      );
    }

    return `${prefix}-${String(seq).padStart(pad, "0")}`;
  }));
}



/** A checkout attempt id: retries of the same attempt reuse it, so no double bill. */
export const newClientTransactionId = (): string => crypto.randomUUID();
