import { Table } from "@/components/ui/table";
import { copyText } from "@/platform-config/clipboard";
/**
 * "Schema & Feature Health" — every POS feature checked against the live
 * database with the exact query shapes the screens use. Nothing is written.
 */
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";
import {
  formatFeatureSchemaReport,
  runFeatureSchemaAudit,
  type FeatureSchemaReport as Report,
} from "@/core/types/feature-schema";

export function FeatureSchemaReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const rep = await runFeatureSchemaAudit();
      setReport(rep);
      if (rep.error) toast.error("Could not read the live table list", { description: rep.error });
      else {
        const bad = rep.features.filter((f) => f.status !== "healthy").length;
        if (bad === 0) toast.success("Every feature matches the live database");
        else toast.warning(`${bad} feature${bad === 1 ? "" : "s"} need a schema fix`);
      }
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await copyText(formatFeatureSchemaReport(report));
      toast.success("Report copied");
    } catch {
      toast.error("This device would not allow copying");
    }
  };

  const broken = report?.features.filter((f) => f.status !== "healthy").length ?? 0;

  return (
    <section className="w-full max-w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Feature &amp; schema health</h2>
          <p className="text-xs text-muted-foreground">
            Runs each feature&apos;s real read and save shapes against the live database — missing
            tables, renamed columns and required fields the till never sends. Nothing is changed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            {busy ? "Checking features…" : "Check features"}
          </Button>
          <Button size="sm" variant="outline" disabled={!report} onClick={() => void copy()}>
            Copy
          </Button>
        </div>
      </div>

      {report?.error && <p className="text-xs text-destructive">{report.error}</p>}

      {report && !report.error && (
        <p className="text-xs text-muted-foreground">
          {broken === 0
            ? "Every feature payload matches the live database."
            : `${broken} feature${broken === 1 ? "" : "s"} need attention.`}
        </p>
      )}

      {report && (
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <Table tableId="platforms/web/components/pos/settings/panels/FeatureSchemaReport.native#1" clientDataControls={false} className="w-full min-w-0 text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Feature</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {report.features.map((f) => {
                const failed = f.ops.filter((o) => !o.ok);
                const expanded = open === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr
                      className="cursor-pointer border-t border-border hover:bg-muted/30"
                      onClick={() => setOpen(expanded ? null : f.id)}
                    >
                      <td className="px-3 py-2 font-medium">{f.name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            f.status === "healthy"
                              ? "rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600 dark:text-emerald-400"
                              : f.status === "skipped"
                                ? "rounded bg-muted px-2 py-0.5 text-muted-foreground"
                                : "rounded bg-destructive/15 px-2 py-0.5 text-destructive"
                          }
                        >
                          {f.status === "healthy"
                            ? "HEALTHY"
                            : f.status === "skipped"
                              ? "NOT CHECKED"
                              : "SCHEMA FIX REQUIRED"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {failed.length === 0
                          ? `${f.ops.length} checks passed`
                          : failed[0]!.detail}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={3} className="px-3 py-2">
                          <ul className="space-y-2">
                            {f.ops.map((op) => (
                              <li key={`${op.table}-${op.label}`} className="space-y-0.5">
                                <p className="font-medium">
                                  <span className={op.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                                    {op.ok ? "OK" : "FIX"}
                                  </span>{" "}
                                  {op.label} — <span className="font-mono">{op.table}</span>
                                </p>
                                <p className="text-muted-foreground">{op.detail}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">{op.source}</p>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
