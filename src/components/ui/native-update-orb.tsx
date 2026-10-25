import { AlertCircle, Download } from "lucide-react";

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
  const measured = typeof progress === "number" && Number.isFinite(progress);
  const percent = measured ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  return <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-50" role="status" aria-live="polite">
    <button type="button" aria-label={`${label}. ${detail}`} title={`${label} — ${detail}`} onClick={onClick} disabled={disabled || busy}
      className="relative grid size-12 place-items-center rounded-full border border-border bg-card text-primary shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95 disabled:cursor-default disabled:opacity-90">
      {busy && <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${measured ? percent * 1.3195 : 33} 132`} className={measured ? "" : "animate-spin"} />
      </svg>}
      {error ? <AlertCircle className="size-5 text-destructive" aria-hidden="true" /> : <Download className="size-5" aria-hidden="true" />}
    </button>
    <span className="sr-only">{detail}</span>
  </div>;
}
