import { AlertCircle, Download } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const hosts = new Map<boolean, HTMLSpanElement>();
const listeners = new Set<() => void>();
const hostSnapshot = () => hosts.get(typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 768px)").matches) ?? null;
const noHost = () => null;
function subscribeHost(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("resize", listener);
  return () => { listeners.delete(listener); window.removeEventListener("resize", listener); };
}

/** Both responsive headers register a slot; only the visible one receives the action. */
export function NativeUpdateSlot({ desktop = false }: { desktop?: boolean }) {
  const register = useCallback((element: HTMLSpanElement | null) => {
    if (element) hosts.set(desktop, element); else hosts.delete(desktop);
    for (const listener of listeners) listener();
  }, [desktop]);
  return <span ref={register} className="inline-flex shrink-0 empty:hidden" />;
}

type Props = {
  label: string;
  detail: string;
  progress?: number;
  busy?: boolean;
  error?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** A native-only update action. Platform wrappers own downloads and installation. */
export function NativeUpdateOrb({ label, detail, progress, busy = false, error = false, disabled = false, onClick }: Props) {
  const host = useSyncExternalStore(subscribeHost, hostSnapshot, noHost);
  const measured = typeof progress === "number" && Number.isFinite(progress);
  const percent = measured ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  const control = <div className={host ? "inline-flex shrink-0" : "fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-50"} role="status" aria-live="polite">
    <button type="button" aria-label={`${label}. ${detail}`} title={`${label} — ${detail}`} onClick={onClick} disabled={disabled || busy}
      className={`relative grid ${host ? "size-9" : "size-12"} shrink-0 place-items-center rounded-full border border-border bg-card text-primary shadow-sm disabled:cursor-default disabled:opacity-90`}>
      {busy && <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${measured ? percent * 1.3195 : 33} 132`} className={measured ? "" : "animate-spin"} />
      </svg>}
      {error ? <AlertCircle className="size-5 text-destructive" aria-hidden="true" /> : <Download className="size-5" aria-hidden="true" />}
    </button>
    <span className="sr-only">{detail}</span>
  </div>;
  return host ? createPortal(control, host) : control;
}
