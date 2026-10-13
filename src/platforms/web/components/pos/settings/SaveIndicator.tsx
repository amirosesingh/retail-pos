/**
 * One consistent "is my work stored?" read-out for every settings page.
 * Pages own their save logic; this only renders the state.
 */
import { Check, Loader2, TriangleAlert } from "lucide-react";

type Props = {
  dirty: boolean;
  saving: boolean;
  savedAt?: string | null;
  error?: string;
  className?: string;
  savedText?: string;
  dirtyText?: string;
};

export function SaveIndicator({
  dirty,
  saving,
  savedAt,
  error,
  className = "",
  savedText = "All changes saved",
  dirtyText = "Unsaved changes",
}: Props) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`flex min-w-0 items-start gap-2 break-words text-sm text-muted-foreground ${className}`}
    >
      {saving ? (
        <>
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none text-primary" /> Saving…
        </>
      ) : error ? (
        <>
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="text-destructive">Could not save — {error}</span>
        </>
      ) : dirty ? (
        <>
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /> {dirtyText}
        </>
      ) : (
        <>
          <Check className="mt-0.5 size-4 shrink-0 text-success" />
          {savedAt ? `${savedText} · ${savedAt}` : savedText}
        </>
      )}
    </span>
  );
}
