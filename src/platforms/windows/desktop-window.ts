/**
 * Renderer side of the in-window title bar buttons. In the browser build there
 * is no bridge, so the hook reports unsupported and the strip stays hidden.
 */
import { setUpdateTicketBusy } from "@/lib/update-safety";
import { useCallback, useEffect, useState } from "react";

type WindowBridge = {
  minimizeWindow?: () => Promise<unknown>;
  toggleMaximizeWindow?: () => Promise<{ maximized?: boolean }>;
  closeWindow?: () => Promise<unknown>;
  isWindowMaximized?: () => Promise<{ maximized: boolean }>;
  onWindowState?: (cb: (s: { maximized: boolean }) => void) => () => void;
};

const bridge = (): WindowBridge | null =>
  typeof window === "undefined"
    ? null
    : ((window as unknown as { pos?: WindowBridge }).pos ?? null);

/** Set by the register so closing mid-ticket asks for confirmation. */
let ticketDirty = false;
export const setTicketDirty = (dirty: boolean) => {
  ticketDirty = dirty;
  setUpdateTicketBusy(dirty);
};
export const isTicketDirty = () => ticketDirty;

export function useWindowControls() {
  const [supported, setSupported] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = bridge();
    if (!api?.minimizeWindow) return;
    setSupported(true);
    void api.isWindowMaximized?.().then((s) => setMaximized(!!s?.maximized));
    return api.onWindowState?.((s) => setMaximized(!!s.maximized));
  }, []);

  const minimize = useCallback(() => void bridge()?.minimizeWindow?.(), []);
  const toggleMaximize = useCallback(async () => {
    const res = await bridge()?.toggleMaximizeWindow?.();
    if (res && typeof res.maximized === "boolean") setMaximized(res.maximized);
  }, []);
  const close = useCallback(() => void bridge()?.closeWindow?.(), []);

  return { supported, maximized, minimize, toggleMaximize, close };
}