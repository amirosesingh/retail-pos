/**
 * Receipt-printer plumbing shared by the browser and the Electron till.
 *
 * In the desktop shell the preload bridge prints silently (no Windows print
 * dialog) and can push raw ESC/POS bytes to kick the cash drawer. In a browser
 * neither exists, so callers fall back to the classic hidden-iframe print.
 */

import { isMobileShell } from "@/platform-config/features";
import type { SlipEncoding, SlipLineEnding } from "./escpos";

const PRINTER_KEY = "pos-receipt-printer-v1";

type PrintResult = { ok: boolean; error?: string };

type PrintBridge = {
  print?: (
    html: string,
    options?: { deviceName?: string; paper?: string; dialog?: boolean },
  ) => Promise<PrintResult>;
  printRaw?: (
    bytes: number[],
    options?: { deviceName?: string; share?: string },
  ) => Promise<PrintResult>;
  openDrawer?: (value: {
    reason: string;
    shiftId?: string | null;
    pin?: 2 | 5;
    printer?: { deviceName?: string; share?: string };
  }) => Promise<PrintResult & { eventId?: string; code?: string }>;
  listPrinters?: () => Promise<{
    ok: boolean;
    printers: { name: string; displayName: string; isDefault: boolean }[];
  }>;
};

export type PrinterPrefs = {
  /** Empty string means "use the Windows default printer". */
  deviceName: string;
  /** Shared name used for the raw drawer pulse; defaults to the device name. */
  share: string;
  /** Drawer connector pin the printer pulses: 2 (standard) or 5. */
  drawerPin?: 2 | 5;
  /**
   * How slips reach the printer on the desktop till.
   * `dialog` = normal Windows print dialog through the printer driver.
   * `direct` = same driver rendering, sent straight to the printer, no dialog.
   * `thermal` = ESC/POS text through the RAW spooler (no driver).
   */
  printMode?: "dialog" | "direct" | "thermal";
  /** Character encoding used for raw ESC/POS text on this printer. */
  encoding?: SlipEncoding;
  /** Line terminator this printer expects: LF or CRLF. */
  lineEnding?: SlipLineEnding;
  /** Page margins in millimetres applied to every printed document. */
  margins?: { top: number; right: number; bottom: number; left: number };
  /**
   * Real printable band of the roll, per paper size, in millimetres.
   * 58mm rolls only print about 48mm; 80mm rolls about 72mm. A printer that
   * starts a few millimetres further right can be nudged with `printOffset`.
   */
  printWidth?: { "30mm"?: number; "58mm": number; "80mm": number };
  /** Left nudge in millimetres applied to slip printing. */
  printOffset?: number;
};

const EMPTY: PrinterPrefs = {
  deviceName: "",
  share: "",
  drawerPin: 2,
  printMode: "dialog",
  encoding: "cp437",
  lineEnding: "lf",
  margins: { top: 4, right: 4, bottom: 4, left: 4 },
  printWidth: { "30mm": 24, "58mm": 48, "80mm": 72 },
  printOffset: 0,
};

const mm = (v: unknown, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(0, Math.round(n * 10) / 10));
};

function normalizeMargins(v: unknown): NonNullable<PrinterPrefs["margins"]> {
  const m = (v ?? {}) as Partial<NonNullable<PrinterPrefs["margins"]>>;
  return {
    top: mm(m.top, 4),
    right: mm(m.right, 4),
    bottom: mm(m.bottom, 4),
    left: mm(m.left, 4),
  };
}

const ENCODINGS: SlipEncoding[] = ["ascii", "cp437", "cp850", "cp858", "utf8"];

function normalizeWidths(v: unknown): NonNullable<PrinterPrefs["printWidth"]> {
  const w = (v ?? {}) as Partial<NonNullable<PrinterPrefs["printWidth"]>>;
  const clamp = (n: unknown, fallback: number, min: number, max: number) => {
    const x = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(max, Math.max(min, Math.round(x * 10) / 10));
  };
  return {
    "30mm": clamp(w["30mm"], 24, 20, 30),
    "58mm": clamp(w["58mm"], 48, 30, 58),
    "80mm": clamp(w["80mm"], 72, 50, 80),
  };
}

function normalizeEncoding(v: unknown): SlipEncoding {
  return ENCODINGS.includes(v as SlipEncoding) ? (v as SlipEncoding) : "cp437";
}

function normalizeLineEnding(v: unknown): SlipLineEnding {
  return v === "crlf" ? "crlf" : "lf";
}

function normalizeMode(mode: unknown): "dialog" | "direct" | "thermal" {
  if (mode === "thermal") return "thermal";
  // Legacy value written by earlier versions.
  if (mode === "direct" || mode === "graphics") return "direct";
  return "dialog";
}

export function printBridge(): PrintBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { pos?: PrintBridge }).pos;
  return bridge && typeof bridge.print === "function" ? bridge : null;
}

let sharedPrefs: PrinterPrefs | undefined;
export function setSharedPrinterPrefs(prefs: PrinterPrefs | undefined) { sharedPrefs = prefs; }

export function getPrinterPrefs(): PrinterPrefs {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = sharedPrefs ? null : window.localStorage.getItem(PRINTER_KEY);
    if (!sharedPrefs && !raw) return EMPTY;
    const parsed = sharedPrefs ?? JSON.parse(raw!) as Partial<PrinterPrefs>;
    return {
      deviceName: parsed.deviceName ?? "",
      share: parsed.share ?? "",
      drawerPin: parsed.drawerPin === 5 ? 5 : 2,
      printMode: normalizeMode(parsed.printMode),
      encoding: normalizeEncoding(parsed.encoding),
      lineEnding: normalizeLineEnding(parsed.lineEnding),
      margins: normalizeMargins(parsed.margins),
      printWidth: normalizeWidths(parsed.printWidth),
      printOffset: mm(parsed.printOffset, 0),
    };
  } catch {
    return EMPTY;
  }
}

export function setPrinterPrefs(prefs: PrinterPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRINTER_KEY, JSON.stringify(prefs));
}

export async function listPrinters() {
  const bridge = printBridge();
  if (!bridge?.listPrinters) return [];
  const res = await bridge.listPrinters();
  return res.ok ? res.printers : [];
}

export type PulseResult = { handled: boolean; ok: boolean; error?: string };

/**
 * Silent print through Electron.
 * `handled: false` means there is no desktop bridge (plain browser).
 */
export async function silentPrint(
  html: string,
  paper?: string,
  dialog = false,
): Promise<PulseResult> {
  const bridge = printBridge();
  if (!bridge?.print) return { handled: false, ok: false };
  const { deviceName } = getPrinterPrefs();
  try {
    const res = await bridge.print(html, {
      ...(deviceName ? { deviceName } : {}),
      ...(paper ? { paper } : {}),
      ...(dialog ? { dialog: true } : {}),
    });
    if (!res?.ok && import.meta.env.DEV) console.error("Silent print failed");
    return { handled: true, ok: !!res?.ok, ...(res?.error ? { error: res.error } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error("Silent print failed");
    return { handled: true, ok: false, error };
  }
}

/**
 * Raw ESC/POS pulse for the cash drawer.
 * `handled: false` means there is no desktop bridge (plain browser).
 */
export async function rawPulse(bytes: number[]): Promise<PulseResult> {
  const bridge = printBridge();
  if (!bridge?.printRaw) return { handled: false, ok: false };
  const { deviceName, share } = getPrinterPrefs();
  try {
    const res = await bridge.printRaw(bytes, {
      ...(deviceName ? { deviceName } : {}),
      ...(share ? { share } : {}),
    });
    if (!res?.ok && import.meta.env.DEV) console.error("Drawer kick failed");
    return { handled: true, ok: !!res?.ok, ...(res?.error ? { error: res.error } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error("Drawer kick failed");
    return { handled: true, ok: false, error };
  }
}

/** Protected desktop drawer command. Main rechecks the signed-in permission and records the event. */
export async function protectedDrawerOpen(
  reason: string,
  shiftId?: string | null,
): Promise<PulseResult & { eventId?: string }> {
  const bridge = printBridge();
  if (!bridge?.openDrawer) return { handled: false, ok: false };
  const { deviceName, share, drawerPin } = getPrinterPrefs();
  try {
    const result = await bridge.openDrawer({
      reason,
      shiftId: shiftId ?? null,
      pin: drawerPin === 5 ? 5 : 2,
      printer: { ...(deviceName ? { deviceName } : {}), ...(share ? { share } : {}) },
    });
    return { handled: true, ok: !!result.ok, ...(result.error ? { error: result.error } : {}), ...(result.eventId ? { eventId: result.eventId } : {}) };
  } catch (error) {
    return { handled: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Receipt hardware is Windows-only. The desktop shell talks to the printer
 * directly; a browser can still fall back to its own print dialog, but the
 * phone build has neither, so the buttons are shown as unavailable there.
 */
export function canPrintReceipts(): boolean {
  return !isMobileShell();
}

/** A cash drawer only opens through a printer, so it follows the same rule. */
export function canOpenDrawer(): boolean {
  return printBridge() !== null || !isMobileShell();
}

/** ESC/POS drawer kick bytes for the configured connector pin. */
export function drawerPulseBytes(): number[] {
  const pin = getPrinterPrefs().drawerPin === 5 ? 1 : 0;
  return [0x1b, 0x70, pin, 0x19, 0xfa];
}
