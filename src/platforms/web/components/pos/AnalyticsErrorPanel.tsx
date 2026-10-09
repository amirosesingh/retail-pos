/**
 * Explains exactly which reporting table or view the database refused and
 * which SQL file re-creates it, so the fix is one copy-paste away.
 */
import { useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoardError, type BoardIssue } from "@/lib/analytics-board";

const asIssues = (error: unknown): BoardIssue[] =>
  error instanceof BoardError
    ? error.issues
    : [
        {
          source: "reporting data",
          kind: "other",
          sqlFile: "supabase/schema.sql",
          detail: error instanceof Error ? error.message : String(error),
          advice: "Apply the pending reporting migrations using docs/database-upgrade.md. Use the full schema installer only for a fresh project.",
        },
      ];

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 shrink-0 px-2 text-[11px]"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy path"}
    </Button>
  );
}

export function AnalyticsErrorPanel({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const issues = asIssues(error);
  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <h2 className="truncate font-medium">The board could not read your sales figures.</h2>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={onRetry}>
            <RefreshCw className="size-3" /> Retry
          </Button>
        )}
      </header>

      <ul className="mt-3 space-y-2">
        {issues.map((i) => (
          <li key={i.source} className="rounded-md border border-border bg-card p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">{i.source}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {i.kind === "permission"
                    ? "Permission denied"
                    : i.kind === "missing"
                      ? "Object missing"
                      : "Read failed"}
                  {" — "}
                  {i.detail}
                </p>
                <p className="mt-1 text-xs">{i.advice}</p>
                <p className="numeric mt-1 break-all text-[11px] text-primary">{i.sqlFile}</p>
              </div>
              <CopyButton value={i.sqlFile} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
