import type { CartLine, PaymentDetails, PaymentMethod } from "@/core/types/pos-types";

export const DISPLAY_CHANNEL = "pos-customer-display";
export const DISPLAY_STORAGE_KEY = "pos.display.snapshot";

export type DisplayLine = {
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
  discount: number;
  foc?: boolean;
  credit?: boolean;
};

export type DisplaySnapshot = {
  at: number;
  mode: "idle" | "cart" | "paid" | "booking" | "transfer";
  companyName: string;
  /** configured business mark shown on the customer-facing display */
  logo?: string;
  storeName: string;
  cashier: string;
  memberName: string | null;
  memberPoints: number | null;
  lines: DisplayLine[];
  subtotal: number;
  discount: number;
  tax: number;
  /** Effective global percentage used on this ticket. */
  taxRate?: number;
  /** Explicit switch so a zero-valued taxable ticket is distinct from tax being disabled. */
  taxEnabled?: boolean;
  total: number;
  /** paid / change / balance figures for the "paid" and "booking" modes */
  paid: number;
  change: number;
  balance: number;
  reference: string;
  dueDate: string;
  promos: string[];
  payment: PaymentDetails | null;
  /** tender the cashier has selected, drives the transfer instructions */
  method: PaymentMethod | null;
  /** bank-transfer slip reference typed by the cashier */
  transferRef: string;
};

export const toDisplayLine = (l: CartLine, lineTotal: number): DisplayLine => ({
  name: l.name,
  qty: l.qty,
  price: l.price,
  lineTotal,
  discount: l.discount || 0,
  foc: l.foc,
  credit: l.credit,
});

let channel: BroadcastChannel | null = null;
const chan = () => {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(DISPLAY_CHANNEL);
  return channel;
};

/** Push the latest counter state to any open customer-facing window. */
export function publishDisplay(snapshot: DisplaySnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* storage full or blocked — the broadcast still works */
  }
  try {
    chan()?.postMessage(snapshot);
  } catch {
    /* a disconnected secondary display must never interrupt checkout */
  }
}

/** Subscribe on the customer screen. Returns an unsubscribe function. */
export function subscribeDisplay(cb: (s: DisplaySnapshot) => void) {
  const c = chan();
  const onMessage = (e: MessageEvent<DisplaySnapshot>) => cb(e.data);
  c?.addEventListener("message", onMessage);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISPLAY_STORAGE_KEY && e.newValue) {
      try {
        cb(JSON.parse(e.newValue) as DisplaySnapshot);
      } catch {
        /* ignore malformed payloads */
      }
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    c?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}

export function readDisplaySnapshot(): DisplaySnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DisplaySnapshot) : null;
  } catch {
    return null;
  }
}

/** Key written when the till shuts down, so popups opened before a refresh
 *  still hear about it through the `storage` event. */
export const DISPLAY_SHUTDOWN_KEY = "pos.display.shutdown";

type ShutdownMessage = { __posDisplay: "shutdown"; at: number };

const isShutdown = (v: unknown): v is ShutdownMessage =>
  !!v && typeof v === "object" && (v as ShutdownMessage).__posDisplay === "shutdown";

/** Popup handle for the display opened from this till window. */
let popup: Window | null = null;

export function openCustomerDisplay() {
  popup = window.open(
    "/display",
    "pos-customer-display",
    "width=1024,height=768,menubar=no,toolbar=no,location=no,status=no",
  );
  return popup;
}

/** Close only the window currently showing the customer display. Electron's
 *  secondary BrowserWindow has no `window.opener`, so browser-history fallback
 *  would navigate that monitor into the privileged till instead of closing it. */
export function closeCurrentCustomerDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.pos?.closeWindow) {
    void window.pos.closeWindow();
    return true;
  }
  if (window.opener) {
    window.close();
    return true;
  }
  return false;
}

/** Close the customer screen: the popup we own plus any other window
 *  listening on the channel (second monitor, another tab). */
export function closeCustomerDisplay() {
  if (typeof window === "undefined") return;
  const message: ShutdownMessage = { __posDisplay: "shutdown", at: Date.now() };
  try {
    chan()?.postMessage(message);
  } catch {
    /* channel already closed */
  }
  try {
    window.localStorage.setItem(DISPLAY_SHUTDOWN_KEY, String(message.at));
    window.localStorage.removeItem(DISPLAY_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    /* cross-origin or already gone */
  }
  popup = null;
}

/** Subscribe on the customer screen to till shutdown. Returns unsubscribe. */
export function subscribeDisplayShutdown(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const c = chan();
  const onMessage = (e: MessageEvent<unknown>) => {
    if (isShutdown(e.data)) cb();
  };
  c?.addEventListener("message", onMessage);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISPLAY_SHUTDOWN_KEY && e.newValue) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    c?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}
