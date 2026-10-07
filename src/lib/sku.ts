/**
 * SKU numbering.
 *
 * The catalog is shared by every branch, so SKUs must never collide. In
 * "auto" mode the till stamps a plain running number (SKU-000123) on new
 * products; in "manual" mode the operator types their own code.
 *
 * Formatting preferences live on the terminal. Number ownership does not:
 * Supabase atomically leases ranges from one global counter shared by every
 * cluster. A till can consume its current lease offline without colliding with
 * another till, and cluster merges never require SKU renumbering.
 */
import { supabaseConfig } from "@/lib/external-supabase-config";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { reserveSkuLease } from "@/lib/sku.functions";
export type SkuMode = "auto" | "manual";

export type SkuSettings = {
  mode: SkuMode;
  prefix: string;
  /** number that will be used for the next generated SKU */
  next: number;
  /** digits the running number is padded to */
  pad: number;
};

const KEY = "pos.sku.settings";
const LEASE_KEY = "pos.sku.global-lease.v1";
const DEFAULT_LEASE_SIZE = 250;

type SkuLease = {
  id: string;
  start: number;
  end: number;
  next: number;
  prefix: string;
  pad: number;
  project: string;
};

// Web Storage is a cache, not the source of truth. A browser whose quota is
// already full must still be able to consume the server-reserved range for
// the rest of this session. Without this in-memory copy every imported row
// reserved another 250 numbers, then failed when localStorage rejected the
// lease write.
let volatileLease: SkuLease | null = null;

export type SkuContext = { storeId?: string | null; terminalId?: string | null };

export const defaultSkuSettings: SkuSettings = {
  mode: "auto",
  prefix: "SKU-",
  next: 1,
  pad: 6,
};

const listeners = new Set<() => void>();
const isBrowser = () => typeof window !== "undefined";

export function readSkuSettings(): SkuSettings {
  if (!isBrowser()) return defaultSkuSettings;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultSkuSettings;
    return { ...defaultSkuSettings, ...(JSON.parse(raw) as Partial<SkuSettings>) };
  } catch {
    return defaultSkuSettings;
  }
}

export function writeSkuSettings(patch: Partial<SkuSettings>) {
  if (!isBrowser()) return;
  const merged = { ...readSkuSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // A full browser cache must not turn an already reserved SKU into a failed
    // product save. The active lease remains available in memory.
  }
  for (const l of listeners) l();
}

export function subscribeSku(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatSku(s: SkuSettings, n: number) {
  return `${s.prefix}${String(n).padStart(Math.max(1, s.pad), "0")}`;
}

function readLease(settings = readSkuSettings()): SkuLease | null {
  if (!isBrowser()) return null;
  const project = currentProjectIdentity();
  const valid = (value: SkuLease | null) =>
    !!value &&
    value.project === project &&
    value.prefix === settings.prefix &&
    value.pad === settings.pad &&
    Number.isSafeInteger(value.next) &&
    Number.isSafeInteger(value.end) &&
    value.next <= value.end;
  if (valid(volatileLease)) return volatileLease;
  try {
    const value = JSON.parse(window.localStorage.getItem(LEASE_KEY) ?? "null") as SkuLease | null;
    if (!valid(value)) return null;
    volatileLease = value;
    return value;
  } catch {
    return null;
  }
}

function currentProjectIdentity(): string {
  try {
    return new URL(supabaseConfig("pos").url).host.toLowerCase();
  } catch {
    return "";
  }
}

function writeLease(lease: SkuLease) {
  if (!isBrowser()) return;
  volatileLease = lease;
  try {
    window.localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
  } catch {
    // Keep using the unique server-owned range in memory. Losing unused
    // numbers on reload is safe; reserving the same number twice is not.
  }
}

type LeaseRow = {
  lease_id: string;
  start_value: number | string;
  end_value: number | string;
  prefix: string;
  padding: number;
};

// Keep allocation within one renderer strictly ordered. A single browser or
// Electron window can create products from imports, barcode search and the
// inventory form at the same time; without this queue they could all read the
// same `lease.next` value before any caller persisted its increment.
let allocationQueue: Promise<void> = Promise.resolve();

async function reserveLease(settings: SkuSettings, context: SkuContext, count: number) {
  const result = await reserveSkuLease({
    data: {
      ...(await getPosCallerAuth()),
      count: Math.max(DEFAULT_LEASE_SIZE, Math.min(5000, count)),
      storeId: context.storeId?.trim() || undefined,
      terminalId: context.terminalId?.trim() || undefined,
      prefix: settings.prefix,
      padding: settings.pad,
    },
  });
  if (!result.ok) throw new Error(result.error);
  const row = result.lease as LeaseRow;
  const start = Number(row?.start_value);
  const end = Number(row?.end_value);
  if (!row?.lease_id || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start)
    throw new Error("The central SKU service returned an invalid number range.");
  const lease: SkuLease = {
    id: row.lease_id,
    start,
    end,
    next: start,
    prefix: String(row.prefix ?? settings.prefix),
    pad: Number(row.padding ?? settings.pad),
    project: currentProjectIdentity(),
  };
  if (!lease.project) throw new Error("The POS database identity is unavailable on this terminal.");
  writeLease(lease);
  return lease;
}

/** Highest running number already used in the catalog, for this prefix. */
export function highestUsed(skus: string[], prefix: string): number {
  let top = 0;
  for (const sku of skus) {
    if (!sku.startsWith(prefix)) continue;
    const n = Number(sku.slice(prefix.length));
    if (Number.isFinite(n) && n > top) top = n;
  }
  return top;
}

/**
 * Next free SKU. Existing catalog codes win over the stored counter, so a
 * branch that syncs new products never hands out a duplicate.
 */
async function allocateNextSku(existing: string[], context: SkuContext): Promise<string> {
  const s = readSkuSettings();
  let lease = readLease(s);
  if (!lease) {
    try {
      lease = await reserveLease(s, context, 1);
    } catch (error) {
      throw new Error(
        "No globally reserved SKU numbers are available offline. Connect this till once and try again.",
        { cause: error },
      );
    }
  }
  if (!lease) throw new Error("The reserved SKU range could not be saved on this terminal.");
  const used = new Set(existing);
  let allocated = lease.next;
  while (allocated <= lease.end && used.has(formatSku(s, allocated))) allocated += 1;
  if (allocated > lease.end) {
    throw new Error(
      "Every number in this terminal's reserved SKU range is already present. Synchronize the catalogue before reserving another range.",
    );
  }
  const code = formatSku(s, allocated);
  writeLease({ ...lease, next: allocated + 1 });
  writeSkuSettings({ next: allocated + 1 });
  return code;
}

export function nextSku(existing: string[], context: SkuContext = {}): Promise<string> {
  const run = () => allocateNextSku(existing, context);
  const locks =
    typeof navigator !== "undefined"
      ? (
          navigator as unknown as {
            locks?: {
              request: (name: string, callback: () => Promise<string>) => Promise<string>;
            };
          }
        ).locks
      : undefined;
  if (locks) return locks.request("pos-global-sku-lease", run);
  const allocation = allocationQueue.then(run);
  allocationQueue = allocation.then(
    () => undefined,
    () => undefined,
  );
  return allocation;
}

/** Preview the next code without consuming it. */
export function peekSku(existing: string[]): string {
  const s = readSkuSettings();
  const lease = readLease(s);
  if (!lease) return `${s.prefix}${"•".repeat(Math.max(1, s.pad))}`;
  const used = new Set(existing);
  let candidate = lease.next;
  while (candidate <= lease.end && used.has(formatSku(s, candidate))) candidate += 1;
  return candidate <= lease.end
    ? formatSku(s, candidate)
    : `${s.prefix}${"•".repeat(Math.max(1, s.pad))}`;
}

/** Keep an offline range ready without consuming a number. */
export async function primeSkuLease(context: SkuContext = {}): Promise<boolean> {
  const settings = readSkuSettings();
  if (settings.mode !== "auto" || readLease(settings)) return true;
  try {
    await reserveLease(settings, context, 1);
    return true;
  } catch {
    return false;
  }
}
