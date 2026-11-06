import { useRef, type ReactNode } from "react";
import { useAuth } from "@/lib/pos-auth";
import { usePosOptional } from "@/lib/pos-store";
import { pageDataScope } from "@/lib/page-data-cache";
import { useConfirmedPresentation } from "@/lib/use-confirmed-presentation";
import { visibleMetricCards } from "@/lib/summary-metric-visibility";
import { SummaryCardRail } from "./SummaryCardRail";

type AuditPresentation = { scope: string; revision: number; ready: boolean; error: string };
function auditPresentation(witness: string | undefined): AuditPresentation | null {
  if (witness === undefined) return null;
  try {
    const value = JSON.parse(witness);
    return typeof value.scope === "string" && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      typeof value.ready === "boolean" && typeof value.error === "string" ? value : { scope: "", revision: 0, ready: false, error: "" };
  } catch { return { scope: "", revision: 0, ready: false, error: "" }; }
}

/** Reuses current readers' evidence; no requests, timers or numeric calculation. */
export function ConfirmedMetricCards({ label, scope, ready, auditWitness, children }: {
  label: string; scope: string; ready: boolean; auditWitness?: string; children: ReactNode;
}) {
  const { ready: authReady, user } = useAuth();
  const pos = usePosOptional();
  const authority = JSON.stringify(pageDataScope(user));
  const audit = auditPresentation(auditWitness);
  const auditAuthority = useRef<{ authority: string; scope: string; after: number } | null>(null);
  if (audit) {
    const previous = auditAuthority.current;
    if (!previous || previous.authority !== authority || previous.scope !== audit.scope)
      auditAuthority.current = { authority, scope: audit.scope,
        after: previous?.scope === audit.scope && previous.authority !== authority ? audit.revision : -1 };
  }
  const auditReady = !audit || (audit.ready && audit.revision > (auditAuthority.current?.after ?? -1));
  const key = authReady && user ? JSON.stringify([authority, pos?.currentStore?.id, scope, audit?.scope]) : null;
  const confirmed = useConfirmedPresentation(key, visibleMetricCards(children), ready && pos?.ready === true && auditReady);
  return <>
    {audit?.error && <p role="alert" className="text-sm text-destructive">Summary refresh unavailable: {audit.error}</p>}
    {audit && !auditReady && !audit.error && !confirmed && <p role="status" className="text-sm text-muted-foreground">Saved activity summary has not been confirmed.</p>}
    {confirmed && confirmed.length > 0 && <SummaryCardRail label={label}>{confirmed}</SummaryCardRail>}
  </>;
}
